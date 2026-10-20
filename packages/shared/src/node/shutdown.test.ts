import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';
import { registerGracefulShutdown, type ShutdownProcess } from './shutdown.js';

function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = jest.fn<(code: number) => void>();
  const proc: ShutdownProcess = {
    once: (event, listener) => emitter.once(event, listener),
    exit,
  };
  return { proc, exit, emit: (signal: NodeJS.Signals) => emitter.emit(signal, signal) };
}

const logger = { info: jest.fn(), error: jest.fn() };

describe('registerGracefulShutdown', () => {
  it('closes tasks in order on SIGTERM, then exits 0', async () => {
    const { proc, exit, emit } = fakeProcess();
    const order: string[] = [];
    const shutdown = registerGracefulShutdown(
      [
        { name: 'http', close: async () => void order.push('http') },
        { name: 'db', close: async () => void order.push('db') },
      ],
      { logger, proc },
    );

    emit('SIGTERM');
    await shutdown('ignored: already running');

    expect(order).toEqual(['http', 'db']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps closing remaining tasks when one fails, then exits 1', async () => {
    const { proc, exit } = fakeProcess();
    const dbClose = jest.fn(async () => undefined);
    const shutdown = registerGracefulShutdown(
      [
        { name: 'http', close: async () => Promise.reject(new Error('boom')) },
        { name: 'db', close: dbClose },
      ],
      { logger, proc },
    );

    await shutdown('test');

    expect(dbClose).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit 1 when tasks exceed the deadline', async () => {
    jest.useFakeTimers();
    try {
      const { proc, exit } = fakeProcess();
      const shutdown = registerGracefulShutdown(
        [{ name: 'stuck', close: () => new Promise<void>(() => undefined) }],
        { logger, proc, timeoutMs: 1_000 },
      );

      void shutdown('test');
      await jest.advanceTimersByTimeAsync(1_000);

      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
