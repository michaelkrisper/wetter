// The app in a real browser: headless Chrome over the DevTools protocol, with
// every request outside the local server answered from the fixtures, so the
// run is offline and repeatable. Skipped when no Chrome is installed (set
// CHROME to its path if it is not on PATH).

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GEOCODING, incaResponse, openMeteoResponse, radarGridResponse } from './fixtures.js';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const chrome = [process.env.CHROME, 'google-chrome', 'chromium', 'chromium-browser'].find(
  (bin) => bin && spawnSync(bin, ['--version']).status === 0,
);

// Fixture answers for the outside world; anything else gets a 404.
function answer(url) {
  if (url.host === 'api.open-meteo.com') {
    if (url.searchParams.get('latitude').includes(',')) return radarGridResponse(url);
    return openMeteoResponse({ model: url.searchParams.get('models')?.split(',')[1] });
  }
  if (url.host === 'geocoding-api.open-meteo.com') return GEOCODING;
  if (url.pathname.includes('/timeseries/forecast/nowcast')) return incaResponse();
  return null;
}

function serve() {
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// A minimal DevTools protocol client over one WebSocket (flat sessions).
async function devtools(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) {
      for (const listener of listeners) listener(message);
      return;
    }
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  };
  return {
    send: (method, params = {}, sessionId = undefined) =>
      new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }),
    on: (listener) => listeners.push(listener),
    close: () => ws.close(),
  };
}

describe('app in a browser', { skip: !chrome && 'no Chrome found', timeout: 60_000 }, () => {
  let server;
  let browser;
  let cdp;
  let page;
  let profile;
  const errors = [];
  const requests = [];

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const waitFor = async (expression, timeout = 10_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${expression}`);
  };
  const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

  before(async () => {
    server = await serve();
    const origin = `http://127.0.0.1:${server.address().port}`;
    profile = mkdtempSync(join(tmpdir(), 'wetter-chrome-'));
    browser = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ]);
    const url = await new Promise((resolve, reject) => {
      let log = '';
      browser.stderr.on('data', (chunk) => {
        log += chunk;
        const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) resolve(match[1]);
      });
      browser.on('exit', () => reject(new Error(`Chrome exited:\n${log}`)));
    });
    cdp = await devtools(url);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    page = (method, params) => cdp.send(method, params, sessionId);

    // The app's own files come from the server, everything else from the fixtures.
    const intercept = ({ requestId, request }) => {
      if (request.url.startsWith(origin)) return page('Fetch.continueRequest', { requestId });
      const url = new URL(request.url);
      requests.push(url);
      const body = answer(url);
      return page('Fetch.fulfillRequest', {
        requestId,
        responseCode: body ? 200 : 404,
        responseHeaders: [
          { name: 'content-type', value: 'application/json' },
          { name: 'access-control-allow-origin', value: '*' },
        ],
        body: Buffer.from(body ? JSON.stringify(body) : '').toString('base64'),
      });
    };
    cdp.on(({ method, params }) => {
      if (method === 'Fetch.requestPaused') intercept(params);
      if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description);
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        errors.push(params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
    await page('Runtime.enable');
    await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp.send('Browser.setPermission', {
      permission: { name: 'geolocation' },
      setting: 'denied',
      origin,
    });
    await page('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await page('Page.navigate', { url: `${origin}/` });
    await waitFor(`!document.body.classList.contains('is-empty')`);
  });

  after(() => {
    cdp?.close();
    browser?.kill();
    server?.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
  });

  it('shows Graz with seven distinct days and the week chart', async () => {
    assert.equal(await text('#place'), 'Graz');
    assert.match(await text('#temp'), /^-?\d+°$/);
    const days = await evaluate(
      `[...document.querySelectorAll('#days li')].map((li) => li.textContent.trim().slice(0, 9))`,
    );
    assert.equal(days.length, 7);
    assert.equal(new Set(days).size, 7, `duplicate days: ${days.join(' | ')}`);
    assert.ok((await evaluate(`document.querySelector('.c-temp').getAttribute('d').length`)) > 100);
    assert.ok(
      await evaluate(
        `!!document.querySelector('#c-night') && document.querySelectorAll('.c-star').length > 0`,
      ),
    );
  });

  it('quotes the same rain in the outlook, the chart and the day', async () => {
    assert.match(await text('#chart-title'), /Regen ab/);
    assert.equal(await text('#chart-detail'), '80 % · 3,9 mm');
    const amounts = await evaluate(`[...document.querySelectorAll('.c-amount')].map((t) => t.textContent)`);
    assert.ok(amounts.includes('3,9 mm'), amounts.join(', '));
    const tomorrow = await text('#days li:nth-child(2)');
    assert.match(tomorrow, /80 %/);
    assert.match(tomorrow, /3,9 mm/);
  });

  it('jumps to a day and back to now', async () => {
    await click('#days li:nth-child(2) button');
    assert.equal(await text('#chart-title'), 'Morgen');
    assert.equal(await evaluate(`document.getElementById('chart-now').hidden`), false);
    await click('#chart-now');
    assert.equal(await evaluate(`document.getElementById('chart-now').hidden`), true);
    assert.match(await text('#chart-title'), /Regen ab/);
  });

  it('searches for another place and keeps it', async () => {
    await click('#place-btn');
    assert.equal(await evaluate(`document.getElementById('picker').open`), true);
    await evaluate(`(() => {
      const input = document.querySelector('#picker input');
      input.value = 'Klagen';
      input.dispatchEvent(new Event('input'));
    })()`);
    await waitFor(`document.querySelectorAll('#picker [data-i]').length > 0`);
    assert.match(await text('#picker [data-i]'), /^Klagenfurt am Wörthersee/);
    await click('#picker [data-i]');
    assert.equal(await evaluate(`document.getElementById('picker').open`), false);
    assert.equal(await text('#place'), 'Klagenfurt am Wörthersee');
    await waitFor(`!document.body.classList.contains('is-empty')`);
    assert.ok(
      requests.some((u) => u.host === 'api.open-meteo.com' && u.searchParams.get('latitude') === '46.6247'),
    );
    const stored = JSON.parse(await evaluate(`localStorage.getItem('wetter:location')`));
    assert.equal(stored.manual, true);

    // Offered again next time.
    await click('#place-btn');
    assert.match(await text('#picker [data-i]'), /^Klagenfurt am Wörthersee/);
    await click('#picker [data-close]');
    assert.equal(await evaluate(`document.getElementById('picker').open`), false);
  });

  it('opens the radar', async () => {
    await click('[data-tab=radar]');
    await waitFor(
      `!document.getElementById('view-radar').hidden && !!document.querySelector('#view-radar canvas')`,
    );
    await click('[data-tab=weather]');
    assert.equal(await evaluate(`document.getElementById('view-weather').hidden`), false);
  });

  it('runs without errors', () => {
    assert.deepEqual(errors, []);
  });
});
