import type { RequestHandler } from 'express';
import request from 'supertest';
import { buildTestApp } from '../test-utils.js';
import { QUEUE_BOARD_PATH } from './queue-board.js';

const credentials = { username: 'admin', password: 'correct-board-password' };
const basic = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const AUTH = basic(credentials.username, credentials.password);

/** Stands in for Bull Board, which needs Redis; the gate in front of it is what's under test. */
const board: RequestHandler = (req, res) => {
  res.json({ board: true, method: req.method, path: req.path });
};

const appWithBoard = () => buildTestApp({ queueBoard: { handler: board, credentials } });

describe('queue dashboard', () => {
  it('is not mounted unless configured', async () => {
    await request(buildTestApp()).get(QUEUE_BOARD_PATH).set('authorization', AUTH).expect(404);
  });

  it('asks for credentials', async () => {
    const res = await request(appWithBoard()).get(QUEUE_BOARD_PATH).expect(401);

    expect(res.headers['www-authenticate']).toBe(
      'Basic realm="SiteSentinel queues", charset="UTF-8"',
    );
    expect(res.body).not.toHaveProperty('board');
  });

  it.each([
    ['wrong password', basic('admin', 'wrong-board-password')],
    ['wrong username', basic('root', credentials.password)],
    ['no colon', `Basic ${Buffer.from('admin').toString('base64')}`],
    ['bearer scheme', 'Bearer correct-board-password'],
  ])('refuses a %s', async (_case, header) => {
    await request(appWithBoard()).get(QUEUE_BOARD_PATH).set('authorization', header).expect(401);
  });

  it('serves the board, uncached, to the admin', async () => {
    const res = await request(appWithBoard())
      .get(`${QUEUE_BOARD_PATH}/api/queues`)
      .set('authorization', AUTH)
      .expect(200);

    expect(res.body).toEqual({ board: true, method: 'GET', path: '/api/queues' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('accepts a password containing a colon', async () => {
    const app = buildTestApp({
      queueBoard: {
        handler: board,
        credentials: { username: 'ops', password: 'pass:with:colons' },
      },
    });
    await request(app)
      .get(QUEUE_BOARD_PATH)
      .set('authorization', basic('ops', 'pass:with:colons'))
      .expect(200);
  });

  describe('state-changing requests', () => {
    const put = (headers: Record<string, string>) =>
      request(appWithBoard())
        .put(`${QUEUE_BOARD_PATH}/api/queues/checks/retry/failed`)
        .set('authorization', AUTH)
        .set(headers);

    it('are allowed from the board itself', async () => {
      await put({ 'sec-fetch-site': 'same-origin' }).expect(200);
    });

    it('are refused from another site, even with the browser-cached credentials', async () => {
      await put({ 'sec-fetch-site': 'cross-site' }).expect(403);
      await put({ 'sec-fetch-site': 'same-site' }).expect(403);
    });

    it('fall back to the Origin header when Fetch Metadata is missing', async () => {
      await put({ origin: 'https://evil.example' }).expect(403);
      await put({ origin: 'not a url' }).expect(403);
    });

    it('are allowed from non-browser clients, which send neither header', async () => {
      await put({}).expect(200);
    });
  });

  it('locks out a source after repeated wrong passwords', async () => {
    const app = appWithBoard();
    const wrong = basic('admin', 'wrong-board-password');
    for (let i = 0; i < 10; i++) {
      await request(app).get(QUEUE_BOARD_PATH).set('authorization', wrong).expect(401);
    }

    await request(app).get(QUEUE_BOARD_PATH).set('authorization', AUTH).expect(429);
  });
});
