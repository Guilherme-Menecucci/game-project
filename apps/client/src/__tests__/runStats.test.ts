import { describe, it, expect } from 'vitest'
import { formatDps, formatTime, resultView, RESULT_COLORS } from '../components/ui/runStats'

describe('formatTime', () => {
  it('formats zero as 00:00', () => {
    expect(formatTime(0)).toBe('00:00')
  })

  it('floors sub-second remainders', () => {
    expect(formatTime(59999)).toBe('00:59')
  })

  it('splits minutes and seconds with zero-padding', () => {
    expect(formatTime(61000)).toBe('01:01')
  })

  it('formats a full 30-minute run', () => {
    expect(formatTime(1_800_000)).toBe('30:00')
  })
})

describe('formatDps', () => {
  it('computes damage per active second', () => {
    // 150 damage over 10 active seconds (acquired at 5s, elapsed 15s)
    expect(formatDps(150, 5000, 15_000)).toBe('15.0')
  })

  it('rounds to one decimal place', () => {
    expect(formatDps(100, 0, 3000)).toBe('33.3')
  })

  it('guards division by zero when acquired at the current tick', () => {
    expect(formatDps(100, 5000, 5000)).toBe('0.0')
  })

  it('guards negative active time (acquiredAtMs after elapsedMs)', () => {
    expect(formatDps(100, 6000, 5000)).toBe('0.0')
  })

  it('handles the starting weapon (acquiredAtMs 0) with no damage yet', () => {
    expect(formatDps(0, 0, 1000)).toBe('0.0')
  })
})

describe('resultView', () => {
  it('presents the survived branch', () => {
    expect(resultView('survived')).toEqual({
      headerColor: RESULT_COLORS.survived,
      headline: 'Run Complete',
      resultLabel: 'Survived',
    })
  })

  it('presents the defeated branch', () => {
    expect(resultView('defeated')).toEqual({
      headerColor: RESULT_COLORS.defeated,
      headline: 'You Were Overwhelmed',
      resultLabel: 'Defeated',
    })
  })

  it('falls back to the defeated presentation for an unset result', () => {
    expect(resultView('')).toEqual(resultView('defeated'))
  })
})
