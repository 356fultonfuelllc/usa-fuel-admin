// Fuel deliveries: every delivery in a month, one row each. Gallons come from the tank
// monitor (TLS) automatically; the owner types the price per gallon (and, optionally, the
// invoice gallons and ticket #). Prices feed the tanks' average cost, which the daily
// reports, Monthly profit, Trends and the accountant export use for fuel profit.

import * as calc from '../calc.js';
import * as commander from '../commander.js';
import { fmt, esc, pill, toast, field, selectField, mediumDate, monthLabel, statTile } from '../ui.js';

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const clean = (v) => String(v ?? '').trim();

// When a delivery finished, from that day's Commander data. The tank monitor keeps its own
// clock; when tracking found it fast or slow (`clockFast` minutes), the time is corrected.
function deliveryTime(ctx, date, tank, index, clockFast = 0) {
  const code = Object.keys(commander.TANK_ROLES).find((k) => commander.TANK_ROLES[k] === tank.role);
  const list = (ctx.cmdr?.days?.[date]?.data?.deliveries || []).filter((x) => x.tank === code);
  const time = list[index]?.time;
  const match = time ? String(time).match(/T(\d{2}):(\d{2})/) : null;
  if (!match) return '';
  const minutes = (Number(match[1]) * 60 + Number(match[2]) - (clockFast || 0) + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const clockLabel = (at) => {
  const [h, m] = at.slice(11, 16).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
};

function statusPill(r) {
  switch (r.state) {
    case 'short': return pill('bad', `Short ${fmt.number(Math.round(r.shortGallons))} gal`);
    case 'no-price': return pill('warn', 'Needs price');
    case 'no-tls': return pill('idle', 'No TLS reading');
    default: return pill('good', 'Priced');
  }
}

export function renderDeliveries(ctx, monthParam) {
  const { settings, days } = ctx;
  const today = calc.todayInNewYork();
  const month = monthParam || today.slice(0, 7);
  const { start, end } = calc.monthBounds(month);
  const ledger = commander.deliveries(days, settings, start, end);
  const rows = ledger.rows.slice().reverse();
  const needPrice = rows.filter((r) => r.state === 'no-price');
  const gallons = rows.reduce((a, r) => a + r.gallons, 0);
  const cost = rows.reduce((a, r) => a + (r.total || 0), 0);
  // Older months still waiting on a price, so nothing gets forgotten.
  const olderUnpriced = commander.deliveries(days, settings, '0000-01-01', calc.addDays(start, -1)).rows.filter((r) => r.state === 'no-price');
  const tankOptions = settings.tanks.map((t) => [t.key, t.product]);
  const name = (r, key) => `d.${r.date}.${r.tank.key}.${r.index}.${key}`;
  const clockFast = rows.map((r) => r.track?.clockFast).find((v) => v);
  const usual = (r) => r.tracked ?? r.measured;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Fuel deliveries</h1></div>
      <div class="page-head__actions">
        <a class="btn btn--ghost btn--small" href="#/deliveries/${calc.previousMonth(month)}">← Previous</a>
        <a class="btn btn--ghost btn--small" href="#/deliveries/${nextMonth(month)}">Next →</a>
      </div>
    </header>

    <section class="card">
      <h2 class="card__title">${monthLabel(month)}</h2>
      <div class="tiles">
        ${statTile('Deliveries', fmt.number(rows.length))}
        ${statTile('Gallons delivered', fmt.number(Math.round(gallons)))}
        ${statTile('Fuel cost entered', fmt.money(cost), '', rows.length && !needPrice.length ? 'All priced' : '')}
        ${statTile('Need a price', fmt.number(needPrice.length), '', needPrice.length ? 'Fuel profit is incomplete until these are priced' : '')}
      </div>
      ${olderUnpriced.length ? `<p>${pill('warn', 'Earlier months')} ${olderUnpriced.length} older deliver${olderUnpriced.length === 1 ? 'y still needs' : 'ies still need'} a price: ${olderUnpriced.slice(-4).map((r) => `<a class="link" href="#/deliveries/${r.date.slice(0, 7)}">${esc(r.tank.product.split(' ')[0])} ${mediumDate(r.date)}</a>`).join(', ')}${olderUnpriced.length > 4 ? '…' : ''}</p>` : ''}
    </section>

    <form class="card" data-prices>
      <div class="card__head">
        <h2 class="card__title">Deliveries</h2>
        ${rows.length ? '<button class="btn btn--primary" type="submit">Save prices</button>' : ''}
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table deliveries-table">
        <thead><tr><th>Date</th><th>Tank</th><th class="num">TLS gallons</th><th class="num">Tracked gallons</th><th class="num">Invoice gallons</th><th class="num">Price / gal</th><th>Ticket / BOL #</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>${rows.map((r) => {
          const time = deliveryTime(ctx, r.date, r.tank, r.index, r.track?.clockFast);
          const span = r.tracked != null ? `${clockLabel(r.track.from)}–${clockLabel(r.track.to)} on the tank monitor's clock` : '';
          return `<tr data-row="${r.date}|${r.tank.key}|${r.index}">
            <td class="dl-date"><a class="link" href="#/report/${r.date}">${mediumDate(r.date)}</a>${time ? `<br><span class="muted">${time}</span>` : ''}</td>
            <td class="dl-tank">${esc(r.tank.product)}</td>
            <td class="num" data-label="TLS gallons">${r.measured == null ? '<span class="muted">—</span>' : fmt.number(r.measured)}</td>
            <td class="num" data-label="Tracked gallons"${span ? ` title="${esc(`Tank readings ${span}`)}"` : ''}>${r.tracked == null ? '<span class="muted">—</span>' : `<strong>${fmt.number(r.tracked)}</strong><br><span class="muted">+${fmt.number(Math.round(r.track.sold))} sold during it</span>`}</td>
            <td class="num" data-label="Invoice gallons"><input class="cell-input" name="${name(r, 'invoiceGallons')}" type="number" inputmode="decimal" step="any" value="${r.invoice ?? ''}" placeholder="${usual(r) == null ? '' : `${fmt.number(usual(r))} (${r.tracked != null ? 'tracked' : 'TLS'})`}" aria-label="Invoice gallons, ${esc(r.tank.product)} ${mediumDate(r.date)}"></td>
            <td class="num" data-label="Price / gal"><span class="cell-money">$<input class="cell-input" name="${name(r, 'cost')}" type="number" inputmode="decimal" step="any" value="${r.cost ?? ''}" placeholder="0.0000" aria-label="Price per gallon, ${esc(r.tank.product)} ${mediumDate(r.date)}"></span></td>
            <td data-label="Ticket / BOL #"><input class="cell-input cell-input--text" name="${name(r, 'ticket')}" type="text" value="${esc(r.ticket)}" aria-label="Ticket number, ${esc(r.tank.product)} ${mediumDate(r.date)}"></td>
            <td class="num" data-label="Cost" data-total>${r.total == null ? '—' : fmt.money(r.total)}</td>
            <td class="dl-status">${statusPill(r)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted">TLS gallons are the tank monitor's delivery report: how much the tank rose. Fuel sold while the truck was unloading doesn't show in that, so <strong>tracked gallons</strong> take the tank reading just before the delivery and just after it (the store PC reads the tanks every 15 minutes) and add back what was pumped in between. Tracked gallons are used when invoice gallons are blank, and the TLS gallons when a delivery couldn't be tracked (before 11/24, or the store PC was offline). Enter the invoice gallons from the bill of lading when you have them and the dashboard flags a delivery that came in more than ${fmt.number(ledger.tolerance)} gal short.${clockFast ? ` The tank monitor's clock is ${Math.abs(clockFast) === 60 ? 'an hour' : `${Math.abs(clockFast)} minutes`} ${clockFast > 0 ? 'fast' : 'slow'}${Math.abs(clockFast) === 60 ? ' (it looks like it never changed back from daylight saving time)' : ''}; the times shown here are corrected.` : ''} Price per gallon is your landed cost (fuel, taxes and freight). It sets the tanks' average cost, which daily reports, Monthly profit, Trends and the accountant export use for fuel profit.</p>`
      : `<p class="empty">No deliveries in ${monthLabel(month)} yet. They appear here the morning after the tank monitor records them, once the day is imported from the Commander.</p>`}
    </form>

    <form class="card" data-add>
      <h2 class="card__title">Add a delivery the tank monitor missed</h2>
      <div class="fields">
        ${field({ name: 'date', label: 'Date', type: 'date', value: today })}
        ${selectField({ name: 'tank', label: 'Tank', value: settings.tanks[0]?.key, options: tankOptions })}
        ${field({ name: 'invoiceGallons', label: 'Gallons', suffix: 'gal', value: '' })}
        ${field({ name: 'cost', label: 'Price / gal', prefix: '$', value: '' })}
        ${field({ name: 'ticket', label: 'Ticket / BOL #', type: 'text', value: '' })}
      </div>
      <button class="btn btn--ghost" type="submit">Add delivery</button>
    </form>`;

  const prices = ctx.view.querySelector('[data-prices]');
  const edits = {};

  prices.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.name?.startsWith('d.')) return;
    edits[input.name] = input.value;
    ctx.markUnsaved(true);
    // Keep the row's cost current while typing.
    const tr = input.closest('tr');
    const [date, tankKey, index] = tr.dataset.row.split('|');
    const r = rows.find((x) => x.date === date && x.tank.key === tankKey && String(x.index) === index);
    const invoice = tr.querySelector('[name$=".invoiceGallons"]').value;
    const price = tr.querySelector('[name$=".cost"]').value;
    const gal = clean(invoice) !== '' ? Number(invoice) : usual(r);
    tr.querySelector('[data-total]').textContent = clean(price) !== '' && gal != null && Number.isFinite(Number(price)) ? fmt.money(gal * Number(price)) : '—';
  });

  prices.addEventListener('submit', async (event) => {
    event.preventDefault();
    const byDate = {};
    for (const [key, value] of Object.entries(edits)) {
      const [, date, tankKey, index, prop] = key.split('.');
      ((byDate[date] ||= {})[`${tankKey}.${index}`] ||= {})[prop] = clean(value);
    }
    if (!Object.keys(byDate).length) { toast('Nothing to save'); return; }
    // Check the numbers before saving anything.
    for (const [date, lines] of Object.entries(byDate)) {
      for (const [where, change] of Object.entries(lines)) {
        for (const prop of ['cost', 'invoiceGallons']) {
          if (change[prop] === undefined || change[prop] === '') continue;
          const n = Number(change[prop]);
          if (!Number.isFinite(n) || n <= 0) {
            alert(`${prop === 'cost' ? 'Price per gallon' : 'Invoice gallons'} for ${mediumDate(date)} isn't a number above zero.`);
            prices.querySelector(`[name="d.${date}.${where}.${prop}"]`)?.focus();
            return;
          }
          if (prop === 'cost' && (n < 1 || n > 10) && !confirm(`$${n} a gallon for ${mediumDate(date)} looks unusual. Save it anyway?`)) return;
        }
      }
    }
    const button = prices.querySelector('[type="submit"]');
    button.disabled = true;
    let saved = 0;
    for (const [date, lines] of Object.entries(byDate)) {
      const day = structuredClone(days[date]);
      for (const [where, change] of Object.entries(lines)) {
        const [tankKey, index] = where.split('.');
        const reading = (day.tanks ||= {})[tankKey] ||= {};
        if (!Array.isArray(reading.deliveries)) {
          reading.deliveries = calc.deliveriesOf(reading).map((d) => ({ ...d }));
          delete reading.delivered; delete reading.cost; delete reading.ticket;
        }
        const line = reading.deliveries[Number(index)];
        if (line) Object.assign(line, change);
      }
      if (!(await ctx.saveDay(day))) { button.disabled = false; return; }
      saved += 1;
    }
    ctx.markUnsaved(false);
    toast(`Saved ${saved} day${saved === 1 ? '' : 's'}`);
    ctx.rerender();
  });

  ctx.view.querySelector('[data-add]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const date = clean(form.get('date'));
    const tankKey = clean(form.get('tank'));
    const gallonsIn = Number(form.get('invoiceGallons'));
    const price = clean(form.get('cost'));
    if (!date || !Number.isFinite(gallonsIn) || gallonsIn <= 0) { alert('Enter the date and the gallons delivered.'); return; }
    if (price !== '' && !(Number(price) > 0)) { alert("The price per gallon isn't a number above zero."); return; }
    if (!days[date]) {
      alert(`There's no daily report for ${mediumDate(date)} yet. Enter or import that day first, then add the delivery.`);
      return;
    }
    const day = structuredClone(days[date]);
    const reading = (day.tanks ||= {})[tankKey] ||= {};
    if (!Array.isArray(reading.deliveries)) {
      reading.deliveries = calc.deliveriesOf(reading).map((d) => ({ ...d }));
      delete reading.delivered; delete reading.cost; delete reading.ticket;
    }
    reading.deliveries.push({ invoiceGallons: String(gallonsIn), measured: '', cost: price, ticket: clean(form.get('ticket')) });
    if (!(await ctx.saveDay(day))) return;
    toast(`Added a delivery on ${mediumDate(date)}`);
    location.hash = `#/deliveries/${date.slice(0, 7)}`;
    ctx.rerender();
  });
}
