// Compliance calendar: licenses, registrations, tests and inspections with due dates.

import * as calc from '../calc.js';
import { COMPLIANCE_ITEMS, COMPLIANCE_CATEGORIES, COMPLIANCE_QUESTIONS } from './compliance-data.js';
import { esc, pill, toast, field, selectField, newId, mediumDate } from '../ui.js';

const UNITS = [['days', 'days'], ['months', 'months'], ['years', 'years']];
const categoryLabel = (key) => (COMPLIANCE_CATEGORIES.find(([k]) => k === key) || [key, 'Other'])[1];
const everyLabel = (item) => (item.every ? `Every ${item.every} ${Number(item.every) === 1 ? item.unit.replace(/s$/, '') : item.unit}` : 'Date set by the agency');

function statusPill(status) {
  if (status.state === 'overdue') return pill('bad', `Overdue ${-status.days} day${status.days === -1 ? '' : 's'}`);
  if (status.state === 'soon') return pill('warn', status.days === 0 ? 'Due today' : `Due in ${status.days} day${status.days === 1 ? '' : 's'}`);
  if (status.state === 'ok') return pill('good', 'Up to date');
  return pill('idle', 'Add the last date');
}

export function complianceAlerts(items, today) {
  return items.map((item) => ({ item, status: calc.complianceStatus(item, today) }))
    .filter(({ status }) => status.state === 'overdue' || status.state === 'soon');
}

function editForm(item, isNew = false) {
  return `<form class="inline-form" data-edit-item="${esc(item.id)}" novalidate>
    <div class="fields">
      ${field({ name: 'name', label: 'Name', type: 'text', value: item.name, wide: true })}
      ${selectField({ name: 'category', label: 'Category', value: item.category, options: COMPLIANCE_CATEGORIES })}
      ${field({ name: 'every', label: 'Repeats every', value: item.every, placeholder: 'Blank = one-time' })}
      ${selectField({ name: 'unit', label: 'Unit', value: item.unit || 'years', options: UNITS })}
      ${field({ name: 'dueDate', label: 'Next due (override)', type: 'date', value: item.dueDate, hint: 'For dates set by an agency, like a license expiration' })}
      ${field({ name: 'who', label: 'Who does it', type: 'text', value: item.who })}
      ${field({ name: 'agency', label: 'Agency', type: 'text', value: item.agency })}
      ${field({ name: 'record', label: 'Record to keep', type: 'text', value: item.record, wide: true })}
      ${field({ name: 'notes', label: 'Notes', type: 'text', value: item.notes, wide: true })}
    </div>
    <div class="button-row form-actions">
      <button class="btn btn--primary btn--small" type="submit">Save</button>
      <button class="btn btn--ghost btn--small" type="button" data-close>Cancel</button>
      ${isNew ? '' : `<span class="toolbar__spacer"></span>
      <button class="btn btn--danger btn--small" type="button" data-delete-item="${esc(item.id)}">Remove from calendar</button>`}
    </div>
  </form>`;
}

function doneForm(item, today) {
  return `<form class="inline-form" data-done-item="${esc(item.id)}" novalidate>
    <div class="fields">
      ${field({ name: 'date', label: 'Done on', type: 'date', value: today })}
      ${field({ name: 'by', label: 'Done by', type: 'text', placeholder: 'Contractor or person' })}
      ${field({ name: 'note', label: 'Result / reference', type: 'text', placeholder: 'Passed, certificate #, invoice #', wide: true })}
    </div>
    <div class="button-row form-actions">
      <button class="btn btn--primary btn--small" type="submit">Save</button>
      <button class="btn btn--ghost btn--small" type="button" data-close>Cancel</button>
    </div>
  </form>`;
}

