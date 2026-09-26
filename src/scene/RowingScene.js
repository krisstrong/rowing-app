import * as THREE from 'three';
import { createWater } from './water.js';
import { createBoat } from './boat.js';
import { createRiver } from './river.js';
import { createMist } from './mist.js';
import { createWake } from './wake.js';
import { createSky } from './sky.js';

const FOG_COLOR = new THREE.Color('#1e2c4e');
const FOG_NEAR = 45;
const FOG_FAR = 270;
const SUN_DIRECTION = new THREE.Vector3(-0.35, 0.14, -1).normalize();

/** How long without a sample before the boat is assumed to have stopped. */
const SAMPLE_TIMEOUT_SEC = 1.5;

/** The pace boat rows the next lane over, and at a steady rating. */
const GHOST_LANE_OFFSET_M = -2.4;
const GHOST_STROKE_RATE = 24;
/** Past this gap it is lost in the fog either way, so stop drawing it. */
const GHOST_MAX_GAP_M = 400;

/** Where the chase camera aims; the reflection pass mirrors this. */
const LOOK_AT_HEIGHT = 0.6;
const LOOK_AT_Z = -4;

/** Keeps anything under the waterline out of the reflection. */
const REFLECTION_CLIP = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];

/**
 * The Mersey River through Kejimkujik at dawn. It consumes the same
 * RowingSample stream as the dashboard — distanceM drives the world scroll,
 * speedMps the camera feel, and strokeState the oars — and knows nothing about
 * where samples come from.
 */
export class RowingScene {
  #renderer;
  #scene;
  #camera;
  #water;
  #boat;
  #ghost;
  #river;
  #mist;
  #wake;
  #reflectionCamera;
  #reflectionTarget;
  #paceBoat = { enabled: false, gapM: 0 };
  #renderedGap = 0;
  #clock = new THREE.Clock();

  #distance = 0;
  #targetDistance = 0;
  #speed = 0;
  #targetSpeed = 0;
  #driving = false;
  #strokeRate = 22;
  #strokePhase = 0;
  #pitch = 0;
  #strokeFinished = false;
  #secondsSinceSample = 0;
  #running = false;
  #reducedMotion = false;

