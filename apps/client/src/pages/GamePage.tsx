import { useRef, useState, useCallback, useEffect } from 'react'
import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import { useAuth } from '../components/auth/AuthProvider.js'
import { SoloRunStartScreen, CLASS_WEAPON } from '../components/game/SoloRunStartScreen.js'
import { RoomBrowserScreen, ROOM_ERROR_COPY } from '../components/game/RoomBrowserScreen.js'
import type { RoomListing } from '../components/game/RoomBrowserScreen.js'
import { PhaserGame } from '../components/game/PhaserGame.js'
import type { GameOverData } from '../components/game/PhaserGame.js'
import { GameHUD } from '../components/game/GameHUD.js'
import { GameOverScreen } from '../components/game/GameOverScreen.js'
import { UpgradePicker } from '../components/ui/UpgradePicker.js'
import { SlotFullModal } from '../components/ui/SlotFullModal.js'
import type { UpgradeOption } from '@game/shared'
import styles from './GamePage.module.css'

export type GamePhase =
  | 'IDLE'
  | 'CHARACTER_SELECT'
  | 'CONNECTING'
  | 'ROOM_BROWSER'
  | 'LOBBY'
  | 'ACTIVE'
  | 'UPGRADING'
  | 'SLOT_FULL'
  | 'GAME-OVER'

export type GameError =
  | 'SESSION_EXPIRED'
  | 'SERVER_ERROR'
  | 'GAME_SERVER_UNREACHABLE'
  | 'TOKEN_REJECTED'
  | null

/** GET /colyseus/rooms poll cadence while the room browser is open. */
const ROOM_POLL_MS = 5000

/** What the room browser asked to connect to. */
type CoopTarget =
  | { kind: 'create'; isPrivate: boolean }
  | { kind: 'join'; roomId: string }
  | { kind: 'code'; code: string }

/**
 * Client-side view of the CoopRoom wire state (plan 06-08/06-09 contract).
 * Read via `state as …` — the established client convention (GameScene/GameHUD
 * also read room state untyped; the client never imports the server schema).
 */
interface CoopWireState {
  roomPhase?: string
  players?: Map<string, { weapons?: string[]; passives?: string[] }>
}

/** Defensive guard for one GET /rooms entry (plan 06-08 listing contract). */
function isRoomListing(value: unknown): value is RoomListing {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.roomId === 'string' &&
    typeof v.hostName === 'string' &&
    typeof v.clients === 'number' &&
    typeof v.maxClients === 'number'
  )
}

/**
 * Maps a matchmaker/join failure onto the locked UI-SPEC copy (best effort —
 * Colyseus 0.17 only exposes the error message text):
 *   `room "X" not found` / `has been disposed` → NOT_FOUND
 *   `X is already full.` (seat-reservation race)  → FULL
 *   `room "X" is locked` / `Room already started` → STARTED
 *   anything else (transport, auth, 5xx)          → SERVER_ERROR
 * Matching is case-SENSITIVE on purpose: room codes are uppercase, so a
 * lowercased `room "FULLXY" not found` would otherwise read as "full".
 * Known ambiguity: a 4/4 lobby auto-locks, so joining a full squad by code
 * reports `is locked` and shows the STARTED copy.
 */
function roomErrorCopy(message: string): string {
  if (message.includes('not found') || message.includes('has been disposed')) {
    return ROOM_ERROR_COPY.NOT_FOUND
  }
  if (message.includes('already full')) return ROOM_ERROR_COPY.FULL
  if (message.includes('is locked') || message.includes('already started')) {
    return ROOM_ERROR_COPY.STARTED
  }
  return ROOM_ERROR_COPY.SERVER_ERROR
}

