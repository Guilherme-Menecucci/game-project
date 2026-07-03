import { Html } from '@react-three/drei'

interface SummaryPanelProps {
  position: [number, number, number]
  elapsedMs: number
  kills: number
  totalDamage: number
  result: 'survived' | 'defeated' | ''
}

const RESULT_COLORS = {
  survived: '#22c55e', // --color-hp-fill
  defeated: '#e05252', // --color-destructive
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function SummaryPanel({
  position,
  elapsedMs,
  kills,
  totalDamage,
  result,
}: SummaryPanelProps) {
  const survived = result === 'survived'
  const headerColor = survived ? RESULT_COLORS.survived : RESULT_COLORS.defeated
  const headline = survived ? 'Run Complete' : 'You Were Overwhelmed'
  const resultLabel = survived ? 'Survived' : 'Defeated'

  const statRows: [string, string][] = [
    ['Time Survived', formatTime(elapsedMs)],
    ['Enemies Defeated', String(kills)],
    ['Damage Dealt', String(totalDamage)],
    ['Result', resultLabel],
  ]

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.6, 2.0, 0.035]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.1} />

        {/* Header banner — flush with the panel's top edge, colored by result */}
        <mesh position={[0, 0.9, 0.02]}>
          <planeGeometry args={[1.6, 0.2]} />
          <meshBasicMaterial color={headerColor} />
        </mesh>

        <Html
          position={[0, 0, 0.04]}
          center
          distanceFactor={2.5}
          style={{
            width: '320px',
            textAlign: 'center',
            color: '#f0f0f5',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '18px',
          }}
        >
          <div
            style={{
              fontSize: '26px',
              fontWeight: '600',
              color: headerColor,
              textShadow: '0 2px 4px rgba(0,0,0,0.7)',
            }}
          >
            {headline}
          </div>

          <dl
            style={{
              width: '100%',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {statRows.map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                }}
              >
                <dt style={{ fontSize: '14px', fontWeight: '400', color: '#8e8e9f' }}>{label}</dt>
                <dd style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>{value}</dd>
              </div>
            ))}
          </dl>
        </Html>
      </mesh>
    </group>
  )
}
