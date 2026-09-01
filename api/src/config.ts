import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080').transform((v) => parseInt(v, 10)),
  GCP_PROJECT_ID: z.string().min(1, 'GCP_PROJECT_ID is required'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  MAPS_SERVER_API_KEY: z.string().optional(),
  MAPS_BROWSER_API_KEY: z.string().optional(),
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