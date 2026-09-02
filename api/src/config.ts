import dotenv from 'dotenv';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

// Tests are hermetic: they never read a developer's local api/.env. A suite that does
// passes or fails for reasons that have nothing to do with the code — the same failure
// mode as pointing the rules suite at the API's port. Tests set what they need explicitly.
if (!isTest) {
  dotenv.config();
}

// The Firebase Web config is a public identifier, not a credential (AGENTS.md §Secret
// management 4): its protection is Firestore Rules + App Check, not concealment. It still
// goes through this schema so that (a) a missing value fails at startup in production
// instead of silently degrading, and (b) no code path can ever substitute another key for
// it. Nothing here may fall back to MAPS_BROWSER_API_KEY — that key is a restricted
// billable credential and is served only from the authenticated GET /api/config route.
const publicIdentifier = (name: string) =>
  isProd
    ? z.string().min(1, `${name} is required in production (public identifier, not a secret)`)
    : z.string().optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080').transform((v) => parseInt(v, 10)),
  GCP_PROJECT_ID: isTest
    ? z.string().default('test-project')
    : z.string().min(1, 'GCP_PROJECT_ID is required'),
  GEMINI_API_KEY: isTest
    ? z.string().default('test-gemini-key')
    : z.string().min(1, 'GEMINI_API_KEY is required'),
  MAPS_SERVER_API_KEY: z.string().optional(),
  MAPS_BROWSER_API_KEY: z.string().optional(),
  FIREBASE_WEB_API_KEY: publicIdentifier('FIREBASE_WEB_API_KEY'),
  FIREBASE_WEB_APP_ID: publicIdentifier('FIREBASE_WEB_APP_ID'),
  // Optional override; defaults to `${GCP_PROJECT_ID}.firebaseapp.com`.
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
});


const parseEnv = () => {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('CRITICAL: Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);

  }
  return result.data;
};

export const env = parseEnv();
