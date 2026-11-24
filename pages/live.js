// Live: the latest snapshot from the Commander (today so far), with a Pull live button that
// asks the store PC for a fresh one. The store PC checks for requests every 5 seconds.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, mediumDate, statTile } from '../ui.js';

const GRADES = [['reg', 'regular', 'Regular'], ['mid', 'mid', 'Mid-Grade'], ['prem', 'premium', 'Premium'], ['dsl', 'diesel', 'Diesel']];
const TANKS = [['reg', 'regular'], ['prem', 'premium'], ['dsl', 'diesel']];
const CATEGORY_LABELS = { grocery: 'Grocery & snacks', cold: 'Cold drinks', coffee: 'Coffee & hot food', beer: 'Beer', tobacco: 'Cigarettes & tobacco', vape: 'Vape', ice: 'Ice', auto: 'Automotive', other: 'Other', bottle: 'Bottle deposits' };
const PULL_TIMEOUT = 60000;

let stopWatching = [];

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} hr ago` : mediumDate(new Date(iso).toISOString().slice(0, 10));
}

export function stationStatus(hb) {
  if (!hb?.last_seen) return { tone: 'bad', label: 'Store PC not connected yet' };
  const age = (Date.now() - new Date(hb.last_seen).getTime()) / 60000;
  if (age < 2) return { tone: 'good', label: 'Store PC online' };
  if (age < 15) return { tone: 'warn', label: `Store PC last seen ${ago(hb.last_seen)}` };
  return { tone: 'bad', label: `Store PC offline since ${mediumDate(new Date(hb.last_seen).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))} ${clockTime(hb.last_seen)}` };
}

const insideTotal = (d) => Object.entries(d.categories || {}).filter(([k]) => k !== 'bottle' && k !== 'manual_fuel').reduce((a, [, v]) => a + Number(v || 0), 0);

// Price each grade is selling at: the store PC's window price when it has one, else the
// period average from the report (marked mixed unless it's an exact x.xx9 price).
function priceFor(d, code, level) {
  const p = d.prices?.[code]?.[level];
  if (p) return { price: Number(p.price), status: p.status, note: p.note };
  const f = d.fuel?.[code];
  if (!f || !f[`${level}_price`]) return null;
  return { price: Number(f[`${level}_price`]), status: f[`${level}_price_status`] || 'mixed' };
}

function delta(now, before, money = true) {
  if (before == null) return '';
  const diff = now - before;
  const text = money ? fmt.signedMoney(diff) : `${fmt.signed(diff)} gal`;
  return `<p class="tile__delta tile__delta--${Math.abs(diff) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down'}">${text} vs same time last week</p>`;
}

function snapshotHtml(ctx, snap, lastWeek) {
  const d = snap.data || {};
  const lw = lastWeek?.data;
  const { settings, days } = ctx;
  const today = calc.todayInNewYork();
  const dates = Object.keys(days).sort();
  const costs = dates.length ? calc.gradeCosts(calc.tankCosts(days, settings)[dates.at(-1)], settings) : {};
  const gallons = Number(d.fuel_total?.gallons || 0);
  const inside = insideTotal(d);

  const priceRows = GRADES.map(([code, key, label]) => {
    const cash = priceFor(d, code, 'cash');
    const credit = priceFor(d, code, 'credit');
    const cost = costs[key];
    const cell = (p) => (p ? `${fmt.ppg(p.price)} ${p.status === 'confirmed' ? '' : `<span title="${esc(p.note || 'The price changed during this window; the next pull confirms it.')}">${pill('warn', 'Mixed')}</span>`}` : '—');
    const margin = (p) => (p && cost != null ? fmt.cents(p.price - cost) : '—');
    return `<tr><td>${label}</td><td class="num">${cell(cash)}</td><td class="num">${cell(credit)}</td><td class="num">${cost == null ? '—' : fmt.ppg(cost)}</td><td class="num">${margin(cash)} / ${margin(credit)}</td></tr>`;
  }).join('');

  const fuelRows = GRADES.map(([code, , label]) => {
    const f = d.fuel?.[code] || {};
    return `<tr><td>${label}</td><td class="num">${fmt.number(Number(f.gallons || 0), 1)}</td><td class="num">${fmt.money(Number(f.sales || 0))}</td><td class="num">${fmt.number(Number(f.cash_gallons || 0), 1)}</td><td class="num">${fmt.number(Number(f.credit_gallons || 0), 1)}</td></tr>`;
  }).join('');

  const tankRows = TANKS.map(([code, role]) => {
    const tank = settings.tanks.find((t) => t.role === role);
    const t = d.tanks?.[code];
    if (!tank || !t) return '';
    const volume = t.tls?.volume ?? t.end;
    const outlook = calc.tankOutlook(tank, days, settings, today);
    const supply = outlook.perDay && volume != null ? volume / outlook.perDay : null;
    return `<tr><td>${esc(tank.product)}</td><td class="num">${fmt.number(volume ?? null)}</td><td class="num">${tank.capacity ? `${fmt.number((volume / Number(tank.capacity)) * 100)}%` : '—'}</td><td class="num">${supply == null ? '—' : fmt.number(supply, 1)}</td><td class="muted">${t.tls?.time ? clockTime(t.tls.time) : esc(t.reading_time || '')}</td></tr>`;
  }).join('');

  const categories = Object.entries(CATEGORY_LABELS).filter(([k]) => Number(d.categories?.[k] || 0)).map(([k, label]) => `<tr><td>${label}</td><td class="num">${fmt.money(Number(d.categories[k]))}</td></tr>`).join('');

  return `
    <section class="card">
      <div class="tiles">
        ${statTile('Sales so far', fmt.money(Number(d.commander_total || 0)), delta(Number(d.commander_total || 0), lw ? Number(lw.commander_total || 0) : null))}
        ${statTile('Fuel gallons', fmt.number(gallons), delta(gallons, lw ? Number(lw.fuel_total?.gallons || 0) : null, false))}
        ${statTile('Inside sales', fmt.money(inside), delta(inside, lw ? insideTotal(lw) : null))}
        ${statTile('Customers', fmt.number(Number(d.customer_count || 0)), '', `Tax ${fmt.money(Number(d.sales_tax || 0))}`)}
      </div>
      ${lw ? `<p class="muted">Compared with ${mediumDate(lastWeek.taken_at.slice(0, 10))} at ${clockTime(lastWeek.taken_at)}.</p>` : '<p class="muted">The comparison with the same time last week appears once a snapshot from a week ago exists.</p>'}
    </section>

    <section class="card">
      <h2 class="card__title">Pump prices now</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Grade</th><th class="num">Cash</th><th class="num">Credit</th><th class="num">Your cost</th><th class="num">Margin cash / credit</th></tr></thead>
        <tbody>${priceRows}</tbody>
      </table></div>
      <p class="muted">From what sold since the previous pull, to a tenth of a cent. "Your cost" is the tank average from the Fuel page.</p>
    </section>

    <section class="card">
      <h2 class="card__title">Fuel today</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Grade</th><th class="num">Gallons</th><th class="num">Sales</th><th class="num">At cash price</th><th class="num">At credit price</th></tr></thead>
        <tbody>${fuelRows}</tbody>
        <tfoot><tr><th>Total</th><th class="num">${fmt.number(gallons, 1)}</th><th class="num">${fmt.money(Number(d.fuel_total?.sales || 0))}</th><th></th><th></th></tr></tfoot>
      </table></div>
    </section>

    <div class="live-grid">
      <section class="card">
        <h2 class="card__title">Inside</h2>
        <div class="table-wrap"><table class="table"><tbody>${categories || '<tr><td class="muted">No inside sales yet</td><td></td></tr>'}</tbody>
          <tfoot><tr><th>Inside total</th><th class="num">${fmt.money(inside)}</th></tr></tfoot></table></div>
      </section>
      <section class="card">
        <h2 class="card__title">Payments</h2>
        <div class="table-wrap"><table class="table"><tbody>
          <tr><td>Cash</td><td class="num">${fmt.money(Number(d.mop?.CASH || 0))}</td></tr>
          <tr><td>Credit cards</td><td class="num">${fmt.money(Number(d.cards?.credit || 0))}</td></tr>
          <tr><td>Debit cards</td><td class="num">${fmt.money(Number(d.cards?.debit || 0))}</td></tr>
          <tr><td>Fleet cards</td><td class="num">${fmt.money(Number(d.cards?.fleet || 0))}</td></tr>
        </tbody></table></div>
        <p class="muted">Voids ${fmt.number(Number(d.void_count || 0))} (${fmt.money(Number(d.void_amount || 0))}) · no-sales ${fmt.number(Number(d.no_sale_count || 0))} · safe drops ${fmt.money(Number(d.safe_drops || 0))}</p>
      </section>
    </div>

    <section class="card">
      <h2 class="card__title">Tanks</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Tank</th><th class="num">Gallons</th><th class="num">Full</th><th class="num">Days of supply</th><th>Reading</th></tr></thead>
        <tbody>${tankRows || '<tr><td colspan="5" class="muted">No tank reading in this snapshot</td></tr>'}</tbody>
      </table></div>
      <p class="muted">Days of supply use the last 7 days' average sales, as on the Fuel page.</p>
    </section>`;
}

export async function renderLive(ctx) {
  stopWatching.forEach((stop) => stop());
  stopWatching = [];
  const { store } = ctx;
  if (!store.commander) {
    ctx.view.innerHTML = `<header class="page-head"><div><p class="eyebrow">Live</p><h1>Live</h1></div></header>
      <section class="card"><p class="empty">Live data comes from the store PC through the cloud database, so it isn't available in this local test copy.</p></section>`;
    return;
  }
  ctx.view.innerHTML = `
    <header class="page-head">
      <div><p class="eyebrow">Live</p><h1>Today so far</h1></div>
      <div class="page-head__actions"><button class="btn btn--primary" type="button" data-pull>Pull live</button></div>
    </header>
    <section class="card live-status">
      <p data-station>Checking the store PC…</p>
      <p class="muted" data-updated></p>
      <p data-pull-status role="status" aria-live="polite"></p>
    </section>
    <div data-snapshot><section class="card"><p class="muted">Loading…</p></section></div>`;

  const stationBox = ctx.view.querySelector('[data-station]');
  const updatedBox = ctx.view.querySelector('[data-updated]');
  const pullStatus = ctx.view.querySelector('[data-pull-status]');
  const snapshotBox = ctx.view.querySelector('[data-snapshot]');
  const pullButton = ctx.view.querySelector('[data-pull]');
  let shownId = null;

  const showStation = async () => {
    try {
      const hb = await store.heartbeat();
      const s = stationStatus(hb);
      stationBox.innerHTML = `${pill(s.tone, s.label)}${hb?.last_error ? ` <span class="muted">Last problem: ${esc(hb.last_error)}</span>` : ''}`;
    } catch (err) {
      stationBox.innerHTML = pill('bad', `Couldn't check the store PC: ${err.message}`);
    }
  };

  const showSnapshot = async (snap) => {
    if (!snap) {
      snapshotBox.innerHTML = '<section class="card"><p class="empty">No live snapshot yet. Once the store PC is set up it takes one every 15 minutes, or tap Pull live.</p></section>';
      return;
    }
    if (snap.id === shownId) return;
    shownId = snap.id;
    let lastWeek = null;
    try {
      lastWeek = await store.snapshotBefore(new Date(new Date(snap.taken_at).getTime() - 7 * 86400000).toISOString());
    } catch { /* no comparison */ }
    updatedBox.textContent = `Last updated ${clockTime(snap.taken_at)} (${ago(snap.taken_at)})`;
    snapshotBox.innerHTML = snapshotHtml(ctx, snap, lastWeek);
  };

  const refreshLatest = async () => {
    try {
      await showSnapshot(await store.latestSnapshot());
    } catch (err) {
      snapshotBox.innerHTML = `<section class="card"><p class="empty">Couldn't load the live snapshot: ${esc(err.message)}</p></section>`;
    }
  };

  await Promise.all([showStation(), refreshLatest()]);
  stopWatching.push(store.watch('cmdr_live_snapshots', () => refreshLatest()));
  const heartbeatTimer = setInterval(showStation, 30000);
  stopWatching.push(() => clearInterval(heartbeatTimer));

  pullButton.addEventListener('click', async () => {
    pullButton.disabled = true;
    pullStatus.textContent = 'Asking the store PC for a fresh pull…';
    let request;
    try {
      request = await store.requestPull('live');
    } catch (err) {
      pullStatus.textContent = `Couldn't send the request: ${err.message}`;
      pullButton.disabled = false;
      return;
    }
    const started = Date.now();
    const finish = (message, ok) => {
      clearInterval(poll);
      stopRequest();
      pullStatus.innerHTML = ok ? pill('good', message) : pill('bad', message);
      pullButton.disabled = false;
    };
    const check = async () => {
      const r = await store.getRequest(request.id).catch(() => null);
      if (r?.status === 'running') pullStatus.textContent = 'The store PC is pulling from the register…';
      if (r?.status === 'done') {
        const snap = await store.snapshotForRequest(request.id).catch(() => null);
        if (snap) await showSnapshot(snap);
        else await refreshLatest();
        finish(`Updated at ${clockTime(new Date().toISOString())}`, true);
        toast('Live numbers updated');
      } else if (r?.status === 'error') {
        finish(`The store PC couldn't pull: ${r.error || 'unknown error'}`, false);
      } else if (Date.now() - started > PULL_TIMEOUT) {
        finish(r?.status === 'pending'
          ? 'No answer from the store PC in 60 seconds. It may be off or offline; the request stays queued and runs when it reconnects.'
          : 'The pull is taking longer than usual. The numbers will appear here when it finishes.', false);
      }
    };
    const stopRequest = store.watch('cmdr_requests', check, `id=eq.${request.id}`);
    const poll = setInterval(check, 3000);
    stopWatching.push(() => { clearInterval(poll); stopRequest(); });
  });

  // Stop listening when leaving the page.
  const leave = () => {
    if (!location.hash.startsWith('#/live')) {
      stopWatching.forEach((stop) => stop());
      stopWatching = [];
      window.removeEventListener('hashchange', leave);
    }
  };
  window.addEventListener('hashchange', leave);
}

