import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WILDLIFE_BUILDERS } from './wildlife.js';

/**
 * The Mersey River through Kejimkujik: a narrow tannin-stained channel between
 * banks of Acadian forest — mostly eastern hemlock and spruce, with white birch
 * and the odd red maple — plus granite erratics at the water's edge.
 *
 * Nothing travels. The river is built as three tiles that recycle against the
 * distance rowed, so a long row never leaves the origin. The tiles carry
 * different content, which puts the repeat at three course lengths rather than
 * one.
 */

const TILE_LENGTH_M = 350;
const TILE_COUNT = 3;
const SPAN_M = TILE_LENGTH_M * TILE_COUNT;
/** Tiles have length, so they need headroom ahead for seamless recycling. */
const AHEAD_M = 560;

// The Mersey is a modest river, not a lake. Keeping the channel tight is what
// makes the banks stream past close enough to read as speed.
const WATER_HALF_WIDTH_M = 13;
const BANK_WIDTH_M = 70;

/** Deterministic, so the river looks the same every time you row it. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic over TILE_LENGTH_M so neighbouring bank tiles meet without a seam. */
function bankHeight(z) {
  const k = (Math.PI * 2) / TILE_LENGTH_M;
  return 5 + 3.2 * Math.sin(z * k * 3) + 2 * Math.sin(z * k * 7 + 1.3);
}

function createBank(side) {
  const geometry = new THREE.PlaneGeometry(BANK_WIDTH_M, TILE_LENGTH_M, 12, 140);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const outward = (x + BANK_WIDTH_M / 2) / BANK_WIDTH_M;
    // Rises out of the water quickly, then rolls away into the trees.
    const rise = THREE.MathUtils.smoothstep(outward, 0, 0.18);
    position.setY(i, rise * bankHeight(z) - 0.35);
    position.setX(i, x + BANK_WIDTH_M / 2 + WATER_HALF_WIDTH_M);
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: '#2a3324', roughness: 1, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.x = side;
  return mesh;
}

/** One instanced batch: shared geometry, per-instance placement and tint. */
function instanced(geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();

  transforms.forEach((transform, index) => {
    position.set(transform.x, transform.y, transform.z);
    quaternion.setFromEuler(new THREE.Euler(0, transform.rotationY ?? 0, transform.tilt ?? 0));
    scale.set(transform.scaleXZ ?? 1, transform.scaleY ?? 1, transform.scaleXZ ?? 1);
    mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
    if (transform.color) mesh.setColorAt(index, transform.color);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  return mesh;
}

/** Stacked, slightly offset cones — a real conifer is tiered, not one spike. */
function tieredConifer(tiers) {
  const parts = tiers.map(({ radius, height, y, lean = 0 }) => {
    const cone = new THREE.ConeGeometry(radius, height, 7);
    cone.translate(lean, y + height / 2, 0);
    return cone;
  });
  return mergeGeometries(parts);
}

const geometries = {
  trunk: new THREE.CylinderGeometry(0.16, 0.24, 4, 5),
  // Eastern hemlock and red spruce: narrow, tiered spires.
  conifer: tieredConifer([
    { radius: 1.6, height: 3.4, y: 0.6 },
    { radius: 1.25, height: 3, y: 3.1, lean: 0.08 },
    { radius: 0.8, height: 2.6, y: 5.2, lean: -0.05 },
  ]),
  // White pine: broader, heavier in the lower crown.
  pine: tieredConifer([
    { radius: 2.3, height: 3, y: 0.4 },
    { radius: 1.7, height: 2.8, y: 2.6, lean: -0.1 },
    { radius: 1.05, height: 2.2, y: 4.6, lean: 0.07 },
  ]),
  canopy: (() => {
    const geometry = new THREE.SphereGeometry(1.8, 8, 6);
    geometry.translate(0, 4.4, 0);
    return geometry;
  })(),
  boulder: new THREE.IcosahedronGeometry(1, 0),
};

const treeMaterials = {
  trunkDark: new THREE.MeshStandardMaterial({ color: '#3a2e24', roughness: 1, flatShading: true }),
  trunkBirch: new THREE.MeshStandardMaterial({ color: '#d8d6cc', roughness: 0.9, flatShading: true }),
  needle: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }),
  leaf: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }),
  granite: new THREE.MeshStandardMaterial({ color: '#6b7078', roughness: 0.95, flatShading: true }),
};

// Mostly the dark evergreen of a hemlock stand, with birch and the odd maple
// for the autumn blaze Keji is known for. Kept sparse so the HUD stays readable.
const NEEDLE_TINTS = ['#1d3326', '#22402c', '#1a2b22', '#2b4630'];
const LEAF_TINTS = ['#8a4a22', '#a8571f', '#b9762a', '#6f6a2e'];

