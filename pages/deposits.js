// Bank deposits: each day's deposit goes from waiting → deposited → cleared by the bank.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, field, mediumDate, shortDate, monthLabel, statTile, usd } from '../ui.js';

function statusPill(s) {
  switch (s.state) {
    case 'pending': return pill('idle', 'Not deposited yet');
    case 'overdue': return pill('warn', `Not deposited · ${s.age} days`);
    case 'transit': return pill('idle', 'At the bank');
    case 'late': return pill('warn', `Not cleared · ${s.waiting} days`);
    case 'cleared': return pill('good', 'Cleared');
    case 'mismatch': return pill('bad', `Bank shows ${usd.format(s.clearedAmount)} (${fmt.signedMoney(s.difference)})`);
    default: return '<span class="muted">No deposit</span>';
  }
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

export function renderDeposits(ctx, monthParam) {
  const { settings, days } = ctx;
  const today = calc.todayInNewYork();
  const month = monthParam || today.slice(0, 7);
  const { start, end } = calc.monthBounds(month);
  const records = Object.fromEntries(ctx.data.deposits.map((r) => [r.id, r]));
  const status = (date) => calc.depositState(date, days[date], records[date], settings, today);

  const rows = Object.keys(days).filter((d) => d >= start && d <= end).sort().reverse()
    .map((date) => ({ date, record: records[date] || {}, s: status(date) }))
    .filter((r) => r.s.state !== 'none');

  // Totals across every day, not just this month, so nothing gets lost between months.
  const all = Object.keys(days).map((date) => status(date));
  const sum = (states) => all.filter((s) => states.includes(s.state)).reduce((a, s) => a + s.amount, 0);
  const problems = all.filter((s) => ['overdue', 'late', 'mismatch'].includes(s.state)).length;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Bank deposits</h1></div>
    </header>

    <section class="card">
      <div class="tiles">
        ${statTile('Waiting to deposit', fmt.money(sum(['pending', 'overdue'])))}
        ${statTile('At the bank, not cleared', fmt.money(sum(['transit', 'late'])))}
        ${statTile(`Cleared in ${monthLabel(month).split(' ')[0]}`, fmt.money(rows.filter((r) => r.s.state === 'cleared').reduce((a, r) => a + r.s.amount, 0)))}
        ${statTile('Need a look', String(problems))}
      </div>
      <p class="muted">Flagged when a deposit isn't made within ${settings.thresholds.depositDays} days, or hasn't cleared ${settings.thresholds.clearDays} days after you deposit it. Change these in Settings.</p>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">${monthLabel(month)}</h2>
        <div class="button-row">
          <a class="btn btn--ghost btn--small" href="#/deposits/${calc.previousMonth(month)}">← Previous</a>
          <a class="btn btn--ghost btn--small" href="#/deposits/${nextMonth(month)}">Next →</a>
        </div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Day</th><th class="num">Deposit</th><th>Status</th><th>Deposited</th><th>Cleared</th><th></th></tr></thead>
        <tbody>${rows.map(({ date, record, s }) => `<tr data-row="${date}">
          <td><a class="link" href="#/report/${date}">${mediumDate(date)}</a></td>
          <td class="num">${fmt.money(s.amount)}</td>
          <td>${statusPill(s)}</td>
          <td>${record.depositedOn ? `${shortDate(record.depositedOn)}${record.slip ? ` · #${esc(record.slip)}` : ''}` : '—'}</td>
          <td>${record.clearedOn ? shortDate(record.clearedOn) : '—'}</td>
          <td class="actions">${!record.depositedOn ? `<button class="btn btn--ghost btn--small" type="button" data-quick="deposited" data-date="${date}">Deposited today</button>` : !record.clearedOn ? `<button class="btn btn--ghost btn--small" type="button" data-quick="cleared" data-date="${date}">Cleared today</button>` : ''}
            <button class="btn btn--ghost btn--small" type="button" data-edit="${date}">Edit</button></td>
        </tr>
        <tr class="row-form" data-form-row="${date}" hidden><td colspan="6">
          <form class="inline-form" data-deposit-form="${date}" novalidate>
            <div class="fields">
              ${field({ name: 'depositedOn', label: 'Deposited on', type: 'date', value: record.depositedOn })}
              ${field({ name: 'slip', label: 'Deposit slip #', type: 'text', value: record.slip })}
              ${field({ name: 'clearedOn', label: 'Cleared by bank on', type: 'date', value: record.clearedOn })}
              ${field({ name: 'clearedAmount', label: 'Amount the bank shows', prefix: '$', value: record.clearedAmount, placeholder: String(s.amount) })}
              ${field({ name: 'note', label: 'Note', type: 'text', value: record.note })}
            </div>
            <div class="button-row form-actions">
              <button class="btn btn--primary btn--small" type="submit">Save</button>
              <button class="btn btn--ghost btn--small" type="button" data-cancel="${date}">Cancel</button>
            </div>
          </form>
        </td></tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No deposits recorded on daily reports in ${monthLabel(month)}. The deposit amount comes from the Cash section of each day.</p>`}
    </section>`;

  const save = async (date, changes) => {
    const record = { ...(records[date] || {}), ...changes, id: date, day: date };
    if (await ctx.saveRecord('deposits', record)) {
      toast(`Deposit for ${shortDate(date)} saved`);
      ctx.rerender();
    }
  };

  ctx.view.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.quick === 'deposited' ? 'depositedOn' : 'clearedOn';
      save(button.dataset.date, { [field]: today });
    });
  });
  ctx.view.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = ctx.view.querySelector(`[data-form-row="${button.dataset.edit}"]`);
      row.hidden = !row.hidden;
    });
  });
  ctx.view.querySelectorAll('[data-cancel]').forEach((button) => {
    button.addEventListener('click', () => { ctx.view.querySelector(`[data-form-row="${button.dataset.cancel}"]`).hidden = true; });
  });
  ctx.view.querySelectorAll('[data-deposit-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const read = (name) => form.elements[name].value.trim();
      if (read('clearedOn') && !read('depositedOn')) return alert('Add the date it was deposited too.');
      save(form.dataset.depositForm, {
        depositedOn: read('depositedOn'),
        slip: read('slip'),
        clearedOn: read('clearedOn'),
        clearedAmount: read('clearedAmount'),
        note: read('note'),
      });
    });
  });
}
