/**
 * Colyseus server configuration — exported for both server.ts and @colyseus/testing boot().
 *
 * WHY separate from server.ts: @colyseus/testing's boot() must receive a ConfigOptions
 * object without triggering listen(). Tests import this module and pass it to boot().
 * server.ts imports this and calls listen() to bind the port.
 *
 * Pattern 3 from 03-RESEARCH.md.
 */
import config from '@colyseus/tools'
import { defineRoom } from '@colyseus/core'
import { SoloRoom } from './rooms/SoloRoom.js'

export const appConfig = config({
  // rooms requires Record<string, RegisteredHandler>.
  // defineRoom() wraps the class in a RegisteredHandler — required by ConfigOptions.rooms.
  // Passing the raw SoloRoom class directly is a TypeScript compile error.
  rooms: {
    solo_room: defineRoom(SoloRoom),
  },
})
