import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;

  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);
    float height = clamp(dir.y, 0.0, 1.0);
    vec3 color = mix(uHorizon, uZenith, pow(height, 1.05));

    float toSun = max(dot(dir, normalize(uSunDirection)), 0.0);
    color += uSunColor * pow(toSun, 900.0) * 1.1;        // the disc
    color += uSunColor * pow(toSun, 90.0) * 0.30;        // the halo
    color += uSunColor * pow(toSun, 12.0) * 0.07;        // haze down the sun's side of the sky

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createSky({ sunDirection, horizonColor }) {
  const geometry = new THREE.SphereGeometry(600, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader,
    fragmentShader,
    uniforms: {
      uZenith: { value: new THREE.Color('#0b1735') },
      uHorizon: { value: horizonColor.clone() },
      uSunColor: { value: new THREE.Color('#F5A623') },
      uSunDirection: { value: sunDirection.clone() },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
