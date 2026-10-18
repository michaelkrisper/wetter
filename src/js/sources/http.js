import { REQUEST_TIMEOUT_MS } from '../config.js';

export async function getJson(url, timeout = REQUEST_TIMEOUT_MS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res.json();
}

export function query(params) {
  return new URLSearchParams(params).toString().replaceAll('%2C', ',');
}
