import * as THREE from 'three';

/**
 * The water plane. It never moves — the wave field scrolls underneath it via
 * uScroll, which is driven by the rower's distance. That keeps vertex
 * coordinates small however far you row.
 */

const WAVE_GLSL = /* glsl */ `
  float waveHeight(vec2 p, float t) {
    float h = 0.0;
    h += sin(p.x * 0.35 + t * 0.9) * 0.120;
    h += sin(p.y * 0.27 - t * 0.7) * 0.150;
    h += sin((p.x * 0.6 + p.y * 0.4) + t * 1.7) * 0.060;
    h += sin((p.x * 1.4 - p.y * 0.9) - t * 2.3) * 0.030;
    return h * uWaveAmp;
  }
`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform float uWaveAmp;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  ${WAVE_GLSL}

  void main() {
    vec2 p = vec2(position.x, position.z + uScroll);
    float h = waveHeight(p, uTime);

    // Analytic-ish normal: sample the height field either side of this vertex.
    float e = 0.35;
    float hx = waveHeight(p + vec2(e, 0.0), uTime);
    float hz = waveHeight(p + vec2(0.0, e), uTime);
    vNormal = normalize(vec3(h - hx, e, h - hz));

    vec3 displaced = vec3(position.x, h, position.z);
    vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeepColor;
  uniform vec3 uSurfaceColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);

    // Grazing angles reflect the sky, steep angles show the dark water.
    // A tight reflection lobe: sky only at grazing angles, tea everywhere else.
    float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.6);
    vec3 color = mix(uDeepColor, uSurfaceColor, fresnel);

    // Sun glint: a tight specular lobe plus a broad sheen down the sun's path.
    vec3 sunDir = normalize(uSunDirection);
    vec3 halfway = normalize(sunDir + viewDir);
    float glint = pow(max(dot(normal, halfway), 0.0), 220.0);
    float sheen = pow(max(dot(normal, halfway), 0.0), 14.0) * 0.12;
    color += uSunColor * (glint * 1.4 + sheen);

    float depth = length(cameraPosition - vWorldPos);
    float fog = smoothstep(uFogNear, uFogFar, depth);
    gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
  }
`;

export function createWater({ size = 700, segments = 220, fogColor, fogNear, fogFar, sunDirection }) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uWaveAmp: { value: 1 },
      // "Mersey tea": Kejimkujik's water is stained brown by tannins leached
      // from the peat bogs it drains, so the body of the water is tea, and only
      // the grazing-angle reflection is sky.
      uDeepColor: { value: new THREE.Color('#3a2510') },
      uSurfaceColor: { value: new THREE.Color('#38507a') },
      uSunColor: { value: new THREE.Color('#F5A623') },
      uSunDirection: { value: sunDirection.clone() },
      uFogColor: { value: fogColor.clone() },
      uFogNear: { value: fogNear },
      uFogFar: { value: fogFar },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(elapsedSec, scrollM) {
      material.uniforms.uTime.value = elapsedSec;
      material.uniforms.uScroll.value = scrollM;
    },
    setWaveAmplitude(amp) {
      material.uniforms.uWaveAmp.value = amp;
    },
    /** Mirrors the shader's wave field on the CPU so the boat can ride the surface. */
    heightAt(x, z, elapsedSec, scrollM) {
      const amp = material.uniforms.uWaveAmp.value;
      const px = x;
      const py = z + scrollM;
      const t = elapsedSec;
      let h = 0;
      h += Math.sin(px * 0.35 + t * 0.9) * 0.12;
      h += Math.sin(py * 0.27 - t * 0.7) * 0.15;
      h += Math.sin(px * 0.6 + py * 0.4 + t * 1.7) * 0.06;
      h += Math.sin(px * 1.4 - py * 0.9 - t * 2.3) * 0.03;
      return h * amp;
    },
  };
}
