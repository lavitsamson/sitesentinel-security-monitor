import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

/** Paths that must never reach the logs (no secrets in logs). */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.secret',
];

export function createLogger(config: Pick<Config, 'env' | 'logLevel'>): Logger {
  return pino({
    name: 'api',
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(config.env === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
