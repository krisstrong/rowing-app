import * as THREE from 'three';

/**
 * The odd animal along the Mersey. All four are species Parks Canada names as
 * characteristic of Kejimkujik's freshwater habitats, built from primitives at
 * roughly life size so they read at a glance from the boat.
 *
 * Each returns { group, update(elapsedSec) }.
 */

const materials = {
  loonBody: new THREE.MeshStandardMaterial({ color: '#15181f', roughness: 0.6 }),
  loonBreast: new THREE.MeshStandardMaterial({ color: '#e8edf5', roughness: 0.7 }),
  heron: new THREE.MeshStandardMaterial({ color: '#7d93b5', roughness: 0.8 }),
  heronBeak: new THREE.MeshStandardMaterial({ color: '#d9b84a', roughness: 0.6 }),
  heronLeg: new THREE.MeshStandardMaterial({ color: '#4a4034', roughness: 0.9 }),
  deer: new THREE.MeshStandardMaterial({ color: '#8a6142', roughness: 0.9 }),
  deerTail: new THREE.MeshStandardMaterial({ color: '#f0ece2', roughness: 0.9 }),
  shell: new THREE.MeshStandardMaterial({ color: '#3b4228', roughness: 0.85 }),
  // The yellow throat is how you tell a Blanding's turtle from anything else.
  turtleThroat: new THREE.MeshStandardMaterial({ color: '#e0c23c', roughness: 0.7 }),
  log: new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }),
};

/** Common loon, riding the water. */
export function createLoon() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), materials.loonBody);
  body.scale.set(1.5, 0.72, 1);
  body.position.y = 0.1;
  group.add(body);

  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), materials.loonBreast);
  breast.scale.set(1.2, 0.5, 0.9);
  breast.position.set(0, 0.04, 0.05);
  group.add(breast);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.34, 8), materials.loonBody);
  neck.position.set(0, 0.3, -0.22);
  neck.rotation.x = 0.25;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), materials.loonBody);
  head.position.set(0, 0.46, -0.28);
  group.add(head);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), materials.loonBody);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.46, -0.44);
  group.add(beak);

  return {
    group,
    update(elapsed) {
      group.position.y = Math.sin(elapsed * 0.9) * 0.03;
      group.rotation.z = Math.sin(elapsed * 0.7) * 0.05;
    },
  };
}

/** Great blue heron, standing in the shallows. */
export function createHeron() {
  const group = new THREE.Group();

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 5), materials.heronLeg);
    leg.position.set(side * 0.06, 0.31, 0);
    group.add(leg);
  }

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), materials.heron);
  body.scale.set(0.8, 0.85, 1.5);
  body.position.y = 0.72;
  group.add(body);

  const neck = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.4, 6), materials.heron);
  lower.position.set(0, 0.2, 0.02);
  lower.rotation.x = -0.35;
  neck.add(lower);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), materials.heron);
  head.position.set(0, 0.42, 0.16);
  neck.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 6), materials.heronBeak);
  beak.rotation.x = -Math.PI / 2.3;
  beak.position.set(0, 0.44, 0.34);
  neck.add(beak);
  neck.position.set(0, 0.82, -0.08);
  group.add(neck);

  return {
    group,
    update(elapsed) {
      // Mostly motionless, with the occasional slow stoop toward the water.
      const stoop = Math.max(0, Math.sin(elapsed * 0.32) - 0.86) * 6;
      neck.rotation.x = stoop * 0.9;
    },
  };
}

/** White-tailed deer at the water's edge. */
export function createDeer() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 8), materials.deer);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.82;
  group.add(body);

  for (const x of [-0.18, 0.18]) {
    for (const z of [-0.3, 0.34]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.8, 5), materials.deer);
      leg.position.set(x, 0.4, z);
      group.add(leg);
    }
  }

  const neck = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.44, 6), materials.deer);
  column.position.y = 0.2;
  neck.add(column);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.2, 4, 6), materials.deer);
  head.rotation.x = Math.PI / 2.4;
  head.position.set(0, 0.42, -0.12);
  neck.add(head);
  neck.position.set(0, 0.92, -0.5);
  neck.rotation.x = 0.25;
  group.add(neck);

  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), materials.deerTail);
  tail.scale.set(0.7, 1.2, 0.6);
  tail.position.set(0, 0.92, 0.56);
  group.add(tail);

  return {
    group,
    update(elapsed) {
      // Grazing, then a head-up check — the thing they always do as you pass.
      const alert = Math.max(0, Math.sin(elapsed * 0.4 + 1.2));
      neck.rotation.x = THREE.MathUtils.lerp(1.15, 0.12, alert ** 2);
      tail.rotation.z = Math.sin(elapsed * 3) * 0.15 * alert;
    },
  };
}

/** Blanding's turtle basking on a half-sunk log — Keji's signature species. */
export function createTurtle() {
  const group = new THREE.Group();

  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 2.2, 8), materials.log);
  log.rotation.z = Math.PI / 2;
  log.rotation.y = 0.2;
  group.add(log);

  const turtle = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.shell);
  shell.scale.set(1, 0.62, 1.25);
  turtle.add(shell);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), materials.shell);
  head.position.set(0, 0.04, -0.22);
  turtle.add(head);

  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), materials.turtleThroat);
  throat.scale.set(1, 0.7, 1);
  throat.position.set(0, 0.005, -0.25);
  turtle.add(throat);

  turtle.position.set(0.15, 0.14, 0);
  turtle.rotation.y = -0.35;
  group.add(turtle);

  return {
    group,
    update(elapsed) {
      group.position.y = Math.sin(elapsed * 0.6) * 0.015;
      turtle.rotation.x = Math.sin(elapsed * 0.25) * 0.05;
    },
  };
}

export const WILDLIFE_BUILDERS = [createLoon, createHeron, createDeer, createTurtle];
