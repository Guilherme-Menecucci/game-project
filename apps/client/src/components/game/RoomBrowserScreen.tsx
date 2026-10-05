import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import styles from './RoomBrowserScreen.module.css'

// ─── Wire-shaped props ────────────────────────────────────────────────────────
// Presentational only: zero fetch/Colyseus code lives here. Plan 06-11 owns the
// GET /rooms request, client.create/joinById calls and error mapping.

/** One public room, shaped exactly like a GET /rooms response entry (plan 06-08). */
export interface RoomListing {
  roomId: string
  hostName: string
  clients: number
  maxClients: number
}

/**
 * Locked user-facing copy for room-join failures (06-UI-SPEC §Copywriting
 * Contract). Plan 06-11 maps server/matchmaker errors onto these strings and
 * passes the result through the `error` prop.
 */
export const ROOM_ERROR_COPY = {
  NOT_FOUND: 'Room not found — check the code and try again.',
  FULL: 'That squad is full.',
  STARTED: 'That run already started.',
  /** Listing/create transport failure — reuses the Phase 5 server-error copy. */
  SERVER_ERROR: "Couldn't reach the server. Try again.",
} as const

// Room codes use the server's 32-char unambiguous alphabet
// (ROOM_CODE_ALPHABET in apps/game-server/src/lib/roomCode.ts): A–Z minus I/O,
// digits 2–9 (no 0/1). Client-side filtering is a typing convenience only —
// the server's roomId lookup stays authoritative.
export const ROOM_CODE_LENGTH = 6
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
const ROOM_CODE_REJECTED_CHARS = /[^A-HJ-NP-Z2-9]/g

/** Uppercase, drop every glyph outside the room-code alphabet, cap at 6 chars. */
export function sanitizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(ROOM_CODE_REJECTED_CHARS, '').slice(0, ROOM_CODE_LENGTH)
}

// ─── Shared room-code display (also used by LobbyScreen's code chip) ─────────

const COPIED_FEEDBACK_MS = 2000

function useCopyFeedback(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = useCallback((text: string) => {
    // navigator.clipboard is undefined on insecure (non-HTTPS, non-localhost) origins.
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
    if (!clipboard?.writeText) return
    clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false)
    )
  }, [])

  return [copied, copy]
}

interface RoomCodeDisplayProps {
  code: string
  /** 'boxes' = 6 Heading-size character cells (§3); 'chip' = compact lobby chip (§5). */
  variant?: 'boxes' | 'chip'
}

export function RoomCodeDisplay({ code, variant = 'boxes' }: RoomCodeDisplayProps) {
  const [copied, copy] = useCopyFeedback()

  const copyBtn = (
    <button type="button" className={styles.textBtn} onClick={() => copy(code)}>
      {copied ? 'Copied ✓' : 'Copy Code'}
    </button>
  )

  if (variant === 'chip') {
    return (
      <div className={styles.codeChip}>
        <span className={styles.codeChipText} aria-label={`Room code ${code.split('').join(' ')}`}>
          {code}
        </span>
        {copyBtn}
      </div>
    )
  }

  return (
    <div className={styles.codeDisplay}>
      <div className={styles.codeBoxes} aria-label={`Room code ${code.split('').join(' ')}`}>
        {code.split('').map((char, i) => (
          <span key={i} className={styles.codeBox} aria-hidden="true">
            {char}
          </span>
        ))}
      </div>
      {copyBtn}
    </div>
  )
}

// ─── Room browser ─────────────────────────────────────────────────────────────

export interface RoomBrowserScreenProps {
  /** Public, unlocked co-op rooms (GET /rooms). */
  rooms: RoomListing[]
  /** True while the listing request is in flight. */
  loading: boolean
  /** Pre-mapped user-facing copy (see ROOM_ERROR_COPY), or null. */
  error: string | null
  /** Code of the private room just created, shown in the Create panel; null otherwise. */
  createdCode: string | null
  /** Optional: disables create/join CTAs while a create/join request is in flight. */
  busy?: boolean
  onCreate: (isPrivate: boolean) => void
  onJoinRoom: (roomId: string) => void
  onJoinByCode: (code: string) => void
  onRefresh: () => void
  onBack: () => void
}

type Panel = 'none' | 'create' | 'code'

