import * as THREE from 'three';

/**
 * A single scull, bow pointing down -Z. Everything is driven by one scalar
 * `phase`: 0 = catch (blades in, legs compressed), 1 = finish (blades out,
 * body laid back). Drive and recovery differ only in how fast phase moves
 * and whether the blades are buried.
 */

const CATCH_SWEEP = 0.95; // radians, blade toward the bow
const FINISH_SWEEP = -0.70; // radians, blade toward the stern

function makeOar(side, materials) {
  const oar = new THREE.Group();

  const shaftLength = 2.6;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, shaftLength, 8), materials.shaft);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = (side * shaftLength) / 2;
  oar.add(shaft);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.035), materials.blade);
  blade.position.set(side * (shaftLength + 0.2), -0.02, 0);
  oar.add(blade);

  // Counterweighted handle inboard of the pivot, so the sweep reads as a lever.
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6), materials.handle);
  handle.rotation.z = Math.PI / 2;
  handle.position.x = side * -0.25;
  oar.add(handle);

  oar.position.set(side * 0.38, 0.28, 0.1);
  return oar;
}

export function createBoat() {
  const group = new THREE.Group();

  const materials = {
    hull: new THREE.MeshStandardMaterial({ color: '#dfe6f3', roughness: 0.45, metalness: 0.05 }),
    deck: new THREE.MeshStandardMaterial({ color: '#17284A', roughness: 0.8 }),
    shaft: new THREE.MeshStandardMaterial({ color: '#c9d3e6', roughness: 0.5 }),
    blade: new THREE.MeshStandardMaterial({ color: '#F5A623', roughness: 0.4 }),
    handle: new THREE.MeshStandardMaterial({ color: '#22355C', roughness: 0.9 }),
    body: new THREE.MeshStandardMaterial({ color: '#2f4e86', roughness: 0.7 }),
    skin: new THREE.MeshStandardMaterial({ color: '#d8bfa0', roughness: 0.9 }),
    rigger: new THREE.MeshStandardMaterial({ color: '#9FADC9', roughness: 0.6, metalness: 0.2 }),
  };

  const hullGeometry = new THREE.CapsuleGeometry(0.17, 7.2, 6, 14);
  hullGeometry.rotateX(Math.PI / 2);
  hullGeometry.scale(1, 0.62, 1);
  const hull = new THREE.Mesh(hullGeometry, materials.hull);
  hull.position.y = 0.05;
  group.add(hull);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 1.7), materials.deck);
  cockpit.position.set(0, 0.16, 0.1);
  group.add(cockpit);

  for (const side of [1, -1]) {
    const rigger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 6), materials.rigger);
    rigger.rotation.z = Math.PI / 2;
    rigger.position.set(side * 0.21, 0.24, 0.1);
    group.add(rigger);
  }

  const oars = [makeOar(1, materials), makeOar(-1, materials)];
  oars.forEach((oar) => group.add(oar));

  // The rower: a torso that leans through the stroke on a seat that slides.
  const rower = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.42, 4, 8), materials.body);
  torso.position.y = 0.32;
  rower.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), materials.skin);
  head.position.y = 0.66;
  rower.add(head);
  rower.position.set(0, 0.16, 0);
  group.add(rower);

  return {
    group,
    /**
     * @param phase 0 at the catch, 1 at the finish
     * @param driving true while the blades should be buried
     */
    update(phase, driving) {
      const sweep = THREE.MathUtils.lerp(CATCH_SWEEP, FINISH_SWEEP, phase);
      const lift = driving ? -0.03 : 0.13;

      for (const [index, oar] of oars.entries()) {
        const side = index === 0 ? 1 : -1;
        oar.rotation.y = side * sweep;
        oar.rotation.z = side * lift;
      }

      // Seat slides sternward and the body opens up as the drive finishes.
      rower.position.z = THREE.MathUtils.lerp(-0.34, 0.36, phase);
      rower.rotation.x = THREE.MathUtils.lerp(-0.45, 0.34, phase);
    },
  };
}
