// Item sales: imported Commander PLU and Deal reports, ranked into best and slowest sellers
// and how each combo / mix-and-match deal is doing against the period before.

import * as calc from '../calc.js';
import { parseReport } from '../itemreport.js';
import { fmt, esc, pill, toast, field, selectField, newId, mediumDate, shortDate, statTile } from '../ui.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let view = null; // { from, to, rank } kept while moving around the dashboard
let pending = null; // a parsed report waiting to be saved

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
const overlaps = (a, b) => a.from <= b.to && b.from <= a.to;
const periodText = (r) => (r.from === r.to ? mediumDate(r.from) : `${shortDate(r.from)} – ${mediumDate(r.to)}`);

// A PDF's text comes back in pieces; put pieces on the same line back together.
async function pdfText(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    const rows = [];
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x: item.transform[4], text: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y).forEach((r) => out.push(r.parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(' ')));
  }
  return out.join('\n');
}

// Totals by item and by deal for every report that falls inside the range.
function totalsFor(reports, from, to) {
  const inside = reports.filter((r) => r.from >= from && r.to <= to);
  const partial = reports.filter((r) => overlaps(r, { from, to }) && !(r.from >= from && r.to <= to));
  const covered = new Set();
  for (const r of inside) for (let d = r.from; d <= r.to; d = calc.addDays(d, 1)) covered.add(d);
  const items = {};
  const deals = {};
  for (const r of inside) {
    for (const i of r.items || []) {
      const key = i.plu || i.name;
      const t = items[key] ||= { key, plu: i.plu, name: i.name, qty: 0, sales: 0, customers: 0 };
      t.name = i.name || t.name;
      t.qty += i.qty;
      t.sales += i.sales;
      t.customers += i.customers || 0;
    }
    for (const d of r.deals || []) {
      const key = `${d.type}:${d.number}`;
      const t = deals[key] ||= { key, type: d.type, number: d.number, name: d.name, count: 0, sales: 0, customers: 0 };
      t.name = d.name || t.name;
      t.count += d.count;
      t.sales += d.sales;
      t.customers += d.customers || 0;
    }
  }
  return { reports: inside, partial, days: covered.size, items, deals };
}

// Change in the daily rate, so a 7-day period compares fairly with a 5-day one.
function rateChange(now, nowDays, before, beforeDays) {
  if (!nowDays || !beforeDays || !before) return null;
  return (now / nowDays) / (before / beforeDays) - 1;
}

