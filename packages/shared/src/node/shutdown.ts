/** Minimal logger surface so this module does not depend on pino. */
export interface ShutdownLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ShutdownTask {
  name: string;
  close: () => Promise<void>;
}

/** The parts of `process` we touch, injectable for tests. */
export interface ShutdownProcess {
  once(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code: number): void;
}

export interface GracefulShutdownOptions {
  logger: ShutdownLogger;
  /** Hard deadline after which the process exits with code 1. */
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  proc?: ShutdownProcess;
}

/**
 * Runs `tasks` in order when a termination signal arrives (or when the returned
 * function is called), then exits. Tasks should be ordered "stop accepting work"
 * first and "close connections" last. Calling it more than once is a no-op.
 */
export function registerGracefulShutdown(
  tasks: ShutdownTask[],
  {
    logger,
    timeoutMs = 10_000,
    signals = ['SIGTERM', 'SIGINT'],
    proc = process,
  }: GracefulShutdownOptions,
): (reason: string) => Promise<void> {
  let shuttingDown: Promise<void> | undefined;

  const shutdown = (reason: string): Promise<void> => {
    shuttingDown ??= (async () => {
      logger.info({ reason }, 'shutting down');
      const deadline = setTimeout(() => {
        logger.error({ timeoutMs }, 'shutdown timed out, forcing exit');
        proc.exit(1);
      }, timeoutMs);
      deadline.unref();

      let exitCode = 0;
      for (const task of tasks) {
        try {
          await task.close();
          logger.info({ task: task.name }, 'closed');
        } catch (err) {
          exitCode = 1;
          logger.error({ task: task.name, err }, 'failed to close');
        }
      }
      clearTimeout(deadline);
      proc.exit(exitCode);
    })();
    return shuttingDown;
  };

  for (const signal of signals) {
    proc.once(signal, () => void shutdown(signal));
  }
  return shutdown;
}
