const patched = new WeakSet();

function patch(shader) {
  shader.vertexShader = 'varying float vBbLight;\n' + shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>
  vec3 bbN = normalize(mat3(modelMatrix) * objectNormal);
  vBbLight = (1.0 + bbN.y) * 0.25 - 0.15 * bbN.x * bbN.x + 0.05 * bbN.z * bbN.z + 0.5;`);
  shader.fragmentShader = 'varying float vBbLight;\n' + shader.fragmentShader
    .replace('#include <opaque_fragment>', 'gl_FragColor = diffuseColor;')
    .replace('#include <colorspace_fragment>', '#include <colorspace_fragment>\n  gl_FragColor.rgb *= vBbLight;');
}

export function shadeLikeBlockbench(mv) {
  const scene = Object.getOwnPropertySymbols(mv).map((k) => mv[k]).find((x) => x?.isScene);
  if (!scene) return;
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    for (const m of [obj.material].flat()) {
      if (!m?.isMeshStandardMaterial || patched.has(m)) continue;
      patched.add(m);
      m.toneMapped = false;
      m.onBeforeCompile = patch;
      m.customProgramCacheKey = () => 'blockbench-shade';
      m.needsUpdate = true;
    }
  });
  scene.queueRender?.();
}
