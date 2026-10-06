import { useRef, useState, useCallback, useEffect } from 'react'
import type { Room } from '@colyseus/sdk'
import { Client } from '@colyseus/sdk'
import { useAuth } from '../components/auth/AuthProvider.js'
import { SoloRunStartScreen, CLASS_WEAPON } from '../components/game/SoloRunStartScreen.js'
import { RoomBrowserScreen, ROOM_ERROR_COPY } from '../components/game/RoomBrowserScreen.js'
import type { RoomListing } from '../components/game/RoomBrowserScreen.js'
import { LobbyScreen } from '../components/game/LobbyScreen.js'
import type { LobbyPlayer } from '../components/game/LobbyScreen.js'
import { PhaserGame } from '../components/game/PhaserGame.js'
import type { GameOverData } from '../components/game/PhaserGame.js'
import { GameHUD } from '../components/game/GameHUD.js'
import { GameOverScreen } from '../components/game/GameOverScreen.js'
import { UpgradePicker } from '../components/ui/UpgradePicker.js'
import { SlotFullModal } from '../components/ui/SlotFullModal.js'
import type { CharacterSelect, UpgradeOption } from '@game/shared'
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
/** How long the "You are now the host" toast stays up. */
const HOST_TOAST_MS = 3000
/**
 * Co-op full-squad defeat (roomPhase 'ended'): GameScene normally emits the
 * gameover itself (plan 06-12 gates it on state.result === 'defeated'). If it
 * has not within this window, GamePage builds the defeat summary from room
 * state itself. The room is NEVER left here (06-15): it survives the defeat
 * and reopens as a lobby ~2s later (CoopRoom.RETURN_TO_LOBBY_DELAY_MS), so the
 * fallback must fire well before the server wipes the run state.
 */
const ENDED_SUMMARY_GRACE_MS = 750

const IN_RUN_PHASES: ReadonlySet<GamePhase> = new Set(['ACTIVE', 'UPGRADING', 'SLOT_FULL'])

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
  /** 'lobby' | 'active' | 'ended' (solo is always 'active'). */
  roomPhase?: string
  /** state.lobby — keyed by sessionId; mirrors the live squad (06-09 deletes leavers). */
  lobby?: Map<
    string,
    {
      displayName?: string
      classId?: string
      weaponId?: string
      ready?: boolean
      isHost?: boolean
    }
  >
  players?: Map<
    string,
    {
      weapons?: string[]
      passives?: string[]
      level?: number
      xp?: number
      weaponStats?: Map<string, { totalDamage?: number; acquiredAtMs?: number }>
    }
  >
  elapsedMs?: number
  /** Squad kills (enemy deaths) — the fallback summary's best-effort kill count. */
  kills?: number
}

/**
 * Defeat summary built from room state (06-15 fallback when GameScene did not
 * emit its own gameover in time). killCount is the squad's state.kills — best
 * effort; GameScene's own emit counts kills from its enemy diff.
 */
function defeatSummaryFromState(state: CoopWireState | undefined, sessionId: string): GameOverData {
  const me = state?.players?.get(sessionId)
  const weaponStats: Record<string, { totalDamage: number; acquiredAtMs: number }> = {}
  me?.weaponStats?.forEach((stats, slot) => {
    weaponStats[slot] = {
      totalDamage: stats.totalDamage ?? 0,
      acquiredAtMs: stats.acquiredAtMs ?? 0,
    }
  })
  return {
    killCount: state?.kills ?? 0,
    elapsedMs: state?.elapsedMs ?? 0,
    level: me?.level ?? 1,
    xp: me?.xp ?? 0,
    weapons: me?.weapons ? Array.from(me.weapons) : [],
    passives: me?.passives ? Array.from(me.passives) : [],
    result: 'defeated',
    weaponStats,
  }
}