export function GamePage() {
  const { user } = useAuth()
  const [phase, setPhase] = useState<GamePhase>('CHARACTER_SELECT')
  const [error, setError] = useState<GameError>(null)
  const roomRef = useRef<Room | null>(null)
  // Pre-created loadout selection: the loadout IS the class — weaponId is
  // derived from CLASS_WEAPON (single source of truth, also used by
  // SoloRunStartScreen to render each loadout card's bound weapon).
  const [selectedClassId, setSelectedClassId] = useState<'vampire' | 'human' | 'dwarf' | null>(null)
  const [pendingChoices, setPendingChoices] = useState<UpgradeOption[]>([])
  const [slotFullPayload, setSlotFullPayload] = useState<{
    weapons: string[]
    upgradeId: string
  } | null>(null)

  // Final stats captured from game-over event (populated on GAME-OVER transition)
  const [finalStats, setFinalStats] = useState<GameOverData>({
    killCount: 0,
    elapsedMs: 0,
    level: 1,
    xp: 0,
  })

  const [weapons, setWeapons] = useState<string[]>([])
  const [passives, setPassives] = useState<string[]>([])

  // ─── Co-op (Phase 6) state ─────────────────────────────────────────────────
  const [rooms, setRooms] = useState<RoomListing[]>([])
  const [roomsLoading, setRoomsLoading] = useState(false)
  // Listing failures and join failures are tracked apart so a successful 5s
  // poll clears a stale listing error without wiping a join error the user
  // has not read yet.
  const [listError, setListError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [browserBusy, setBrowserBusy] = useState(false)

  // Refs read from async/room callbacks (never stale React state).
  const phaseRef = useRef<GamePhase>(phase)
  const unmountedRef = useRef(false)
  const connectingRef = useRef(false)
  const pollAbortRef = useRef<AbortController | null>(null)
  /** Removes every listener attached to the current co-op room. */
  const coopTeardownRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  async function handleSoloRun() {
    setPhase('CONNECTING')
    setError(null)
    setWeapons([])
    setPassives([])

    // Step 1: Fetch game token (session cookie required — D-05)
    let token: string
    try {
      const res = await fetch('/api/auth/game-token', { credentials: 'include' })
      if (res.status === 401) {
        setPhase('CHARACTER_SELECT')
        setError('SESSION_EXPIRED')
        return
      }
      if (!res.ok) {
        // 403 or 5xx — treat as server error (UI-SPEC entry flow copywriting)
        setPhase('CHARACTER_SELECT')
        setError('SERVER_ERROR')
        return
      }
      const data = (await res.json()) as { token: string }
      token = data.token
    } catch {
      // Network error
      setPhase('CHARACTER_SELECT')
      setError('SERVER_ERROR')
      return
    }

    // Step 2: Connect to Colyseus solo_room via /colyseus proxy (D-10)
    try {
      const client = new Client('/colyseus')
      // create() — never joinOrCreate(). SoloRoom.maxClients is 4, so
      // joinOrCreate would drop a second player into another player's "solo" run.
      // create() always spins up a fresh, unshared room instance per solo run.
      const room = await client.create<unknown>('solo_room', {
        token,
        classId: selectedClassId,
        weaponId: selectedClassId ? CLASS_WEAPON[selectedClassId] : null,
      })
      roomRef.current = room as Room

      // Track weapons and passives
      room.onStateChange((stateUpdate: unknown) => {
        const state = stateUpdate as {
          players?: Map<string, { weapons?: string[]; passives?: string[] }>
        }
        const myPlayer = state.players?.get(room.sessionId)
        if (myPlayer) {
          if (myPlayer.weapons) {
            setWeapons(Array.from(myPlayer.weapons))
          }
          if (myPlayer.passives) {
            setPassives(Array.from(myPlayer.passives))
          }
        }
      })

      // Add progression listeners
      room.onMessage('levelup', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      })

      room.onMessage('slot_full', (data: { weapons: string[]; upgradeId: string }) => {
        setSlotFullPayload(data)
        setPhase('SLOT_FULL')
      })

      room.onMessage('rare_event', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      })

      room.onMessage('upgrade_applied', () => {
        setPhase('ACTIVE')
        setPendingChoices([])
        setSlotFullPayload(null)
      })

      setPhase('ACTIVE')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ECONNREFUSED') || msg.includes('timeout') || msg.includes('connect')) {
        setError('GAME_SERVER_UNREACHABLE')
      } else if (
        msg.includes('token') ||
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('auth')
      ) {
        setError('TOKEN_REJECTED')
      } else {
        setError('SERVER_ERROR')
      }
      setPhase('CHARACTER_SELECT')
    }
  }

  // ─── Co-op: room browser ───────────────────────────────────────────────────

  /** GET /rooms through the Vite proxy (/colyseus is stripped — 06-RESEARCH Pattern 2). */
  const fetchRooms = useCallback(async (signal?: AbortSignal) => {
    setRoomsLoading(true)
    try {
      const res = await fetch('/colyseus/rooms', { signal })
      if (!res.ok) {
        setListError(ROOM_ERROR_COPY.SERVER_ERROR)
        return
      }
      const data: unknown = await res.json()
      if (signal?.aborted) return
      setRooms(Array.isArray(data) ? data.filter(isRoomListing) : [])
      setListError(null)
    } catch {
      // Aborted on browser exit/unmount — not an error the user should see.
      if (signal?.aborted) return
      setListError(ROOM_ERROR_COPY.SERVER_ERROR)
    } finally {
      if (!signal?.aborted) setRoomsLoading(false)
    }
  }, [])

  // Poll on browser entry + every 5s; abort + clear on exit/unmount so a late
  // response never sets state after the browser is gone.
  const inBrowser = phase === 'ROOM_BROWSER'
  useEffect(() => {
    if (!inBrowser) return
    const controller = new AbortController()
    pollAbortRef.current = controller
    void fetchRooms(controller.signal)
    const timer = window.setInterval(() => void fetchRooms(controller.signal), ROOM_POLL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
      if (pollAbortRef.current === controller) pollAbortRef.current = null
      setRoomsLoading(false)
    }
  }, [inBrowser, fetchRooms])

  const handleRefreshRooms = useCallback(() => {
    void fetchRooms(pollAbortRef.current?.signal)
  }, [fetchRooms])

  const handleOpenCoop = useCallback(() => {
    setError(null)
    setJoinError(null)
    setListError(null)
    setCreatedCode(null)
    setPhase('ROOM_BROWSER')
  }, [])

  const handleBrowserBack = useCallback(() => {
    setJoinError(null)
    setCreatedCode(null)
    setPhase('CHARACTER_SELECT')
  }, [])

  /**
   * Wires the in-run listeners on a freshly joined co-op room. Mirrors the solo
   * listener block (weapons/passives + progression messages) — handleSoloRun is
   * intentionally left verbatim so the solo path stays byte-identical.
   * Returns a teardown that removes everything it attached.
   */
  function attachCoopListeners(room: Room): () => void {
    const onState = (stateUpdate: unknown) => {
      const state = stateUpdate as CoopWireState
      const myPlayer = state.players?.get(room.sessionId)
      if (myPlayer) {
        if (myPlayer.weapons) setWeapons(Array.from(myPlayer.weapons))
        if (myPlayer.passives) setPassives(Array.from(myPlayer.passives))
      }
    }
    room.onStateChange(onState)

    const offs = [
      room.onMessage('levelup', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      }),
      room.onMessage('slot_full', (data: { weapons: string[]; upgradeId: string }) => {
        setSlotFullPayload(data)
        setPhase('SLOT_FULL')
      }),
      room.onMessage('rare_event', (data: { options: UpgradeOption[] }) => {
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      }),
      room.onMessage('upgrade_applied', () => {
        setPhase('ACTIVE')
        setPendingChoices([])
        setSlotFullPayload(null)
      }),
    ]

    return () => {
      room.onStateChange.remove(onState)
      for (const off of offs) off()
    }
  }

  async function handleCoopConnect(target: CoopTarget) {
    // One create/join in flight at a time (double-click → double-create guard).
    if (connectingRef.current) return
    connectingRef.current = true
    setBrowserBusy(true)
    setJoinError(null)

    try {
      // Step 1: game token — same HttpOnly-cookie endpoint as solo (T-06-18:
      // held in memory, sent only in join options, never in URLs/storage).
      let token: string
      try {
        const res = await fetch('/api/auth/game-token', { credentials: 'include' })
        if (res.status === 401) {
          // Session gone — the start screen owns the "sign in again" copy.
          setError('SESSION_EXPIRED')
          setPhase('CHARACTER_SELECT')
          return
        }
        if (!res.ok) {
          setJoinError(ROOM_ERROR_COPY.SERVER_ERROR)
          return
        }
        const data = (await res.json()) as { token: string }
        token = data.token
      } catch {
        setJoinError(ROOM_ERROR_COPY.SERVER_ERROR)
        return
      }

      // Step 2: create()/joinById() only — NEVER joinOrCreate(): it would spawn
      // phantom rooms or drop the player into a squad they did not pick.
      let room: Room
      try {
        const client = new Client('/colyseus')
        const joined =
          target.kind === 'create'
            ? await client.create<unknown>('coop_room', { token, isPrivate: target.isPrivate })
            : await client.joinById<unknown>(
                target.kind === 'code' ? target.code.toUpperCase() : target.roomId,
                { token }
              )
        room = joined as Room
      } catch (e) {
        setJoinError(roomErrorCopy(e instanceof Error ? e.message : String(e)))
        return
      }

      // The user backed out (or the page unmounted) while we were connecting —
      // don't yank them into a lobby they no longer expect; drop the seat.
      if (unmountedRef.current || phaseRef.current !== 'ROOM_BROWSER') {
        void room.leave()
        return
      }

      coopTeardownRef.current?.()
      roomRef.current = room
      setWeapons([])
      setPassives([])
      coopTeardownRef.current = attachCoopListeners(room)

      // roomId IS the 6-char code for coop rooms (06-08). Private creators see
      // it in the browser's create panel and as the lobby chip; code joiners
      // get the chip too so they can re-share it.
      const isPrivateCreate = target.kind === 'create' && target.isPrivate
      setCreatedCode(isPrivateCreate ? room.roomId : null)
      setPhase('LOBBY')
    } finally {
      connectingRef.current = false
      if (!unmountedRef.current) setBrowserBusy(false)
    }
  }

  const handleSelectClass = useCallback((classId: 'vampire' | 'human' | 'dwarf') => {
    setSelectedClassId(classId)
  }, [])

  const handleUpgradeSelect = useCallback((upgradeId: string) => {
    roomRef.current?.send('upgrade_selected', { upgradeId })
    setPhase('ACTIVE')
    setPendingChoices([])
  }, [])

  const handleReplace = useCallback(
    (slot: number) => {
      if (slotFullPayload) {
        roomRef.current?.send('replace_slot', { slot, upgradeId: slotFullPayload.upgradeId })
        setPhase('ACTIVE')
        setSlotFullPayload(null)
      }
    },
    [slotFullPayload]
  )

  const handleGameOver = useCallback((data: GameOverData) => {
    // ACTIVE → GAME-OVER: capture final stats, show GameOverScreen
    setFinalStats(data)
    setPhase('GAME-OVER')
  }, [])

  const handleEndRun = useCallback(
    (data: GameOverData) => {
      // Voluntary exit (GAME-12/16 survived path): leave the room first so the
      // server's onLeave marks result='survived', then show the summary locally.
      void roomRef.current?.leave()
      handleGameOver(data)
    },
    [handleGameOver]
  )

  const handleRetry = useCallback(() => {
    // GAME-OVER → CHARACTER_SELECT: deliberate pause — player must re-select
    // a loadout and click "Start Run" again. Selection is reset so a new run
    // always starts with a fresh, nothing-selected loadout screen.
    setSelectedClassId(null)
    setPhase('CHARACTER_SELECT')
  }, [])

  // Unmount: drop co-op listeners and abandon an un-started lobby seat (a
  // started run is torn down by PhaserGame/GameScene as before).
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      coopTeardownRef.current?.()
      coopTeardownRef.current = null
      if (phaseRef.current === 'LOBBY') void roomRef.current?.leave()
    }
  }, [])

  return (
    <div className={styles.page}>
      {(phase === 'IDLE' || phase === 'CHARACTER_SELECT' || phase === 'CONNECTING') && (
        <SoloRunStartScreen
          phase={phase}
          error={error}
          user={user}
          selectedClassId={selectedClassId}
          onSelectClass={handleSelectClass}
          onSoloRun={() => void handleSoloRun()}
          onCoop={handleOpenCoop}
        />
      )}
      {phase === 'ROOM_BROWSER' && (
        <RoomBrowserScreen
          rooms={rooms}
          loading={roomsLoading}
          error={joinError ?? listError}
          createdCode={createdCode}
          busy={browserBusy}
          onCreate={(isPrivate) => void handleCoopConnect({ kind: 'create', isPrivate })}
          onJoinRoom={(roomId) => void handleCoopConnect({ kind: 'join', roomId })}
          onJoinByCode={(code) => void handleCoopConnect({ kind: 'code', code })}
          onRefresh={handleRefreshRooms}
          onBack={handleBrowserBack}
        />
      )}
      {(phase === 'ACTIVE' || phase === 'UPGRADING' || phase === 'SLOT_FULL') &&
        roomRef.current && (
          <>
            <PhaserGame room={roomRef.current} onGameOver={handleGameOver} />
            <GameHUD room={roomRef.current} onEndRun={handleEndRun} />
          </>
        )}
      {phase === 'UPGRADING' && (
        <UpgradePicker
          options={pendingChoices}
          onSelect={handleUpgradeSelect}
          weapons={weapons}
          passives={passives}
        />
      )}
      {phase === 'SLOT_FULL' && slotFullPayload && (
        <SlotFullModal
          weapons={slotFullPayload.weapons}
          upgradeId={slotFullPayload.upgradeId}
          onReplace={handleReplace}
        />
      )}
      {phase === 'GAME-OVER' && (
        <GameOverScreen
          stats={{
            elapsedMs: finalStats.elapsedMs,
            kills: finalStats.killCount,
            level: finalStats.level,
            xp: finalStats.xp,
            weapons: weapons,
            passives: passives,
            result: finalStats.result,
            weaponStats: finalStats.weaponStats,
          }}
          onRetry={handleRetry}
        />
      )}
    </div>
  )
}
