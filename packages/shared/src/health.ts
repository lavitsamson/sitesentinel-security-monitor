import { z } from 'zod';

export const healthLiveSchema = z.object({
  status: z.literal('ok'),
});
export type HealthLive = z.infer<typeof healthLiveSchema>;

export const dependencyHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthReadySchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), dependencyHealthSchema),
});
export type HealthReady = z.infer<typeof healthReadySchema>;
