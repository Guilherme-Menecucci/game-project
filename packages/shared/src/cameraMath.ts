/**
 * cameraMath.ts — co-op centroid camera math (ROOM-05, 06-RESEARCH Pattern 7).
 *
 * PRESENTATION math, not simulation: nothing here feeds simulateTick or any
 * server decision. It lives in @game/shared purely for testability — the
 * client package has no vitest harness, and these helpers are plain
 * deterministic arithmetic over the shared toroidal helper. No Phaser imports:
 * shared stays pure and browser/node agnostic.
 *
 * Units are the caller's (GameScene passes server sub-units + WORLD_W, then
 * converts the result to game units for rendering).
 */
import { toroidalDelta } from './weapons.js'

export interface CameraPoint {
  x: number
  y: number
}

export interface CameraTarget {
  /** Centroid x in the ANCHOR's frame — may be negative or >= worldSize (never wrapped). */
  x: number
  /** Centroid y in the ANCHOR's frame — may be negative or >= worldSize (never wrapped). */
  y: number
  /** Largest |toroidal dx| of any member from the anchor (anchor itself = 0). */
  maxAbsDx: number
  /** Largest |toroidal dy| of any member from the anchor (anchor itself = 0). */
  maxAbsDy: number
}

/**
 * Squad centroid as the mean of toroidal deltas relative to the anchor (the
 * anchor counts as a member with delta 0). A naive coordinate mean would park
 * the camera mid-world when players straddle the wrap edge; toroidal deltas
 * keep it next to the anchor. The result is NOT wrapped back into
 * [0, worldSize): the caller decides how to map it into render space.
 *
 * Empty teammates → the anchor unchanged with zero spreads (solo degenerate).
 * Never mutates its inputs.
 */
export function computeCameraTarget(
  anchor: CameraPoint,
  teammates: readonly CameraPoint[],
  worldSize: number
): CameraTarget {
  let sumDx = 0
  let sumDy = 0
  let maxAbsDx = 0
  let maxAbsDy = 0
  for (const mate of teammates) {
    const dx = toroidalDelta(anchor.x, mate.x, worldSize)
    const dy = toroidalDelta(anchor.y, mate.y, worldSize)
    sumDx += dx
    sumDy += dy
    if (Math.abs(dx) > maxAbsDx) maxAbsDx = Math.abs(dx)
    if (Math.abs(dy) > maxAbsDy) maxAbsDy = Math.abs(dy)
  }
  const count = teammates.length + 1
  return {
    x: anchor.x + sumDx / count,
    y: anchor.y + sumDy / count,
    maxAbsDx,
    maxAbsDy,
  }
}

export interface ZoomOptions {
  /** Padding (caller units) added on EACH side of the spread. Default 240. */
  margin?: number
  /** Furthest zoom-out allowed. Default 0.5. */
  minZoom?: number
  /** Closest zoom allowed — the solo baseline; never zoom in past it. Default 1.0. */
  maxZoom?: number
}

/**
 * Zoom that fits the squad spread (plus margin on each side) inside the
 * viewport: min(viewportW / spreadW, viewportH / spreadH), clamped to
 * [minZoom, maxZoom]. spreadW = 2*maxAbsDx + 2*margin (same for H).
 * A non-positive spread on an axis imposes no constraint (division guard).
 */
export function computeZoom(
  maxAbsDx: number,
  maxAbsDy: number,
  viewportW: number,
  viewportH: number,
  opts: ZoomOptions = {}
): number {
  const margin = opts.margin ?? 240
  const minZoom = opts.minZoom ?? 0.5
  const maxZoom = opts.maxZoom ?? 1.0

  const spreadW = 2 * maxAbsDx + 2 * margin
  const spreadH = 2 * maxAbsDy + 2 * margin
  const fitW = spreadW > 0 ? viewportW / spreadW : maxZoom
  const fitH = spreadH > 0 ? viewportH / spreadH : maxZoom
  const zoom = Math.min(fitW, fitH)
  return Math.min(maxZoom, Math.max(minZoom, zoom))
}
