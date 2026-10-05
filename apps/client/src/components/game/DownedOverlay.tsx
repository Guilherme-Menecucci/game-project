import { formatBleedOut } from './HudTeammates.js'
import styles from './DownedOverlay.module.css'

interface DownedOverlayProps {
  localDowned: boolean
  localBleedOutMs: number
  localEliminated: boolean
}

/**
 * Co-op local-player overlays (UI-SPEC §7–8, ROOM-07/09) — props in, no room
 * access; GameHUD feeds them from its existing 20Hz state subscription.
 *
 * Full-screen, non-interactive layers (pointer-events: none). GameHUD renders
 * this FIRST inside the HUD root so every HUD cluster paints above it.
 *   - Local downed: amber screen-edge vignette + center-top
 *     "DOWNED — crawl to your team!" banner with a Display-size bleed-out
 *     countdown. Amber, no red wash (the countdown digits alone use
 *     --color-bleedout-text).
 *   - Local eliminated: light spectate scrim (world stays visible). The
 *     "Eliminated — spectating" chip is rendered via <SpectateChip> in the
 *     top-center column so it never collides with the timer.
 * Full-squad defeat is untouched: GameScene emits the Phase 5 GameOverScreen.
 */
export function DownedOverlay({
  localDowned,
  localBleedOutMs,
  localEliminated,
}: DownedOverlayProps) {
  if (localEliminated) {
    return <div className={styles.spectateScrim} />
  }

  if (!localDowned) {
    return null
  }

  return (
    <>
      <div className={styles.vignette} />
      <div className={styles.downedBanner}>
        <div className={styles.downedHeading}>DOWNED — crawl to your team!</div>
        <div className={styles.bleedOut}>{formatBleedOut(localBleedOutMs)}</div>
      </div>
    </>
  )
}

/** Top-center chip shown to an eliminated local player (replaces HP/XP clusters). */
export function SpectateChip() {
  return <div className={styles.spectateChip}>Eliminated — spectating</div>
}

interface RevivingLabelProps {
  name: string
}

/** "Reviving {name}…" — shown to the rescuer above the local HP cluster. */
export function RevivingLabel({ name }: RevivingLabelProps) {
  return <div className={styles.revivingLabel}>Reviving {name}…</div>
}
