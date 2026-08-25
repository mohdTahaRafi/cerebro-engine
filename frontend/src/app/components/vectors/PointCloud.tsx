// phase_4 §4.3 — the entire cloud is ONE instanced draw call. The rejected alternative (one
// <mesh> per node) is 5,000 draw calls and ~8 fps; see architecture.md §5. Highlight/dim/ring
// state (§4.6's beacon, the document legend's per-doc dimming) is applied by mutating the
// `size`/`alpha`/`ring` attributes IN PLACE via the imperative handle below — never by
// rebuilding the geometry — so a re-color or a hover is one attribute upload, not a
// re-upload of positions (task 4.20: `renderer.info.memory.geometries` does not increase).
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { DecodedProjection } from './decodeProjection';

const BASE_SIZE = 6;
const RAISED_SIZE = 11;
const DIM_ALPHA = 0.12;

export interface BeaconNeighbor { index: number; kept: boolean }

export interface PointCloudHandle {
  /** Document indices to dim in place (DocumentLegend's per-document visibility toggle). */
  setHiddenDocs(hidden: Set<number>): void;
  /** `null` clears the beacon's highlight entirely (restores base size/alpha/no rings). */
  setBeacon(neighbors: BeaconNeighbor[] | null): void;
}

interface PointCloudProps {
  decoded: DecodedProjection;
}

export const PointCloud = forwardRef<PointCloudHandle, PointCloudProps>(function PointCloud({ decoded }, ref) {
  const hiddenDocsRef = useRef<Set<number>>(new Set());
  const beaconRef = useRef<BeaconNeighbor[] | null>(null);
  const sizeAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const alphaAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const ringAttrRef = useRef<THREE.BufferAttribute | null>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(decoded.colors, 3));
    const n = decoded.pointIds.length;
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n).fill(BASE_SIZE), 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute('ring', new THREE.BufferAttribute(new Float32Array(n).fill(0), 1));
    g.computeBoundingSphere(); // REQUIRED — without it frustum culling drops the whole
                               // cloud the moment the camera moves off the origin.
    return g;
  }, [decoded]);

  sizeAttrRef.current = geometry.getAttribute('size') as THREE.BufferAttribute;
  alphaAttrRef.current = geometry.getAttribute('alpha') as THREE.BufferAttribute;
  ringAttrRef.current = geometry.getAttribute('ring') as THREE.BufferAttribute;

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      attribute float size;
      attribute float alpha;
      attribute float ring;
      varying vec3 vColor; varying float vAlpha; varying float vRing;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vRing = ring;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Perspective-correct point size, clamped so a near point does not become a
        // screen-filling square.
        gl_PointSize = clamp(size * uPixelRatio * (300.0 / -mv.z), 1.0, 28.0);
        // Depth fade: distant points recede rather than forming a flat wall.
        float depthFade = clamp(1.0 - (-mv.z - 40.0) / 120.0, 0.15, 1.0);
        vAlpha *= depthFade;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha; varying float vRing;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d);
        if (r > 0.25) discard;
        if (vRing > 0.5) {
          // Ring only — the difference between "retrieved" and "kept" is a shape
          // difference (ring vs. filled disc), never a color difference (DESIGN.md §5.20).
          if (r < 0.14) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.20, r) * smoothstep(0.14, 0.17, r));
        } else {
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.16, r));
        }
      }`,
  }), []);

  function recompute() {
    const sizeAttr = sizeAttrRef.current!;
    const alphaAttr = alphaAttrRef.current!;
    const ringAttr = ringAttrRef.current!;
    const n = decoded.pointIds.length;
    const hidden = hiddenDocsRef.current;
    const beacon = beaconRef.current;

    const neighborByIndex = new Map<number, boolean>(); // index -> kept
    if (beacon) for (const nb of beacon) neighborByIndex.set(nb.index, nb.kept);

    for (let i = 0; i < n; i++) {
      const isNeighbor = neighborByIndex.has(i);
      const docDimmed = hidden.has(decoded.docIndex[i]);

      let size = BASE_SIZE;
      let ring = 0;
      let alpha = 1;

      if (beacon) {
        if (isNeighbor) {
          size = RAISED_SIZE;
          ring = neighborByIndex.get(i) ? 1 : 0; // kept → ring; cut → raised, no ring
        } else {
          alpha = DIM_ALPHA;
        }
      }
      if (docDimmed) alpha = Math.min(alpha, DIM_ALPHA);

      sizeAttr.array[i] = size;
      alphaAttr.array[i] = alpha;
      ringAttr.array[i] = ring;
    }
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    ringAttr.needsUpdate = true;
  }

  useImperativeHandle(ref, () => ({
    setHiddenDocs(hidden: Set<number>) { hiddenDocsRef.current = hidden; recompute(); },
    setBeacon(neighbors: BeaconNeighbor[] | null) { beaconRef.current = neighbors; recompute(); },
  }), [decoded]);

  return <points geometry={geometry} material={material} />;
});
