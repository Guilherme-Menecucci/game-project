import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { UpgradeOption } from '@game/shared'
import * as THREE from 'three'

interface UpgradeCardProps {
  option: UpgradeOption
  position: [number, number, number]
  onSelect: (id: string) => void
  weapons: string[]
  passives: string[]
}

const TYPE_COLORS = {
  weapon: '#4a9eff',
  passive: '#44cc88',
  evolution: '#ffcc00',
}

function getStatImprovements(optionId: string): string[] {
  const [id, levelStr] = optionId.split(':')
  const level = levelStr ? parseInt(levelStr, 10) : 1

  if (optionId === 'holy_wand') {
    return ['Evolve Magic Wand', 'Fires continuously', 'Damage: 30']
  }
  if (optionId === 'thousand_edge') {
    return ['Evolve Knife', 'Fires continuously', 'Damage: 40']
  }

  if (id === 'magic_wand' || id === 'knife') {
    const dmg = id === 'magic_wand' ? [3, 5, 8, 11, 15] : [5, 8, 12, 17, 23]
    const cds = id === 'magic_wand' ? [30, 24, 20, 16, 12] : [23, 18, 15, 12, 9]
    const speeds =
      id === 'magic_wand'
        ? ['10.5k', '12.8k', '15.0k', '16.5k', '18.0k']
        : ['14.0k', '17.0k', '20.0k', '22.0k', '24.0k']

    const idx = level - 1
    const prevIdx = level - 2
    const currentDmg = dmg[idx]
    const prevDmg = prevIdx >= 0 ? dmg[prevIdx] : 0

    const currentCd = cds[idx]
    const prevCd = prevIdx >= 0 ? cds[prevIdx] : 0

    const currentSpd = speeds[idx]

    const changes = [
      `Damage: ${currentDmg} ${prevDmg ? `(+${currentDmg - prevDmg})` : ''}`,
      `Cooldown: ${currentCd} ticks ${prevCd ? `(${currentCd - prevCd})` : ''}`,
      `Proj Speed: ${currentSpd}`,
    ]
    return changes
  }

  if (id === 'garlic') {
    const rad = ['0.6x', '0.8x', '1.0x', '1.2x', '1.5x']
    const dmg = [2, 3, 5, 7, 10]
    const idx = level - 1
    const prevIdx = level - 2
    const prevDmg = prevIdx >= 0 ? dmg[prevIdx] : 0
    return [
      `Damage: ${dmg[idx]} ${prevDmg ? `(+${dmg[idx] - prevDmg})` : ''}`,
      `Radius: ${rad[idx]}`,
    ]
  }

  if (id === 'bible') {
    const dmg = [2, 4, 6, 9, 12]
    const count = level
    const idx = level - 1
    const prevIdx = level - 2
    const prevDmg = prevIdx >= 0 ? dmg[prevIdx] : 0
    return [
      `Damage: ${dmg[idx]} ${prevDmg ? `(+${dmg[idx] - prevDmg})` : ''}`,
      `Projectiles: ${count}`,
    ]
  }

  if (id === 'spinach') {
    const mults = ['+5%', '+10%', '+15%', '+20%', '+30%']
    return [`Damage bonus: ${mults[level - 1]}`]
  }

  if (id === 'empty_tome') {
    const mults = ['-5%', '-10%', '-15%', '-20%', '-35%']
    return [`Cooldown reduction: ${mults[level - 1]}`]
  }

  if (id === 'bracer') {
    const mults = ['+5%', '+10%', '+15%', '+20%', '+35%']
    return [`Projectile speed: ${mults[level - 1]}`]
  }

  if (id === 'boots') {
    const speeds = ['+150', '+300', '+450', '+600', '+800']
    return [`Speed: ${speeds[level - 1]}`]
  }

  return []
}