export function RoomBrowserScreen({
  rooms,
  loading,
  error,
  createdCode,
  busy = false,
  onCreate,
  onJoinRoom,
  onJoinByCode,
  onRefresh,
  onBack,
}: RoomBrowserScreenProps) {
  const [panel, setPanel] = useState<Panel>(createdCode ? 'create' : 'none')
  const [isPrivate, setIsPrivate] = useState(false)
  const [code, setCode] = useState('')
  const [codeFocused, setCodeFocused] = useState(false)

  // A freshly created private code must be visible even if the panel was closed.
  useEffect(() => {
    if (createdCode) setPanel('create')
  }, [createdCode])

  const codeValid = ROOM_CODE_PATTERN.test(code)

  const togglePanel = (next: Exclude<Panel, 'none'>) =>
    setPanel((current) => (current === next ? 'none' : next))

  const handleJoinByCode = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!codeValid || busy) return
    onJoinByCode(code)
  }

  const showEmpty = !loading && rooms.length === 0

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <h1 className={styles.heading}>Join a Squad</h1>

        <div className={styles.actionsRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            aria-expanded={panel === 'create'}
            onClick={() => togglePanel('create')}
          >
            Create Room
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            aria-expanded={panel === 'code'}
            onClick={() => togglePanel('code')}
          >
            Join by Code
          </button>
          <button
            type="button"
            className={`${styles.textBtn} ${styles.refreshBtn}`}
            disabled={loading}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <p className={styles.errorText}>{error}</p>
          </div>
        )}

        {panel === 'create' && (
          <section className={styles.panel} aria-label="Create room">
            <div className={styles.segmented} role="group" aria-label="Room visibility">
              <button
                type="button"
                className={`${styles.segmentBtn} ${!isPrivate ? styles.segmentBtnSelected : ''}`}
                aria-pressed={!isPrivate}
                onClick={() => setIsPrivate(false)}
              >
                Public
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${isPrivate ? styles.segmentBtnSelected : ''}`}
                aria-pressed={isPrivate}
                onClick={() => setIsPrivate(true)}
              >
                Private
              </button>
            </div>

            {createdCode && <RoomCodeDisplay code={createdCode} />}

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busy}
              onClick={() => onCreate(isPrivate)}
            >
              Create Room
            </button>
          </section>
        )}

        {panel === 'code' && (
          <form className={styles.panel} aria-label="Join by code" onSubmit={handleJoinByCode}>
            <label className={styles.codeEntry} htmlFor="room-code-input">
              <input
                id="room-code-input"
                className={styles.codeInput}
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-label="Room code"
                value={code}
                onChange={(e) => setCode(sanitizeRoomCode(e.target.value))}
                onFocus={() => setCodeFocused(true)}
                onBlur={() => setCodeFocused(false)}
              />
              <span className={styles.codeBoxes} aria-hidden="true">
                {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => {
                  const isActive = codeFocused && i === Math.min(code.length, ROOM_CODE_LENGTH - 1)
                  return (
                    <span
                      key={i}
                      className={`${styles.codeBox} ${isActive ? styles.codeBoxActive : ''}`}
                    >
                      {code[i] ?? ''}
                    </span>
                  )
                })}
              </span>
            </label>

            <button type="submit" className={styles.primaryBtn} disabled={!codeValid || busy}>
              Join
            </button>
          </form>
        )}

        {loading && rooms.length === 0 ? (
          <p className={styles.mutedText}>Finding squads…</p>
        ) : showEmpty ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyHeading}>No open squads right now.</p>
            <p className={styles.bodyText}>Create a room and share the code with friends.</p>
            {panel !== 'create' && (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setPanel('create')}
              >
                Create Room
              </button>
            )}
          </div>
        ) : (
          <ul className={styles.roomList}>
            {rooms.map((room) => {
              const isFull = room.clients >= room.maxClients
              return (
                <li key={room.roomId} className={styles.roomRow}>
                  <span className={styles.hostName}>{room.hostName}</span>
                  <span className={styles.countBadge}>
                    {room.clients}/{room.maxClients}
                  </span>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={isFull || busy}
                    onClick={() => onJoinRoom(room.roomId)}
                  >
                    Join
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.textBtn} onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  )
}
