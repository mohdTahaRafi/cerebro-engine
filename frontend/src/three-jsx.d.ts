// phase_4 §4 — @react-three/fiber v8 augments JSX intrinsics via a global `declare global {
// namespace JSX {...} }` block, which merges fine under React 18's ambient JSX namespace but
// is NOT picked up under @types/react 19 (this repo's actual `react`/`react-dom` runtime is
// still 18.3.1 per package.json's peerDependencies — only the TYPE packages are on 19, an
// existing mismatch predating this phase). React 19's types moved the JSX namespace to live
// INSIDE the `react` module itself, so third-party global augmentation has to target it
// there instead. This is the documented workaround for exactly that combination — R3F v9
// (which targets React 19's runtime, not just its types) is deliberately NOT used here since
// this app's actual React is 18.
import type { ThreeElements } from '@react-three/fiber';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}
