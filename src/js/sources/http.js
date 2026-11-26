import { REQUEST_TIMEOUT_MS } from '../config.js';

// Requests index.html started before the modules loaded, by URL; each is used once.
const early = globalThis.wetterEarly ?? {};

const aborted = (signal) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

export async function getJson(url, timeout = REQUEST_TIMEOUT_MS) {
  const signal = AbortSignal.timeout(timeout);
  const started = early[url];
  delete early[url];
  const res = await (started ? Promise.race([started, aborted(signal)]) : fetch(url, { signal }));
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

export function query(params) {
  return new URLSearchParams(params).toString().replaceAll('%2C', ',');
}
