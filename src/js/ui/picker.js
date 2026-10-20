// Choosing the place: search by name, the device's position, or one of the
// places chosen before.

import { distanceKm } from '../location.js';
import { searchPlaces } from '../sources/geocoding.js';
import * as storage from '../storage.js';

const RECENT = 6;
const DEBOUNCE_MS = 250;

const html = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function createPicker(dialog, { onPick, onLocate }) {
  const input = dialog.querySelector('input');
  const list = dialog.querySelector('ul');
  let shown = [];
  let note = '';
  let request = 0;
  let timer = 0;

  function render() {
    const gps = `<li><button type="button" data-gps class="picker-gps"><svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 21 3l-8.5 18-2-7.5Z"/></svg><span>Mein Standort</span></button></li>`;
    const items = shown
      .map(
        (p, i) =>
          `<li><button type="button" data-i="${i}"><span>${html(p.name)}</span><small>${html(p.area ?? '')}</small></button></li>`,
      )
      .join('');
    list.innerHTML = gps + items + (note ? `<li class="picker-note">${note}</li>` : '');
  }

  async function search() {
    const q = input.value.trim();
    const id = ++request;
    if (q.length < 2) {
      shown = storage.get('recent-places') ?? [];
      note = '';
      render();
      return;
    }
    note = 'sucht …';
    render();
    try {
      const results = await searchPlaces(q);
      if (id !== request) return;
      shown = results;
      note = results.length ? '' : 'Kein Ort gefunden';
    } catch {
      if (id !== request) return;
      shown = [];
      note = 'Suche nicht erreichbar';
    }
    render();
  }

  function remember(place) {
    const recent = (storage.get('recent-places') ?? []).filter((p) => distanceKm(p, place) > 1);
    storage.set('recent-places', [place, ...recent].slice(0, RECENT));
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, DEBOUNCE_MS);
  });
  dialog.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    if (shown.length && input.value.trim().length >= 2) list.querySelector('[data-i]')?.click();
    else search();
  });
  // The close button or a tap on the backdrop.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
  list.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-gps')) {
      note = 'Standort wird bestimmt …';
      render();
      try {
        await onLocate();
        dialog.close();
      } catch {
        note = 'Standort nicht verfügbar';
        render();
      }
      return;
    }
    const place = shown[Number(button.dataset.i)];
    remember(place);
    dialog.close();
    onPick(place);
  });

  return {
    open() {
      input.value = '';
      search();
      dialog.showModal();
      input.focus();
    },
  };
}