// Small summary of the latest snapshot for the Overview page.
export async function liveTile(ctx, box) {
  if (!box || !ctx.store.commander) return;
  try {
    const [snap, hb] = await Promise.all([ctx.store.latestSnapshot(), ctx.store.heartbeat()]);
    if (!snap && !hb) return;
    const d = snap?.data || {};
    const reg = snap ? priceFor(d, 'reg', 'credit') : null;
    const s = stationStatus(hb);
    box.innerHTML = `
      <div class="card__head"><h2 class="card__title">Live${snap ? ` · ${clockTime(snap.taken_at)}` : ''}</h2>${pill(s.tone, s.label)}</div>
      ${snap ? `<div class="tiles">
        ${statTile('Sales so far', fmt.money(Number(d.commander_total || 0)))}
        ${statTile('Fuel gallons', fmt.number(Number(d.fuel_total?.gallons || 0)))}
        ${statTile('Regular (credit)', reg ? fmt.ppg(reg.price) : '—', '', reg && reg.status !== 'confirmed' ? 'Changing' : '')}
      </div>` : '<p class="muted">No live snapshot yet.</p>'}
      <p><a class="link" href="#/live">Open Live</a></p>`;
    box.hidden = false;
  } catch {
    // Live data is optional on the Overview.
  }
}