export function renderCompliance(ctx) {
  const today = calc.todayInNewYork();
  const items = ctx.data.compliance_items.slice();
  const rows = items.map((item) => ({ item, status: calc.complianceStatus(item, today) }));
  const order = { overdue: 0, soon: 1, unknown: 2, ok: 3 };
  rows.sort((a, b) => order[a.status.state] - order[b.status.state] || (a.status.due || '9').localeCompare(b.status.due || '9') || a.item.name.localeCompare(b.item.name));
  const count = (state) => rows.filter((r) => r.status.state === state).length;
  const missingDefaults = COMPLIANCE_ITEMS.filter((d) => !items.some((i) => i.id === d.key));

  ctx.view.innerHTML = `<div data-compliance-page>
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Compliance</p><h1>Compliance calendar</h1></div>
      <div class="page-head__actions"><button class="btn btn--ghost" type="button" data-add-item>Add an item</button></div>
    </header>
    <p class="intro">Licenses, registrations, tests and inspections with their due dates. Enter when each was last done (or the expiration date) and the dashboard warns you 30 days ahead. Daily, weekly and monthly checks done by staff are under <a href="#/inspections">Inspections &amp; repairs</a>.</p>

    ${items.length ? `<section class="card">
      <div class="tiles">
        <div class="tile"><p class="tile__label">Overdue</p><p class="tile__value">${count('overdue')}</p></div>
        <div class="tile"><p class="tile__label">Due in 30 days</p><p class="tile__value">${count('soon')}</p></div>
        <div class="tile"><p class="tile__label">Need a date</p><p class="tile__value">${count('unknown')}</p></div>
        <div class="tile"><p class="tile__label">Up to date</p><p class="tile__value">${count('ok')}</p></div>
      </div>
    </section>` : ''}

    ${missingDefaults.length ? `<section class="card">
      <h2 class="card__title">${items.length ? 'Items from the standard list you don\'t have' : 'Start with the standard list'}</h2>
      <p class="card__hint">${missingDefaults.length} items that typically apply to a gas station with a store in Farmingdale (Nassau County). Check each one with your tank contractor or the agency; some depend on your equipment.</p>
      <button class="btn btn--primary" type="button" data-load-defaults>Add ${items.length ? 'the missing items' : 'the standard list'}</button>
    </section>` : ''}

    <section class="card">
      <details class="details details--open-top">
        <summary>Questions that decide which items apply (${COMPLIANCE_QUESTIONS.length})</summary>
        <p class="card__hint">Some items only apply depending on your equipment and permits. Answer these with your tank contractor, your registration certificate or the Nassau County Department of Health (516-227-9691), then remove the items that don't apply.</p>
        <ol class="question-list">${COMPLIANCE_QUESTIONS.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
      </details>
    </section>

    <section class="card" data-new-item hidden>
      <h2 class="card__title">Add an item</h2>
      ${editForm({ id: '', name: '', category: 'tanks', every: '', unit: 'years', dueDate: '', who: '', agency: '', record: '', notes: '' }, true)}
    </section>

    ${rows.length ? `<section class="card">
      <div class="table-wrap"><table class="table compliance-table">
        <thead><tr><th>Item</th><th>How often</th><th>Last done</th><th>Next due</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.map(({ item, status }) => `<tr data-row="${esc(item.id)}">
          <td><strong>${esc(item.name)}</strong><br><span class="muted">${esc(categoryLabel(item.category))}${item.who ? ` · ${esc(item.who)}` : ''}${item.agency ? ` · ${esc(item.agency)}` : ''}</span>
            ${item.notes || item.record || item.source ? `<details class="row-details"><summary>Details</summary>
              ${item.notes ? `<p>${esc(item.notes)}</p>` : ''}
              ${item.record ? `<p><strong>Keep:</strong> ${esc(item.record)}</p>` : ''}
              ${item.source ? `<p><a class="link" href="${esc(item.source)}" target="_blank" rel="noopener">Source</a></p>` : ''}
              ${(item.history || []).length ? `<p><strong>History:</strong> ${(item.history || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map((h) => `${mediumDate(h.date)}${h.by ? ` (${esc(h.by)})` : ''}${h.note ? `: ${esc(h.note)}` : ''}`).join(' · ')}</p>` : ''}
            </details>` : ''}</td>
          <td>${esc(everyLabel(item))}</td>
          <td>${status.lastDone ? mediumDate(status.lastDone) : '—'}</td>
          <td>${status.due ? mediumDate(status.due) : '—'}</td>
          <td>${statusPill(status)}</td>
          <td class="actions">
            <button class="btn btn--ghost btn--small" type="button" data-show-done="${esc(item.id)}">Mark done</button>
            <button class="btn btn--ghost btn--small" type="button" data-show-edit="${esc(item.id)}">Edit</button>
          </td>
        </tr>
        <tr class="row-form" data-form-row="${esc(item.id)}" hidden><td colspan="6"></td></tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}
  </div>`;

  const page = ctx.view.querySelector('[data-compliance-page]');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const save = async (item, message) => {
    const record = { ...item, day: calc.complianceStatus(item, today).due || today };
    if (await ctx.saveRecord('compliance_items', record)) {
      toast(message);
      ctx.rerender();
    }
  };
  const readForm = (form) => {
    const f = form.elements;
    return {
      name: f.name.value.trim(), category: f.category.value, every: f.every.value.trim(), unit: f.unit.value,
      dueDate: f.dueDate.value, who: f.who.value.trim(), agency: f.agency.value.trim(), record: f.record.value.trim(), notes: f.notes.value.trim(),
    };
  };
  const openRow = (id, html) => {
    ctx.view.querySelectorAll('[data-form-row]').forEach((r) => { r.hidden = true; });
    const row = ctx.view.querySelector(`[data-form-row="${CSS.escape(id)}"]`);
    row.firstElementChild.innerHTML = html;
    row.hidden = false;
    row.querySelector('input')?.focus();
  };

  ctx.view.querySelector('[data-add-item]').addEventListener('click', () => {
    const box = ctx.view.querySelector('[data-new-item]');
    box.hidden = false;
    box.querySelector('input').focus();
  });
  ctx.view.querySelector('[data-load-defaults]')?.addEventListener('click', async () => {
    let added = 0;
    for (const d of missingDefaults) {
      const { key, ...rest } = d;
      const item = { id: key, ...rest, dueDate: '', history: [] };
      if (await ctx.saveRecord('compliance_items', { ...item, day: today })) added += 1;
    }
    toast(`Added ${added} items`);
    ctx.rerender();
  });

  page.addEventListener('click', (event) => {
    const done = event.target.closest('[data-show-done]');
    const edit = event.target.closest('[data-show-edit]');
    const close = event.target.closest('[data-close]');
    const del = event.target.closest('[data-delete-item]');
    if (done) openRow(done.dataset.showDone, doneForm(byId[done.dataset.showDone], today));
    if (edit) openRow(edit.dataset.showEdit, editForm(byId[edit.dataset.showEdit]));
    if (close) {
      const row = close.closest('[data-form-row]');
      if (row) row.hidden = true;
      else ctx.view.querySelector('[data-new-item]').hidden = true;
    }
    if (del) {
      const item = byId[del.dataset.deleteItem];
      if (!confirm(`Remove "${item.name}" from the calendar? Its history goes with it.`)) return;
      ctx.removeRecord('compliance_items', item.id).then((ok) => { if (ok) { toast('Removed'); ctx.rerender(); } });
    }
  });

  page.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.matches('[data-done-item]')) {
      const item = byId[form.dataset.doneItem];
      const f = form.elements;
      if (!f.date.value) return alert('Enter the date it was done.');
      const history = [...(item.history || []), { date: f.date.value, by: f.by.value.trim(), note: f.note.value.trim() }];
      // A new completion replaces any fixed due date; the next one is counted from it.
      await save({ ...item, history, dueDate: item.every ? '' : item.dueDate }, 'Marked done');
    } else if (form.matches('[data-edit-item]')) {
      const data = readForm(form);
      if (!data.name) return alert('Give the item a name.');
      if (data.every && !Number.isFinite(Number(data.every))) return alert('"Repeats every" must be a number.');
      const id = form.dataset.editItem;
      await save(id ? { ...byId[id], ...data } : { id: newId(), ...data, history: [] }, id ? 'Saved' : 'Added');
    }
  });
}
