/**
 * Game server entry point.
 *
 * Imports appConfig (room definitions) and calls listen() to bind the port.
 * This is the ONLY file that binds a port — tests use boot(appConfig) from
 * @colyseus/testing instead.
 */
import { listen } from '@colyseus/tools'
import { appConfig } from './app.config.js'
import { env } from './lib/env.js'

listen(appConfig, Number(env.PORT)).then(() => {
  console.log(`[GameServer] Listening on :${env.PORT}`)
})
