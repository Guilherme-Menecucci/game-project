import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }), // NULL until verification click (D-09)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
