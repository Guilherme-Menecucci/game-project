import type { FastifyReply } from 'fastify'
import { env } from '../env.js'

/**
 * Issue a guest session cookie — no maxAge (cleared on browser close per D-03).
 * Guest cookie is a session cookie: no maxAge, no expires.
 */
export function issueGuestCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('session', token, {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    // No maxAge, no expires → session cookie per D-03
  })
}

/**
 * Issue a registered-account session cookie — 30-day persistent (D-02).
 * maxAge: 2592000 = 60 * 60 * 24 * 30 seconds (30 days)
 */
export function issueRegisteredCookie(reply: FastifyReply, token: string): void {
  reply.setCookie('session', token, {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 2592000, // 30 days in seconds (D-02)
  })
}
