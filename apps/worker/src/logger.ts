import { pino, type Logger } from 'pino';
import type { Config } from './config.js';

export type { Logger };

export function createLogger(config: Pick<Config, 'env' | 'logLevel'>): Logger {
  return pino({
    name: 'worker',
    level: config.logLevel,
    redact: { paths: ['*.password', '*.token', '*.secret'], censor: '[redacted]' },
    ...(config.env === 'development' && {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    }),
  });
}
