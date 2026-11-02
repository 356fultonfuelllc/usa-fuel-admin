// Trends: daily gallons and sales with a 7-day average, averages by day of the week,
// and month over month.

import * as calc from '../calc.js';
import { fmt, esc, shortDate, mediumDate, monthLabel, statTile, deltaLine } from '../ui.js';
import { drawColumns, keepSized } from './charts.js';

const RANGES = [['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['all', 'All']];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let range = '90';
let stopResize = null;

const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

function dailyRows(days, settings, from, to) {
  const costsByDate = calc.tankCosts(days, settings);
  const rows = [];
  for (let d = from; d <= to; d = calc.addDays(d, 1)) {
    const day = days[d];
    if (!day) { rows.push({ date: d, entered: false }); continue; }
    const s = calc.summarizeDay(day, settings);
    const margin = calc.dayMargin(day, calc.gradeCosts(costsByDate[d], settings));
    rows.push({ date: d, entered: true, gallons: s.fuelGallons, sales: s.totalSales, inside: s.insideAmount, fuelProfit: margin.profit, overShort: s.overShort });
  }
  // 7-day average over the days entered in each trailing week.
  rows.forEach((r, i) => {
    const week = rows.slice(Math.max(0, i - 6), i + 1).filter((w) => w.entered);
    r.avgGallons = week.length >= 3 ? week.reduce((a, w) => a + w.gallons, 0) / week.length : null;
    r.avgSales = week.length >= 3 ? week.reduce((a, w) => a + w.sales, 0) / week.length : null;
  });
  return rows;
}

function totals(rows) {
  const entered = rows.filter((r) => r.entered);
  const sum = (k) => entered.reduce((a, r) => a + (r[k] || 0), 0);
  const profitRows = entered.filter((r) => r.fuelProfit != null);
  const profitGallons = profitRows.reduce((a, r) => a + r.gallons, 0);
  return {
    days: entered.length,
    gallonsPerDay: entered.length ? sum('gallons') / entered.length : null,
    salesPerDay: entered.length ? sum('sales') / entered.length : null,
    insidePerDay: entered.length ? sum('inside') / entered.length : null,
    profitPerGallon: profitGallons ? profitRows.reduce((a, r) => a + r.fuelProfit, 0) / profitGallons : null,
  };
}

function axisEvery(rows) {
  const n = rows.length;
  if (n <= 31) return (r, i) => (i % 7 === 0 ? shortDate(r.date) : '');
  if (n <= 120) return (r) => (r.date.endsWith('-01') || r.date.endsWith('-15') ? shortDate(r.date) : '');
  return (r) => (r.date.endsWith('-01') ? fmt.date(r.date, { month: 'short' }) : '');
}

function tableView(rows, money) {
  return `<details class="details chart__table"><summary>Show as table</summary>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th class="num">${money ? 'Total sales' : 'Gallons'}</th><th class="num">7-day average</th></tr></thead>
      <tbody>${rows.filter((r) => r.entered).slice().reverse().map((r) => `<tr><td>${mediumDate(r.date)}</td>
        <td class="num">${money ? fmt.money(r.sales) : fmt.number(r.gallons)}</td>
        <td class="num">${(money ? r.avgSales : r.avgGallons) == null ? '—' : money ? fmt.money(r.avgSales) : fmt.number(r.avgGallons)}</td></tr>`).join('')}</tbody>
    </table></div></details>`;
}

export function renderTrends(ctx) {
  const { settings, days } = ctx;
  stopResize?.();
  const dates = Object.keys(days).sort();
  const today = calc.todayInNewYork();
  if (!dates.length) {
    ctx.view.innerHTML = `${ctx.banner()}<header class="page-head"><div><p class="eyebrow">Money</p><h1>Trends</h1></div></header>
      <section class="card"><p class="empty">Trends appear once a few days are entered.</p></section>`;
    return;
  }
  const last = dates.at(-1);
  const first = range === 'all' ? dates[0] : calc.addDays(last, -(Number(range) - 1));
  const from = first < dates[0] ? dates[0] : first;
  const rows = dailyRows(days, settings, from, last);
  const span = calc.daysBetween(from, last) + 1;
  const previousRows = range === 'all' ? [] : dailyRows(days, settings, calc.addDays(from, -span), calc.addDays(from, -1));
  const now = totals(rows);
  const before = previousRows.some((r) => r.entered) ? totals(previousRows) : null;

  // Day-of-week averages.
  const byWeekday = WEEKDAYS.map((label, i) => {
    const list = rows.filter((r) => r.entered && weekday(r.date) === i);
    return {
      label,
      days: list.length,
      gallons: list.length ? list.reduce((a, r) => a + r.gallons, 0) / list.length : null,
      inside: list.length ? list.reduce((a, r) => a + r.inside, 0) / list.length : null,
    };
  });

  // Month over month (all months with data).
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].reverse().slice(0, 13);
  const monthRows = months.map((m) => {
    const { start, end } = calc.monthBounds(m);
    const t = totals(dailyRows(days, settings, start, end > today ? today : end));
    const entered = dates.filter((d) => d >= start && d <= end).map((d) => calc.summarizeDay(days[d], settings));
    return {
      month: m, ...t,
      gallons: entered.reduce((a, s) => a + s.fuelGallons, 0),
      sales: entered.reduce((a, s) => a + s.totalSales, 0),
      inside: entered.reduce((a, s) => a + s.insideAmount, 0),
      overShort: entered.reduce((a, s) => a + (s.overShort || 0), 0),
    };
  });
  const change = (a, b) => (a == null || b == null || !b ? '' : `<span class="muted">${a >= b ? '▲' : '▼'} ${fmt.number(Math.abs((a - b) / b) * 100, 1)}%</span>`);

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Trends</h1></div>
      <div class="segmented" role="group" aria-label="Time range">
        ${RANGES.map(([key, label]) => `<button class="segmented__btn${key === range ? ' is-on' : ''}" type="button" data-range="${key}" aria-pressed="${key === range}">${label}</button>`).join('')}
      </div>
    </header>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">${mediumDate(from)} – ${mediumDate(last)}</h2>
        <span class="muted">${now.days} day${now.days === 1 ? '' : 's'} entered${before ? ' · compared with the period before' : ''}</span>
      </div>
      <div class="tiles">
        ${statTile('Gallons a day', fmt.number(now.gallonsPerDay == null ? null : Math.round(now.gallonsPerDay)), before ? deltaLine(now.gallonsPerDay, before.gallonsPerDay, true, 'vs the period before') : '')}
        ${statTile('Sales a day', fmt.moneyCompact(now.salesPerDay), before ? deltaLine(now.salesPerDay, before.salesPerDay, true, 'vs the period before') : '')}
        ${statTile('Inside sales a day', fmt.moneyCompact(now.insidePerDay), before ? deltaLine(now.insidePerDay, before.insidePerDay, true, 'vs the period before') : '')}
        ${statTile('Fuel profit a gallon', now.profitPerGallon == null ? '—' : fmt.cents(now.profitPerGallon), before && before.profitPerGallon != null && now.profitPerGallon != null ? `<p class="tile__delta tile__delta--${now.profitPerGallon >= before.profitPerGallon ? 'up' : 'down'}">${fmt.cents(now.profitPerGallon - before.profitPerGallon)} vs before</p>` : '')}
      </div>
    </section>

    <section class="card">
      <h2 class="card__title">Fuel gallons by day</h2>
      <div class="chart-legend"><span class="key key--col"></span>Gallons that day <span class="key key--line"></span>7-day average</div>
      <div data-chart="gallons"></div>
      ${tableView(rows, false)}
    </section>

    <section class="card">
      <h2 class="card__title">Total sales by day</h2>
      <div class="chart-legend"><span class="key key--col"></span>Sales that day <span class="key key--line"></span>7-day average</div>
      <div data-chart="sales"></div>
      ${tableView(rows, true)}
    </section>

    <div class="grid-2">
      <section class="card">
        <h2 class="card__title">Average gallons by day of the week</h2>
        <div data-chart="weekday-gallons"></div>
        <details class="details chart__table"><summary>Show as table</summary>
          <table class="table"><tbody>${byWeekday.map((w) => `<tr><td>${w.label}</td><td class="num">${w.gallons == null ? '—' : fmt.number(Math.round(w.gallons))}</td><td class="num muted">${w.days} days</td></tr>`).join('')}</tbody></table>
        </details>
      </section>
      <section class="card">
        <h2 class="card__title">Average inside sales by day of the week</h2>
        <div data-chart="weekday-inside"></div>
        <details class="details chart__table"><summary>Show as table</summary>
          <table class="table"><tbody>${byWeekday.map((w) => `<tr><td>${w.label}</td><td class="num">${w.inside == null ? '—' : fmt.money(w.inside)}</td><td class="num muted">${w.days} days</td></tr>`).join('')}</tbody></table>
        </details>
      </section>
    </div>

    <section class="card">
      <h2 class="card__title">Month over month</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Month</th><th class="num">Days</th><th class="num">Gallons</th><th class="num">Gallons / day</th><th class="num">Total sales</th><th class="num">Sales / day</th><th class="num">Inside sales</th><th class="num">Fuel profit / gal</th><th class="num">Cash over/short</th></tr></thead>
        <tbody>${monthRows.map((m, i) => {
          const prev = monthRows[i + 1];
          return `<tr>
            <td><a class="link" href="#/profit/${m.month}">${esc(monthLabel(m.month))}</a></td>
            <td class="num">${m.days}</td>
            <td class="num">${fmt.number(Math.round(m.gallons))}</td>
            <td class="num">${fmt.number(m.gallonsPerDay == null ? null : Math.round(m.gallonsPerDay))}<br>${change(m.gallonsPerDay, prev?.gallonsPerDay)}</td>
            <td class="num">${fmt.money(m.sales)}</td>
            <td class="num">${fmt.money(m.salesPerDay)}<br>${change(m.salesPerDay, prev?.salesPerDay)}</td>
            <td class="num">${fmt.money(m.inside)}</td>
            <td class="num">${m.profitPerGallon == null ? '—' : fmt.cents(m.profitPerGallon)}</td>
            <td class="num">${fmt.signedMoney(Math.round(m.overShort * 100) / 100)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted">Per-day figures average the days entered, so a month that's only partly entered still compares fairly. Changes are against the month before.</p>
    </section>`;

  const label = axisEvery(rows);
  const daily = (key, avgKey, money) => rows.map((r, i) => ({
    label: mediumDate(r.date),
    axisLabel: label(r, i),
    value: r.entered ? r[key] : null,
    line: r[avgKey],
    tip: r.entered
      ? [['that day', money ? fmt.money(r[key]) : `${fmt.number(Math.round(r[key]))} gal`], ...(r[avgKey] != null ? [['7-day average', money ? fmt.money(r[avgKey]) : `${fmt.number(Math.round(r[avgKey]))} gal`]] : [])]
      : [['', 'Not entered']],
  }));
  const weekly = (key, money) => byWeekday.map((w) => ({
    label: `${w.label} (${w.days} days)`, axisLabel: w.label, value: w[key],
    tip: [['average', w[key] == null ? '—' : money ? fmt.money(w[key]) : `${fmt.number(Math.round(w[key]))} gal`]],
  }));
  const draws = [
    () => drawColumns(ctx.view.querySelector('[data-chart="gallons"]'), daily('gallons', 'avgGallons', false)),
    () => drawColumns(ctx.view.querySelector('[data-chart="sales"]'), daily('sales', 'avgSales', true), { money: true }),
    () => drawColumns(ctx.view.querySelector('[data-chart="weekday-gallons"]'), weekly('gallons', false), { height: 180, strong: true }),
    () => drawColumns(ctx.view.querySelector('[data-chart="weekday-inside"]'), weekly('inside', true), { height: 180, money: true, strong: true }),
  ];
  draws.forEach((d) => d());
  stopResize = keepSized(draws);

  ctx.view.querySelectorAll('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      range = button.dataset.range;
      renderTrends(ctx);
    });
  });
}
