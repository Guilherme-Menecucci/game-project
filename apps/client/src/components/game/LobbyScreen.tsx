import { characterCatalog, weaponCatalog } from '@game/shared'
import type { CharacterSelect } from '@game/shared'
import { CLASS_ORDER, CLASS_WEAPON } from './SoloRunStartScreen.js'
import { RoomCodeDisplay } from './RoomBrowserScreen.js'
import styles from './LobbyScreen.module.css'

// ─── Wire-shaped props ────────────────────────────────────────────────────────
// Presentational only: zero Colyseus code lives here. Plan 06-11 maps
// state.lobby (MapSchema<LobbyPlayerSchema> keyed by sessionId, plan 06-08)
// into `players` and forwards the callbacks as room messages.

/** One state.lobby entry plus its map key (plan 06-08 wire contract). */
export interface LobbyPlayer {
  sessionId: string
  displayName: string
  classId: string
  weaponId: string
  ready: boolean
  isHost: boolean
}

export interface LobbyScreenProps {
  /** Lobby roster in join order (oldest first). */
  players: LobbyPlayer[]
  localSessionId: string
  /** Private-room code shown as a chip with copy (top-right); null for public rooms. */
  roomCode: string | null
  /** Renders the "You are now the host" toast (set after a host_changed naming the local player). */
  hostToast: boolean
  /** Same payload shape as the select_class message (CharacterSelectSchema). */
  onSelectClass: (
    classId: CharacterSelect['classId'],
    weaponId: CharacterSelect['weaponId']
  ) => void
  onToggleReady: () => void
  onStart: () => void
  onLeave: () => void
}

/** Room capacity (CoopRoom maxClients, plan 06-08). */
const SQUAD_SIZE = 4
/** Start gate mirrors the server's start_run guard: 2+ players, all ready. */
const MIN_SQUAD_TO_START = 2

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

function classNameFor(classId: string): string {
  return hasOwn(characterCatalog, classId) ? characterCatalog[classId].displayName : classId
}

function weaponNameFor(weaponId: string): string {
  return hasOwn(weaponCatalog, weaponId) ? weaponCatalog[weaponId].displayName : weaponId
}

function PlayerSlot({ player, isLocal }: { player: LobbyPlayer; isLocal: boolean }) {
  return (
    <div
      className={styles.slot}
      role="group"
      aria-label={`${player.displayName}${isLocal ? ' (you)' : ''}`}
    >
      <div className={styles.slotNameRow}>
        <p className={styles.playerName}>{player.displayName}</p>
        {player.isHost && <span className={styles.hostChip}>★ Host</span>}
      </div>
      <p className={styles.classCardName}>{classNameFor(player.classId)}</p>
      <p className={styles.loadoutWeaponName}>{weaponNameFor(player.weaponId)}</p>
      <span className={`${styles.pill} ${player.ready ? styles.pillReady : styles.pillNotReady}`}>
        {player.ready ? 'Ready' : 'Not ready'}
      </span>
    </div>
  )
}

function EmptySlot() {
  return (
    <div className={styles.slotEmpty}>
      <p className={styles.mutedText}>Waiting for player…</p>
    </div>
  )
}

export function LobbyScreen({
  players,
  localSessionId,
  roomCode,
  hostToast,
  onSelectClass,
  onToggleReady,
  onStart,
  onLeave,
}: LobbyScreenProps) {
  const localPlayer = players.find((p) => p.sessionId === localSessionId)
  const isLocalHost = localPlayer?.isHost ?? false
  const isLocalReady = localPlayer?.ready ?? false
  const canStart = players.length >= MIN_SQUAD_TO_START && players.every((p) => p.ready)

  const slots = players.slice(0, SQUAD_SIZE)
  const emptyCount = SQUAD_SIZE - slots.length

  return (
    <div className={styles.screen}>
      <div className={styles.layout}>
        {hostToast && (
          <p className={styles.toast} role="status">
            You are now the host
          </p>
        )}

        <header className={styles.header}>
          <h1 className={styles.heading}>Squad Lobby</h1>
          {roomCode && <RoomCodeDisplay code={roomCode} variant="chip" />}
        </header>

        <div className={styles.slotRow}>
          {slots.map((player) => (
            <PlayerSlot
              key={player.sessionId}
              player={player}
              isLocal={player.sessionId === localSessionId}
            />
          ))}
          {Array.from({ length: emptyCount }, (_, i) => (
            <EmptySlot key={`empty-${i}`} />
          ))}
        </div>

        {/* Local class picker — same loadout cards/order as the Phase 5 solo screen */}
        <div className={styles.loadoutCardRow} role="group" aria-label="Choose your loadout">
          {CLASS_ORDER.map((classId) => {
            const entry = characterCatalog[classId]
            const weaponId = CLASS_WEAPON[classId]
            const isSelected = localPlayer?.classId === classId
            return (
              <button
                key={classId}
                type="button"
                className={`${styles.loadoutCard} ${isSelected ? styles.loadoutCardSelected : ''}`}
                aria-pressed={isSelected}
                disabled={!localPlayer}
                onClick={() => onSelectClass(classId, weaponId)}
              >
                <p className={styles.classCardName}>{entry.displayName}</p>
                <p className={styles.loadoutWeaponName}>{weaponCatalog[weaponId].displayName}</p>
              </button>
            )
          })}
        </div>

        <footer className={styles.footer}>
          <button type="button" className={styles.textBtn} onClick={onLeave}>
            Leave Lobby
          </button>

          <div className={styles.footerActions}>
            <button
              type="button"
              className={isLocalReady ? styles.unreadyBtn : styles.primaryBtn}
              disabled={!localPlayer}
              onClick={onToggleReady}
            >
              {isLocalReady ? 'Unready' : 'Ready'}
            </button>

            {isLocalHost ? (
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!canStart}
                onClick={onStart}
              >
                Start Run
              </button>
            ) : (
              <p className={styles.mutedText}>Waiting for host…</p>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
