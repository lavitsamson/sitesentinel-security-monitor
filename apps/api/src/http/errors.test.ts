import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { silentLogger } from '../test-utils.js';
import { HttpError, errorHandler } from './errors.js';

function appThatThrows(err: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler(silentLogger));
  return app;
}

describe('errorHandler', () => {
  it('maps HttpError onto its status and detail', async () => {
    const res = await request(appThatThrows(new HttpError(409, 'Conflict', 'Already exists'))).get(
      '/boom',
    );

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'Already exists',
      instance: '/boom',
    });
  });

  it('maps ZodError to 400 with field-level errors', async () => {
    const result = z.object({ domain: z.string() }).safeParse({ domain: 42 });
    const res = await request(appThatThrows(result.error)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'domain', message: expect.any(String) }]);
  });

  it('hides internals of unexpected errors', async () => {
    const res = await request(appThatThrows(new Error('db password is hunter2'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      instance: '/boom',
    });
    expect(res.text).not.toContain('hunter2');
  });
});
