import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function worker() {
  const handlers = {}, cached = [];
  const cache = { addAll: async values => cached.push(...values), put: async key => cached.push(key) };
  const context = {
    URL, Promise, Response,
    self: {
      location: { origin: 'https://reader.example' },
      registration: { scope: 'https://reader.example/' },
      skipWaiting() {}, clients: { claim: async () => {} },
      addEventListener: (name, listener) => { handlers[name] = listener; },
    },
    fetch: async () => new Response('static file'),
    caches: { keys: async () => [], open: async () => cache, match: async () => null },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  return { handlers, cached };
}

test('service worker caches only fixed static assets and leaves private pages to the network', async () => {
  const { handlers, cached } = worker();
  for (const path of ['/study', '/capture?url=https%3A%2F%2Fnews.example%2Fstory', '/read/article-id', '/room', '/api/room-articles', '/api/room-discussion', '/s/private-token', '/preview/article-id']) {
    let handled = false;
    handlers.fetch({ request: { url: 'https://reader.example' + path, method: 'GET', mode: 'navigate' }, respondWith: () => { handled = true; } });
    assert.equal(handled, false, path);
  }
  let response;
  handlers.fetch({ request: { url: 'https://reader.example/icon-192.png', method: 'GET', mode: 'no-cors' }, respondWith: value => { response = value; } });
  assert.equal((await response).status, 200);
  await Promise.resolve();
  assert.equal(cached.length, 1);
  assert.equal(cached[0].url, 'https://reader.example/icon-192.png');
});