function getEvolutionWarning(
  optionId: string,
  weapons: string[],
  passives: string[]
): string | null {
  const [id] = optionId.split(':')

  const hasMagicWand = weapons.some((w) => w.startsWith('magic_wand'))
  const hasEmptyTome = passives.some((p) => p.startsWith('empty_tome'))
  const hasKnife = weapons.some((w) => w.startsWith('knife'))
  const hasBracer = passives.some((p) => p.startsWith('bracer'))

  if (id === 'empty_tome' && hasMagicWand && !hasEmptyTome) {
    return 'Missing part for Holy Wand!'
  }
  if (id === 'magic_wand' && hasEmptyTome && !hasMagicWand) {
    return 'Missing part for Holy Wand!'
  }
  if (id === 'bracer' && hasKnife && !hasBracer) {
    return 'Missing part for Thousand Edge!'
  }
  if (id === 'knife' && hasBracer && !hasKnife) {
    return 'Missing part for Thousand Edge!'
  }

  return null
}

export function UpgradeCard({ option, position, onSelect, weapons, passives }: UpgradeCardProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const tiltY = useRef(0)

  useFrame((_, delta) => {
    if (meshRef.current) {
      const targetTilt = hovered ? 0.3 : 0
      tiltY.current += (targetTilt - tiltY.current) * 10 * delta
      meshRef.current.rotation.y = tiltY.current
    }
  })

  const borderCol = TYPE_COLORS[option.kind] || '#ffffff'
  const statsList = getStatImprovements(option.id)
  const comboWarning = getEvolutionWarning(option.id, weapons, passives)

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={() => onSelect(option.id)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[1.12, 1.68, 0.035]} />
        <meshStandardMaterial
          color={hovered ? '#ffffff' : '#1a1a2e'}
          roughness={0.3}
          metalness={0.1}
        />

        {/* Card header banner indicating type */}
        <mesh position={[0, 0.74, 0.02]}>
          <planeGeometry args={[1.12, 0.2]} />
          <meshBasicMaterial color={borderCol} />
        </mesh>

        <Html
          position={[0, 0, 0.04]}
          center
          distanceFactor={2.5}
          style={{
            width: '240px',
            textAlign: 'center',
            color: hovered ? '#1a1a2e' : '#f0f0f5',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <style
            dangerouslySetInnerHTML={{
              __html: `
            @keyframes pulse {
              0% { transform: scale(0.97); opacity: 0.85; }
              100% { transform: scale(1.03); opacity: 1; }
            }
          `,
            }}
          />

          {/* Option Display Name */}
          <div
            style={{
              fontSize: '22px',
              fontWeight: '800',
              textShadow: hovered ? 'none' : '0 2px 4px rgba(0,0,0,0.7)',
              color: hovered ? '#1a1a2e' : '#ffffff',
            }}
          >
            {option.displayName}
          </div>

          {/* Option Kind Badge */}
          <div
            style={{
              display: 'inline-block',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '900',
              textTransform: 'uppercase',
              backgroundColor: borderCol,
              color: option.kind === 'evolution' ? '#1a1a2e' : '#ffffff',
            }}
          >
            {option.kind}
          </div>

          {/* Option Description */}
          <div
            style={{
              fontSize: '14px',
              color: hovered ? '#2e2e42' : '#d1d1db',
              lineHeight: '1.4',
              margin: '2px 0',
            }}
          >
            {option.description}
          </div>

          {/* Stat Improvements Details */}
          {statsList.length > 0 && (
            <div
              style={{
                width: '100%',
                backgroundColor: hovered ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)',
                borderRadius: '6px',
                padding: '6px 10px',
                boxSizing: 'border-box',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  color: borderCol,
                  marginBottom: '4px',
                }}
              >
                Stat Improvements
              </div>
              {statsList.map((stat, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '13px',
                    fontWeight: '500',
                    color: hovered ? '#1a1a2e' : '#f0f0f5',
                  }}
                >
                  • {stat}
                </div>
              ))}
            </div>
          )}

          {/* Evolution Combo Warning */}
          {comboWarning && (
            <div
              style={{
                fontSize: '13px',
                fontWeight: 'bold',
                color: hovered ? '#735100' : '#ffd700',
                backgroundColor: hovered ? 'rgba(115, 81, 0, 0.1)' : 'rgba(255, 215, 0, 0.15)',
                border: `1px solid ${hovered ? '#735100' : '#ffd700'}`,
                padding: '4px 8px',
                borderRadius: '4px',
                marginTop: '4px',
                width: '100%',
                boxSizing: 'border-box',
                animation: 'pulse 1.2s infinite alternate ease-in-out',
              }}
            >
              ✨ {comboWarning}
            </div>
          )}
        </Html>
      </mesh>
    </group>
  )
}