  constructor(canvas) {
    this.#reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.15;

    this.#scene = new THREE.Scene();
    this.#scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    this.#camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1400);
    this.#camera.position.set(0, 3.4, 11);

    this.#reflectionCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 1400);
    this.#reflectionTarget = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.#scene.add(createSky({ sunDirection: SUN_DIRECTION, horizonColor: FOG_COLOR }));

    this.#scene.add(new THREE.HemisphereLight('#5d82c0', '#0a1428', 1.1));
    const sun = new THREE.DirectionalLight('#ffd9a0', 1.7);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(-60);
    this.#scene.add(sun);

    // The sun is ahead of the boat, so without a fill the hull is all shadow.
    const fill = new THREE.DirectionalLight('#8fb0e8', 0.7);
    fill.position.set(6, 12, 20);
    this.#scene.add(fill);

    this.#water = createWater({
      fogColor: FOG_COLOR,
      fogNear: FOG_NEAR,
      fogFar: FOG_FAR,
      sunDirection: SUN_DIRECTION,
    });
    if (this.#reducedMotion) this.#water.setWaveAmplitude(0.3);
    this.#scene.add(this.#water.mesh);

    this.#boat = createBoat();
    this.#scene.add(this.#boat.group);

    this.#ghost = createBoat({ ghost: true });
    this.#ghost.group.visible = false;
    this.#ghost.group.position.x = GHOST_LANE_OFFSET_M;
    this.#scene.add(this.#ghost.group);

    this.#river = createRiver();
    this.#scene.add(this.#river.group);

    this.#mist = createMist();
    this.#scene.add(this.#mist.group);

    this.#wake = createWake();
    this.#scene.add(this.#wake.group);

    this.#resize();
    window.addEventListener('resize', () => this.#resize());
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#clock.start();
    const loop = () => {
      if (!this.#running) return;
      this.#frame(this.#clock.getDelta());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.#running = false;
  }

  /** Feed in the latest RowingSample. Safe to call at whatever rate they arrive. */
  applySample(sample) {
    this.#targetDistance = sample.distanceM;
    this.#targetSpeed = sample.speedMps;

    // A new drive means a new stroke, which by definition starts at the catch.
    // Without this the oars carry over wherever the recovery ramp had got to.
    const driving = sample.strokeState === 'driving';
    if (driving && !this.#driving) this.#strokePhase = 0;
    if (!driving && this.#driving) this.#strokeFinished = true;
    this.#driving = driving;
    if (sample.strokeRate > 0) this.#strokeRate = sample.strokeRate;
    this.#secondsSinceSample = 0;
  }

  /** @param state the PaceBoat's `state`, or anything with `enabled` and `gapM`. */
  updatePaceBoat(state) {
    // Snap on the way in, so enabling it doesn't slide the ghost up from wherever
    // the last race left off.
    if (state.enabled && !this.#paceBoat.enabled) this.#renderedGap = state.gapM;
    this.#paceBoat = state;
  }

  /** Called when a source stops, so the boat glides to a halt rather than freezing. */
  rest() {
    this.#targetSpeed = 0;
    this.#driving = false;
  }

  #frame(rawDelta) {
    const delta = Math.min(rawDelta, 0.1); // a backgrounded tab shouldn't teleport the boat
    const elapsed = this.#clock.elapsedTime;

    this.#secondsSinceSample += delta;
    if (this.#secondsSinceSample > SAMPLE_TIMEOUT_SEC) {
      this.#targetSpeed = 0;
      this.#driving = false;
    }

    this.#advanceDistance(delta);
    this.#advanceStroke(delta);

    const waterHeightAt = (x, z) => this.#water.heightAt(x, z, elapsed, this.#distance);

    this.#water.update(elapsed, this.#distance);
    this.#river.update(this.#distance, elapsed, waterHeightAt);
    this.#mist.update(this.#distance, elapsed);
    this.#boat.update(this.#strokePhase, this.#driving);
    this.#wake.update(delta, this.#speed, this.#strokeFinished, waterHeightAt);
    this.#strokeFinished = false;
    this.#placeBoat(waterHeightAt);
    this.#placeGhost(waterHeightAt, elapsed, delta);
    this.#placeCamera(waterHeightAt);

    this.#renderReflection();
    this.#renderer.render(this.#scene, this.#camera);
  }

  #advanceDistance(delta) {
    this.#speed += (this.#targetSpeed - this.#speed) * Math.min(1, delta * 4);
    // Integrate speed between samples, then ease onto the distance the PM5
    // actually reports. Samples arrive at 10 Hz; this keeps motion smooth
    // without letting the scene drift away from the real number.
    this.#distance += this.#speed * delta;
    this.#distance += (this.#targetDistance - this.#distance) * Math.min(1, delta * 2);
  }

  #advanceStroke(delta) {
    const cycleSec = 60 / Math.max(this.#strokeRate, 14);
    const driveSec = cycleSec * 0.35;
    const recoverySec = cycleSec * 0.65;
    const step = this.#driving ? delta / driveSec : -(delta / recoverySec);
    this.#strokePhase = THREE.MathUtils.clamp(this.#strokePhase + step, 0, 1);

    // The hull noses down on the drive and settles back on the recovery.
    const targetPitch = this.#driving ? -0.014 : 0.007;
    this.#pitch += (targetPitch - this.#pitch) * Math.min(1, delta * 6);
  }

  #placeBoat(waterHeightAt) {
    const group = this.#boat.group;
    const bow = waterHeightAt(0, -3.5);
    const stern = waterHeightAt(0, 3.5);
    group.position.y = (bow + stern) / 2 + 0.06;
    group.rotation.x = this.#pitch + Math.atan2(stern - bow, 7) * 0.5;
    group.rotation.z = (waterHeightAt(0.6, 0) - waterHeightAt(-0.6, 0)) * 0.35;
  }

  #placeGhost(waterHeightAt, elapsed, delta) {
    const { enabled, gapM } = this.#paceBoat;
    // Samples land at 10 Hz but we draw at 60, so ease onto the reported gap
    // rather than stepping the ghost along with each one.
    this.#renderedGap += (gapM - this.#renderedGap) * Math.min(1, delta * 6);

    const visible = enabled && Math.abs(this.#renderedGap) < GHOST_MAX_GAP_M;
    this.#ghost.group.visible = visible;
    if (!visible) return;

    // Ahead of you is -Z, which is exactly the sign of the gap reversed.
    const z = -this.#renderedGap;
    const group = this.#ghost.group;
    group.position.z = z;

    const bow = waterHeightAt(GHOST_LANE_OFFSET_M, z - 3.5);
    const stern = waterHeightAt(GHOST_LANE_OFFSET_M, z + 3.5);
    group.position.y = (bow + stern) / 2 + 0.06;
    group.rotation.x = Math.atan2(stern - bow, 7) * 0.5;

    // It rows a metronome stroke — there is no real rower to take timing from.
    const cycleSec = 60 / GHOST_STROKE_RATE;
    const cyclePos = (elapsed % cycleSec) / cycleSec;
    const driving = cyclePos < 0.35;
    const phase = driving ? cyclePos / 0.35 : 1 - (cyclePos - 0.35) / 0.65;
    this.#ghost.update(phase, driving);
  }

  #placeCamera(waterHeightAt) {
    const pullback = this.#reducedMotion ? 0 : this.#speed * 0.22;
    const targetZ = 11 + pullback;
    const targetY = 3.4 + waterHeightAt(0, 11) * 0.5;

    this.#camera.position.z += (targetZ - this.#camera.position.z) * 0.05;
    this.#camera.position.y += (targetY - this.#camera.position.y) * 0.05;
    this.#camera.lookAt(0, LOOK_AT_HEIGHT, LOOK_AT_Z);

    const targetFov = 55 + (this.#reducedMotion ? 0 : this.#speed * 1.1);
    if (Math.abs(this.#camera.fov - targetFov) > 0.01) {
      this.#camera.fov += (targetFov - this.#camera.fov) * 0.05;
      this.#camera.updateProjectionMatrix();
    }
  }

  /**
   * Renders the world mirrored in the water plane into a texture the water
   * shader samples. Half resolution: it is about to be rippled and tinted, so
   * the detail would be wasted.
   */
  #renderReflection() {
    const camera = this.#camera;
    const reflection = this.#reflectionCamera;

    // The camera has no roll and the water sits at y=0, so mirroring is just a
    // sign flip on height — both for the eye and for what it looks at.
    reflection.position.set(camera.position.x, -camera.position.y, camera.position.z);
    reflection.lookAt(0, -LOOK_AT_HEIGHT, LOOK_AT_Z);
    reflection.fov = camera.fov;
    reflection.aspect = camera.aspect;
    reflection.updateProjectionMatrix();

    // Anything below the waterline would show through the surface, so clip it.
    this.#renderer.clippingPlanes = REFLECTION_CLIP;
    this.#water.mesh.visible = false;
    this.#renderer.setRenderTarget(this.#reflectionTarget);
    this.#renderer.render(this.#scene, reflection);
    this.#renderer.setRenderTarget(null);
    this.#water.mesh.visible = true;
    this.#renderer.clippingPlanes = [];
  }

  #resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();

    const pixelRatio = this.#renderer.getPixelRatio();
    const targetWidth = Math.max(2, Math.floor((width * pixelRatio) / 2));
    const targetHeight = Math.max(2, Math.floor((height * pixelRatio) / 2));
    this.#reflectionTarget.setSize(targetWidth, targetHeight);
    // The shader divides gl_FragCoord by this, so it must be the size of the
    // main drawing buffer, not the half-size target.
    this.#water.setReflection(this.#reflectionTarget.texture, width * pixelRatio, height * pixelRatio);
  }
}
