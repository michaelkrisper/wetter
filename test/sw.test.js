import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

describe('service worker', () => {
  it('activate deletes only outdated caches of this app', async () => {
    const names = [
      'wetter-1a2b3c4d',
      'wetter-0000aaaa',
      'muenzen-assets-75f18d4840',
      'schall-1a2b3c4d',
      'v3',
    ];
    const deleted = [];
    const listeners = {};
    const src = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8').replaceAll(
      '__VERSION__',
      '1a2b3c4d',
    );
    runInNewContext(src, {
      self: {
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
        clients: { claim: async () => {} },
      },
      caches: {
        keys: async () => names,
        delete: async (name) => deleted.push(name),
      },
    });
    let done;
    listeners.activate({
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
    assert.deepEqual(deleted, ['wetter-0000aaaa']);
  });
});
