// phase_4 §4.4 — GPU color picking, not raycasting. THREE.Points raycasting tests every
// vertex against a CPU threshold; at 5,000 points on every pointermove that's a measurable
// stall, and the threshold needs per-zoom tuning or the hit target is unusable. Instead: an
// off-screen 1×1 render, only on click (never on move), of a picking-only scene whose
// fragment color IS the node's id.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { DecodedProjection } from './decodeProjection';
import { boundingSphere, fitDistance } from './framing';

// Deliberately between PointCloud's BASE_SIZE (6) and RAISED_SIZE (11): the hit target is
// a little more forgiving than the drawn dot, which is what makes clicking a single node
// in a dense cluster feel accurate rather than fussy. The 4px device-pixel floor keeps the
// farthest points of a deep cloud clickable even where they draw at 1px.
const PICK_SIZE = 8;

const PICK_VERTEX = `
  attribute vec3 idColor;
  attribute float pickable;
  varying vec3 vId;
  uniform float uPixelRatio;
  uniform float uFitDistance;
  void main() {
    vId = idColor;
    // A hidden document's points are dimmed to 12% alpha but were still fully solid to
    // the picker, so a click landed on a document the user had explicitly switched off —
    // and, worse, an invisible point OCCLUDED the visible one behind it. Pushing them
    // outside clip space removes them from the pick pass entirely, which is the only
    // way to fix the occlusion as well as the hit.
    if (pickable < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 0.001);
    // Same framing-relative scale as PointCloud's own gl_PointSize, so what is clickable
    // tracks what is drawn at every corpus scale and every zoom level (framing.ts).
    gl_PointSize = clamp(${PICK_SIZE.toFixed(1)} * uPixelRatio * (uFitDistance / dist), 4.0, 28.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
  }`;
const PICK_FRAGMENT = `
  varying vec3 vId;
  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    if (dot(d, d) > 0.25) discard;
    // NO <colorspace_fragment> here, unlike PointCloud: this fragment color is an integer
    // id split across three bytes, not a color. Any transfer function applied to it would
    // corrupt the id and return the wrong node.
    gl_FragColor = vec4(vId, 1.0);
  }`;

export function usePicking(decoded: DecodedProjection, hiddenDocs: Set<number>) {
  const { gl, camera, size } = useThree();
  const sceneRef = useRef<THREE.Scene | null>(null);
  const targetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const pickableAttrRef = useRef<THREE.BufferAttribute | null>(null);

  const fitDist = useMemo(() => fitDistance(boundingSphere(decoded.bounds).radius), [decoded.bounds]);

  useEffect(() => {
    const n = decoded.pointIds.length;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(decoded.positions, 3));
    // The id is decoded as r + g*256 + b*65536, addressing up to 16.7M nodes — comfortably
    // above the 65,535 ceiling Uint16Array imposes on docIndex anyway (§4.4 step 3).
    const idColor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      idColor[i * 3] = (i & 0xff) / 255;
      idColor[i * 3 + 1] = ((i >> 8) & 0xff) / 255;
      idColor[i * 3 + 2] = ((i >> 16) & 0xff) / 255;
    }
    geometry.setAttribute('idColor', new THREE.BufferAttribute(idColor, 3));
    const pickable = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1);
    geometry.setAttribute('pickable', pickable);
    pickableAttrRef.current = pickable;

    const material = new THREE.ShaderMaterial({
      vertexShader: PICK_VERTEX,
      fragmentShader: PICK_FRAGMENT,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uFitDistance: { value: fitDist },
      },
    });

    const scene = new THREE.Scene();
    scene.add(new THREE.Points(geometry, material));
    sceneRef.current = scene;
    targetRef.current = new THREE.WebGLRenderTarget(1, 1);

    return () => {
      geometry.dispose();
      material.dispose();
      targetRef.current?.dispose();
      pickableAttrRef.current = null;
      sceneRef.current = null;
      targetRef.current = null;
    };
  }, [decoded, fitDist]);

  // Mutated in place on the existing attribute, matching PointCloud's own "one attribute
  // update, never a re-upload" rule (§4.3) — toggling a document must not rebuild the
  // picking geometry any more than it rebuilds the cloud's.
  useEffect(() => {
    const attr = pickableAttrRef.current;
    if (!attr) return;
    for (let i = 0; i < decoded.docIndex.length; i++) {
      attr.array[i] = hiddenDocs.has(decoded.docIndex[i]) ? 0 : 1;
    }
    attr.needsUpdate = true;
  }, [hiddenDocs, decoded]);

  /** `clientX`/`clientY` in CSS pixels relative to the viewport (a raw pointer event's
   *  coordinates); `domElement` is the canvas to resolve them against. Returns the node
   *  index under the cursor, or `null` for a miss. */
  const pick = useCallback((clientX: number, clientY: number, domElement: HTMLElement): number | null => {
    const scene = sceneRef.current;
    const target = targetRef.current;
    if (!scene || !target) return null;

    const rect = domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

    const persp = camera as THREE.PerspectiveCamera;
    persp.setViewOffset(rect.width, rect.height, x, y, 1, 1);

    const prevColor = new THREE.Color();
    gl.getClearColor(prevColor);
    const prevAlpha = gl.getClearAlpha();
    // White is the "nothing here" sentinel — id (255,255,255) would be node 16,777,215,
    // far beyond any projection this console will ever render.
    gl.setClearColor(0xffffff, 1);
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(scene, camera);

    const pixel = new Uint8Array(4);
    gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);

    gl.setRenderTarget(null);
    gl.setClearColor(prevColor, prevAlpha);
    persp.clearViewOffset();

    const [r, g, b] = pixel;
    if (r === 255 && g === 255 && b === 255) return null;
    const id = r + g * 256 + b * 65536;
    return id < decoded.pointIds.length ? id : null;
  }, [gl, camera, size, decoded]);

  return { pick };
}
