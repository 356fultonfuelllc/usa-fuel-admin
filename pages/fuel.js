// Fuel prices & margin: the posted-price log, margin at today's prices, and realized
// fuel profit by day and grade for a month.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, field, newId, dateTimeLabel, mediumDate, monthLabel, statTile } from '../ui.js';

const GRADES = calc.GRADES;

function currentTankCosts(ctx) {
  const dates = Object.keys(ctx.days).sort();
  if (dates.length) return calc.tankCosts(ctx.days, ctx.settings)[dates.at(-1)];
  return Object.fromEntries(ctx.settings.tanks.map((t) => [t.key, t.startCost === '' || t.startCost == null ? null : Number(t.startCost)]));
}

export function renderFuel(ctx, monthParam) {
  const { settings, days } = ctx;
  const now = calc.nowInNewYork();
  const changes = ctx.data.price_changes.slice().sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  const posted = calc.pricesAt(changes, now);
  const costs = calc.gradeCosts(currentTankCosts(ctx), settings);
  const dates = Object.keys(days).sort();
  const month = monthParam || (dates.at(-1) || now).slice(0, 7);
  const { start, end } = calc.monthBounds(month);

  // Realized margin for each day of the month.
  const costsByDate = calc.tankCosts(days, settings);
  const rows = dates.filter((d) => d >= start && d <= end).map((date) => {
    const margin = calc.dayMargin(days[date], calc.gradeCosts(costsByDate[date], settings));
    const gallons = margin.grades.reduce((a, g) => a + g.gallons, 0);
    const amount = margin.grades.reduce((a, g) => a + g.amount, 0);
    return { date, margin, gallons, amount };
  });
  const byGrade = GRADES.map((grade) => {
    const lines = rows.map((r) => r.margin.grades.find((g) => g.key === grade.key));
    const gallons = lines.reduce((a, l) => a + l.gallons, 0);
    const amount = lines.reduce((a, l) => a + l.amount, 0);
    const known = lines.filter((l) => l.profit != null);
    const profit = known.length ? known.reduce((a, l) => a + l.profit, 0) : null;
    const knownGallons = known.reduce((a, l) => a + l.gallons, 0);
    return { ...grade, gallons, amount, price: gallons ? amount / gallons : null, profit, margin: knownGallons ? profit / knownGallons : null };
  });
  const monthProfit = rows.some((r) => r.margin.profit != null) ? rows.reduce((a, r) => a + (r.margin.profit || 0), 0) : null;
  const monthGallons = rows.reduce((a, r) => a + r.gallons, 0);
  const missingCosts = GRADES.some((g) => costs[g.key] == null);

  const priceCell = (record, grade) => {
    if (!record) return '—';
    const credit = record.credit?.[grade.key];
    const cash = record.cash?.[grade.key];
    return `${credit ? `$${Number(credit).toFixed(3)}` : '—'}${cash ? `<br><span class="muted">cash $${Number(cash).toFixed(3)}</span>` : ''}`;
  };

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Fuel</p><h1>Prices &amp; margin</h1></div>
      <div class="page-head__actions"><button class="btn btn--primary" type="button" data-new-price>Log a price change</button></div>
    </header>

    <section class="card" data-price-form hidden>
      <h2 class="card__title">Log a price change</h2>
      <p class="card__hint">The prices on your sign from this moment on. Cash prices are optional.</p>
      <form data-price-change novalidate>
        <div class="fields">
          ${field({ name: 'effectiveAt', label: 'Effective', type: 'datetime-local', value: now })}
          ${field({ name: 'note', label: 'Note', type: 'text', placeholder: 'e.g. supplier increase' })}
        </div>
        <div class="price-grid">
          <span></span>${GRADES.map((g) => `<span class="price-grid__head">${g.label}</span>`).join('')}
          <span class="price-grid__label">Credit</span>
          ${GRADES.map((g) => field({ name: `credit.${g.key}`, label: `${g.label} credit price`, prefix: '$', value: posted?.credit?.[g.key] ?? '' })).join('')}
          <span class="price-grid__label">Cash</span>
          ${GRADES.map((g) => field({ name: `cash.${g.key}`, label: `${g.label} cash price`, prefix: '$', value: posted?.cash?.[g.key] ?? '' })).join('')}
        </div>
        <div class="button-row form-actions">
          <button class="btn btn--primary" type="submit">Save price change</button>
          <button class="btn btn--ghost" type="button" data-cancel-price>Cancel</button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Right now</h2>
        <span class="muted">${posted ? `Prices posted ${dateTimeLabel(posted.effectiveAt)}` : 'No prices logged yet'}</span>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Grade</th><th class="num">Posted credit</th><th class="num">Posted cash</th><th class="num">Your cost</th><th class="num">Margin (credit)</th><th class="num">Margin (cash)</th></tr></thead>
        <tbody>${GRADES.map((g) => {
          const credit = posted?.credit?.[g.key] ? Number(posted.credit[g.key]) : null;
          const cash = posted?.cash?.[g.key] ? Number(posted.cash[g.key]) : null;
          const cost = costs[g.key];
          return `<tr>
            <td>${g.label}</td>
            <td class="num">${fmt.ppg(credit)}</td>
            <td class="num">${fmt.ppg(cash)}</td>
            <td class="num">${fmt.ppg(cost)}</td>
            <td class="num">${credit != null && cost != null ? fmt.cents(credit - cost) : '—'}</td>
            <td class="num">${cash != null && cost != null ? fmt.cents(cash - cost) : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted">Your cost is the average cost per gallon of the fuel in each tank, updated with every delivery. Mid-grade blends the regular and premium costs. Margins are before card fees.</p>
      ${missingCosts ? `<p>${pill('warn', 'Costs missing')} Enter the cost per gallon with each delivery (Enter a day → Tank readings), or a starting cost per tank in <a href="#/settings">Settings</a>.</p>` : ''}
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Fuel profit · ${monthLabel(month)}</h2>
        <div class="button-row">
          <a class="btn btn--ghost btn--small" href="#/fuel/${calc.previousMonth(month)}">← Previous</a>
          <a class="btn btn--ghost btn--small" href="#/fuel/${nextMonth(month)}">Next →</a>
        </div>
      </div>
      <div class="tiles">
        ${statTile('Fuel profit', monthProfit == null ? '—' : fmt.money(monthProfit))}
        ${statTile('Gallons sold', fmt.number(monthGallons))}
        ${statTile('Profit per gallon', monthProfit == null || !monthGallons ? '—' : fmt.cents(monthProfit / monthGallons))}
        ${statTile('Days with numbers', String(rows.length))}
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Grade</th><th class="num">Gallons</th><th class="num">Avg sold at</th><th class="num">Margin / gal</th><th class="num">Profit</th></tr></thead>
        <tbody>${byGrade.map((g) => `<tr><td>${g.label}</td><td class="num">${fmt.number(g.gallons)}</td><td class="num">${fmt.ppg(g.price)}</td><td class="num">${g.margin == null ? '—' : fmt.cents(g.margin)}</td><td class="num">${g.profit == null ? '—' : fmt.money(g.profit)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${rows.length ? `<details class="details">
        <summary>By day</summary>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th class="num">Gallons</th><th class="num">Fuel sales</th><th class="num">Margin / gal</th><th class="num">Profit</th></tr></thead>
          <tbody>${rows.slice().reverse().map((r) => `<tr>
            <td><a class="link" href="#/report/${r.date}">${mediumDate(r.date)}</a></td>
            <td class="num">${fmt.number(r.gallons)}</td>
            <td class="num">${fmt.money(r.amount)}</td>
            <td class="num">${r.margin.perGallon == null ? '—' : fmt.cents(r.margin.perGallon)}${r.margin.complete ? '' : ' <span class="muted">(partial)</span>'}</td>
            <td class="num">${r.margin.profit == null ? '—' : fmt.money(r.margin.profit)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </details>` : `<p class="empty">No days entered for ${monthLabel(month)}.</p>`}
    </section>

    <section class="card">
      <h2 class="card__title">Price history</h2>
      ${changes.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Effective</th>${GRADES.map((g) => `<th class="num">${g.label}</th>`).join('')}<th>Note</th><th></th></tr></thead>
        <tbody>${changes.map((p) => `<tr>
          <td>${dateTimeLabel(p.effectiveAt)}</td>
          ${GRADES.map((g) => `<td class="num">${priceCell(p, g)}</td>`).join('')}
          <td>${esc(p.note)}</td>
          <td class="actions"><button class="btn btn--ghost btn--small" type="button" data-delete-price="${esc(p.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No price changes logged yet.</p>'}
    </section>`;

  const formCard = ctx.view.querySelector('[data-price-form]');
  ctx.view.querySelector('[data-new-price]').addEventListener('click', () => {
    formCard.hidden = false;
    formCard.querySelector('input').focus();
  });
  ctx.view.querySelector('[data-cancel-price]').addEventListener('click', () => { formCard.hidden = true; });

  ctx.view.querySelector('[data-price-change]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const read = (name) => form.elements[name].value.trim();
    const effectiveAt = read('effectiveAt');
    if (!effectiveAt) return alert('Enter when these prices took effect.');
    const credit = {};
    const cash = {};
    for (const g of GRADES) {
      if (read(`credit.${g.key}`)) credit[g.key] = Number(read(`credit.${g.key}`));
      if (read(`cash.${g.key}`)) cash[g.key] = Number(read(`cash.${g.key}`));
    }
    if (!Object.keys(credit).length) return alert('Enter at least one credit price.');
    const record = { id: newId(), day: effectiveAt.slice(0, 10), effectiveAt, credit, cash, note: read('note') };
    if (await ctx.saveRecord('price_changes', record)) {
      toast('Price change saved');
      ctx.rerender();
    }
  });

  ctx.view.querySelectorAll('[data-delete-price]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this price change?')) return;
      if (await ctx.removeRecord('price_changes', button.dataset.deletePrice)) {
        toast('Price change deleted');
        ctx.rerender();
      }
    });
  });
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
