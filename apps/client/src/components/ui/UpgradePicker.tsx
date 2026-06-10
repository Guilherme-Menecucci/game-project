import { useState, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { UpgradeCard } from './UpgradeCard.js'
import type { UpgradeOption } from '@game/shared'

interface UpgradePickerProps {
  options: UpgradeOption[]
  onSelect: (upgradeId: string) => void
  weapons: string[]
  passives: string[]
}

const ITEM_NAMES: Record<string, string> = {
  magic_wand: 'Magic Wand',
  garlic: 'Garlic',
  knife: 'Knife',
  bible: 'Bible',
  holy_wand: 'Holy Wand 🌟',
  thousand_edge: 'Thousand Edge 🌟',
  spinach: 'Spinach',
  boots: 'Boots',
  empty_tome: 'Empty Tome',
  bracer: 'Bracer',
}

export function UpgradePicker({ options, onSelect, weapons, passives }: UpgradePickerProps) {
  const [timeLeft, setTimeLeft] = useState(15)

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((t) => Math.max(0, t - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  if (!options || options.length === 0) return null

  // Card layout placements: side by side
  const cardPositions: [number, number, number][] = [
    [-1.8, 0, 0],
    [0, 0, 0],
    [1.8, 0, 0],
  ]

  return (
    <>
      {/* Semi-transparent dark backdrop overlay covering Phaser (z-index 50) */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(5, 5, 15, 0.85)',
          zIndex: 50,
          pointerEvents: 'all',
          backdropFilter: 'blur(5px)',
        }}
      />

      {/* Timer / Timeout progress bar at the top */}
      <div
        style={{
          position: 'fixed',
          top: '30px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            color: timeLeft <= 5 ? '#ff4a4a' : '#ffffff',
            fontSize: '20px',
            fontWeight: '900',
            letterSpacing: '0.15em',
            textShadow: '0 0 10px rgba(0,0,0,0.8)',
            animation: timeLeft <= 5 ? 'pulse 0.5s infinite alternate ease-in-out' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          ⏱️ TIME LEFT:{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '24px' }}>{timeLeft}s</span>
        </div>
        <div
          style={{
            width: '320px',
            height: '8px',
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: '4px',
            overflow: 'hidden',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              width: `${(timeLeft / 15) * 100}%`,
              height: '100%',
              backgroundColor: timeLeft <= 5 ? '#ff4a4a' : '#4ade80',
              boxShadow: timeLeft <= 5 ? '0 0 12px #ff4a4a' : '0 0 12px #4ade80',
              transition: 'width 1s linear, background-color 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Loadout panel on the left */}
      <div
        style={{
          position: 'fixed',
          top: '100px',
          left: '45px',
          zIndex: 100,
          width: '260px',
          backgroundColor: 'rgba(20, 20, 35, 0.85)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.05)',
          backdropFilter: 'blur(12px)',
          color: '#ffffff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <h3
          style={{
            fontSize: '18px',
            fontWeight: '900',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            paddingBottom: '12px',
            margin: 0,
            color: '#ffcc00',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          🛡️ Loadout Status
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: '800',
                textTransform: 'uppercase',
                color: '#8e8e9f',
                marginBottom: '10px',
                letterSpacing: '0.05em',
              }}
            >
              Weapons ({weapons.length}/6)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {weapons.length === 0 ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#686875',
                    fontStyle: 'italic',
                    paddingLeft: '8px',
                  }}
                >
                  No weapons equipped
                </div>
              ) : (
                weapons.map((w, i) => {
                  const [id, lvl] = w.split(':')
                  const isEvolved = id === 'holy_wand' || id === 'thousand_edge'
                  return (
                    <div
                      key={i}
                      style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderLeft: `3px solid ${isEvolved ? '#ffcc00' : '#4a9eff'}`,
                      }}
                    >
                      <span>{ITEM_NAMES[id] || id}</span>
                      {lvl && (
                        <span style={{ color: '#ffcc00', fontWeight: 'bold' }}>Lv {lvl}</span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: '800',
                textTransform: 'uppercase',
                color: '#8e8e9f',
                marginBottom: '10px',
                letterSpacing: '0.05em',
              }}
            >
              Passives ({passives.length}/6)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {passives.length === 0 ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#686875',
                    fontStyle: 'italic',
                    paddingLeft: '8px',
                  }}
                >
                  No passives equipped
                </div>
              ) : (
                passives.map((p, i) => {
                  const [id, lvl] = p.split(':')
                  return (
                    <div
                      key={i}
                      style={{
                        fontSize: '13px',
                        fontWeight: '600',
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderLeft: `3px solid #44cc88`,
                      }}
                    >
                      <span>{ITEM_NAMES[id] || id}</span>
                      {lvl && (
                        <span style={{ color: '#44cc88', fontWeight: 'bold' }}>Lv {lvl}</span>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

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
              weapons={weapons}
              passives={passives}
            />
          ))}
        </Canvas>
      </div>
    </>
  )
}
