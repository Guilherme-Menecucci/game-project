/**
 * simulateTick — pure deterministic tick function.
 * Stub: throws 'not implemented' until Task 2 of plan 03-02 implements it.
 */
import type { PlainGameState } from './state.js'
import type { PlayerInput } from './schemas.js'
import type { Prng } from './prng.js'

export const TICK_SEC = 1 / 20
export const SPEED_SUBUNITS = 10_000

export function simulateTick(
  state: PlainGameState,
  inputs: Map<string, PlayerInput>,
  prng: Prng
): PlainGameState {
  void state
  void inputs
  void prng
  throw new Error('not implemented')
}
