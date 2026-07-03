// Pure presentation logic shared by the end-of-run panels (SummaryPanel,
// BuildPanel). Kept free of react-three-fiber imports so it can be unit
// tested in a plain node environment.

export const RESULT_COLORS = {
  survived: '#22c55e', // --color-hp-fill
  defeated: '#e05252', // --color-destructive
}

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function formatDps(totalDamage: number, acquiredAtMs: number, elapsedMs: number): string {
  const activeSec = (elapsedMs - acquiredAtMs) / 1000
  if (activeSec <= 0) return '0.0'
  return (totalDamage / activeSec).toFixed(1)
}

export function resultView(result: 'survived' | 'defeated' | '') {
  const survived = result === 'survived'
  return {
    headerColor: survived ? RESULT_COLORS.survived : RESULT_COLORS.defeated,
    headline: survived ? 'Run Complete' : 'You Were Overwhelmed',
    resultLabel: survived ? 'Survived' : 'Defeated',
  }
}
