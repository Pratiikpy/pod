import { z } from 'zod';

const ConfigSchema = z.object({
  SOSOVALUE_API_KEY: z.string().min(1),
  SODEX_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  SODEX_REBALANCER_PRIVATE_KEY: z.string().min(1).optional(),
  POD_VAULT_ADDRESSES: z.string().optional(), // comma-separated
  REASONING_LOGGER_ADDRESS: z.string().optional(),
  DRAWDOWN_GUARD_ADDRESS: z.string().optional(),
  CRON_SECRET: z.string().min(8).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      'Invalid worker config:\n' +
        parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return parsed.data;
}