function buildTile(seed) {
  const group = new THREE.Group();
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const half = TILE_LENGTH_M / 2;

  const trunks = [];
  const birchTrunks = [];
  const conifers = [];
  const pines = [];
  const canopies = [];
  const boulders = [];

  for (const side of [1, -1]) {
    for (let i = 0; i < 90; i += 1) {
      const z = -half + random() * TILE_LENGTH_M;
      // Denser near the water, thinning as the bank rolls back.
      const depth = random() ** 0.6;
      const inland = 1 + depth * 52;
      const x = side * (WATER_HALF_WIDTH_M + inland);
      // Same curve the bank mesh uses, so trunks sit on the ground rather than in it.
      const groundY = THREE.MathUtils.smoothstep(inland / BANK_WIDTH_M, 0, 0.18) * bankHeight(z) - 0.5;
      const scale = 0.8 + random() * 1.1;
      const rotationY = random() * Math.PI * 2;
      const tilt = (random() - 0.5) * 0.06;
      const roll = random();

      if (roll < 0.66) {
        trunks.push({ x, y: groundY + 2 * scale, z, scaleY: scale, scaleXZ: scale, rotationY, tilt });
        const spire = { x, y: groundY, z, scaleY: scale, scaleXZ: scale, rotationY, tilt, color: new THREE.Color(pick(NEEDLE_TINTS)) };
        (roll < 0.46 ? conifers : pines).push(spire);
      } else if (roll < 0.85) {
        birchTrunks.push({ x, y: groundY + 2 * scale, z, scaleY: scale * 1.1, scaleXZ: scale * 0.6, rotationY, tilt });
        canopies.push({ x, y: groundY, z, scaleY: scale * 0.8, scaleXZ: scale * 0.75, rotationY, tilt, color: new THREE.Color('#5d6b33') });
      } else {
        trunks.push({ x, y: groundY + 2 * scale, z, scaleY: scale, scaleXZ: scale, rotationY, tilt });
        canopies.push({ x, y: groundY, z, scaleY: scale * 0.9, scaleXZ: scale * 0.95, rotationY, tilt, color: new THREE.Color(pick(LEAF_TINTS)) });
      }
    }

    // Granite erratics, mostly at the water's edge where you actually see them.
    for (let i = 0; i < 14; i += 1) {
      const z = -half + random() * TILE_LENGTH_M;
      const x = side * (WATER_HALF_WIDTH_M - 3 + random() * 8);
      const scale = 0.3 + random() * 0.9;
      boulders.push({
        x,
        y: -0.25 + random() * 0.3,
        z,
        scaleXZ: scale,
        scaleY: scale * (0.5 + random() * 0.4),
        rotationY: random() * Math.PI,
        tilt: (random() - 0.5) * 0.5,
      });
    }
  }

  group.add(instanced(geometries.trunk, treeMaterials.trunkDark, trunks));
  group.add(instanced(geometries.trunk, treeMaterials.trunkBirch, birchTrunks));
  group.add(instanced(geometries.conifer, treeMaterials.needle, conifers));
  group.add(instanced(geometries.pine, treeMaterials.needle, pines));
  group.add(instanced(geometries.canopy, treeMaterials.leaf, canopies));
  group.add(instanced(geometries.boulder, treeMaterials.granite, boulders));

  return { group, random };
}

/**
 * Two animals per tile: six slots across the three tiles, which is enough for
 * every species to appear (with three you never meet the turtle) and still
 * works out at roughly one sighting every 175 m. Each sits where its species
 * actually would.
 */
function placeWildlife(tile, index) {
  const build = WILDLIFE_BUILDERS[index % WILDLIFE_BUILDERS.length];
  const animal = build();
  const side = tile.random() < 0.5 ? 1 : -1;
  const z = -TILE_LENGTH_M / 2 + tile.random() * TILE_LENGTH_M;

  // Loons swim, herons wade, turtles bask at the edge, deer stand on the bank.
  const placement = [
    { x: side * (4 + tile.random() * 10), y: 0 }, // loon
    { x: side * (WATER_HALF_WIDTH_M - 1.5), y: -0.3 }, // heron
    { x: side * (WATER_HALF_WIDTH_M + 1.2), y: -0.35 }, // deer
    { x: side * (WATER_HALF_WIDTH_M - 2.5), y: -0.18 }, // turtle on a log
  ][index % WILDLIFE_BUILDERS.length];

  animal.group.position.set(placement.x, placement.y, z);
  animal.group.rotation.y = side > 0 ? -Math.PI / 2 + tile.random() : Math.PI / 2 - tile.random();
  tile.group.add(animal.group);
  return { animal, floats: index % WILDLIFE_BUILDERS.length === 0, baseY: placement.y, x: placement.x, z };
}

export function createRiver() {
  const group = new THREE.Group();
  const tiles = [];

  for (let index = 0; index < TILE_COUNT; index += 1) {
    const tile = buildTile(1337 + index * 7919);
    for (const side of [1, -1]) {
      const bank = createBank(side);
      tile.group.add(bank);
    }
    const creatures = [placeWildlife(tile, index * 2), placeWildlife(tile, index * 2 + 1)];
    tile.group.position.z = index * TILE_LENGTH_M - AHEAD_M;
    group.add(tile.group);
    tiles.push({ ...tile, offset: index * TILE_LENGTH_M, creatures });
  }

  return {
    group,
    update(distanceM, elapsedSec, waterHeightAt) {
      const scroll = distanceM % SPAN_M;
      for (const tile of tiles) {
        const z = ((tile.offset + scroll) % SPAN_M) - AHEAD_M;
        tile.group.position.z = z;

        for (const creature of tile.creatures) {
          creature.animal.update(elapsedSec);
          if (creature.floats) {
            // Only the loon rides the water; the rest are on solid ground.
            creature.animal.group.position.y =
              creature.baseY + waterHeightAt(creature.x, creature.z + z);
          }
        }
      }
    },
  };
}
