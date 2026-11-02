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

  // Cash vs credit for the month, by grade.
  const levels = GRADES.map((grade) => {
    const t = { ...grade, cashGallons: 0, creditGallons: 0, cashProfit: 0, creditProfit: 0, fees: 0, days: 0, estimated: 0, unsplit: 0 };
    for (const r of rows) {
      const split = calc.priceLevelSplit(days[r.date], grade.key, ctx.data.price_changes, r.date);
      if (!split) continue;
      const cost = calc.gradeCosts(costsByDate[r.date], settings)[grade.key];
      const profit = calc.priceLevelProfit(split, cost, settings);
      if (!profit) { t.unsplit += 1; continue; }
      t.days += 1;
      if (!split.exact && !split.reliable) t.estimated += 1;
      t.cashGallons += split.cashGallons;
      t.creditGallons += split.creditGallons;
      t.cashProfit += profit.cashProfit;
      t.creditProfit += profit.creditProfit;
      t.fees += profit.fees;
    }
    return t;
  });
  const anySplit = levels.some((l) => l.days);
  const feeSet = settings.cards?.feePct !== '' && settings.cards?.feePct != null;
  const today = calc.todayInNewYork();
  const outlook = settings.tanks.map((tank) => calc.tankOutlook(tank, days, settings, today));
  const orderPill = (o) => ({ order: pill('bad', 'Order now'), soon: pill('warn', 'Order soon'), ok: pill('good', 'OK'), unknown: pill('idle', 'No reading') }[o.state]);
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
      <div><p class="eyebrow">Fuel</p><h1>Prices, ordering &amp; margin</h1></div>
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
        <h2 class="card__title">Fuel ordering</h2>
        <span class="muted">Fill to ${fmt.number(Number(settings.ordering.maxFillPct))}% · order ${fmt.number(Number(settings.ordering.leadDays))} day${Number(settings.ordering.leadDays) === 1 ? '' : 's'} ahead · <a href="#/settings">change</a></span>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Tank</th><th class="num">In the tank</th><th class="num">Sells / day</th><th class="num">Days of supply</th><th class="num">Reorder at</th><th>Order by</th><th class="num">Room for a delivery</th><th></th></tr></thead>
        <tbody>${outlook.map((o) => `<tr>
          <td>${esc(o.tank.product)}</td>
          <td class="num">${o.latest ? `${fmt.number(o.estimate)} gal<br><span class="muted">${o.elapsed ? `estimated · ` : ''}${fmt.number(Math.round(o.fullPct * 100))}% full</span>` : '—'}</td>
          <td class="num">${o.perDay == null ? '—' : `${fmt.number(Math.round(o.perDay))} gal`}</td>
          <td class="num">${o.daysOfSupply == null ? '—' : fmt.number(o.daysOfSupply, 1)}</td>
          <td class="num">${fmt.number(o.reorderAt)} gal</td>
          <td>${o.state === 'order' ? 'Now' : o.reorderDate ? mediumDate(o.reorderDate) : '—'}</td>
          <td class="num">${o.latest ? `${fmt.number(o.room)} gal` : '—'}</td>
          <td>${orderPill(o)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted">From each tank's last TLS reading${outlook[0]?.latest ? ` (${mediumDate(outlook[0].latest)} close)` : ''}, less what has sold since. Sales per day average the last 7 days entered. "Room" is what fits up to the fill limit, rounded down to 100 gallons.</p>
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
      <h3 class="card__sub">Cash vs credit</h3>
      ${anySplit ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Grade</th><th class="num">Cash gallons</th><th class="num">Cash profit / gal</th><th class="num">Credit gallons</th><th class="num">Credit profit / gal</th><th class="num">Card fees</th><th class="num">Cash profit</th><th class="num">Credit profit</th></tr></thead>
        <tbody>${levels.filter((l) => l.days).map((l) => `<tr>
          <td>${l.label}${l.estimated ? `<br><span class="muted">${l.estimated} day${l.estimated === 1 ? '' : 's'} estimated</span>` : ''}</td>
          <td class="num">${fmt.number(l.cashGallons)}</td>
          <td class="num">${l.cashGallons ? fmt.cents(l.cashProfit / l.cashGallons) : '—'}</td>
          <td class="num">${fmt.number(l.creditGallons)}</td>
          <td class="num">${l.creditGallons ? fmt.cents(l.creditProfit / l.creditGallons) : '—'}</td>
          <td class="num">${feeSet ? fmt.money(l.fees) : '—'}</td>
          <td class="num">${fmt.money(l.cashProfit)}</td>
          <td class="num">${fmt.money(l.creditProfit)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted">${feeSet ? `Credit profit is after card fees of ${fmt.number(Number(settings.cards.feePct), 2)}% on credit-price sales.` : `${pill('warn', 'No card fee set')} Add your card processing rate in <a href="#/settings">Settings</a> to take fees off credit profit.`} The split comes from the cash/credit gallons typed on each day, or is worked out from that day's gallons, dollars and posted prices.${settings.cards?.debitPays === 'cash' ? ' Debit pays the cash price here, so some cash-price gallons also carry card fees that aren\'t counted.' : ''}</p>`
        : `<p class="empty">Log both cash and credit prices (above) to see cash and credit profit separately.</p>`}

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
