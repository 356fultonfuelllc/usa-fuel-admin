// Monthly profit: fuel, inside and lottery profit, less card fees, monthly bills, one-off
// expenses and repairs from the maintenance log.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, field, selectField, newId, mediumDate, monthLabel, statTile } from '../ui.js';

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const categoryLabel = (key) => (calc.EXPENSE_CATEGORIES.find(([k]) => k === key) || [key, 'Other'])[1];

const sum = (rows, key) => rows.reduce((t, r) => t + (r[key] || 0), 0);
const signed = (v) => (v == null ? '—' : v < 0 ? `<span class="neg">${fmt.money(v)}</span>` : fmt.money(v));
const minus = (v) => (v ? `−${fmt.money(v)}` : fmt.money(0));

// One day's full breakdown, opened from the by-day list.
function dayDetail(r, settings) {
  const fee = settings.cards?.feePct;
  const fuel = r.grades.length ? `<table class="table table--day">
      <thead><tr><th>Fuel</th><th class="num">Gallons</th><th class="num">Sold at</th><th class="num">Cost</th><th class="num">Margin / gal</th><th class="num">Profit</th></tr></thead>
      <tbody>${r.grades.map((g) => `<tr>
        <td>${esc(g.label)}</td>
        <td class="num">${fmt.number(g.gallons, 1)}</td>
        <td class="num">${fmt.ppg(g.price)}</td>
        <td class="num">${g.cost == null ? '<span class="muted">no cost</span>' : fmt.ppg(g.cost)}</td>
        <td class="num">${g.margin == null ? '—' : fmt.cents(g.margin)}</td>
        <td class="num">${signed(g.profit)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Fuel profit</th><th class="num">${fmt.number(r.gallons, 1)}</th><th></th><th></th><th class="num">${r.perGallon == null ? '—' : fmt.cents(r.perGallon)}</th><th class="num">${signed(r.fuelProfit)}</th></tr></tfoot>
    </table>
    ${r.manualFuel ? `<p class="muted">Manual fuel sales of ${fmt.money(r.manualFuel)} have no gallons, so they aren't in fuel profit.</p>` : ''}
    ${r.fuelComplete ? '' : `<p>${pill('warn', 'Partial')} A grade has no cost yet. Add the delivery cost on that day's report, or a starting cost in <a href="#/settings">Settings</a>.</p>`}`
    : '<p class="muted">No fuel sold.</p>';

  const est = (l) => (l.exact ? '' : ` <span class="muted" title="${esc(l.reason || 'Worked out from the day\'s gallons, dollars and posted prices.')}">est.</span>`);
  const levels = r.levels.length ? `<table class="table table--day">
      <thead><tr><th>Cash vs credit</th><th class="num">Cash gal</th><th class="num">Cash price</th><th class="num">Cash profit</th><th class="num">Credit gal</th><th class="num">Credit price</th><th class="num">Credit profit</th></tr></thead>
      <tbody>${r.levels.map((l) => l.split ? `<tr>
        <td>${esc(l.label)}${est(l)}</td>
        <td class="num">${fmt.number(l.cashGallons, 1)}</td>
        <td class="num">${fmt.ppg(l.cashPrice)}</td>
        <td class="num">${signed(l.cashProfit)}</td>
        <td class="num">${fmt.number(l.creditGallons, 1)}</td>
        <td class="num">${fmt.ppg(l.creditPrice)}</td>
        <td class="num">${signed(l.creditProfit)}</td>
      </tr>` : `<tr><td>${esc(l.label)}</td><td colspan="6" class="muted">${esc(l.reason)}</td></tr>`).join('')}</tbody>
      <tfoot><tr>
        <th>Total</th>
        <th class="num">${fmt.number(r.cashGallons, 1)}</th>
        <th class="num">${r.cashGallons + r.creditGallons ? `${Math.round((r.cashGallons / (r.cashGallons + r.creditGallons)) * 100)}%` : ''}</th>
        <th class="num">${signed(r.cashFuelProfit)}</th>
        <th class="num">${fmt.number(r.creditGallons, 1)}</th>
        <th class="num">${r.cashGallons + r.creditGallons ? `${Math.round((r.creditGallons / (r.cashGallons + r.creditGallons)) * 100)}%` : ''}</th>
        <th class="num">${signed(r.creditFuelProfit)}</th>
      </tr></tfoot>
    </table>
    <p class="muted">Credit profit here is before card fees; the day's card fees come off below. "est." means the split was worked out from the day's gallons, dollars and posted prices instead of typed from Commander.</p>` : '';

  const payments = r.tenders.length ? `<table class="table table--day">
      <thead><tr><th>Payments</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
      <tbody>${r.tenders.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${fmt.money(t.amount)}</td><td class="num">${r.tenderTotal ? `${(t.amount / r.tenderTotal * 100).toFixed(1)}%` : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>Total</th><th class="num">${fmt.money(r.tenderTotal)}</th><th class="num">Cards ${r.tenderTotal ? `${(r.cardSales / r.tenderTotal * 100).toFixed(1)}%` : '—'}</th></tr></tfoot>
    </table>` : '';

  const inside = r.inside.length ? `<table class="table table--day">
      <thead><tr><th>Inside</th><th class="num">Sales</th><th class="num">Margin</th><th class="num">Profit</th></tr></thead>
      <tbody>${r.inside.map((g) => `<tr>
        <td>${esc(g.label)}</td>
        <td class="num">${fmt.money(g.sales)}</td>
        <td class="num">${g.profit == null ? '<span class="muted">not set</span>' : `${esc(g.marginPct)}%`}</td>
        <td class="num">${g.profit == null ? '—' : fmt.money(g.profit)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><th>Inside profit</th><th class="num">${fmt.money(r.insideSales)}</th><th></th><th class="num">${fmt.money(r.insideProfit)}</th></tr></tfoot>
    </table>` : '';

  const lines = [
    ['Fuel profit', signed(r.fuelProfit)],
    ['Inside profit', fmt.money(r.insideProfit)],
    ...(r.lotterySales ? [[`Lottery commission <span class="muted">(${fmt.money(r.lotterySales)} sales)</span>`, fmt.money(r.lotteryProfit)]] : []),
    ['<strong>Gross profit</strong>', `<strong>${signed(r.grossProfit)}</strong>`],
    [`− Card fees <span class="muted">(${fmt.money(r.cardSales)} card sales${fee ? ` × ${esc(fee)}%` : ''})</span>`, r.cardFees == null ? '<span class="muted">rate not set</span>' : minus(r.cardFees)],
    ...(r.bills ? [['− Monthly bills <span class="muted">(share for one day)</span>', minus(r.bills)]] : []),
    ...r.expenses.map((e) => [`− ${esc(e.label)}${e.detail ? ` <span class="muted">(${esc(e.detail)})</span>` : ''}`, minus(e.amount)]),
    ['<strong>Net for the day</strong>', `<strong>${signed(r.net)}</strong>`],
  ];
  return `<div class="day-detail">
    ${fuel}
    ${levels ? `<div class="day-detail__wide">${levels}</div>` : ''}
    ${inside ? `<div>${inside}</div>` : ''}
    <div class="day-detail__stack">
      ${payments}
      <table class="table table--day pnl"><tbody>${lines.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}</tbody></table>
    </div>
    ${r.personalCost ? `<p class="muted">Personal fuel taken at cost: ${fmt.money(r.personalCost)} (owner's draw, not in profit).</p>` : ''}
    ${r.hasReport ? `<p class="no-print"><a class="link" href="#/report/${r.date}">Open the ${mediumDate(r.date)} report</a></p>` : '<p class="muted">No report entered for this day; only its expenses are shown.</p>'}
  </div>`;
}

function byDaySection(p, settings, month) {
  const rows = p.daily;
  if (!rows.length) return `<section class="card"><h2 class="card__title">By day</h2><p class="empty">No days entered for ${monthLabel(month)}.</p></section>`;
  const lottery = rows.some((r) => r.lotteryProfit);
  const expenses = rows.some((r) => r.expenseAmount || r.bills);
  const feesSet = rows.every((r) => r.cardFees != null);
  const gallons = sum(rows, 'gallons');
  const fuelProfit = sum(rows, 'fuelProfit');
  const best = rows.filter((r) => r.hasReport).reduce((b, r) => (b == null || r.net > b.net ? r : b), null);
  const worst = rows.filter((r) => r.hasReport).reduce((w, r) => (w == null || r.net < w.net ? r : w), null);
  const cols = 8 + (lottery ? 1 : 0) + (expenses ? 1 : 0);

  return `<section class="card">
    <div class="card__head">
      <h2 class="card__title">By day</h2>
      <span class="muted">${best && worst && best !== worst ? `Best ${mediumDate(best.date)} (${fmt.money(best.net)}) · worst ${mediumDate(worst.date)} (${fmt.money(worst.net)})` : ''}</span>
    </div>
    <div class="table-wrap"><table class="table table--by-day">
      <thead><tr>
        <th>Date</th><th class="num">Gallons</th><th class="num">Cash fuel</th><th class="num">Credit fuel</th><th class="num">Fuel profit</th><th class="num">Inside profit</th>
        ${lottery ? '<th class="num">Lottery</th>' : ''}
        <th class="num">Gross profit</th><th class="num">Card fees</th>
        ${expenses ? '<th class="num">Expenses</th>' : ''}
        <th class="num">Net</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr class="by-day__row">
        <td>${mediumDate(r.date)}</td>
        <td class="num">${fmt.number(Math.round(r.gallons))}</td>
        <td class="num">${signed(r.cashFuelProfit)}${r.splitComplete ? '' : '<span class="muted">*</span>'}${r.cashGallons ? `<br><span class="muted">${fmt.number(Math.round(r.cashGallons))} gal</span>` : ''}</td>
        <td class="num">${signed(r.creditFuelProfit)}${r.splitComplete ? '' : '<span class="muted">*</span>'}${r.creditGallons ? `<br><span class="muted">${fmt.number(Math.round(r.creditGallons))} gal</span>` : ''}</td>
        <td class="num">${signed(r.fuelProfit)}${r.fuelComplete ? '' : '<span class="muted">*</span>'}${r.perGallon == null ? '' : `<br><span class="muted">${fmt.cents(r.perGallon)}/gal</span>`}</td>
        <td class="num">${fmt.money(r.insideProfit)}${r.insideComplete ? '' : '<span class="muted">*</span>'}</td>
        ${lottery ? `<td class="num">${fmt.money(r.lotteryProfit)}</td>` : ''}
        <td class="num">${signed(r.grossProfit)}</td>
        <td class="num">${r.cardFees == null ? '—' : minus(r.cardFees)}</td>
        ${expenses ? `<td class="num">${minus(r.expenseAmount + r.bills)}</td>` : ''}
        <td class="num"><strong>${signed(r.net)}</strong></td>
      </tr>
      <tr class="by-day__detail"><td colspan="${cols}"><details class="row-details"><summary>Breakdown for ${mediumDate(r.date)}</summary>${dayDetail(r, settings)}</details></td></tr>`).join('')}</tbody>
      <tfoot><tr>
        <th>${rows.length} day${rows.length === 1 ? '' : 's'}</th>
        <th class="num">${fmt.number(Math.round(gallons))}</th>
        <th class="num">${signed(sum(rows, 'cashFuelProfit'))}<br><span class="muted">${fmt.number(Math.round(sum(rows, 'cashGallons')))} gal</span></th>
        <th class="num">${signed(sum(rows, 'creditFuelProfit'))}<br><span class="muted">${fmt.number(Math.round(sum(rows, 'creditGallons')))} gal</span></th>
        <th class="num">${signed(fuelProfit)}${gallons ? `<br><span class="muted">${fmt.cents(fuelProfit / gallons)}/gal</span>` : ''}</th>
        <th class="num">${fmt.money(sum(rows, 'insideProfit'))}</th>
        ${lottery ? `<th class="num">${fmt.money(sum(rows, 'lotteryProfit'))}</th>` : ''}
        <th class="num">${signed(sum(rows, 'grossProfit'))}</th>
        <th class="num">${feesSet ? minus(sum(rows, 'cardFees')) : '—'}</th>
        ${expenses ? `<th class="num">${minus(sum(rows, 'expenseAmount') + sum(rows, 'bills'))}</th>` : ''}
        <th class="num">${signed(sum(rows, 'net'))}</th>
      </tr></tfoot>
    </table></div>
    <p class="muted">${rows.some((r) => !r.fuelComplete || !r.insideComplete || !r.splitComplete) ? '* Partial: a fuel grade has no cost or no cash/credit split, or a department has no margin % set. ' : ''}Cash and credit fuel profit are before card fees; credit is split from the cash/credit gallons typed on each day, or worked out from that day's gallons, dollars and posted prices. Card fees are each day's credit, debit and fleet sales${settings.cards?.feePct ? ` × ${esc(settings.cards.feePct)}%` : ''}.${p.billsPerDay ? ` Monthly bills are spread evenly at ${fmt.money(p.billsPerDay)} a day over days with a report, so these days add up to less than the month's net until every day is entered.` : ''} One-off expenses and repairs show on the day they're dated.</p>
  </section>`;
}

// Cash paid out of the drawer this month, from the daily reports.
function payoutsSection(days, month) {
  const { start, end } = calc.monthBounds(month);
  const lines = [];
  for (const date of Object.keys(days).filter((d) => d >= start && d <= end).sort()) {
    const list = calc.payoutList(days[date]);
    if (list.length) list.forEach((p) => lines.push({ date, ...p }));
    else if (Number(days[date].cash?.payOuts)) lines.push({ date, to: '', reason: 'unitemized', amount: Number(days[date].cash.payOuts), note: '' });
  }
  const label = (key) => (key === 'unitemized' ? 'Not itemized' : calc.payoutReasonLabel(key));
  const totalOf = (list) => list.reduce((a, p) => a + p.amount, 0);
  const groupBy = (key) => Object.values(lines.reduce((acc, p) => {
    const k = key(p);
    (acc[k] ||= { name: k, count: 0, amount: 0 }).count += 1;
    acc[k].amount += p.amount;
    return acc;
  }, {})).sort((a, b) => b.amount - a.amount);
  const all = totalOf(lines);
  const byReason = groupBy((p) => label(p.reason));
  const byPayee = groupBy((p) => p.to || 'Not named').slice(0, 10);
  const share = (v) => (all ? `${fmt.number((v / all) * 100)}%` : '');

  return `<section class="card">
    <div class="card__head">
      <h2 class="card__title">Cash pay outs</h2>
      <span class="muted">${fmt.money(all)} · ${lines.length} payment${lines.length === 1 ? '' : 's'}</span>
    </div>
    <p class="card__hint">Cash paid out of the drawer, from each day's Cash section. These balance the drawer; they aren't added to the expenses above.</p>
    ${lines.length ? `<div class="payout-summary">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>What for</th><th class="num">Payments</th><th class="num">Amount</th><th class="num">Share</th></tr></thead>
        <tbody>${byReason.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${fmt.money(r.amount)}</td><td class="num">${share(r.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Paid to (top 10)</th><th class="num">Payments</th><th class="num">Amount</th></tr></thead>
        <tbody>${byPayee.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${fmt.money(r.amount)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <details class="details">
      <summary>Every pay out (${lines.length})</summary>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Paid to</th><th>What for</th><th>Invoice # / note</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.slice().reverse().map((p) => `<tr>
          <td><a class="link" href="#/report/${p.date}">${mediumDate(p.date)}</a></td><td>${esc(p.to || '—')}</td><td>${esc(label(p.reason))}</td><td>${esc(p.note)}</td><td class="num">${fmt.money(p.amount)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </details>` : `<p class="empty">No pay outs entered for ${monthLabel(month)}.</p>`}
  </section>`;
}

export function renderProfit(ctx, monthParam) {
  const { settings, days } = ctx;
  const today = calc.todayInNewYork();
  const month = monthParam || today.slice(0, 7);
  const p = calc.monthProfit(month, days, settings, {
    priceChanges: ctx.data.price_changes,
    expenses: ctx.data.expenses,
    maintenance: ctx.data.maintenance,
  });
  const missing = [];
  if (p.cardFees == null && p.cardSales) missing.push('your card processing rate');
  if (p.insideMissing.length) missing.push(`a margin % for ${p.insideMissing.map((g) => g.label).join(', ')}`);
  if (p.lotteryProfit == null && p.lotterySales) missing.push('the lottery commission %');

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Monthly profit</h1></div>
      <div class="page-head__actions no-print">
        <a class="btn btn--ghost btn--small" href="#/profit/${calc.previousMonth(month)}">← Previous</a>
        <a class="btn btn--ghost btn--small" href="#/profit/${nextMonth(month)}">Next →</a>
        <button class="btn btn--primary btn--small" type="button" data-print>Print or save PDF</button>
      </div>
    </header>
    <p class="print-only">${esc(settings.facility.name)} · ${esc(settings.facility.address)} · printed ${mediumDate(today)}</p>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">${monthLabel(month)}</h2>
        <span class="muted">${p.daysEntered} of ${p.daysInMonth} days entered</span>
      </div>
      <div class="tiles">
        ${statTile('Gross profit', fmt.money(p.grossProfit))}
        ${statTile('Expenses', fmt.money(p.expenseTotal))}
        ${statTile('Net profit', fmt.money(p.net))}
        ${statTile('Break-even gallons / day', p.breakEvenPerDay == null ? '—' : p.breakEvenPerDay === 0 ? 'Covered' : fmt.number(Math.round(p.breakEvenPerDay)), '', p.breakEvenPerDay === 0 ? 'Inside and lottery profit cover the expenses' : p.gallonsPerDay == null ? '' : `Selling ${fmt.number(Math.round(p.gallonsPerDay))} a day`)}
      </div>
      ${missing.length ? `<p>${pill('warn', 'Incomplete')} Add ${missing.join(', ')} in <a href="#/settings">Settings</a> for a full picture.</p>` : ''}
      ${p.daysEntered && p.daysEntered < p.daysInMonth ? `<p class="muted">Monthly bills count in full, so net profit catches up as the month's days are entered.</p>` : ''}
    </section>

    <section class="card">
      <h2 class="card__title">Profit and loss</h2>
      <div class="table-wrap"><table class="table pnl">
        <tbody>
          <tr><td>Fuel profit <span class="muted">(${fmt.number(Math.round(p.fuelGallons))} gal${p.perGallon != null ? ` × ${fmt.cents(p.perGallon)}` : ''}, before card fees)</span></td><td class="num">${fmt.money(p.fuelProfit)}</td></tr>
          <tr><td>Inside profit <span class="muted">(${fmt.money(p.insideSales)} sales)</span></td><td class="num">${fmt.money(p.insideProfit)}</td></tr>
          ${p.inside.filter((g) => g.sales).map((g) => `<tr class="pnl__sub"><td>${esc(g.label)} · ${fmt.money(g.sales)}${g.marginPct !== '' && g.marginPct != null ? ` × ${esc(g.marginPct)}%` : ' · no margin set'}</td><td class="num">${g.profit == null ? '—' : fmt.money(g.profit)}</td></tr>`).join('')}
          <tr><td>Lottery commission <span class="muted">(${fmt.money(p.lotterySales)} sales)</span></td><td class="num">${fmt.money(p.lotteryProfit)}</td></tr>
        </tbody>
        <tbody>
          <tr class="pnl__total"><th>Gross profit</th><th class="num">${fmt.money(p.grossProfit)}</th></tr>
          <tr><td>− Card fees <span class="muted">(${fmt.money(p.cardSales)} card sales${settings.cards?.feePct ? ` × ${esc(settings.cards.feePct)}%` : ''})</span></td><td class="num">${fmt.money(p.cardFees)}</td></tr>
          ${p.fixed.map((e) => `<tr><td>− ${esc(e.label || 'Monthly bill')}</td><td class="num">${fmt.money(e.amount)}</td></tr>`).join('')}
          ${p.byCategory.map((c) => `<tr><td>− ${esc(c.label)}</td><td class="num">${fmt.money(c.amount)}</td></tr>`).join('')}
          ${p.repairCost ? `<tr><td>− Repairs <span class="muted">(from the maintenance log)</span></td><td class="num">${fmt.money(p.repairCost)}</td></tr>` : ''}
          <tr class="pnl__total"><th>Net profit</th><th class="num">${fmt.money(p.net)}</th></tr>
        </tbody>
        ${p.personalGallons ? `<tbody><tr><td>Personal fuel taken <span class="muted">(${fmt.number(p.personalGallons, 1)} gal at cost, owner's draw, not in profit above)</span></td><td class="num">${fmt.money(p.personalCost)}</td></tr></tbody>` : ''}
      </table></div>
      <p class="muted">Monthly bills are set in <a href="#/settings">Settings</a>. Break-even is the gallons a day that would cover expenses after inside and lottery profit, at this month's fuel profit per gallon.</p>
    </section>

    ${byDaySection(p, settings, month)}

    <section class="card">
      <h2 class="card__title">One-off expenses</h2>
      <p class="card__hint no-print">Anything that isn't a monthly bill: supplies, a plumber, license fees. Don't add fuel or merchandise invoices; their cost is already in fuel profit and the inside margins. Repairs logged under Inspections &amp; repairs are counted automatically.</p>
      <form class="inline-form no-print" data-expense-form novalidate>
        <div class="fields">
          ${field({ name: 'day', label: 'Date', type: 'date', value: month === today.slice(0, 7) ? today : `${month}-01` })}
          ${selectField({ name: 'category', label: 'Category', value: 'other', options: calc.EXPENSE_CATEGORIES })}
          ${field({ name: 'vendor', label: 'Paid to', type: 'text' })}
          ${field({ name: 'amount', label: 'Amount', prefix: '$' })}
          ${field({ name: 'note', label: 'Note', type: 'text' })}
        </div>
        <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Add expense</button></div>
      </form>
      ${p.oneOff.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${p.oneOff.slice().sort((a, b) => b.day.localeCompare(a.day)).map((e) => `<tr>
          <td>${mediumDate(e.day)}</td><td>${esc(categoryLabel(e.category))}</td><td>${esc(e.vendor)}</td><td>${esc(e.note)}</td>
          <td class="num">${fmt.money(Number(e.amount) || 0)}</td>
          <td class="actions no-print"><button class="btn btn--ghost btn--small" type="button" data-delete-expense="${esc(e.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No one-off expenses in ${monthLabel(month)}.</p>`}
    </section>

    ${payoutsSection(days, month)}`;

  ctx.view.querySelector('[data-print]').addEventListener('click', () => window.print());
  const form = ctx.view.querySelector('[data-expense-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    const amount = f.amount.value.trim();
    if (!f.day.value) return alert('Enter the date.');
    if (!amount || !Number.isFinite(Number(amount))) return alert('Enter the amount.');
    const record = { id: newId(), day: f.day.value, category: f.category.value, vendor: f.vendor.value.trim(), amount, note: f.note.value.trim() };
    if (await ctx.saveRecord('expenses', record)) {
      toast('Expense added');
      ctx.rerender();
    }
  });
  ctx.view.querySelectorAll('[data-delete-expense]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this expense?')) return;
      if (await ctx.removeRecord('expenses', button.dataset.deleteExpense)) {
        toast('Expense deleted');
        ctx.rerender();
      }
    });
  });
}
