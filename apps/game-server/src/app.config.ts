/**
 * Colyseus server configuration — exported for both server.ts and @colyseus/testing boot().
 *
 * WHY separate from server.ts: @colyseus/testing's boot() must receive a ConfigOptions
 * object without triggering listen(). Tests import this module and pass it to boot().
 * server.ts imports this and calls listen() to bind the port.
 * This module must stay free of listen()/side effects beyond middleware registration.
 *
 * Pattern 3 from 03-RESEARCH.md.
 */
import config from '@colyseus/tools'
import { defineRoom, matchMaker } from '@colyseus/core'
import helmet from 'helmet'
import { SoloRoom } from './rooms/SoloRoom.js'
import { CoopRoom } from './rooms/CoopRoom.js'
import { env } from './lib/env.js'

// Matchmake-route CORS pinning (Phase 6 Wave 0, T-06-04 mitigate).
// Express middleware does NOT govern /matchmake/* — Colyseus writes those
// responses through its matchmaking controller, whose DEFAULT_CORS_HEADERS /
// getCorsHeaders default is `headers.get('origin') || '*'` (echo any origin —
// 06-RESEARCH.md Pitfall 6, controller.mjs). When CORS_ORIGIN is set
// (production), pin the allowed origin; when unset (dev — same-origin traffic
// through the Vite proxy), keep the Colyseus default.
const corsOrigin = env.CORS_ORIGIN
if (corsOrigin) {
  matchMaker.controller.getCorsHeaders = function () {
    return {
      'Access-Control-Allow-Origin': corsOrigin,
      Vary: 'Origin',
    }
  }
}

// Minimal structural response type for the express routes below: @types/express
// is not a dependency (initializeExpress's app is typed via an unresolved
// express import), and this plan adds no packages (T-06-SC).
interface JsonResponse {
  json(body: unknown): void
  status(code: number): JsonResponse
}

export const appConfig = config({
  // rooms requires Record<string, RegisteredHandler>.
  // defineRoom() wraps the class in a RegisteredHandler — required by ConfigOptions.rooms.
  // Passing the raw SoloRoom class directly is a TypeScript compile error.
  rooms: {
    solo_room: defineRoom(SoloRoom),
    // 2–4 player co-op (Phase 6). Joins land in the lobby phase only; the room
    // lock()s on start_run (06-08, Pitfall 3). SoloRoom stays maxClients=1.
    coop_room: defineRoom(CoopRoom),
  },

  // HTTP-layer hardening for the express routes (helmet defaults are safe for
  // a JSON-only server). Middleware registration only — no listen(), so
  // @colyseus/testing boot() stays compatible.
  initializeExpress: (app) => {
    app.use(helmet())

    // Public co-op room browser (ROOM-01). @colyseus/sdk 0.17 has no
    // client.getAvailableRooms(), so the listing is served from the matchmaker
    // cache (06-RESEARCH.md Pattern 2). private:false + locked:false means
    // only joinable public lobbies appear — private rooms never leak (T-06-13)
    // and started runs are locked. Only listing fields are exposed.
    app.get('/rooms', async (_req: unknown, res: JsonResponse) => {
      try {
        const rooms = await matchMaker.query({ name: 'coop_room', private: false, locked: false })
        res.json(
          rooms.map((r) => ({
            roomId: r.roomId,
            clients: r.clients,
            maxClients: r.maxClients,
            hostName: (r.metadata as { hostName?: string } | undefined)?.hostName ?? 'Unknown',
          }))
        )
      } catch {
        res.status(500).json({ error: 'room listing unavailable' })
      }
    })
  },
})
