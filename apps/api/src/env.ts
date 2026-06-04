import * as z from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.url(),
  DATABASE_URL_TEST: z.url().optional(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.url().default('http://localhost:5173'),
})

// Validate at module load time — fails fast at startup, not per-request.
// JWT_SECRET and RESEND_API_KEY must never appear in logged error messages.
const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // Only log field names, not values — prevents secret exposure in logs.
  const missingFields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
  throw new Error(`Environment validation failed. Missing or invalid fields: ${missingFields}`)
}

export const env = parsed.data