function changeCell(change, isNew) {
  if (isNew) return pill('good', 'New');
  if (change == null) return '<span class="muted">—</span>';
  const pct = Math.round(change * 100);
  if (pct === 0) return '<span class="muted">±0%</span>';
  return `<span class="${pct > 0 ? 'is-good-text' : 'is-bad-text'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
}

const DEAL_TYPES = { combo: 'Combo', mix: 'Mix & match' };
const itemKey = (i) => i.plu || i.name;
const dealKey = (d) => `${d.type}:${d.number}`;
const itemLink = (key, name) => `<a class="link" href="#/item/${encodeURIComponent(key)}">${esc(name)}</a>`;
const dealLink = (key, name) => `<a class="link" href="#/deal/${encodeURIComponent(key)}">${esc(name)}</a>`;
const dayHead = (d) => `${fmt.date(d, { weekday: 'short' })}<br>${fmt.date(d, { month: 'numeric', day: 'numeric' })}`;

// Reports that cover exactly one day: the only ones that can be shown day by day.
const dailyReports = (reports, from = '0000-00-00', to = '9999-99-99') => reports
  .filter((r) => r.from === r.to && r.from >= from && r.to <= to)
  .sort((a, b) => a.from.localeCompare(b.from));

function dayByDaySection(daily, rows, kind, metric, partialCount) {
  const isItems = kind === 'items';
  const withData = daily.filter((r) => (isItems ? r.items?.length : r.deals?.length));
  if (!withData.length) return '';
  const field = isItems ? (metric === 'sales' ? 'sales' : 'qty') : (metric === 'sales' ? 'sales' : 'count');
  const show = (v) => (field === 'sales' ? fmt.money(v) : fmt.number(v));
  const byDay = withData.map((r) => {
    const map = {};
    for (const x of (isItems ? r.items : r.deals)) {
      const key = isItems ? itemKey(x) : dealKey(x);
      map[key] = (map[key] || 0) + (x[field] || 0);
    }
    return map;
  });
  const title = isItems ? 'Items day by day' : 'Deals day by day';
  return `<section class="card">
    <div class="card__head">
      <h2 class="card__title">${title}</h2>
      ${isItems ? selectField({ name: 'dayMetric', label: 'Show', value: metric, options: [['qty', 'Units sold'], ['sales', 'Dollar sales']] }).replace('<label class="fld">', '<label class="fld fld--inline" data-day-metric>') : ''}
    </div>
    <p class="card__hint">${isItems ? 'Exact' : 'Times sold'} ${isItems ? (field === 'sales' ? 'dollar sales' : 'units sold') : ''} for each day with a daily report. Click a name for its full history.${partialCount ? ' Weekly or monthly reports can\'t be split by day, so they\'re left out here.' : ''}</p>
    ${isItems ? `<div class="day-tools no-print">${`<label class="fld"><span class="fld__label">Find an item</span><span class="fld__control"><input type="search" placeholder="Name or PLU" autocomplete="off" data-day-search></span></label>`}</div>` : ''}
    <div class="table-wrap"><table class="table table--days" ${isItems ? 'data-day-table' : ''}>
      <thead><tr><th class="sticky-col">${isItems ? 'Item' : 'Deal'}</th>${withData.map((r) => `<th class="num">${dayHead(r.from)}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${rows.map((x, n) => {
        const values = byDay.map((m) => m[x.key] || 0);
        const total = values.reduce((a, v) => a + v, 0);
        return `<tr${isItems && n >= 25 ? ' data-extra hidden' : ''}${isItems ? ` data-find="${esc(`${x.name} ${x.plu}`.toLowerCase())}"` : ''}>
          <td class="sticky-col">${isItems ? itemLink(x.key, x.name) : dealLink(x.key, x.name)}${isItems ? `<br><span class="muted">${esc(x.plu)}</span>` : ''}</td>
          ${values.map((v) => `<td class="num${v ? '' : ' muted'}">${v ? show(v) : '0'}</td>`).join('')}
          <td class="num"><strong>${show(total)}</strong></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    ${isItems && rows.length > 25 ? `<div class="button-row no-print"><button class="btn btn--ghost btn--small" type="button" data-show-all-days>Show all ${rows.length} items</button></div>` : ''}
  </section>`;
}


function importSection(today) {
  const yesterday = calc.addDays(today, -1);
  return `<section class="card no-print" id="import">
    <h2 class="card__title">Add a report</h2>
    <p class="card__hint">Use the Commander's <strong>PLU report</strong> (items) and <strong>Deal report</strong> (combos and mix &amp; match) for a day, a week or a month. Paste the report text, or choose the saved file: a PDF, a text file or a CSV/Excel-saved-as-CSV. Both reports can go in at once.</p>
    <form class="inline-form" data-import-form novalidate>
      <div class="fields">
        ${field({ name: 'from', label: 'Report covers from', type: 'date', value: yesterday })}
        ${field({ name: 'to', label: 'To', type: 'date', value: yesterday, hint: 'Same date for a daily report' })}
        <label class="fld"><span class="fld__label">Report file</span><span class="fld__control"><input type="file" name="file" accept=".pdf,.txt,.csv,.tsv,.prn,text/plain,text/csv,application/pdf"></span></label>
      </div>
      <label class="fld fld--wide"><span class="fld__label">Or paste the report text</span><textarea name="text" rows="6" placeholder="PLU NUMBER   DESCRIPTION   CUST  ITEMS  PRICE  TOT-SALES ..."></textarea></label>
      <div class="button-row form-actions">
        <button class="btn btn--primary" type="submit">Read report</button>
      </div>
    </form>
    <div data-preview></div>
  </section>`;
}

function previewHtml(p, reports) {
  const itemTotal = p.items.reduce((a, i) => a + i.sales, 0);
  const clash = reports.filter((r) => overlaps(r, p) && ((p.items.length && r.items?.length) || (p.deals.length && r.deals?.length)));
  const totalOk = p.reportTotal == null ? null : Math.abs(p.reportTotal - itemTotal) < 0.05;
  return `<div class="import-preview">
    <h3 class="card__sub">${periodText(p)}: found ${p.items.length} item${p.items.length === 1 ? '' : 's'} and ${p.deals.length} deal${p.deals.length === 1 ? '' : 's'}</h3>
    ${!p.items.length && !p.deals.length ? `<p>${pill('bad', 'Nothing found')} No item or deal lines were recognized. Send the report to Claude so the reader can be adjusted to your Commander's layout.</p>` : ''}
    ${p.items.length ? `<p>Item sales add up to <strong>${fmt.money(itemTotal)}</strong>${totalOk == null ? '' : totalOk ? ` ${pill('good', 'Matches the report total')}` : ` ${pill('warn', `Report total says ${fmt.money(p.reportTotal)}`)}`}</p>` : ''}
    ${p.skipped ? `<p>${pill('warn', `${p.skipped} line${p.skipped === 1 ? '' : 's'} not read`)} Some lines looked like items but didn't match the layout.</p>` : ''}
    ${clash.length ? `<p>${pill('warn', 'Overlaps')} Already imported for ${clash.map(periodText).join(', ')}. Saving this too would count those days twice; delete one of them below.</p>` : ''}
    ${p.items.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>PLU</th><th>Item</th><th class="num">Sold</th><th class="num">Sales</th></tr></thead>
      <tbody>${p.items.slice().sort((a, b) => b.sales - a.sales).slice(0, 8).map((i) => `<tr><td class="muted">${esc(i.plu)}</td><td>${esc(i.name)}</td><td class="num">${fmt.number(i.qty)}</td><td class="num">${fmt.money(i.sales)}</td></tr>`).join('')}</tbody>
    </table></div>${p.items.length > 8 ? `<p class="muted">Top 8 of ${p.items.length} shown.</p>` : ''}` : ''}
    ${p.deals.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Deal</th><th>Type</th><th class="num">Sold</th><th class="num">Sales</th></tr></thead>
      <tbody>${p.deals.map((d) => `<tr><td>${esc(d.name)}</td><td>${DEAL_TYPES[d.type]}</td><td class="num">${fmt.number(d.count)}</td><td class="num">${fmt.money(d.sales)}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    <div class="button-row form-actions">
      ${p.items.length || p.deals.length ? '<button class="btn btn--primary" type="button" data-save-import>Save report</button>' : ''}
      <button class="btn btn--ghost" type="button" data-cancel-import>Cancel</button>
    </div>
  </div>`;
}

export function renderItems(ctx) {
  const today = calc.todayInNewYork();
  const reports = ctx.data.item_reports.slice().sort((a, b) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from));
  const latest = reports[0];
  const thisMonth = calc.monthBounds(today.slice(0, 7));
  const range = view || { from: latest ? calc.monthBounds(latest.to.slice(0, 7)).start : thisMonth.start, to: latest ? calc.monthBounds(latest.to.slice(0, 7)).end : thisMonth.end, rank: 'sales' };
  const length = daysBetween(range.from, range.to);
  const prev = { from: calc.addDays(range.from, -length), to: calc.addDays(range.from, -1) };
  const now = totalsFor(reports, range.from, range.to);
  const before = totalsFor(reports, prev.from, prev.to);

  const items = Object.values(now.items);
  const rankKey = range.rank === 'qty' ? 'qty' : 'sales';
  const ranked = items.slice().sort((a, b) => b[rankKey] - a[rankKey] || b.sales - a.sales);
  const salesTotal = items.reduce((a, i) => a + i.sales, 0);
  const unitsTotal = items.reduce((a, i) => a + i.qty, 0);
  const deals = Object.values(now.deals).sort((a, b) => b.count - a.count);
  const slow = items.filter((i) => i.qty > 0).sort((a, b) => a.qty - b.qty || a.sales - b.sales).slice(0, 15);
  const stopped = Object.values(before.items).filter((i) => i.qty > 0 && !now.items[i.key]).sort((a, b) => b.qty - a.qty).slice(0, 15);
  const change = (key, field, table) => {
    const b = before[table][key];
    return { pct: b ? rateChange(now[table][key][field], now.days, b[field], before.days) : null, isNew: before.days > 0 && !b };
  };
  const share = (v) => (salesTotal ? `${fmt.number((v / salesTotal) * 100, 1)}%` : '—');
  const daily = dailyReports(reports, range.from, range.to);
  const dayMetric = range.dayMetric === 'sales' ? 'sales' : 'qty';
  const multiDay = now.reports.filter((r) => r.from !== r.to).length;
  const monthValue = range.from.endsWith('-01') && range.to === calc.monthBounds(range.from.slice(0, 7)).end ? range.from.slice(0, 7) : '';

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Sales</p><h1>Item sales</h1></div>
      <div class="page-head__actions no-print"><a class="btn btn--primary btn--small" href="#/items" data-jump-import>Add a report</a></div>
    </header>

    <section class="card">
      <form class="export-range no-print" data-range-form novalidate>
        <div class="fields">
          ${field({ name: 'month', label: 'Month', type: 'month', value: monthValue })}
          ${field({ name: 'from', label: 'Or from', type: 'date', value: range.from })}
          ${field({ name: 'to', label: 'To', type: 'date', value: range.to })}
          ${selectField({ name: 'rank', label: 'Rank items by', value: rankKey, options: [['sales', 'Dollar sales'], ['qty', 'Units sold']] })}
        </div>
      </form>
      <div class="tiles">
        ${statTile('Item sales', fmt.money(salesTotal))}
        ${statTile('Units sold', fmt.number(unitsTotal))}
        ${statTile('Different items sold', fmt.number(items.filter((i) => i.qty > 0).length))}
        ${statTile('Deals sold', fmt.number(deals.reduce((a, d) => a + d.count, 0)))}
      </div>
      <p class="muted">${now.reports.length ? `${now.days} of ${length} days in ${mediumDate(range.from)} – ${mediumDate(range.to)} have a report.` : `No reports for ${mediumDate(range.from)} – ${mediumDate(range.to)} yet.`}
        ${before.days ? ` Changes compare the daily rate with ${mediumDate(prev.from)} – ${mediumDate(prev.to)} (${before.days} day${before.days === 1 ? '' : 's'} of reports).` : now.reports.length ? ' Add reports for the period before to see what is up or down.' : ''}</p>
      ${now.partial.length ? `<p>${pill('warn', 'Not counted')} ${now.partial.map(periodText).join(', ')} only partly falls in these dates. Widen the dates to include ${now.partial.length === 1 ? 'it' : 'them'}.</p>` : ''}
    </section>

    ${items.length ? `<section class="card">
      <div class="card__head"><h2 class="card__title">Best sellers</h2><span class="muted">Top ${Math.min(25, ranked.length)} by ${rankKey === 'qty' ? 'units' : 'dollar sales'}</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th class="num">#</th><th>Item</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Share of sales</th><th class="num">vs before</th></tr></thead>
        <tbody>${ranked.slice(0, 25).map((i, n) => { const c = change(i.key, rankKey, 'items'); return `<tr>
          <td class="num muted">${n + 1}</td><td>${itemLink(i.key, i.name)}<br><span class="muted">${esc(i.plu)}</span></td>
          <td class="num">${fmt.number(i.qty)}</td><td class="num">${fmt.money(i.sales)}</td><td class="num">${share(i.sales)}</td><td class="num">${changeCell(c.pct, c.isNew)}</td>
        </tr>`; }).join('')}</tbody>
      </table></div>
    </section>

    ${dayByDaySection(daily, ranked, 'items', dayMetric, multiDay)}

    <section class="card">
      <h2 class="card__title">Slowest sellers</h2>
      <p class="card__hint">Items that sold, but the fewest. Candidates for less shelf space, a deal, or dropping.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Item</th><th class="num">Units</th><th class="num">Sales</th></tr></thead>
        <tbody>${slow.map((i) => `<tr><td>${itemLink(i.key, i.name)} <span class="muted">${esc(i.plu)}</span></td><td class="num">${fmt.number(i.qty)}</td><td class="num">${fmt.money(i.sales)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${stopped.length ? `<h3 class="card__sub">Sold before, none this time</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Item</th><th class="num">Units before</th></tr></thead>
        <tbody>${stopped.map((i) => `<tr><td>${itemLink(i.key, i.name)} <span class="muted">${esc(i.plu)}</span></td><td class="num">${fmt.number(i.qty)}</td></tr>`).join('')}</tbody>
      </table></div>` : ''}
    </section>` : ''}

    ${deals.length ? `<section class="card">
      <h2 class="card__title">Combos and mix &amp; match deals</h2>
      <p class="card__hint">From the Deal report. A deal that sells more often per day than before is working; one that barely sells may need a better price or a better spot.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Deal</th><th>Type</th><th class="num">Times sold</th><th class="num">Customers</th><th class="num">Sales</th><th class="num">Per day</th><th class="num">vs before</th></tr></thead>
        <tbody>${deals.map((d) => { const c = change(d.key, 'count', 'deals'); return `<tr>
          <td>${dealLink(d.key, d.name)}</td><td>${DEAL_TYPES[d.type] || ''} #${esc(d.number)}</td>
          <td class="num">${fmt.number(d.count)}</td><td class="num">${fmt.number(d.customers)}</td><td class="num">${fmt.money(d.sales)}</td>
          <td class="num">${now.days ? fmt.number(d.count / now.days, 1) : '—'}</td><td class="num">${changeCell(c.pct, c.isNew)}</td>
        </tr>`; }).join('')}</tbody>
      </table></div>
    </section>` : ''}

    ${dayByDaySection(daily, deals, 'deals', 'count', multiDay)}

    ${items.length ? `<section class="card">
      <details class="details">
        <summary>All ${items.length} items</summary>
        ${field({ name: 'search', label: 'Find an item', type: 'search', placeholder: 'Name or PLU', attrs: 'data-item-search' })}
        <div class="table-wrap"><table class="table" data-all-items>
          <thead><tr><th>Item</th><th>PLU</th><th class="num">Units</th><th class="num">Sales</th></tr></thead>
          <tbody>${items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((i) => `<tr data-find="${esc(`${i.name} ${i.plu}`.toLowerCase())}"><td>${itemLink(i.key, i.name)}</td><td class="muted">${esc(i.plu)}</td><td class="num">${fmt.number(i.qty)}</td><td class="num">${fmt.money(i.sales)}</td></tr>`).join('')}</tbody>
        </table></div>
      </details>
    </section>` : ''}

    ${importSection(today)}

    <section class="card">
      <h2 class="card__title">Reports added</h2>
      ${reports.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Covers</th><th class="num">Items</th><th class="num">Item sales</th><th class="num">Deals</th><th>Added</th><th></th></tr></thead>
        <tbody>${reports.map((r) => `<tr>
          <td>${periodText(r)}</td><td class="num">${fmt.number((r.items || []).length)}</td>
          <td class="num">${fmt.money((r.items || []).reduce((a, i) => a + i.sales, 0))}</td><td class="num">${fmt.number((r.deals || []).length)}</td>
          <td class="muted">${r.addedAt ? mediumDate(r.addedAt.slice(0, 10)) : ''}</td>
          <td class="actions no-print"><button class="btn btn--ghost btn--small" type="button" data-delete-report="${esc(r.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No reports added yet.</p>'}
    </section>`;

  // ---- Dates and ranking ----
  const rangeForm = ctx.view.querySelector('[data-range-form]');
  rangeForm.addEventListener('change', (event) => {
    const f = rangeForm.elements;
    if (event.target.name === 'month' && f.month.value) {
      const b = calc.monthBounds(f.month.value);
      view = { ...range, from: b.start, to: b.end };
    } else if (event.target.name === 'rank') {
      view = { ...range, rank: f.rank.value };
    } else if (f.from.value && f.to.value) {
      if (f.to.value < f.from.value) return alert('"To" must be on or after "From".');
      view = { ...range, from: f.from.value, to: f.to.value };
    } else return;
    renderItems(ctx);
  });

  ctx.view.querySelector('[data-day-metric] select')?.addEventListener('change', (event) => {
    view = { ...range, dayMetric: event.target.value };
    renderItems(ctx);
  });
  const dayRows = () => [...ctx.view.querySelectorAll('[data-day-table] tbody tr')];
  ctx.view.querySelector('[data-show-all-days]')?.addEventListener('click', (event) => {
    dayRows().forEach((tr) => { tr.hidden = false; delete tr.dataset.extra; });
    event.currentTarget.remove();
  });
  ctx.view.querySelector('[data-day-search]')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    dayRows().forEach((tr) => { tr.hidden = q ? !tr.dataset.find.includes(q) : 'extra' in tr.dataset; });
  });

  ctx.view.querySelector('[data-item-search]')?.addEventListener('input', (event) => {
    const q = event.target.value.trim().toLowerCase();
    ctx.view.querySelectorAll('[data-all-items] tbody tr').forEach((tr) => { tr.hidden = Boolean(q) && !tr.dataset.find.includes(q); });
  });

  ctx.view.querySelector('[data-jump-import]').addEventListener('click', (event) => {
    event.preventDefault();
    ctx.view.querySelector('#import').scrollIntoView({ behavior: 'smooth' });
    ctx.view.querySelector('[name="file"]').focus({ preventScroll: true });
  });

  // ---- Import ----
  const form = ctx.view.querySelector('[data-import-form]');
  const preview = ctx.view.querySelector('[data-preview]');
  form.elements.from.addEventListener('change', () => {
    if (!form.elements.to.value || form.elements.to.value < form.elements.from.value) form.elements.to.value = form.elements.from.value;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    const from = f.from.value;
    const to = f.to.value || from;
    if (!from) return alert('Enter the date the report starts.');
    if (to < from) return alert('"To" must be on or after "From".');
    if (to > today) return alert("The report can't end after today.");
    const file = f.file.files[0];
    let text = f.text.value;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (file) text = /\.pdf$/i.test(file.name) || file.type === 'application/pdf' ? await pdfText(file) : await file.text();
    } catch (err) {
      button.disabled = false;
      return alert(`Couldn't read that file.\n\n${err.message}`);
    }
    button.disabled = false;
    if (!text.trim()) return alert('Choose the report file or paste the report text.');
    pending = { ...parseReport(text), from, to, fileName: file?.name || '' };
    preview.innerHTML = previewHtml(pending, reports);
    preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  preview.addEventListener('click', async (event) => {
    if (event.target.closest('[data-cancel-import]')) {
      pending = null;
      preview.innerHTML = '';
      return;
    }
    if (!event.target.closest('[data-save-import]') || !pending) return;
    const record = {
      id: newId(),
      day: pending.to,
      from: pending.from,
      to: pending.to,
      items: pending.items,
      deals: pending.deals,
      reportTotal: pending.reportTotal,
      fileName: pending.fileName,
      addedAt: new Date().toISOString(),
    };
    if (await ctx.saveRecord('item_reports', record)) {
      toast(`Saved the report for ${periodText(record)}`);
      pending = null;
      const month = calc.monthBounds(record.to.slice(0, 7));
      view = record.from >= range.from && record.to <= range.to ? range : { ...range, from: month.start, to: month.end };
      renderItems(ctx);
    }
  });

  ctx.view.querySelectorAll('[data-delete-report]').forEach((button) => {
    button.addEventListener('click', async () => {
      const r = reports.find((x) => x.id === button.dataset.deleteReport);
      if (!r || !confirm(`Delete the report for ${periodText(r)}? You can add it again later.`)) return;
      if (await ctx.removeRecord('item_reports', r.id)) {
        toast('Report deleted');
        renderItems(ctx);
      }
    });
  });

  // Keep a parsed report on screen across re-renders until it's saved or cancelled.
  if (pending) preview.innerHTML = previewHtml(pending, reports);
}

// ---- One item's (or one deal's) full history, day by day ----

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function renderItemHistory(ctx, kind, key) {
  const isItem = kind === 'item';
  const reports = ctx.data.item_reports.slice().sort((a, b) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from));
  const listOf = (r) => (isItem ? r.items : r.deals) || [];
  const keyOf = isItem ? itemKey : dealKey;
  const countField = isItem ? 'qty' : 'count';
  const find = (r) => {
    const matches = listOf(r).filter((x) => keyOf(x) === key);
    if (!matches.length) return null;
    return matches.reduce((t, x) => ({ name: x.name, plu: x.plu, number: x.number, type: x.type, count: t.count + (x[countField] || 0), sales: t.sales + (x.sales || 0), customers: t.customers + (x.customers || 0) }), { count: 0, sales: 0, customers: 0 });
  };

  // Every report that lists this kind of row: a day with none sold shows as 0.
  const rows = reports.filter((r) => listOf(r).length).map((r) => ({ r, hit: find(r) })).filter((x) => x.hit || x.r.from === x.r.to);
  const hits = rows.filter((x) => x.hit);
  if (!hits.length) {
    ctx.view.innerHTML = `${ctx.banner()}<header class="page-head"><div><p class="eyebrow">Item sales</p><h1>Not found</h1></div></header>
      <section class="card"><p class="empty">No reports include this ${isItem ? 'item' : 'deal'}. <a class="link" href="#/items">Back to Item sales</a></p></section>`;
    return;
  }
  const info = hits[0].hit;
  const name = info.name;
  const daily = rows.filter((x) => x.r.from === x.r.to);
  const dailyCounts = daily.map((x) => ({ date: x.r.from, count: x.hit?.count || 0, sales: x.hit?.sales || 0, customers: x.hit?.customers || 0 }));
  const totalCount = hits.reduce((a, x) => a + x.hit.count, 0);
  const totalSales = hits.reduce((a, x) => a + x.hit.sales, 0);
  const best = dailyCounts.slice().sort((a, b) => b.count - a.count)[0];
  const perDay = dailyCounts.length ? dailyCounts.reduce((a, d) => a + d.count, 0) / dailyCounts.length : null;
  const weekdays = WEEKDAYS.map((label, i) => {
    const list = dailyCounts.filter((d) => new Date(`${d.date}T12:00:00Z`).getUTCDay() === i);
    return { label, days: list.length, avg: list.length ? list.reduce((a, d) => a + d.count, 0) / list.length : null };
  });
  const topWeekday = weekdays.filter((w) => w.avg != null).sort((a, b) => b.avg - a.avg)[0];
  const unit = isItem ? 'units' : 'times sold';
  const subtitle = isItem ? `PLU ${esc(info.plu)}` : `${DEAL_TYPES[info.type] || 'Deal'} #${esc(info.number)}`;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow"><a class="link" href="#/items">Item sales</a> · ${subtitle}</p><h1>${esc(name)}</h1></div>
      <div class="page-head__actions no-print"><a class="btn btn--ghost btn--small" href="#/items">← All items</a></div>
    </header>

    <section class="card">
      <div class="tiles">
        ${statTile(isItem ? 'Units sold' : 'Times sold', fmt.number(totalCount), '', `In ${hits.length} report${hits.length === 1 ? '' : 's'}`)}
        ${statTile('Sales', fmt.money(totalSales), '', totalCount && isItem ? `Average ${fmt.money(totalSales / totalCount)} each` : '')}
        ${statTile(`Average ${isItem ? 'units' : 'sold'} per day`, perDay == null ? '—' : fmt.number(perDay, 1), '', dailyCounts.length ? `Over ${dailyCounts.length} daily report${dailyCounts.length === 1 ? '' : 's'}` : 'Needs daily reports')}
        ${statTile('Best day', best ? fmt.number(best.count) : '—', '', best ? mediumDate(best.date) : '')}
      </div>
    </section>

    ${dailyCounts.length >= 7 ? `<section class="card">
      <h2 class="card__title">By day of the week</h2>
      <p class="card__hint">Average ${unit} on each weekday, from daily reports.${topWeekday ? ` Busiest: ${topWeekday.label}.` : ''}</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Day</th><th class="num">Days</th><th class="num">Average ${unit}</th></tr></thead>
        <tbody>${weekdays.map((w) => `<tr><td>${w.label}</td><td class="num">${w.days}</td><td class="num">${w.avg == null ? '—' : fmt.number(w.avg, 1)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}

    <section class="card">
      <h2 class="card__title">Every report</h2>
      <p class="card__hint">Newest first. Days with a daily report where it didn't sell show 0.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th class="num">${isItem ? 'Units' : 'Times sold'}</th><th class="num">Sales</th>${isItem ? '<th class="num">Average price</th>' : ''}<th class="num">Customers</th></tr></thead>
        <tbody>${rows.map(({ r, hit }) => `<tr>
          <td>${periodText(r)}${r.from !== r.to ? ' <span class="muted">(multi-day report)</span>' : ''}</td>
          <td class="num${hit ? '' : ' muted'}">${fmt.number(hit?.count || 0)}</td>
          <td class="num${hit ? '' : ' muted'}">${fmt.money(hit?.sales || 0)}</td>
          ${isItem ? `<td class="num">${hit && hit.count ? fmt.money(hit.sales / hit.count) : '—'}</td>` : ''}
          <td class="num">${hit && hit.customers ? fmt.number(hit.customers) : '—'}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th>Total</th><th class="num">${fmt.number(totalCount)}</th><th class="num">${fmt.money(totalSales)}</th>${isItem ? `<th class="num">${totalCount ? fmt.money(totalSales / totalCount) : '—'}</th>` : ''}<th></th></tr></tfoot>
      </table></div>
    </section>`;
}
