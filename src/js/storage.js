// localStorage with a namespace; failures (private mode, quota) are not fatal.
const PREFIX = 'wetter:';

export function get(key) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + key));
  } catch {
    return null;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore: the app works without the cache, it is just slower to start.
  }
}
