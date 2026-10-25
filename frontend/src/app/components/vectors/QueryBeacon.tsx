// phase_4 §4.6 — the query beacon: a --signal sphere with a soft additive halo, plus its
// neighbor links as ONE LineSegments object (not N separate line objects). The
// retrieved-vs-kept ring distinction lives on PointCloud's `ring` attribute (set via
// PointCloudHandle.setBeacon) — this component only draws the beacon itself and the fan of
// links to its neighbors.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { DecodedProjection } from './decodeProjection';
import type { ProjectQueryResponse } from '../../../api/contracts';
import { boundingSphere } from './framing';

// theme.css `--signal` — fixed here rather than read from CSS, since a WebGL uniform can't
// consume a custom property. Same hex in both themes (only the `-soft`/`-ring` derivatives
// differ between light and dark).
const SIGNAL_HEX = 0x004ffe;

// The beacon sphere and its halo as a FRACTION of the cloud's own radius, not in absolute
// world units. The 0.11/0.24 world-unit radii these replace were sized for a cloud of
// radius ~1: against this deployment's fit (radius ≈ 10) the beacon drew at roughly a
// hundredth of the cloud's extent — a speck — and against a larger fit it would have been
// invisible outright. As a fraction it reads identically at every corpus scale.
const BEACON_RADIUS_FRACTION = 0.035;
const HALO_RADIUS_FRACTION = 0.075;

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
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
    // THREE.Color converts a hex to linear working space (ColorManagement is on),
    // so this needs the same re-encode PointCloud's fragment shader does or the links
    // draw a darker blue than the --signal the Place button is painted in.
    #include <colorspace_fragment>
  }`;

interface QueryBeaconProps {
  beacon: [number, number, number];
  neighbors: ProjectQueryResponse['neighbors'];
  decoded: DecodedProjection;
}

export function QueryBeacon({ beacon, neighbors, decoded }: QueryBeaconProps) {
  const radius = useMemo(() => boundingSphere(decoded.bounds).radius, [decoded.bounds]);

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
    // Every beacon placement builds a new geometry; without a bounding sphere the whole
    // link fan is frustum-culled as soon as the camera leaves the origin, exactly as
    // PointCloud's own computeBoundingSphere comment describes.
    g.computeBoundingSphere();
    return g;
  }, [beacon, neighbors, decoded]);

  const linkMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: LINK_VERTEX, fragmentShader: LINK_FRAGMENT,
    uniforms: { uColor: { value: new THREE.Color(SIGNAL_HEX) } },
    transparent: true, depthWrite: false,
  }), []);

  // Placing a beacon repeatedly is the single most-repeated action on this screen, and
  // each placement allocates a fresh geometry — three.js frees neither on its own.
  useEffect(() => () => linkGeometry.dispose(), [linkGeometry]);
  useEffect(() => () => linkMaterial.dispose(), [linkMaterial]);

  return (
    <group>
      <lineSegments geometry={linkGeometry} material={linkMaterial} />

      {/* The beacon itself — the only point in the scene not colored by the document
          legend, which is what makes it read as "the thing I placed" (§4.6). */}
      <mesh position={beacon}>
        <sphereGeometry args={[radius * BEACON_RADIUS_FRACTION, 16, 16]} />
        <meshBasicMaterial color={SIGNAL_HEX} />
      </mesh>
      {/* Soft additive halo — a larger, dimmer, depth-unwritten sphere behind it. */}
      <mesh position={beacon}>
        <sphereGeometry args={[radius * HALO_RADIUS_FRACTION, 16, 16]} />
        <meshBasicMaterial color={SIGNAL_HEX} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}
