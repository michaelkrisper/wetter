import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { mockFetch } from './fixtures.js';

const SRC = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, SRC), 'utf8');
const html = read('index.html');

// Modules main.js imports statically, directly or indirectly (dynamic import() excluded).
function importGraph(entry) {
  const seen = new Set();
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const [, spec] of read(path).matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)) {
      visit(new URL(spec, new URL(path, SRC)).href.slice(SRC.href.length));
    }
  };
  visit(entry);
  seen.delete(entry);
  return seen;
}

describe('startup', () => {
  it('preloads exactly the modules main.js imports, so there is no import waterfall', () => {
    const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(
      ([, href]) => href,
    );
    assert.deepEqual(preloaded.toSorted(), [...importGraph('js/main.js')].toSorted());
  });

  it('caches every startup module in the service worker', () => {
    const sw = read('sw.js');
    for (const path of importGraph('js/main.js')) assert.ok(sw.includes(`'${path}'`), path);
  });

  it('starts the requests for Graz that forecast.js makes, before the first forecast', async () => {
    const { DEFAULT_LOCATION } = await import('../src/js/config.js');
    const { requestsFor } = await import('../src/js/forecast.js');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const defaults = [...script.matchAll(/'(https:\/\/[^']+)'/g)].map(([, url]) => url);
    assert.deepEqual(defaults, requestsFor(DEFAULT_LOCATION));
  });
});

describe('early requests', () => {
  // http.js picks up what index.html left in window.wetterEarly when it loads.
  const url = 'https://api.example/forecast';
  const pending = {};
  globalThis.wetterEarly = pending;
  const http = import('../src/js/sources/http.js');

  it('takes over a request the page already started, once', async (t) => {
    const { getJson } = await http;
    pending[url] = Promise.resolve(Response.json({ early: true }));
    const calls = mockFetch(t, () => ({ early: false }));
    assert.deepEqual(await getJson(url), { early: true });
    assert.deepEqual(await getJson(url), { early: false });
    assert.equal(calls.length, 1);
  });

  it('gives up on a started request after the timeout', async () => {
    const { getJson } = await http;
    pending[url] = new Promise(() => {});
    await assert.rejects(getJson(url, 20), { name: 'TimeoutError' });
  });
});
