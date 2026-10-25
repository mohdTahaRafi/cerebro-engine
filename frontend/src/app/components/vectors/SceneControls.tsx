// phase_4 §4.5 — OrbitControls with damping, `minDistance`/`maxDistance` derived from the
// payload `bounds` so the camera cannot be flown inside the cloud or lost outside it. Initial
// framing fits the bounding sphere with a 1.2 margin. Auto-rotation is deliberately absent —
// the single most common decorative tell in this genre, and it actively interferes with
// reading cluster structure.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls as DreiOrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { boundingSphere, fitDistance, type Bounds } from './framing';

export interface SceneControlsHandle {
  resetView(): void;
}

interface SceneControlsProps {
  bounds: Bounds;
}

export const SceneControls = forwardRef<SceneControlsHandle, SceneControlsProps>(function SceneControls({ bounds }, ref) {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const { center, radius } = useMemo(() => boundingSphere(bounds), [bounds]);

  const frame = () => {
    const persp = camera as THREE.PerspectiveCamera;
    const distance = fitDistance(radius, persp.fov);
    // near/far scale with the cloud too. The fixed 0.05/1000 they replace worked for a
    // cloud of radius ~10 and silently failed outside that: a large fit (radius > ~330)
    // sat beyond the far plane and rendered nothing at all, while at the near end a
    // fixed 0.05 wastes almost the whole depth buffer's precision on empty space.
    persp.near = Math.max(0.01, radius * 0.01);
    persp.far = Math.max(distance * 4, radius * 40);
    persp.updateProjectionMatrix();
    camera.position.set(center[0], center[1], center[2] + distance);
    camera.lookAt(center[0], center[1], center[2]);
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(center[0], center[1], center[2]);
      controls.update();
    }
  };

  useEffect(frame, [bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({ resetView: frame }), [bounds]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DreiOrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={radius * 0.15}
      maxDistance={radius * 4}
      autoRotate={false}
    />
  );
});
