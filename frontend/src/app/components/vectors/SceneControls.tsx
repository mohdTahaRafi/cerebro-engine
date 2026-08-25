// phase_4 §4.5 — OrbitControls with damping, `minDistance`/`maxDistance` derived from the
// payload `bounds` so the camera cannot be flown inside the cloud or lost outside it. Initial
// framing fits the bounding sphere with a 1.2 margin. Auto-rotation is deliberately absent —
// the single most common decorative tell in this genre, and it actively interferes with
// reading cluster structure.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls as DreiOrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export interface SceneControlsHandle {
  resetView(): void;
}

interface SceneControlsProps {
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export const SceneControls = forwardRef<SceneControlsHandle, SceneControlsProps>(function SceneControls({ bounds }, ref) {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const { center, radius } = useMemo(() => {
    const c: [number, number, number] = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const dx = bounds.max[0] - bounds.min[0];
    const dy = bounds.max[1] - bounds.min[1];
    const dz = bounds.max[2] - bounds.min[2];
    const r = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
    return { center: c, radius: r };
  }, [bounds]);

  const frame = () => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const margin = 1.2;
    const distance = (radius * margin) / Math.sin((fov * Math.PI) / 360);
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
