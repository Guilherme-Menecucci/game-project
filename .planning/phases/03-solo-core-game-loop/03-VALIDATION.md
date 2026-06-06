---
phase: 3
slug: solo-core-game-loop
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-06
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.8 |
| **Config file** | `packages/shared/vitest.config.ts` (existing), `apps/game-server/vitest.config.ts` (new — Wave 0 gap) |
| **Quick run command** | `pnpm --filter @game/shared test` |
| **Full suite command** | `pnpm test` (workspace root) |
| **Estimated runtime** | ~30 seconds (unit only), ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @game/shared test`
- **After every plan wave:** Run `pnpm test` (workspace root, all packages)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | TEST-01 / SC-2 | T-3-01 | simulateTick is a pure function; byte-identical output on seeded calls | unit | `pnpm --filter @game/shared vitest run simulateTick` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | GAME-02 | — | Player moves in 8 directions in simulateTick | unit | `pnpm --filter @game/shared vitest run movement` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | GAME-18 | — | Spatial grid resolves collisions in O(n) — 300+ enemies bench | unit | `pnpm --filter @game/shared vitest run spatialGrid` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | SEC-01 / SC-4 | T-3-02 | Room rejects fabricated state mutation from client | integration | `pnpm --filter @game/game-server vitest run anticheats` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 0 | TEST-05 | — | @colyseus/testing room lifecycle (join, tick, leave) | integration | `pnpm --filter @game/game-server vitest run room` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 0 | D-05 | T-3-03 | GET /auth/game-token returns valid short-lived JWT | integration | `pnpm --filter @game/api vitest run game-token` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 0 | GAME-05 | T-3-06 | Ranged archetype keep-distance movement, enemy fire interval, isEnemy:true projectile | unit | `pnpm --filter @game/shared vitest run ranged` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | GAME-02 / GAME-18 | — | simulateTick pure function: player movement + spatial grid wired | unit | `pnpm --filter @game/shared vitest run` | ❌ | ⬜ pending |
| 03-03-01 | 03 | 1 | D-05 / SEC-01 | T-3-03 | GET /auth/game-token route returns 200 with valid game JWT | integration | `pnpm --filter @game/api vitest run game-token` | ❌ | ⬜ pending |
| 03-04-01 | 04 | 2 | GAME-01 / GAME-04 | T-3-02 | SoloRoom onCreate + onJoin + tick advances + spawn fires | integration | `pnpm --filter @game/game-server vitest run room` | ❌ | ⬜ pending |
| 03-04-02 | 04 | 2 | SEC-01 / SC-4 | T-3-02 | SoloRoom rejects fabricated state mutation (anticheats) | integration | `pnpm --filter @game/game-server vitest run anticheats` | ❌ | ⬜ pending |
| 03-06-01 | 06 | 2 | GAME-03 / GAME-05 | T-3-01 T-3-06 | auto-fire player proj, ranged keep-distance, enemy fire, enemy proj damages player | unit | `pnpm --filter @game/shared vitest run weapons` | ❌ | ⬜ pending |
| 03-06-02 | 06 | 2 | GAME-06 / GAME-07 | T-3-02 | gem drop on kill, XP auto-collect, level-up at threshold | unit | `pnpm --filter @game/shared vitest run weapons` | ❌ | ⬜ pending |
| 03-07-01 | 07 | 3 | UI-02 / GAME-05 | — | Phaser canvas renders at /game; proj_enemy frame present in atlas | e2e (manual) | Manual: open /game in browser, verify canvas + orange-red enemy projectiles | manual-only | ⬜ pending |
| 03-08-01 | 08 | 4 | GAME-01 | — | GameOverScreen appears when player hp reaches 0 | e2e (manual) | Manual: let player die, verify GameOverScreen | manual-only | ⬜ pending |
| 03-09-01 | 09 | 5 | SC-5 | all | pnpm test exits 0 — all packages GREEN | integration | `pnpm test` | ❌ | ⬜ pending |
| 03-09-02 | 09 | 5 | SC-4 | T-3-02 | anticheats tests GREEN after full integration | integration | `pnpm --filter @game/game-server vitest run anticheats` | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/shared/src/__tests__/simulateTick.determinism.test.ts` — covers SC-2 + TEST-01 (seeded PRNG, byte-identical output)
- [ ] `packages/shared/src/__tests__/simulateTick.movement.test.ts` — covers GAME-02 (8-direction movement in pure tick)
- [ ] `packages/shared/src/__tests__/spatialGrid.test.ts` — covers GAME-18 (grid correctness + toroidal wrap edge case)
- [ ] `packages/shared/src/__tests__/prng.test.ts` — covers mulberry32 seeding determinism
- [ ] `packages/shared/src/__tests__/spawn.test.ts` — covers GAME-04 + GAME-05 (spawn curve, archetype mix including ranged)
- [ ] `packages/shared/src/__tests__/ranged.behavior.test.ts` — covers GAME-05 (ranged archetype: keep-distance movement, fire interval, isEnemy:true projectile)
- [ ] `apps/game-server/vitest.config.ts` — new config (game-server has none yet); use `resolve.conditions: ['source']` + `ssr.resolve.conditions: ['source']` pattern from `apps/api/vitest.config.ts`
- [ ] `apps/game-server/src/__tests__/soloRoom.anticheats.test.ts` — covers SC-4 + TEST-05
- [ ] `apps/api/src/__tests__/auth/game-token.test.ts` — covers D-05 (GET /auth/game-token happy path + auth failure)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Phaser canvas renders at /game | UI-02 | Canvas rendering requires a real browser with WebGL; Playwright canvas interaction via JS eval possible but fragile for visual verification | 1. Start all three dev processes (Vite :5173, Fastify :3000, Colyseus :2567). 2. Open browser at http://localhost:5173/game. 3. Click "Solo Run". 4. Verify Phaser canvas mounts (dark arena ground, green player rect). 5. Move with WASD — verify player moves and enemies spawn. 6. Check fps counter in browser dev tools stays ≥ 60. |
| 300+ enemies at 60 fps | GAME-18 | Performance gate requires visual/fps verification; automated perf tests are flaky on CI | After Phaser canvas test above: let run continue until 300+ enemies visible. Check fps remains ≥ 60 via browser dev tools. |
| Ranged enemy projectiles visible | GAME-05 | Visual verification of orange-red (#fb923c) proj_enemy sprites in Phaser canvas | Wait 60+ seconds into a run — verify yellow ranged circles appear, keep their distance from player, and fire orange-red projectiles toward the player. |
| GameOverScreen appears on death | GAME-01 | UI transition requires browser interaction | Let player hp reach 0 (contact or enemy projectile). Verify GameOverScreen component replaces the game canvas. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are manual-only (checkpoint tasks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (9 files including ranged.behavior.test.ts)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
