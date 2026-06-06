import { Canvas } from '@react-three/fiber'
import { UpgradeCard } from './UpgradeCard.js'
import type { UpgradeOption } from '@game/shared'

interface UpgradePickerProps {
  options: UpgradeOption[]
  onSelect: (upgradeId: string) => void
}

export function UpgradePicker({ options, onSelect }: UpgradePickerProps) {
  // Guard clause to prevent rendering an empty canvas (Pattern S-3/D-07)
  if (!options || options.length === 0) return null

  // Card layout placements: side by side
  const cardPositions: [number, number, number][] = [
    [-2.2, 0, 0],
    [0, 0, 0],
    [2.2, 0, 0],
  ]

  return (
    <>
      {/* Semi-transparent dark backdrop overlay covering Phaser (z-index 50) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 50,
          pointerEvents: 'all',
        }}
      />

      {/* R3F Canvas container overlay positioned above backdrop (z-index 51) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 51,
          pointerEvents: 'none',
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 5], fov: 50 }}
          style={{
            width: '100%',
            height: '100%',
            pointerEvents: 'auto',
          }}
        >
          <ambientLight intensity={0.8} />
          <directionalLight position={[2, 4, 6]} intensity={1.0} />

          {/* Render options dynamically (max 3 side-by-side cards) */}
          {options.slice(0, 3).map((option, index) => (
            <UpgradeCard
              key={option.id}
              option={option}
              position={cardPositions[index] || [0, 0, 0]}
              onSelect={onSelect}
            />
          ))}
        </Canvas>
      </div>
    </>
  )
}
