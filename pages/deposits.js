// Bank deposits: each day's cash deposit goes from waiting → deposited → cleared by the bank,
// alone or combined with other days in one trip. Card deposits from PDI are matched to each
// day's card batch from an uploaded Flagstar statement (CSV), along with PDI's monthly fee.

import * as calc from '../calc.js';
import * as bank from '../bank.js';
import { fmt, esc, pill, toast, field, newId, mediumDate, shortDate, monthLabel, statTile, usd } from '../ui.js';

let pendingCsv = null; // a parsed statement waiting for the owner to confirm its columns

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

function cardPill(r) {
  switch (r.state) {
    case 'matched': return pill('good', r.match.variant.label === 'Full batch' ? 'Deposited' : r.match.variant.label);
    case 'differs': return pill('bad', `Deposit differs ${fmt.signedMoney(r.match.difference)}`);
    case 'missing': return pill('bad', `No deposit found · ${r.age} days`);
    case 'no-statement': return '<span class="muted">Upload a statement to check</span>';
    default: return pill('idle', 'Waiting for the deposit');
  }
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

// Each day's card batch, with the Amex and fleet parts from the Commander when known.
function batchesFor(ctx, from, to) {
  const out = [];
  for (const date of Object.keys(ctx.days).filter((d) => d >= from && d <= to).sort()) {
    const day = ctx.days[date];
    const c = ctx.cmdr?.days?.[date]?.data;
    const saved = day.register?.batchTotal;
    const total = saved !== '' && saved != null && Number.isFinite(Number(saved)) ? Number(saved) : c?.cards?.batch_total ?? null;
    if (!total) continue;
    const amex = (c?.cards?.by_card || []).filter((x) => /AMEX|AMERICAN EXPRESS/i.test(x.name)).reduce((a, x) => a + x.amount, 0);
    out.push({ date, total: Math.round(total * 100) / 100, amex: Math.round(amex * 100) / 100, fleet: Number(c?.cards?.fleet || 0), card: day.tenders ? Number(day.tenders.credit || 0) + Number(day.tenders.debit || 0) + Number(day.tenders.fleet || 0) : null });
  }
  return out;
}

function csvPreview(csv) {
  const cols = csv.cols;
  const options = (selected) => [['-1', '—'], ...csv.cols.header.map((h, i) => [String(i), h || `Column ${i + 1}`])]
    .map(([v, t]) => `<option value="${v}"${String(selected) === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const lines = bank.toTransactions(csv.rows, cols);
  return `<div class="import-preview">
    <h3 class="card__sub">${esc(csv.fileName)}: ${lines.length} line${lines.length === 1 ? '' : 's'} read${lines.length ? `, ${mediumDate(lines[0].day)} – ${mediumDate(lines.at(-1).day)}` : ''}</h3>
    <p class="card__hint">Check that the columns are right, then save. Uploading the same statement again doesn't add anything twice.</p>
    <div class="fields" data-csv-cols>
      ${['date', 'description', 'amount', 'credit', 'debit'].map((k) => `<label class="fld"><span class="fld__label">${{ date: 'Date', description: 'Description', amount: 'Amount (+/−)', credit: 'Or: money in', debit: 'Or: money out' }[k]}</span><span class="fld__control"><select data-col="${k}">${options(cols[k])}</select></span></label>`).join('')}
    </div>
    ${lines.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines.slice(0, 6).map((l) => `<tr><td>${mediumDate(l.day)}</td><td>${esc(l.description)}</td><td class="num${l.amount < 0 ? ' is-bad-text' : ''}">${fmt.signedMoney(l.amount)}</td></tr>`).join('')}</tbody></table></div>` : `<p>${pill('bad', 'Nothing read')} Pick the date and amount columns above.</p>`}
    <div class="button-row form-actions">
      ${lines.length ? '<button class="btn btn--primary" type="button" data-csv-save>Save statement</button>' : ''}
      <button class="btn btn--ghost" type="button" data-csv-cancel>Cancel</button>
    </div>
  </div>`;
}

export function renderDeposits(ctx, monthParam) {
  const { settings, days } = ctx;
  const today = calc.todayInNewYork();
  const month = monthParam || today.slice(0, 7);
  const { start, end } = calc.monthBounds(month);
  const records = Object.fromEntries(ctx.data.deposits.map((r) => [r.id, r]));
  const prefs = { ...bank.DEFAULT_BANK_SETTINGS, ...(records[bank.SETTINGS_ID] || {}) };
  const lines = ctx.data.deposits.filter((r) => r.id.startsWith(bank.BANK_PREFIX) && r.id !== bank.SETTINGS_ID);
  const groupOf = (date) => calc.depositGroup(records[date], records, days);
  const status = (date) => calc.depositState(date, days[date], records[date], settings, today, groupOf(date));

  const rows = Object.keys(days).filter((d) => d >= start && d <= end).sort().reverse()
    .map((date) => ({ date, record: records[date] || {}, s: status(date), group: groupOf(date) }))
    .filter((r) => r.s.state !== 'none');

  // Totals across every day, not just this month, so nothing gets lost between months.
  const all = Object.keys(days).map((date) => status(date));
  const sum = (states) => all.filter((s) => states.includes(s.state)).reduce((a, s) => a + s.amount, 0);
  const problems = all.filter((s) => ['overdue', 'late', 'mismatch'].includes(s.state)).length;

  // Cash the bank shows that could clear a deposit still in transit.
  const inTransit = [];
  const seenGroups = new Set();
  for (const date of Object.keys(days)) {
    const s = status(date);
    if (!['transit', 'late'].includes(s.state)) continue;
    if (s.group) {
      if (seenGroups.has(s.group.id)) continue;
      seenGroups.add(s.group.id);
      inTransit.push({ key: s.group.id, label: `${s.group.days.map(shortDate).join(' + ')} (combined)`, amount: s.group.total, depositedOn: s.group.depositedOn });
    } else {
      inTransit.push({ key: date, label: mediumDate(date), amount: s.amount, depositedOn: records[date]?.depositedOn || date });
    }
  }
  const suggestions = bank.cashSuggestions(inTransit, lines, prefs);

  // Card deposits for this month (batches up to five days into next month still match).
  const cardRows = bank.matchCardDeposits(batchesFor(ctx, start, end), lines, prefs, today).reverse();
  const fees = bank.processorFees(lines, prefs).filter((l) => l.day >= start && l.day <= end);
  const lastMonth = calc.monthBounds(calc.previousMonth(month));
  const lastMonthCards = batchesFor(ctx, lastMonth.start, lastMonth.end).reduce((a, b) => a + b.total, 0);
  const feeTotal = -fees.reduce((a, l) => a + l.amount, 0);
  const statementRange = lines.length ? { from: lines.map((l) => l.day).sort()[0], to: lines.map((l) => l.day).sort().at(-1) } : null;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Bank deposits</h1></div>
      <div class="page-head__actions">
        <a class="btn btn--ghost btn--small" href="#/deposits/${calc.previousMonth(month)}">← Previous</a>
        <a class="btn btn--ghost btn--small" href="#/deposits/${nextMonth(month)}">Next →</a>
      </div>
    </header>

    <section class="card">
      <div class="tiles">
        ${statTile('Cash waiting to deposit', fmt.money(sum(['pending', 'overdue'])))}
        ${statTile('Cash at the bank, not cleared', fmt.money(sum(['transit', 'late'])))}
        ${statTile('Card deposits found', `${cardRows.filter((r) => r.state === 'matched').length} of ${cardRows.length}`, '', monthLabel(month))}
        ${statTile('Need a look', String(problems + cardRows.filter((r) => ['missing', 'differs'].includes(r.state)).length))}
      </div>
      <p class="muted">Cash is flagged when it isn't deposited within ${settings.thresholds.depositDays} days or hasn't cleared ${settings.thresholds.clearDays} days after you deposit it (change in Settings). Card deposits are matched from your bank statement below.</p>
    </section>

    ${suggestions.length ? `<section class="card">
      <h2 class="card__title">The bank shows these deposits</h2>
      <ul class="alerts">${suggestions.map((x) => `<li>${pill('good', 'Match')}<span>${esc(x.label)}: ${fmt.money(x.amount)}, on your statement ${mediumDate(x.line.day)}</span><button class="btn btn--ghost btn--small" type="button" data-clear-from-bank="${esc(x.key)}" data-on="${x.line.day}" data-amount="${x.line.amount}">Mark cleared</button></li>`).join('')}</ul>
    </section>` : ''}

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Cash deposits · ${monthLabel(month)}</h2>
        <span class="muted" data-selection-note>Tick days to deposit them together</span>
      </div>
      <div class="button-row combine-bar" data-combine-bar hidden>
        <span data-combine-total></span>
        ${field({ name: 'combineOn', label: 'Deposited on', type: 'date', value: today })}
        ${field({ name: 'combineSlip', label: 'Deposit slip #', type: 'text' })}
        <button class="btn btn--primary btn--small" type="button" data-combine>Deposit together</button>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th></th><th>Day</th><th class="num">Deposit</th><th>Status</th><th>Deposited</th><th>Cleared</th><th></th></tr></thead>
        <tbody>${rows.map(({ date, record, s, group }) => {
          const target = group ? group.id : date;
          const deposited = group ? group.depositedOn : record.depositedOn;
          const cleared = group ? group.clearedOn : record.clearedOn;
          const slip = group ? group.slip : record.slip;
          const canCombine = !group && !record.depositedOn && ['pending', 'overdue'].includes(s.state);
          return `<tr data-row="${date}">
          <td>${canCombine ? `<input type="checkbox" data-pick="${date}" data-amount="${s.amount}" aria-label="Deposit ${shortDate(date)} with others">` : ''}</td>
          <td><a class="link" href="#/report/${date}">${mediumDate(date)}</a>${group ? `<br><span class="muted">Combined with ${group.days.filter((d) => d !== date).map(shortDate).join(', ')} · ${fmt.money(group.total)}</span>` : ''}</td>
          <td class="num">${fmt.money(s.amount)}</td>
          <td>${statusPill(s)}</td>
          <td>${deposited ? `${shortDate(deposited)}${slip ? ` · #${esc(slip)}` : ''}` : '—'}</td>
          <td>${cleared ? shortDate(cleared) : '—'}</td>
          <td class="actions">${!deposited ? `<button class="btn btn--ghost btn--small" type="button" data-quick="deposited" data-target="${esc(target)}">Deposited today</button>` : !cleared ? `<button class="btn btn--ghost btn--small" type="button" data-quick="cleared" data-target="${esc(target)}">Cleared today</button>` : ''}
            <button class="btn btn--ghost btn--small" type="button" data-edit="${date}">Edit</button></td>
        </tr>
        <tr class="row-form" data-form-row="${date}" hidden><td colspan="7">
          <form class="inline-form" data-deposit-form="${esc(target)}" novalidate>
            ${group ? `<p class="muted">Combined deposit: ${group.days.map(mediumDate).join(', ')}. Changes apply to all of them.</p>` : ''}
            <div class="fields">
              ${field({ name: 'depositedOn', label: 'Deposited on', type: 'date', value: deposited })}
              ${field({ name: 'slip', label: 'Deposit slip #', type: 'text', value: slip })}
              ${field({ name: 'clearedOn', label: 'Cleared by bank on', type: 'date', value: cleared })}
              ${field({ name: 'clearedAmount', label: 'Amount the bank shows', prefix: '$', value: group ? group.clearedAmount : record.clearedAmount, placeholder: String(group ? group.total : s.amount) })}
              ${field({ name: 'note', label: 'Note', type: 'text', value: group ? group.note : record.note })}
            </div>
            <div class="button-row form-actions">
              <button class="btn btn--primary btn--small" type="submit">Save</button>
              <button class="btn btn--ghost btn--small" type="button" data-cancel="${date}">Cancel</button>
              ${group ? `<button class="btn btn--ghost btn--small" type="button" data-split="${esc(group.id)}">Split back into separate days</button>` : ''}
            </div>
          </form>
        </td></tr>`;
        }).join('')}</tbody>
      </table></div>` : `<p class="empty">No cash deposits recorded on daily reports in ${monthLabel(month)}. The deposit amount comes from the Cash section of each day.</p>`}
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Card deposits from PDI · ${monthLabel(month)}</h2>
        <span class="muted">${statementRange ? `Statement lines ${shortDate(statementRange.from)} – ${mediumDate(statementRange.to)}` : 'Upload a statement below'}</span>
      </div>
      ${cardRows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Sales day</th><th class="num">Card batch</th><th class="num">PDI deposit</th><th>Deposited</th><th>Status</th></tr></thead>
        <tbody>${cardRows.map((r) => `<tr>
          <td><a class="link" href="#/report/${r.date}">${mediumDate(r.date)}</a></td>
          <td class="num">${fmt.money(r.total)}${r.amex || r.fleet ? `<br><span class="muted">${r.amex ? `Amex ${fmt.money(r.amex)}` : ''}${r.amex && r.fleet ? ' · ' : ''}${r.fleet ? `fleet ${fmt.money(r.fleet)}` : ''}</span>` : ''}</td>
          <td class="num">${r.match ? fmt.money(r.match.line.amount) : '—'}</td>
          <td>${r.match ? shortDate(r.match.line.day) : '—'}</td>
          <td>${cardPill(r)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No card batches in ${monthLabel(month)}.</p>`}
      <h3 class="card__sub">PDI fees charged in ${monthLabel(month)}</h3>
      ${fees.length ? `<p><strong>${fmt.money(feeTotal)}</strong>${lastMonthCards ? ` = <strong>${fmt.number((feeTotal / lastMonthCards) * 100, 2)}%</strong> of ${monthLabel(calc.previousMonth(month))}'s card sales (${fmt.money(lastMonthCards)})` : ''}. Settings uses ${esc(String(settings.cards?.feePct ?? '—'))}% for profit estimates.</p>
        <ul class="muted">${fees.map((l) => `<li>${mediumDate(l.day)} · ${esc(l.description)} · ${fmt.money(-l.amount)}</li>`).join('')}</ul>` : `<p class="muted">${lines.length ? `No money out with "${esc(prefs.processorMatch)}" in the description this month.` : 'Appears once a statement covering this month is uploaded.'}</p>`}
      <p class="muted">PDI pays each day's batch in one deposit and charges its fees once a month. A deposit that equals the batch less Amex or fleet cards means those cards are paid to you separately.</p>
    </section>

    <section class="card" id="statement">
      <h2 class="card__title">Bank statement (Flagstar)</h2>
      <p class="card__hint">In Flagstar online banking, download your account activity as a CSV file and choose it here. Once a week is plenty. ${lines.length ? `${lines.length} lines saved so far.` : ''}</p>
      <form class="inline-form" data-csv-form novalidate>
        <div class="fields">
          <label class="fld"><span class="fld__label">Statement file (CSV)</span><span class="fld__control"><input type="file" name="file" accept=".csv,text/csv"></span></label>
          ${field({ name: 'processorMatch', label: 'Card deposits contain', type: 'text', value: prefs.processorMatch, hint: 'Text in PDI deposit descriptions' })}
          ${field({ name: 'cashMatch', label: 'Cash deposits contain', type: 'text', value: prefs.cashMatch, hint: 'Text in your branch deposit descriptions' })}
        </div>
        <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Read statement</button><button class="btn btn--ghost" type="button" data-save-prefs>Save matching text</button></div>
      </form>
      <div data-csv-preview></div>
      ${lines.length ? `<details class="details"><summary>What's on the statement (most common descriptions)</summary>
        <ul>${bank.descriptionsSummary(lines).map((x) => `<li>${x.direction === 'in' ? 'In' : 'Out'} · ${esc(x.text)} · ${x.count}×</li>`).join('')}</ul>
        <p class="muted">If PDI's deposits or your branch deposits are described differently, change the matching text above.</p></details>` : ''}
    </section>`;

  // ---- Cash deposits: one day or a combined group ----
  const saveTarget = async (target, changes) => {
    const isGroup = target.startsWith('group-');
    const record = isGroup ? { ...records[target], ...changes } : { ...(records[target] || {}), ...changes, id: target, day: target };
    if (await ctx.saveRecord('deposits', record)) {
      toast(isGroup ? 'Combined deposit saved' : `Deposit for ${shortDate(target)} saved`);
      ctx.rerender();
    }
  };

  ctx.view.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => saveTarget(button.dataset.target, { [button.dataset.quick === 'deposited' ? 'depositedOn' : 'clearedOn']: today }));
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
      saveTarget(form.dataset.depositForm, { depositedOn: read('depositedOn'), slip: read('slip'), clearedOn: read('clearedOn'), clearedAmount: read('clearedAmount'), note: read('note') });
    });
  });
  ctx.view.querySelectorAll('[data-split]').forEach((button) => {
    button.addEventListener('click', async () => {
      const group = records[button.dataset.split];
      if (!group || !confirm(`Split ${group.days.map(shortDate).join(', ')} back into separate deposits?`)) return;
      for (const d of group.days) {
        const { group: _drop, ...rest } = records[d] || {};
        if (!(await ctx.saveRecord('deposits', { ...rest, id: d, day: d, depositedOn: group.depositedOn || '', slip: group.slip || '' }))) return;
      }
      if (await ctx.removeRecord('deposits', group.id)) {
        toast('Split into separate days');
        ctx.rerender();
      }
    });
  });

  // Combine ticked days into one deposit.
  const bar = ctx.view.querySelector('[data-combine-bar]');
  const picks = () => [...ctx.view.querySelectorAll('[data-pick]:checked')];
  ctx.view.querySelectorAll('[data-pick]').forEach((box) => box.addEventListener('change', () => {
    const chosen = picks();
    bar.hidden = chosen.length < 2;
    ctx.view.querySelector('[data-combine-total]').textContent = `${chosen.length} days · ${fmt.money(chosen.reduce((a, b) => a + Number(b.dataset.amount), 0))}`;
  }));
  ctx.view.querySelector('[data-combine]')?.addEventListener('click', async () => {
    const chosenDays = picks().map((b) => b.dataset.pick).sort();
    if (chosenDays.length < 2) return;
    const id = `group-${newId()}`;
    const group = { id, day: chosenDays.at(-1), kind: 'group', days: chosenDays, depositedOn: bar.querySelector('[name="combineOn"]').value || today, slip: bar.querySelector('[name="combineSlip"]').value.trim(), clearedOn: '', clearedAmount: '', note: '' };
    if (!(await ctx.saveRecord('deposits', group))) return;
    for (const d of chosenDays) {
      if (!(await ctx.saveRecord('deposits', { ...(records[d] || {}), id: d, day: d, group: id }))) return;
    }
    toast(`${chosenDays.length} days deposited together`);
    ctx.rerender();
  });

  ctx.view.querySelectorAll('[data-clear-from-bank]').forEach((button) => {
    button.addEventListener('click', () => saveTarget(button.dataset.clearFromBank, { clearedOn: button.dataset.on, clearedAmount: button.dataset.amount }));
  });

  // ---- Bank statement ----
  const form = ctx.view.querySelector('[data-csv-form]');
  const preview = ctx.view.querySelector('[data-csv-preview]');
  const savePrefs = async () => {
    const next = { ...prefs, id: bank.SETTINGS_ID, day: today, processorMatch: form.elements.processorMatch.value.trim() || 'PDI', cashMatch: form.elements.cashMatch.value.trim() || 'DEPOSIT' };
    return ctx.saveRecord('deposits', next);
  };
  ctx.view.querySelector('[data-save-prefs]').addEventListener('click', async () => {
    if (await savePrefs()) { toast('Matching text saved'); ctx.rerender(); }
  });
  const showPreview = () => { preview.innerHTML = pendingCsv ? csvPreview(pendingCsv) : ''; };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = form.elements.file.files[0];
    if (!file) return alert('Choose the CSV file you downloaded from Flagstar.');
    const rows = bank.parseCsv(await file.text());
    const cols = bank.guessColumns(rows);
    if (!cols) return alert("That file doesn't look like a bank statement: no date and amount columns found.");
    pendingCsv = { fileName: file.name, rows, cols };
    showPreview();
  });
  preview.addEventListener('change', (event) => {
    const select = event.target.closest('[data-col]');
    if (!select || !pendingCsv) return;
    pendingCsv.cols = { ...pendingCsv.cols, [select.dataset.col]: Number(select.value) };
    showPreview();
  });
  preview.addEventListener('click', async (event) => {
    if (event.target.closest('[data-csv-cancel]')) { pendingCsv = null; showPreview(); return; }
    if (!event.target.closest('[data-csv-save]') || !pendingCsv) return;
    const button = event.target.closest('[data-csv-save]');
    button.disabled = true;
    const incoming = bank.toTransactions(pendingCsv.rows, pendingCsv.cols);
    const fresh = incoming.filter((l) => !records[l.id]);
    for (const l of fresh) {
      if (!(await ctx.saveRecord('deposits', { ...l, importedAt: new Date().toISOString() }))) { button.disabled = false; return; }
    }
    await savePrefs();
    toast(`${fresh.length} new line${fresh.length === 1 ? '' : 's'} saved${incoming.length - fresh.length ? `, ${incoming.length - fresh.length} already there` : ''}`);
    pendingCsv = null;
    ctx.rerender();
  });
  if (pendingCsv) showPreview();
}
