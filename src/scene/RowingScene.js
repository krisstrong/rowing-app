import * as THREE from 'three';
import { createWater } from './water.js';
import { createBoat } from './boat.js';
import { createCourse } from './course.js';
import { createSky } from './sky.js';

const FOG_COLOR = new THREE.Color('#1e2c4e');
const FOG_NEAR = 45;
const FOG_FAR = 270;
const SUN_DIRECTION = new THREE.Vector3(-0.35, 0.14, -1).normalize();

/** How long without a sample before the boat is assumed to have stopped. */
const SAMPLE_TIMEOUT_SEC = 1.5;

/**
 * The v2 lake scene. It consumes the same RowingSample stream as the
 * dashboard — distanceM drives the world scroll, speedMps the camera feel,
 * and strokeState the oars — and knows nothing about where samples come from.
 */
export class RowingScene {
  #renderer;
  #scene;
  #camera;
  #water;
  #boat;
  #course;
  #clock = new THREE.Clock();

  #distance = 0;
  #targetDistance = 0;
  #speed = 0;
  #targetSpeed = 0;
  #driving = false;
  #strokeRate = 22;
  #strokePhase = 0;
  #pitch = 0;
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

    this.#course = createCourse();
    this.#scene.add(this.#course.group);

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
    this.#driving = driving;
    if (sample.strokeRate > 0) this.#strokeRate = sample.strokeRate;
    this.#secondsSinceSample = 0;
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
    this.#course.update(this.#distance, elapsed, waterHeightAt);
    this.#boat.update(this.#strokePhase, this.#driving);
    this.#placeBoat(waterHeightAt);
    this.#placeCamera(waterHeightAt);

    this.#renderer.render(this.#scene, this.#camera);
  }

  #advanceDistance(delta) {
    this.#speed += (this.#targetSpeed - this.#speed) * Math.min(1, delta * 4);
    // Integrate speed between samples, then ease onto the distance the PM5
    // actually reports. Samples arrive at 4 Hz; this keeps motion smooth
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

  #placeCamera(waterHeightAt) {
    const pullback = this.#reducedMotion ? 0 : this.#speed * 0.22;
    const targetZ = 11 + pullback;
    const targetY = 3.4 + waterHeightAt(0, 11) * 0.5;

    this.#camera.position.z += (targetZ - this.#camera.position.z) * 0.05;
    this.#camera.position.y += (targetY - this.#camera.position.y) * 0.05;
    this.#camera.lookAt(0, 0.6, -4);

    const targetFov = 55 + (this.#reducedMotion ? 0 : this.#speed * 1.1);
    if (Math.abs(this.#camera.fov - targetFov) > 0.01) {
      this.#camera.fov += (targetFov - this.#camera.fov) * 0.05;
      this.#camera.updateProjectionMatrix();
    }
  }

  #resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }
}
