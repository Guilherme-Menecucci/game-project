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

export const appConfig = config({
  // rooms requires Record<string, RegisteredHandler>.
  // defineRoom() wraps the class in a RegisteredHandler — required by ConfigOptions.rooms.
  // Passing the raw SoloRoom class directly is a TypeScript compile error.
  rooms: {
    solo_room: defineRoom(SoloRoom),
  },

  // HTTP-layer hardening for the express routes (helmet defaults are safe for
  // a JSON-only server). Middleware registration only — no listen(), so
  // @colyseus/testing boot() stays compatible.
  initializeExpress: (app) => {
    app.use(helmet())
  },
})
