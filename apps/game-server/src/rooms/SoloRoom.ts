/**
 * SoloRoom — single-player room over BaseGameRoom.
 *
 * Everything mode-agnostic (auth, rate limiting, input anti-replay, tick
 * skeleton, level-up flow, upgrade timeouts, onLeave cleanup) lives in
 * BaseGameRoom. SoloRoom only supplies the single-player semantics:
 * - maxClients = 1 (isolation invariant)
 * - a global simulationPaused flag toggled on every pending pick / defeat
 * - the single-player rare-event body (first player + broadcast)
 * - result = 'survived' when the only player leaves an undefeated run
 *
 * Pattern 2 from 03-RESEARCH.md: Room is a thin adapter; no game logic here.
 * All game physics live in @game/shared simulateTick (pure function).
 */
import type { Client } from '@colyseus/core'
import { selectUpgradeOptions } from '@game/shared'
import { BaseGameRoom } from './BaseGameRoom.js'

export class SoloRoom extends BaseGameRoom {
  // A solo room holds exactly one player. maxClients=1 is the security invariant:
  // it leaves no free seat for a crafted client to match into via join('solo_room')
  // by name, and forces joinOrCreate to always create a fresh room. Multiplayer
  // (2–4 players) is a separate room config in Phase 6 — never widen this one.
  maxClients = 1

  public simulationPaused = false

  onJoin(client: Client, options?: Record<string, unknown>): void {
    this.seedPlayer(client, options)
  }

  onLeave(client: Client): void {
    // Set 'survived' if the run has not already ended in defeat.
    // Check this.clients.length <= 1 BEFORE removing the leaving client —
    // Colyseus calls onLeave while the client is still in this.clients.
    // For a solo room (maxClients=1), this condition is always true on the
    // only player's leave, and future multiplayer rooms must re-evaluate.
    if (this.clients.length <= 1 && this.plainState.result !== 'defeated') {
      this.plainState.result = 'survived'
      this.state.result = 'survived'
    }

    super.onLeave(client)
  }

  // --- BaseGameRoom hook seams (solo semantics: one global pause) ---

  protected onUpgradePending(sessionId: string): void {
    void sessionId
    this.simulationPaused = true
  }

  protected onUpgradeResolved(sessionId: string): void {
    void sessionId
    this.simulationPaused = false
  }

  protected isTickBlocked(): boolean {
    return this.simulationPaused
  }

  protected onDefeat(): void {
    this.simulationPaused = true
  }

  protected triggerRareEvent(): boolean {
    const sessionId = Array.from(this.plainState.players.keys())[0]
    if (sessionId) {
      const options = selectUpgradeOptions(this.plainState, sessionId, this.prng)
      if (options.length === 0) {
        return false
      }
      this.simulationPaused = true
      this.pendingUpgradeOptions.set(sessionId, options)
      this.broadcast('rare_event', { options })

      const timeout = setTimeout(() => {
        this.autoSelectUpgrade(sessionId)
      }, 15_000)
      this.upgradeTimeouts.set(sessionId, timeout)
      return true
    }
    return false
  }
}
