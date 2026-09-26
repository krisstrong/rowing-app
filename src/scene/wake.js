import * as THREE from 'three';

/**
 * The marks a boat leaves on the water: a wake trailing off the stern, and the
 * puddles each blade digs at the finish of a stroke. The puddles are the giveaway
 * that this is rowing rather than a boat with an engine — they sit still in the
 * water while the boat pulls away from them.
 */

const PUDDLE_POOL = 16;
const PUDDLE_LIFE_SEC = 5;
const BLADE_REACH_M = 2.9;

function createGradientTexture(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 128);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWakeRibbon() {
  // A tapered strip: narrow at the stern, spreading as it falls behind.
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 12);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const along = position.getZ(i) + 0.5; // 0 at the stern, 1 at the tail
    position.setZ(i, 3.4 + along * 26);
    position.setX(i, position.getX(i) * (0.5 + along * 2.2));
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    map: createGradientTexture([
      [0, 'rgba(255,255,255,0.32)'],
      [0.4, 'rgba(255,255,255,0.14)'],
      [1, 'rgba(255,255,255,0)'],
    ]),
    color: '#cddcf0',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return { mesh, material };
}

export function createWake() {
  const group = new THREE.Group();

  const ribbon = createWakeRibbon();
  group.add(ribbon.mesh);

  const puddleGeometry = new THREE.RingGeometry(0.1, 0.34, 14);
  puddleGeometry.rotateX(-Math.PI / 2);
  const puddles = [];
  for (let index = 0; index < PUDDLE_POOL; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: '#d9e6f7',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const mesh = new THREE.Mesh(puddleGeometry, material);
    mesh.position.y = 0.04;
    mesh.renderOrder = 1;
    mesh.visible = false;
    group.add(mesh);
    puddles.push({ mesh, material, age: Infinity, side: 1 });
  }

  let next = 0;

  function spawnPair() {
    for (const side of [1, -1]) {
      const puddle = puddles[next % PUDDLE_POOL];
      next += 1;
      puddle.age = 0;
      puddle.side = side;
      puddle.mesh.visible = true;
      puddle.mesh.position.set(side * BLADE_REACH_M, 0.04, 1.2);
      puddle.mesh.scale.setScalar(0.6);
      puddle.mesh.rotation.y = Math.random() * Math.PI;
    }
  }

  return {
    group,
    /**
     * @param strokeFinished true on the frame a drive ends — one pair of puddles
     *   per stroke, dropped where the blades came out.
     */
    update(delta, speedMps, strokeFinished, waterHeightAt) {
      if (strokeFinished) spawnPair();

      // Subtle on purpose: the stern is only a few metres from the camera, so
      // anything stronger reads as a road rather than disturbed water.
      ribbon.material.opacity = THREE.MathUtils.clamp(speedMps * 0.05, 0, 0.2);
      ribbon.mesh.position.y = waterHeightAt(0, 12) + 0.03;

      for (const puddle of puddles) {
        if (puddle.age === Infinity) continue;
        puddle.age += delta;
        if (puddle.age > PUDDLE_LIFE_SEC) {
          puddle.age = Infinity;
          puddle.mesh.visible = false;
          continue;
        }
        // The puddle stays where it was made; the boat is what moves away.
        puddle.mesh.position.z += speedMps * delta;
        puddle.mesh.position.y = waterHeightAt(puddle.mesh.position.x, puddle.mesh.position.z) + 0.04;

        const life = puddle.age / PUDDLE_LIFE_SEC;
        puddle.mesh.scale.setScalar(0.6 + life * 1.5);
        puddle.material.opacity = 0.5 * (1 - life) ** 1.5;
      }
    },
  };
}