/** Snapshot state.lobby into plain objects (live schema instances would not re-render). */
function toLobbyPlayers(lobby: CoopWireState['lobby']): LobbyPlayer[] {
  const players: LobbyPlayer[] = []
  lobby?.forEach((entry, sessionId) => {
    players.push({
      sessionId,
      displayName: entry.displayName ?? 'Player',
      classId: entry.classId ?? '',
      weaponId: entry.weaponId ?? '',
      ready: entry.ready === true,
      isHost: entry.isHost === true,
    })
  })
  return players
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
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([])
  const [lobbyRoomCode, setLobbyRoomCode] = useState<string | null>(null)
  const [hostToast, setHostToast] = useState(false)
  // Co-op summary over a live room (06-15): true while GAME-OVER shows a
  // full-squad defeat and this client is still connected to the room.
  const [coopSummary, setCoopSummary] = useState(false)
  // Live server roomPhase ('lobby' | 'active' | 'ended') — 'lobby' after
  // 'ended' means the server reopened the room and Back to Lobby is enabled.
  const [coopRoomPhase, setCoopRoomPhase] = useState<string | null>(null)

  // Refs read from async/room callbacks (never stale React state).
  const phaseRef = useRef<GamePhase>(phase)
  const unmountedRef = useRef(false)
  const connectingRef = useRef(false)
  const pollAbortRef = useRef<AbortController | null>(null)
  /** Removes every listener attached to the current co-op room. */
  const coopTeardownRef = useRef<(() => void) | null>(null)
  /** False once the co-op room's connection dropped after the run started. */
  const coopLiveRef = useRef(false)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // host_changed → toast; LobbyScreen has no timer of its own (06-10 note 3).
  useEffect(() => {
    if (!hostToast) return
    const timer = window.setTimeout(() => setHostToast(false), HOST_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [hostToast])

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
   * Wires every listener on a freshly joined co-op room, imperatively at join
   * time (same shape as solo — handleSoloRun is intentionally left verbatim so
   * the solo path stays byte-identical):
   *   - lobby roster from state.lobby (only while roomPhase is 'lobby')
   *   - roomPhase 'active' → ACTIVE (there is no "run started" message — 06-08)
   *   - roomPhase 'ended'  → defeat summary over the LIVE room (06-15): the
   *     room is never left; GameScene emits, else a state-built fallback
   *   - live roomPhase mirrored into React (enables Back to Lobby on 'lobby')
   *   - weapons/passives + levelup/slot_full/rare_event/upgrade_applied (as solo)
   *   - host_changed → toast; lobby-only onLeave → back to the browser;
   *     in-run onLeave → the summary can no longer return to the lobby
   * Returns an idempotent teardown that removes everything it attached. The
   * same room is re-attached on Back to Lobby so the one-shot flags re-arm.
   *
   * NOTE (@colyseus/sdk 0.17.42 signal.remove): removing a callback that is not
   * registered pops the LAST handler (indexOf -1), and removal swaps with the
   * last handler — so every remove here is guarded by an "attached" flag and
   * no handler removes a listener of the signal currently being invoked.
   */
  function attachCoopListeners(room: Room): () => void {
    let runStarted = false
    let endedTimer: number | null = null
    let endedSeen = false
    let lobbyLeaveAttached = false
    let runLeaveAttached = false
    let tornDown = false
    coopLiveRef.current = true

    // Server dispose/kick while still in the lobby. Removed when the run starts
    // (so End Run leaves never bounce to the browser) and by teardown before an
    // intentional Leave Lobby.
    const onLobbyLeave = () => {
      if (roomRef.current !== room) return
      coopTeardownRef.current?.()
      coopTeardownRef.current = null
      roomRef.current = null
      setLobbyPlayers([])
      setLobbyRoomCode(null)
      setHostToast(false)
      setCreatedCode(null)
      setJoinError(ROOM_ERROR_COPY.SERVER_ERROR)
      setPhase('ROOM_BROWSER')
    }
    room.onLeave(onLobbyLeave)
    lobbyLeaveAttached = true
    const detachLobbyLeave = () => {
      if (!lobbyLeaveAttached) return
      lobbyLeaveAttached = false
      room.onLeave.remove(onLobbyLeave)
    }

    // Connection lost after the run started (intentional leaves tear down
    // first, so they never land here). Mid-run, GameScene's own onLeave still
    // produces the summary; either way the room can no longer bring this player
    // back, so the summary falls back to the solo actions. No listener removal
    // here — this runs inside the onLeave invoke (see NOTE above).
    const onRunLeave = () => {
      if (roomRef.current !== room) return
      coopLiveRef.current = false
      setCoopSummary(false)
    }

    const onState = (stateUpdate: unknown) => {
      const state = stateUpdate as CoopWireState
      const myPlayer = state.players?.get(room.sessionId)
      if (myPlayer) {
        if (myPlayer.weapons) setWeapons(Array.from(myPlayer.weapons))
        if (myPlayer.passives) setPassives(Array.from(myPlayer.passives))
      }
      setCoopRoomPhase(state.roomPhase ?? null)

      if (state.roomPhase === 'lobby') {
        setLobbyPlayers(toLobbyPlayers(state.lobby))
      } else if (state.roomPhase === 'active' && !runStarted) {
        // Start transition: PhaserGame/GameHUD mount exactly as in solo.
        runStarted = true
        detachLobbyLeave()
        if (!runLeaveAttached) {
          room.onLeave(onRunLeave)
          runLeaveAttached = true
        }
        setPhase('ACTIVE')
      } else if (state.roomPhase === 'ended' && !endedSeen) {
        endedSeen = true
        detachLobbyLeave()
        endedTimer = window.setTimeout(() => {
          endedTimer = null
          // Still in-run on this room → GameScene did not emit its gameover;
          // show the defeat summary from room state. The room stays joined.
          if (roomRef.current === room && IN_RUN_PHASES.has(phaseRef.current)) {
            handleGameOver(defeatSummaryFromState(room.state as CoopWireState, room.sessionId))
          }
        }, ENDED_SUMMARY_GRACE_MS)
      }
    }
    room.onStateChange(onState)

    const offs = [
      room.onMessage('host_changed', (data: { hostSessionId?: string }) => {
        if (data?.hostSessionId === room.sessionId) setHostToast(true)
      }),
      // Pick messages never pull a finished run (summary over the live room,
      // 06-15) back into ACTIVE.
      room.onMessage('levelup', (data: { options: UpgradeOption[] }) => {
        if (endedSeen) return
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      }),
      room.onMessage('slot_full', (data: { weapons: string[]; upgradeId: string }) => {
        if (endedSeen) return
        setSlotFullPayload(data)
        setPhase('SLOT_FULL')
      }),
      room.onMessage('rare_event', (data: { options: UpgradeOption[] }) => {
        if (endedSeen) return
        setPendingChoices(data.options)
        setPhase('UPGRADING')
      }),
      room.onMessage('upgrade_applied', () => {
        if (endedSeen) return
        setPhase('ACTIVE')
        setPendingChoices([])
        setSlotFullPayload(null)
      }),
    ]

    return () => {
      if (tornDown) return
      tornDown = true
      room.onStateChange.remove(onState)
      detachLobbyLeave()
      if (runLeaveAttached) {
        runLeaveAttached = false
        room.onLeave.remove(onRunLeave)
      }
      for (const off of offs) off()
      if (endedTimer !== null) window.clearTimeout(endedTimer)
      endedTimer = null
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
      setHostToast(false)
      setCoopSummary(false)
      setCoopRoomPhase((room.state as CoopWireState | undefined)?.roomPhase ?? null)
      setLobbyPlayers(toLobbyPlayers((room.state as CoopWireState | undefined)?.lobby))
      coopTeardownRef.current = attachCoopListeners(room)

      // The server seeds lobby entries as human/magic_wand, which is not a real
      // loadout (CLASS_WEAPON.human is knife). Claim a real one immediately —
      // the player's solo-screen pick, else human — so the slot never shows the
      // server default (06-10 note 1). CharacterSelectSchema payload shape.
      const classId: CharacterSelect['classId'] = selectedClassId ?? 'human'
      room.send('select_class', { classId, weaponId: CLASS_WEAPON[classId] })

      // roomId IS the 6-char code for coop rooms (06-08). Private creators see
      // it in the browser's create panel and as the lobby chip; code joiners
      // get the chip too so they can re-share it.
      const isPrivateCreate = target.kind === 'create' && target.isPrivate
      setCreatedCode(isPrivateCreate ? room.roomId : null)
      setLobbyRoomCode(isPrivateCreate || target.kind === 'code' ? room.roomId : null)
      setPhase('LOBBY')
    } finally {
      connectingRef.current = false
      if (!unmountedRef.current) setBrowserBusy(false)
    }
  }

  // ─── Co-op: lobby intents (server re-validates all of them — T-06-19) ──────

  const handleToggleReady = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    // Read the local ready flag at click time from room state, not a render
    // snapshot, so a fast double-click never sends the same value twice.
    const state = room.state as CoopWireState | undefined
    const current = state?.lobby?.get(room.sessionId)?.ready === true
    room.send('ready', { ready: !current })
  }, [])

  const handleLobbySelectClass = useCallback(
    (classId: CharacterSelect['classId'], weaponId: CharacterSelect['weaponId']) => {
      roomRef.current?.send('select_class', { classId, weaponId })
      // Remembered so a later lobby claims the same loadout on join.
      setSelectedClassId(classId)
    },
    []
  )

  const handleStartRun = useCallback(() => {
    // `{}` is required: StartRunSchema (z.object({})) drops a bare send.
    roomRef.current?.send('start_run', {})
  }, [])

  const handleLeaveLobby = useCallback(() => {
    const room = roomRef.current
    // Tear down first: removes the lobby onLeave so this intentional leave is
    // not reported as a disconnect.
    coopTeardownRef.current?.()
    coopTeardownRef.current = null
    roomRef.current = null
    setLobbyPlayers([])
    setLobbyRoomCode(null)
    setHostToast(false)
    setCreatedCode(null)
    setJoinError(null)
    setPhase('ROOM_BROWSER')
    void room?.leave()
  }, [])

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
    // ACTIVE → GAME-OVER: capture final stats, show GameOverScreen.
    // Co-op full-squad defeat with the room still connected (06-15): the
    // summary offers Back to Lobby / Leave Squad instead of Try Again.
    setCoopSummary(
      coopTeardownRef.current !== null && coopLiveRef.current && data.result === 'defeated'
    )
    setFinalStats(data)
    setPhase('GAME-OVER')
  }, [])

  const handleEndRun = useCallback(
    (data: GameOverData) => {
      // Voluntary exit (GAME-12/16 survived path): leave the room first so the
      // server's onLeave marks result='survived', then show the summary locally.
      // Co-op: the player left the squad — drop the room's listeners first so
      // the summary is the plain (Try Again / Exit to Home) variant.
      coopTeardownRef.current?.()
      coopTeardownRef.current = null
      void roomRef.current?.leave()
      handleGameOver(data)
    },
    [handleGameOver]
  )

  const handleRetry = useCallback(() => {
    // GAME-OVER → CHARACTER_SELECT: deliberate pause — player must re-select
    // a loadout and click "Start Run" again. Selection is reset so a new run
    // always starts with a fresh, nothing-selected loadout screen.
    // Co-op: drop the finished room's listeners (no-op after a solo run).
    coopTeardownRef.current?.()
    coopTeardownRef.current = null
    setCoopSummary(false)
    setSelectedClassId(null)
    setPhase('CHARACTER_SELECT')
  }, [])

  /**
   * Co-op summary → "Back to Lobby" (06-15). Only this player returns; enabled
   * once the server reopened the room (roomPhase 'lobby'). The SAME room is
   * re-attached so the run-start/ended one-shot flags re-arm for the next run
   * and the lobby-only onLeave is active again. Ready is NOT sent: the player
   * readies by hand (developer decision — absent players stay not-ready).
   */
  function handleReturnToLobby() {
    const room = roomRef.current
    if (!room) return
    const state = room.state as CoopWireState | undefined
    if (state?.roomPhase !== 'lobby') return
    coopTeardownRef.current?.()
    coopTeardownRef.current = null
    setCoopSummary(false)
    setWeapons([])
    setPassives([])
    setPendingChoices([])
    setSlotFullPayload(null)
    setFinalStats({ killCount: 0, elapsedMs: 0, level: 1, xp: 0 })
    setCoopRoomPhase('lobby')
    setLobbyPlayers(toLobbyPlayers(state.lobby))
    coopTeardownRef.current = attachCoopListeners(room)
    setPhase('LOBBY')
  }

  /** Co-op summary → "Leave Squad" (06-15): leave the room, back to the start screen. */
  const handleLeaveSquad = useCallback(() => {
    const room = roomRef.current
    // Tear down first so the intentional leave is not treated as a drop.
    coopTeardownRef.current?.()
    coopTeardownRef.current = null
    coopLiveRef.current = false
    roomRef.current = null
    setCoopSummary(false)
    setCoopRoomPhase(null)
    setLobbyPlayers([])
    setLobbyRoomCode(null)
    setHostToast(false)
    setCreatedCode(null)
    setJoinError(null)
    setPhase('CHARACTER_SELECT')
    void room?.leave()
  }, [])

  // Unmount: drop co-op listeners and abandon a co-op seat that is not inside
  // a run — an un-started lobby, or the summary over a live room (06-15). A
  // started run is torn down by PhaserGame/GameScene as before.
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      const hadCoopRoom = coopTeardownRef.current !== null
      coopTeardownRef.current?.()
      coopTeardownRef.current = null
      if (phaseRef.current === 'LOBBY' || (hadCoopRoom && phaseRef.current === 'GAME-OVER')) {
        void roomRef.current?.leave()
      }
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
      {phase === 'LOBBY' && roomRef.current && (
        <LobbyScreen
          players={lobbyPlayers}
          localSessionId={roomRef.current.sessionId}
          roomCode={lobbyRoomCode}
          hostToast={hostToast}
          onSelectClass={handleLobbySelectClass}
          onToggleReady={handleToggleReady}
          onStart={handleStartRun}
          onLeave={handleLeaveLobby}
        />
      )}
      {(phase === 'ACTIVE' || phase === 'UPGRADING' || phase === 'SLOT_FULL') &&
        roomRef.current && (
          <>
            {/* inputLocked: the client half of the co-op pick lock (ROOM-06 locked
                decision) — PhaserGame + GameHUD stay mounted under the picker,
                so the world stays visible behind the overlay. */}
            <PhaserGame
              room={roomRef.current}
              onGameOver={handleGameOver}
              inputLocked={phase === 'UPGRADING' || phase === 'SLOT_FULL'}
            />
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
          coop={
            coopSummary
              ? {
                  canReturn: coopRoomPhase === 'lobby',
                  onReturnToLobby: handleReturnToLobby,
                  onLeave: handleLeaveSquad,
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
