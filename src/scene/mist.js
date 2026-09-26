import * as THREE from 'three';

/**
 * Low mist lying on the river at dawn. Soft-edged quads facing the camera,
 * recycled against distance like everything else in the scene.
 *
 * They sit above the waterline on purpose, so the reflection pass picks them
 * up and the mist appears in the water too.
 */

const BAND_COUNT = 16;
const SPAN_M = 420;
const AHEAD_M = 340;

/** A blurred blob, drawn once and shared by every band. */
function createMistTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMist() {
  const group = new THREE.Group();
  const texture = createMistTexture();
  const bands = [];

  for (let index = 0; index < BAND_COUNT; index += 1) {
    const width = 26 + Math.random() * 34;
    const height = 2.2 + Math.random() * 2.6;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: '#b9c9e0',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.renderOrder = 2;
    group.add(mesh);
    bands.push({
      mesh,
      material,
      offset: (index / BAND_COUNT) * SPAN_M,
      baseX: (Math.random() - 0.5) * 16,
      baseY: 0.35 + Math.random() * 1.1,
      peakOpacity: 0.05 + Math.random() * 0.07,
      drift: 1.5 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
    });
  }

  return {
    group,
    update(distanceM, elapsedSec) {
      for (const band of bands) {
        const z = ((band.offset + distanceM) % SPAN_M) - AHEAD_M;
        band.mesh.position.set(
          band.baseX + Math.sin(elapsedSec * 0.06 + band.phase) * band.drift,
          band.baseY + Math.sin(elapsedSec * 0.11 + band.phase) * 0.18,
          z,
        );

        // Mist reads from a distance and not from inside it, so fade each band
        // out as it comes at you. Without this the near ones curtain the river.
        const ahead = -z;
        const nearFade = THREE.MathUtils.smoothstep(ahead, 25, 90);
        const farFade = 1 - THREE.MathUtils.smoothstep(ahead, 200, 300);
        band.material.opacity = band.peakOpacity * nearFade * farFade;
      }
    },
  };
}
