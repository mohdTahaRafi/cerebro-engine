// phase_4 §4.6 — the query beacon: a --signal sphere with a soft additive halo, plus its
// neighbor links as ONE LineSegments object (not N separate line objects). The
// retrieved-vs-kept ring distinction lives on PointCloud's `ring` attribute (set via
// PointCloudHandle.setBeacon) — this component only draws the beacon itself and the fan of
// links to its neighbors.
import { useMemo } from 'react';
import * as THREE from 'three';
import type { DecodedProjection } from './decodeProjection';
import type { ProjectQueryResponse } from '../../../api/contracts';

// theme.css `--signal` — fixed here rather than read from CSS, since a WebGL uniform can't
// consume a custom property. Same hex in both themes (only the `-soft`/`-ring` derivatives
// differ between light and dark).
const SIGNAL_HEX = 0x004ffe;

const LINK_VERTEX = `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const LINK_FRAGMENT = `
  varying float vAlpha;
  uniform vec3 uColor;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }`;

interface QueryBeaconProps {
  beacon: [number, number, number];
  neighbors: ProjectQueryResponse['neighbors'];
  decoded: DecodedProjection;
}

export function QueryBeacon({ beacon, neighbors, decoded }: QueryBeaconProps) {
  const linkGeometry = useMemo(() => {
    const positions = new Float32Array(neighbors.length * 2 * 3);
    const alphas = new Float32Array(neighbors.length * 2);
    neighbors.forEach((nb, rank) => {
      const bx = beacon[0], by = beacon[1], bz = beacon[2];
      const nx = decoded.positions[nb.index * 3];
      const ny = decoded.positions[nb.index * 3 + 1];
      const nz = decoded.positions[nb.index * 3 + 2];
      const o = rank * 6;
      positions[o] = bx; positions[o + 1] = by; positions[o + 2] = bz;
      positions[o + 3] = nx; positions[o + 4] = ny; positions[o + 5] = nz;
      // Alpha falls off by rank — the nearest neighbor's link reads brightest, the tenth
      // fades toward the field rather than every link competing at full strength.
      const a = Math.max(0.15, 1 - rank / neighbors.length);
      alphas[rank * 2] = a; alphas[rank * 2 + 1] = a;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    return g;
  }, [beacon, neighbors, decoded]);

  const linkMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: LINK_VERTEX, fragmentShader: LINK_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color(SIGNAL_HEX) } },
    transparent: true, depthWrite: false,
  }), []);

  return (
    <group>
      <lineSegments geometry={linkGeometry} material={linkMaterial} />

      {/* The beacon itself — the only point in the scene not colored by the document
          legend, which is what makes it read as "the thing I placed" (§4.6). */}
      <mesh position={beacon}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshBasicMaterial color={SIGNAL_HEX} />
      </mesh>
      {/* Soft additive halo — a larger, dimmer, depth-unwritten sphere behind it. */}
      <mesh position={beacon}>
        <sphereGeometry args={[0.24, 16, 16]} />
        <meshBasicMaterial color={SIGNAL_HEX} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
