/**
 * Geometry for the radial menu: items sit evenly round a circle, the first one straight up,
 * going clockwise.
 */

/** Where item `i` of `n` sits, relative to the centre. */
export function radialPoint(i: number, n: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2
  return { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) }
}

/** Which item the pointer is pointing at (by direction), or -1 inside the dead zone in the middle. */
export function radialIndexAt(dx: number, dy: number, n: number, deadZone: number): number {
  if (n <= 0 || Math.hypot(dx, dy) < deadZone) return -1
  // Angle clockwise from straight up, 0..2π.
  let angle = Math.atan2(dy, dx) + Math.PI / 2
  if (angle < 0) angle += Math.PI * 2
  const slice = (Math.PI * 2) / n
  return Math.floor(((angle + slice / 2) % (Math.PI * 2)) / slice)
}
