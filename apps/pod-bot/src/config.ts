import { z } from 'zod';

const ConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  SOSOVALUE_API_KEY: z.string().min(1),
  SODEX_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  POD_VAULT_ADDRESS: z.string().optional(),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().url().optional(),
  NVIDIA_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid POD bot config:\n${issues}`);
  }
  return parsed.data;
}
