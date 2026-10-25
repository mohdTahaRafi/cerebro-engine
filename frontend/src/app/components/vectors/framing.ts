// The one place the scene's scale is decided. Every other module in components/vectors/
// reads its numbers from here rather than hardcoding its own.
//
// This exists because the point cloud used to size its points in ABSOLUTE world units
// (`gl_PointSize = size * dpr * (300.0 / -mv.z)`, and a depth fade over the fixed range
// 40..160), while the camera derived its distance from the payload's own `bounds`. UMAP
// output has no fixed scale — a fit of one corpus spans ±3, another ±30 — so the two
// disagreed by whatever factor that corpus happened to produce. On this deployment's own
// data (bounds ≈ ±10, camera at ~28) every point pegged the 28px clamp and the cloud
// rendered as three solid blobs with no internal structure and no depth cue at all; a
// corpus three times larger would instead have rendered every point at the 1px floor and
// at the depth fade's 0.15 alpha minimum — a nearly invisible cloud. Deriving both from
// the same fit distance makes the picture identical at any corpus scale.

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

/** The Canvas camera's field of view. Shared so `fitDistance` and the camera cannot drift. */
export const CAMERA_FOV = 50;

/** Framing margin: the fitted sphere fills 1/1.2 of the frustum, leaving a visible gap
 *  between the outermost points and the canvas edge. */
const FIT_MARGIN = 1.2;

/** The bounding sphere of a projection payload. `radius` is floored at 0.5 so a degenerate
 *  cloud (one point, or a not-yet-fitted all-zero bounds) still yields a usable camera
 *  distance rather than dividing by zero. */
export function boundingSphere(bounds: Bounds): { center: [number, number, number]; radius: number } {
  const center: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const dx = bounds.max[0] - bounds.min[0];
  const dy = bounds.max[1] - bounds.min[1];
  const dz = bounds.max[2] - bounds.min[2];
  const radius = Math.max(0.5, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2);
  return { center, radius };
}

/** The camera distance at which the whole cloud is framed — the reference distance the
 *  point-size and depth-fade uniforms are expressed relative to, so "one BASE_SIZE point
 *  is BASE_SIZE CSS pixels" is true at the default view for every corpus. */
export function fitDistance(radius: number, fov: number = CAMERA_FOV): number {
  return (radius * FIT_MARGIN) / Math.sin((fov * Math.PI) / 360);
}
