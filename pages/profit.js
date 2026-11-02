// Monthly profit: fuel, inside and lottery profit, less card fees, monthly bills, one-off
// expenses and repairs from the maintenance log.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, field, selectField, newId, mediumDate, monthLabel, statTile } from '../ui.js';

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const categoryLabel = (key) => (calc.EXPENSE_CATEGORIES.find(([k]) => k === key) || [key, 'Other'])[1];

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
      <div class="page-head__actions">
        <a class="btn btn--ghost btn--small" href="#/profit/${calc.previousMonth(month)}">← Previous</a>
        <a class="btn btn--ghost btn--small" href="#/profit/${nextMonth(month)}">Next →</a>
      </div>
    </header>

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
      </table></div>
      <p class="muted">Monthly bills are set in <a href="#/settings">Settings</a>. Break-even is the gallons a day that would cover expenses after inside and lottery profit, at this month's fuel profit per gallon.</p>
    </section>

    <section class="card">
      <h2 class="card__title">One-off expenses</h2>
      <p class="card__hint">Anything that isn't a monthly bill: supplies, a plumber, license fees. Don't add fuel or merchandise invoices; their cost is already in fuel profit and the inside margins. Repairs logged under Inspections &amp; repairs are counted automatically.</p>
      <form class="inline-form" data-expense-form novalidate>
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
          <td class="actions"><button class="btn btn--ghost btn--small" type="button" data-delete-expense="${esc(e.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No one-off expenses in ${monthLabel(month)}.</p>`}
    </section>`;

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
