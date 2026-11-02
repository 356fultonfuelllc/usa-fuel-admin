// Formatting and small UI building blocks shared by every dashboard page.

import { addDays } from './calc.js';

export const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const fmt = {
  money: (v) => (v == null ? '—' : usd.format(v)),
  moneyCompact: (v) => (v == null ? '—' : Math.abs(v) >= 10000 ? compactUsd.format(v) : usd.format(v)),
  number: (v, digits = 0) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })),
  signed: (v, digits = 0) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`),
  signedMoney: (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${usd.format(Math.abs(v))}`),
  // Price per gallon with tenths of a cent, as on the sign: $3.299
  ppg: (v) => (v == null ? '—' : `$${v.toFixed(3)}`),
  cents: (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)}¢`),
  date: (d, options) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...options }),
};
export const longDate = (d) => fmt.date(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const mediumDate = (d) => fmt.date(d, { weekday: 'short', month: 'short', day: 'numeric' });
export const shortDate = (d) => fmt.date(d, { month: 'short', day: 'numeric' });
export const slashDate = (d) => fmt.date(d, { month: '2-digit', day: '2-digit', year: 'numeric' });
export const monthLabel = (month) => fmt.date(`${month}-01`, { month: 'long', year: 'numeric' });
export const periodLabel = (start) => `${shortDate(start)} – ${fmt.date(addDays(start, 9), { month: 'short', day: 'numeric', year: 'numeric' })}`;
export function dateTimeLabel(value) {
  if (!value) return '—';
  const [date, time] = value.split('T');
  const [h, m] = (time || '00:00').split(':').map(Number);
  return `${mediumDate(date)}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let target = obj;
  for (const key of keys) {
    if (target[key] == null || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[last] = value;
}

const ICONS = {
  good: '<path d="M5 12.5 10 17.5 19 7"/>',
  warn: '<path d="M10.3 3.9 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16.5h.01"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V13M12 16.5h.01"/>',
  idle: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.8l3 1.8"/>',
};
// Status pills always pair an icon with a label, never color alone.
export const pill = (tone, label) => `<span class="pill pill--${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[tone]}</svg>${esc(label)}</span>`;

export function toast(message) {
  const box = document.querySelector('[data-toast]');
  box.textContent = message;
  box.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('is-visible'), 2600);
}

export function field({ name, label, value, type = 'number', prefix, suffix, hint, placeholder, wide, attrs = '' }) {
  const numeric = type === 'number';
  return `<label class="fld${wide ? ' fld--wide' : ''}">
    <span class="fld__label">${esc(label)}</span>
    <span class="fld__control">${prefix ? `<span class="fld__affix">${prefix}</span>` : ''}<input name="${name}" type="${type}"${numeric ? ' inputmode="decimal" step="any"' : ''} value="${esc(value ?? '')}" placeholder="${esc(placeholder ?? '')}" autocomplete="off" ${attrs}>${suffix ? `<span class="fld__affix fld__affix--end">${suffix}</span>` : ''}</span>
    ${hint ? `<span class="fld__hint">${esc(hint)}</span>` : ''}
  </label>`;
}

export function selectField({ name, label, value, options, hint }) {
  return `<label class="fld">
    <span class="fld__label">${esc(label)}</span>
    <span class="fld__control"><select name="${name}">${options.map(([v, text]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></span>
    ${hint ? `<span class="fld__hint">${esc(hint)}</span>` : ''}
  </label>`;
}

// Saving to the cloud can fail (no signal, signed out); never lose the user's typing silently.
export async function attempt(action, failMessage) {
  try {
    await action();
    return true;
  } catch (err) {
    alert(`${failMessage}\n\n${err.message}`);
    return false;
  }
}

export function statTile(label, value, delta, note) {
  return `<div class="tile">
    <p class="tile__label">${esc(label)}</p>
    <p class="tile__value">${value}</p>
    ${delta || ''}
    ${note ? `<p class="tile__note">${esc(note)}</p>` : ''}
  </div>`;
}

export function deltaLine(current, previous, upIsGood = true, label = 'vs previous 7 days') {
  if (!previous) return '';
  const change = (current - previous) / previous;
  if (!Number.isFinite(change)) return '';
  const tone = Math.abs(change) < 0.005 ? 'flat' : (change > 0) === upIsGood ? 'up' : 'down';
  return `<p class="tile__delta tile__delta--${tone}">${change > 0 ? '▲' : change < 0 ? '▼' : '■'} ${fmt.number(Math.abs(change) * 100, 1)}% ${label}</p>`;
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

// Reads a form's named inputs into a plain object (dotted names become nested).
export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    setPath(data, el.name, el.type === 'checkbox' ? el.checked : el.value.trim());
  }
  return data;
}
