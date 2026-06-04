import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'
import { env } from '../env.js'

// In test mode, prefer DATABASE_URL_TEST if set (separate test database)
const connectionUrl =
  env.NODE_ENV === 'test' && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL

export const sql = postgres(connectionUrl)
export const db = drizzle(sql, { schema })
