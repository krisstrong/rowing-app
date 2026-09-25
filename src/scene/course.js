import * as THREE from 'three';

/**
 * Everything that streams past to sell the sense of speed: lane buoys and the
 * banks either side. Nothing actually travels — each object's z is recomputed
 * from the distance rowed, modulo the course length, so the world recycles.
 */

const BUOY_SPACING_M = 12.5;
const BUOY_COUNT = 28;
const COURSE_LENGTH_M = BUOY_SPACING_M * BUOY_COUNT;
const DISTANCE_AHEAD_M = 320;
const LANE_HALF_WIDTH_M = 4.5;

// Bank tiles have length, not just a position, so they need extra headroom
// ahead of the boat for the recycling to stay seamless at every scroll offset.
const BANK_TILE_COUNT = 3;
const BANK_AHEAD_M = 560;

/** Periodic over COURSE_LENGTH_M so the two bank tiles meet seamlessly. */
function bankHeight(z) {
  const k = (Math.PI * 2) / COURSE_LENGTH_M;
  return 6 + 4 * Math.sin(z * k * 3) + 2.5 * Math.sin(z * k * 7 + 1.3);
}

function createBank(side) {
  const width = 90;
  const innerEdge = 40;
  const geometry = new THREE.PlaneGeometry(width, COURSE_LENGTH_M, 14, 150);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const outward = (x + width / 2) / width; // 0 at the water's edge, 1 furthest away
    const rise = THREE.MathUtils.smoothstep(outward, 0, 0.4);
    position.setY(i, rise * bankHeight(z));
    position.setX(i, x + width / 2 + innerEdge);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: '#16304a', roughness: 0.95, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = side;
  return mesh;
}

export function createCourse() {
  const group = new THREE.Group();

  const buoyGeometry = new THREE.SphereGeometry(0.16, 8, 6);
  const buoyMaterial = new THREE.MeshStandardMaterial({ color: '#9FADC9', roughness: 0.7 });
  const markerMaterial = new THREE.MeshStandardMaterial({ color: '#EAEEF7', roughness: 0.5 });

  const buoys = [];
  for (let index = 0; index < BUOY_COUNT; index += 1) {
    // Every eighth buoy (100 m) is brighter, so distance reads at a glance.
    const material = index % 8 === 0 ? markerMaterial : buoyMaterial;
    for (const side of [1, -1]) {
      const buoy = new THREE.Mesh(buoyGeometry, material);
      buoy.position.x = side * LANE_HALF_WIDTH_M;
      group.add(buoy);
      buoys.push({ mesh: buoy, offset: index * BUOY_SPACING_M });
    }
  }

  const banks = [];
  for (const side of [1, -1]) {
    for (let tile = 0; tile < BANK_TILE_COUNT; tile += 1) {
      const bank = createBank(side);
      group.add(bank);
      banks.push({ mesh: bank, offset: tile * COURSE_LENGTH_M });
    }
  }

  return {
    group,
    update(distanceM, elapsedSec, waterHeightAt) {
      const scroll = distanceM % COURSE_LENGTH_M;

      for (const { mesh, offset } of buoys) {
        const z = ((offset + scroll) % COURSE_LENGTH_M) - DISTANCE_AHEAD_M;
        mesh.position.z = z;
        mesh.position.y = waterHeightAt(mesh.position.x, z) + 0.05;
      }

      const bankSpan = COURSE_LENGTH_M * BANK_TILE_COUNT;
      for (const { mesh, offset } of banks) {
        mesh.position.z = ((offset + (distanceM % bankSpan)) % bankSpan) - BANK_AHEAD_M;
      }
    },
  };
}
