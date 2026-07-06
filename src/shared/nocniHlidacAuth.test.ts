import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nocniHlidacAuth } from './nocniHlidacAuth.js';

// Config reads process.env.NOCNI_HLIDAC_API_TOKEN once at import time, so we
// exercise the preHandler directly against a throwaway Fastify app instead of
// trying to reload config per test.
async function buildApp() {
  const app = Fastify();
  app.get('/protected', { preHandler: nocniHlidacAuth }, async () => ({ ok: true }));
  return app;
}

describe('nocniHlidacAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a request with a wrong token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dGVzdA==' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('nocniHlidacAuth — server-side token not configured', () => {
  const originalToken = process.env.NOCNI_HLIDAC_API_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.NOCNI_HLIDAC_API_TOKEN;
    else process.env.NOCNI_HLIDAC_API_TOKEN = originalToken;
    vi.resetModules();
  });

  it('fails closed (401) for any token when NOCNI_HLIDAC_API_TOKEN is unset', async () => {
    delete process.env.NOCNI_HLIDAC_API_TOKEN;
    vi.resetModules();
    const { nocniHlidacAuth: freshAuth } = await import('./nocniHlidacAuth.js');
    const app = Fastify();
    app.get('/protected', { preHandler: freshAuth }, async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer anything-at-all' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('nocniHlidacAuth — configured token', () => {
  const originalToken = process.env.NOCNI_HLIDAC_API_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.NOCNI_HLIDAC_API_TOKEN;
    else process.env.NOCNI_HLIDAC_API_TOKEN = originalToken;
    vi.resetModules();
  });

  it('accepts the correct Bearer token once NOCNI_HLIDAC_API_TOKEN is set', async () => {
    process.env.NOCNI_HLIDAC_API_TOKEN = 'correct-token';
    vi.resetModules();
    // Dynamic import AFTER resetModules + setting env — config.js (a
    // transitive dependency) re-reads process.env fresh, since resetModules
    // clears the whole module registry, not just this one file.
    const { nocniHlidacAuth: freshAuth } = await import('./nocniHlidacAuth.js');
    const app = Fastify();
    app.get('/protected', { preHandler: freshAuth }, async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer correct-token' },
    });
    expect(res.statusCode).toBe(200);
  });
});
