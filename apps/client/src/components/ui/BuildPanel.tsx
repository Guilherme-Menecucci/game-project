import { Html } from '@react-three/drei'

interface BuildPanelProps {
  position: [number, number, number]
  weapons: string[]
  passives: string[]
  /** Keyed by slot index '0'-'5' (D-21) — weapons[i] pairs with weaponStats[String(i)]. */
  weaponStats: Record<string, { totalDamage: number; acquiredAtMs: number }>
  elapsedMs: number
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

const ITEM_ICONS: Record<string, string> = {
  magic_wand: '🪄',
  garlic: '🧄',
  knife: '🗡️',
  bible: '📖',
  holy_wand: '🌟',
  thousand_edge: '💫',
  spinach: '🌱',
  boots: '🥾',
  empty_tome: '📕',
  bracer: '🛡️',
}

// TYPE_COLORS carryover from UpgradeCard (05-UI-SPEC §9)
const WEAPON_COLOR = '#4a9eff'
const PASSIVE_COLOR = '#44cc88'
const EVOLUTION_COLOR = '#ffcc00'

function formatDps(totalDamage: number, acquiredAtMs: number, elapsedMs: number): string {
  const activeSec = (elapsedMs - acquiredAtMs) / 1000
  if (activeSec <= 0) return '0.0'
  return (totalDamage / activeSec).toFixed(1)
}

interface LoadoutItemProps {
  id: string
  lvl: string | undefined
  borderColor: string
  badgeColor: string
}

function LoadoutItem({ id, lvl, borderColor, badgeColor }: LoadoutItemProps) {
  return (
    <div
      title={ITEM_NAMES[id] || id}
      style={{
        position: 'relative',
        width: '44px',
        height: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        backgroundColor: 'rgba(255,255,255,0.03)',
        border: `1px solid ${borderColor}`,
        fontSize: '20px',
      }}
    >
      <span style={{ lineHeight: 1 }}>{ITEM_ICONS[id] || '❓'}</span>
      {lvl && (
        <span
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            fontSize: '9px',
            fontWeight: '800',
            color: badgeColor,
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
          }}
        >
          L{lvl}
        </span>
      )}
    </div>
  )
}

export function BuildPanel({
  position,
  weapons,
  passives,
  weaponStats,
  elapsedMs,
}: BuildPanelProps) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.6, 2.0, 0.035]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.1} />

        {/* Header banner — neutral weapon-blue tint (not result-branched) */}
        <mesh position={[0, 0.9, 0.02]}>
          <planeGeometry args={[1.6, 0.2]} />
          <meshBasicMaterial color={WEAPON_COLOR} />
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
            gap: '14px',
          }}
        >
          <div
            style={{
              fontSize: '20px',
              fontWeight: '600',
              textShadow: '0 2px 4px rgba(0,0,0,0.7)',
            }}
          >
            Final Loadout
          </div>

          <div
            style={{
              width: '100%',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '10px',
            }}
          >
            {weapons.map((w, i) => {
              const [id, lvl] = w.split(':')
              const isEvolved = id === 'holy_wand' || id === 'thousand_edge'
              // Pair by array index: weapons[i]'s slot index IS i (in-place
              // replace_slot per 05-07 — never splice/shift). Starting weapon
              // legitimately has acquiredAtMs 0; missing entry is defensive.
              const stats = weaponStats[String(i)] ?? { totalDamage: 0, acquiredAtMs: 0 }
              return (
                <div
                  key={`weapon-${i}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <LoadoutItem
                    id={id}
                    lvl={lvl}
                    borderColor={isEvolved ? EVOLUTION_COLOR : WEAPON_COLOR}
                    badgeColor={EVOLUTION_COLOR}
                  />
                  <div style={{ fontSize: '10px', fontWeight: '400', color: '#d1d1db' }}>
                    Total Damage: {stats.totalDamage}
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: '400', color: '#d1d1db' }}>
                    DPS: {formatDps(stats.totalDamage, stats.acquiredAtMs, elapsedMs)}
                  </div>
                </div>
              )
            })}
            {passives.map((p, i) => {
              const [id, lvl] = p.split(':')
              return (
                <LoadoutItem
                  key={`passive-${i}`}
                  id={id}
                  lvl={lvl}
                  borderColor={PASSIVE_COLOR}
                  badgeColor={PASSIVE_COLOR}
                />
              )
            })}
          </div>
        </Html>
      </mesh>
    </group>
  )
}
