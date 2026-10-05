/**
 * cameraMath.test.ts — centroid camera math spec (ROOM-05, 06-RESEARCH Pattern 7).
 *
 * Presentation math hosted in @game/shared purely for testability (the client
 * package has no vitest harness). Locked behavior:
 *   - computeCameraTarget: mean of TOROIDAL deltas relative to the anchor
 *     (anchor counts as a member with delta 0) — a naive mean would park the
 *     camera mid-world when players straddle the wrap edge.
 *   - computeZoom: fit spread + margin into the viewport, clamped to
 *     [minZoom, maxZoom] (defaults 0.5..1.0) — never zooms in past baseline.
 */
import { describe, expect, it } from 'vitest'
import { computeCameraTarget, computeZoom } from '../cameraMath.js'

describe('computeCameraTarget', () => {
  it('returns the mean of toroidal deltas relative to the anchor', () => {
    const r = computeCameraTarget({ x: 100, y: 100 }, [{ x: 300, y: 100 }], 1000)
    expect(r).toEqual({ x: 200, y: 100, maxAbsDx: 200, maxAbsDy: 0 })
  })

  it('uses the toroidal delta across the wrap edge (no mid-world fling)', () => {
    const r = computeCameraTarget({ x: 10, y: 0 }, [{ x: 990, y: 0 }], 1000)
    // delta = -20 → mean -10 relative to anchor → x 0 (anchor frame, unwrapped)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.maxAbsDx).toBe(20)
    expect(r.maxAbsDy).toBe(0)
  })

  it('keeps the result in the anchor frame (may go negative — caller decides)', () => {
    const r = computeCameraTarget({ x: 0, y: 500 }, [{ x: 960, y: 500 }], 1000)
    expect(r.x).toBe(-20)
    expect(r.maxAbsDx).toBe(40)
  })

  it('averages multiple teammates on both axes and tracks the max spread', () => {
    const r = computeCameraTarget(
      { x: 500, y: 500 },
      [
        { x: 600, y: 500 },
        { x: 500, y: 200 },
        { x: 410, y: 560 },
      ],
      1000
    )
    // dx: 0,100,0,-90 → sum 10 → mean 2.5 ; dy: 0,0,-300,60 → sum -240 → mean -60
    expect(r.x).toBeCloseTo(502.5, 10)
    expect(r.y).toBeCloseTo(440, 10)
    expect(r.maxAbsDx).toBe(100)
    expect(r.maxAbsDy).toBe(300)
  })

  it('returns the anchor unchanged with zero spreads when there are no teammates', () => {
    const r = computeCameraTarget({ x: 123, y: 456 }, [], 1000)
    expect(r).toEqual({ x: 123, y: 456, maxAbsDx: 0, maxAbsDy: 0 })
  })

  it('does not mutate its inputs', () => {
    const anchor = { x: 100, y: 100 }
    const mates = [{ x: 300, y: 100 }]
    computeCameraTarget(anchor, mates, 1000)
    expect(anchor).toEqual({ x: 100, y: 100 })
    expect(mates).toEqual([{ x: 300, y: 100 }])
  })
})

describe('computeZoom', () => {
  it('returns exactly 1.0 when the spread fits the viewport at baseline', () => {
    expect(computeZoom(100, 50, 1280, 720)).toBe(1)
  })

  it('never zooms in past the 1.0 baseline even for zero spread', () => {
    expect(computeZoom(0, 0, 1280, 720)).toBe(1)
  })

  it('zero spread with zero margin does not divide by zero', () => {
    const z = computeZoom(0, 0, 1280, 720, { margin: 0 })
    expect(Number.isFinite(z)).toBe(true)
    expect(z).toBe(1)
  })

  it('fits the wider axis: maxAbsDx 800 on 1280x720 with margin 240 → 1280/2080', () => {
    const z = computeZoom(800, 0, 1280, 720)
    expect(z).toBeCloseTo(1280 / 2080, 10)
    expect(z).toBeCloseTo(0.6154, 4)
  })

  it('fits the taller axis when vertical spread dominates', () => {
    // spreadH = 2*300 + 480 = 1080 → 720/1080 ≈ 0.6667 ; spreadW = 480 → 1280/480 > 1
    expect(computeZoom(0, 300, 1280, 720)).toBeCloseTo(720 / 1080, 10)
  })

  it('clamps a huge spread to minZoom 0.5', () => {
    expect(computeZoom(100_000, 100_000, 1280, 720)).toBe(0.5)
  })

  it('honors custom margin/minZoom/maxZoom options', () => {
    expect(computeZoom(100_000, 0, 1280, 720, { minZoom: 0.25 })).toBe(0.25)
    expect(computeZoom(0, 0, 1280, 720, { maxZoom: 0.8 })).toBe(0.8)
    // margin 0: spreadW = 2*1280 = 2560 → 1280/2560 = 0.5 exactly
    expect(computeZoom(1280, 0, 1280, 720, { margin: 0 })).toBe(0.5)
  })
})
