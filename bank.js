// Bank statement (CSV) import and matching: PDI card deposits against each day's card batch,
// PDI's monthly fee charge, and cash deposits against what was taken to the bank.
// Bank lines are kept in the `deposits` record list with ids starting "bank-".

export const BANK_PREFIX = 'bank-';
export const SETTINGS_ID = 'bank-settings';
export const DEFAULT_BANK_SETTINGS = { processorMatch: 'PDI', cashMatch: 'DEPOSIT', cardWindowDays: 5 };

// ---- CSV ----

function splitLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell.trim()); cell = ''; } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseCsv(text) {
  return String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map(splitLine);
}

// The header row is the first row naming a date column and an amount-ish column.
export function guessColumns(rows) {
  const headerIndex = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit/i.test(c)));
  if (headerIndex < 0) return null;
  const header = rows[headerIndex].map((h) => h.toLowerCase());
  const find = (...patterns) => header.findIndex((h) => patterns.some((p) => p.test(h)));
  const date = find(/post(ed|ing)? ?date/, /^date$/, /transaction date/, /date/);
  return {
    headerIndex,
    header: rows[headerIndex],
    date,
    description: find(/desc/, /memo/, /payee/, /detail/, /^transaction$/, /name/),
    amount: find(/^amount$/, /amount/),
    debit: find(/debit/, /withdraw/),
    credit: find(/credit/, /deposit/),
  };
}

export function parseMoney(text) {
  if (text == null) return null;
  let t = String(text).trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || /^-/.test(t) || /-$/.test(t) || /\bDR\b/i.test(t);
  t = t.replace(/[()$,\s]|DR|CR/gi, '').replace(/-/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export function parseDate(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Rows -> bank lines { id, day, description, amount (+ in, - out) } using the chosen columns.
// Identical lines on the same day stay separate (the nth copy gets its own id), and the same
// statement uploaded twice produces the same ids, so nothing is counted twice.
export function toTransactions(rows, cols) {
  const seen = {};
  const out = [];
  for (const row of rows.slice(cols.headerIndex + 1)) {
    const day = parseDate(row[cols.date]);
    if (!day) continue;
    let amount = null;
    if (cols.amount >= 0 && row[cols.amount] !== undefined && row[cols.amount] !== '') amount = parseMoney(row[cols.amount]);
    else {
      const credit = cols.credit >= 0 ? parseMoney(row[cols.credit]) : null;
      const debit = cols.debit >= 0 ? parseMoney(row[cols.debit]) : null;
      if (credit) amount = Math.abs(credit);
      else if (debit) amount = -Math.abs(debit);
    }
    if (amount == null || amount === 0) continue;
    const description = cols.description >= 0 ? row[cols.description] || '' : '';
    const key = `${day}|${description}|${amount.toFixed(2)}`;
    seen[key] = (seen[key] || 0) + 1;
    out.push({ id: `${BANK_PREFIX}${day}-${hash(`${key}|${seen[key]}`)}`, day, description, amount: Math.round(amount * 100) / 100 });
  }
  return out;
}

// ---- Matching ----

const cents = (v) => Math.round(v * 100) / 100;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const includes = (text, needle) => Boolean(needle) && String(text || '').toUpperCase().includes(String(needle).toUpperCase());

// Each day's card batch with the PDI deposit that paid it. A PDI deposit may equal the whole
// batch, or the batch less Amex and/or fleet cards if those settle on their own.
export function matchCardDeposits(batches, lines, prefs, today) {
  const credits = lines.filter((l) => l.amount > 0 && includes(l.description, prefs.processorMatch)).sort((a, b) => a.day.localeCompare(b.day));
  const used = new Set();
  const window = Number(prefs.cardWindowDays || 5);
  // Only call a deposit missing once the statement covers the days it could have arrived on.
  const coveredTo = lines.map((l) => l.day).sort().at(-1) || null;
  const results = [];
  for (const b of batches.slice().sort((x, y) => x.date.localeCompare(y.date))) {
    const variants = [{ label: 'Full batch', amount: b.total }];
    if (b.amex) variants.push({ label: 'Batch less Amex', amount: cents(b.total - b.amex) });
    if (b.fleet) variants.push({ label: 'Batch less fleet', amount: cents(b.total - b.fleet) });
    if (b.amex && b.fleet) variants.push({ label: 'Batch less Amex and fleet', amount: cents(b.total - b.amex - b.fleet) });
    const inWindow = credits.filter((c) => !used.has(c.id) && c.day >= b.date && c.day <= addDays(b.date, window));
    let match = null;
    for (const c of inWindow) {
      const variant = variants.find((v) => Math.abs(v.amount - c.amount) < 0.01);
      if (variant) { match = { line: c, variant, state: 'matched', difference: 0 }; break; }
    }
    if (!match && inWindow.length) {
      const near = inWindow.map((c) => ({ c, diff: c.amount - b.total })).sort((x, y) => Math.abs(x.diff) - Math.abs(y.diff))[0];
      if (Math.abs(near.diff) <= Math.max(25, b.total * 0.1)) match = { line: near.c, variant: variants[0], state: 'differs', difference: cents(near.diff) };
    }
    if (match) used.add(match.line.id);
    const age = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${b.date}T12:00:00Z`)) / 86400000);
    let state = match ? match.state : 'waiting';
    if (!match && !coveredTo) state = 'no-statement';
    else if (!match && coveredTo >= addDays(b.date, window)) state = 'missing';
    results.push({ ...b, match, state, age });
  }
  return results;
}

// PDI's monthly charge(s): money out whose description names the processor.
export function processorFees(lines, prefs) {
  return lines.filter((l) => l.amount < 0 && includes(l.description, prefs.processorMatch)).sort((a, b) => a.day.localeCompare(b.day));
}

// Cash deposits the bank shows that could clear a deposited day or combined deposit.
export function cashSuggestions(pending, lines, prefs) {
  const credits = lines.filter((l) => l.amount > 0 && includes(l.description, prefs.cashMatch) && !includes(l.description, prefs.processorMatch));
  const used = new Set();
  const out = [];
  for (const p of pending.slice().sort((a, b) => a.depositedOn.localeCompare(b.depositedOn))) {
    const hit = credits.find((c) => !used.has(c.id) && c.day >= p.depositedOn && c.day <= addDays(p.depositedOn, 7) && Math.abs(c.amount - p.amount) < 0.01);
    if (hit) { used.add(hit.id); out.push({ ...p, line: hit }); }
  }
  return out;
}

export function descriptionsSummary(lines) {
  const counts = {};
  for (const l of lines) {
    const key = `${l.amount > 0 ? 'in' : 'out'}|${l.description.replace(/\d{3,}/g, '#').slice(0, 40)}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ direction: k.split('|')[0], text: k.split('|')[1], count: n }));
}
