import { useState, useEffect, useRef } from 'react'
import type { Room } from '@colyseus/sdk'
import styles from './VotePauseBanner.module.css'

/** `vote_pause_state` broadcast payload — CoopRoom contract (plan 06-09). */
export interface VotePauseState {
  kind: 'pause' | 'resume'
  votes: number
  needed: number
  status: 'open' | 'passed' | 'expired' | 'cancelled'
  paused: boolean
}

/** What GameHUD needs to know to show/hide the "Vote Pause" trigger. */
export interface VoteActivity {
  /** A vote (pause or resume) is currently open. */
  voteOpen: boolean
  /** The world is vote-paused (server-authoritative, from the last broadcast). */
  paused: boolean
}

interface VotePauseBannerProps {
  room: Room
  /** Eliminated spectators cannot vote (server drops their votes) — hide buttons. */
  canVote: boolean
  onActivityChange?: (activity: VoteActivity) => void
}

/**
 * Co-op vote-pause banner + PAUSED scrim (UI-SPEC §6, ROOM-11).
 *
 * The ONLY consumer of 'vote_pause_state'. Rendering is driven exclusively by
 * server broadcasts (ROOM-12 / T-06-22): buttons only send the `{}` intents
 * ('vote_pause' / 'vote_resume' — a bare send is dropped server-side) and never
 * assume the vote passed.
 *   - status 'open'  → active-vote prompt (top-center banner, or inside the scrim
 *                      when it is a resume vote)
 *   - paused === true → full-screen PAUSED scrim with "Vote to Resume"
 *   - 'passed' / 'expired' / 'cancelled' clear the open-vote prompt
 * The 15s countdown bar is a cosmetic CSS animation restarted only on a
 * transition INTO 'open' (every new vote re-broadcasts the tally); the server
 * owns the real window. CSS animation, not timers — no hidden-tab drift.
 */
export function VotePauseBanner({ room, canVote, onActivityChange }: VotePauseBannerProps) {
  const [vote, setVote] = useState<VotePauseState | null>(null)
  const [paused, setPaused] = useState(false)
  const [voteSeq, setVoteSeq] = useState(0)
  const voteOpenRef = useRef(false)
  const onActivityChangeRef = useRef(onActivityChange)

  useEffect(() => {
    onActivityChangeRef.current = onActivityChange
  }, [onActivityChange])

  useEffect(() => {
    const unsubscribe = room.onMessage('vote_pause_state', (msg: VotePauseState) => {
      if (!msg || typeof msg !== 'object') return
      const isOpen = msg.status === 'open'
      if (isOpen && !voteOpenRef.current) {
        setVoteSeq((s) => s + 1)
      }
      voteOpenRef.current = isOpen
      setVote(isOpen ? msg : null)
      setPaused(msg.paused === true)
      onActivityChangeRef.current?.({ voteOpen: isOpen, paused: msg.paused === true })
    })
    return () => {
      unsubscribe()
    }
  }, [room])

  const sendPause = () => room.send('vote_pause', {})
  const sendResume = () => room.send('vote_resume', {})

  const countdownBar = (
    <div className={styles.countdownTrack}>
      <div key={voteSeq} className={styles.countdownFill} />
    </div>
  )

  if (paused) {
    const resumeVote = vote && vote.kind === 'resume' ? vote : null
    return (
      <div className={styles.scrim}>
        <div className={styles.pausedHeadline}>PAUSED</div>
        <div className={styles.pausedBody}>Any player can call a vote to resume.</div>
        {canVote && (
          <button type="button" className={styles.voteBtn} onClick={sendResume}>
            Vote to Resume
          </button>
        )}
        {resumeVote && (
          <div className={styles.resumeTally}>
            <span className={styles.label}>
              {resumeVote.votes}/{resumeVote.needed}
            </span>
            {countdownBar}
          </div>
        )}
      </div>
    )
  }

  if (vote && vote.kind === 'pause') {
    return (
      <div className={styles.banner}>
        <div className={styles.bannerRow}>
          <span className={styles.label}>
            PAUSE VOTE — {vote.votes}/{vote.needed}
          </span>
          {canVote && (
            <button type="button" className={styles.voteBtn} onClick={sendPause}>
              Vote Yes
            </button>
          )}
        </div>
        {countdownBar}
      </div>
    )
  }

  return null
}
