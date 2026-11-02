// Inspections & repairs: daily, weekly, monthly and annual checklists done by station staff,
// and a log of repairs and service calls.

import * as calc from '../calc.js';
import { CHECKLISTS } from './compliance-data.js';
import { fmt, esc, pill, toast, field, selectField, newId, mediumDate, longDate } from '../ui.js';

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'annual'];
const STATUS = [['ok', 'OK'], ['problem', 'Problem'], ['na', 'N/A']];

function equipmentOptions(settings) {
  return [
    ...settings.tanks.map((t) => [`tank:${t.key}`, `${t.product} tank`]),
    ['dispensers', 'Dispensers / nozzles / hoses'],
    ['lines', 'Piping / line leak detectors'],
    ['atg', 'Tank gauge (TLS-350)'],
    ['sumps', 'Sumps / spill buckets'],
    ['cp', 'Cathodic protection'],
    ['pos', 'Register / Commander'],
    ['air', 'Air machine'],
    ['atm', 'ATM'],
    ['coolers', 'Coolers / refrigeration'],
    ['building', 'Building / lights / canopy'],
    ['other', 'Other'],
  ];
}

function checklistPill(status) {
  if (status.state === 'never') return pill('idle', 'Not done yet');
  if (status.state === 'overdue') return pill('bad', `Overdue since ${mediumDate(status.due)}`);
  if (status.state === 'due') return pill('warn', 'Due today');
  return pill('good', `Next due ${mediumDate(status.due)}`);
}

export function inspectionAlerts(logs, today) {
  return FREQUENCIES.filter((f) => CHECKLISTS[f]?.items.length)
    .map((f) => ({ frequency: f, status: calc.checklistStatus(f, logs, today) }))
    .filter(({ frequency, status }) => status.state === 'overdue' || (status.state === 'never' && frequency !== 'annual'));
}

export function renderInspections(ctx) {
  const today = calc.todayInNewYork();
  const logs = ctx.data.inspections.slice().sort((a, b) => b.day.localeCompare(a.day) || (b.savedAt || '').localeCompare(a.savedAt || ''));
  const repairs = ctx.data.maintenance.slice().sort((a, b) => b.day.localeCompare(a.day));
  const equipment = equipmentOptions(ctx.settings);
  const equipmentLabel = (key) => (equipment.find(([k]) => k === key) || [key, key])[1];

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Compliance</p><h1>Inspections &amp; repairs</h1></div>
    </header>
    <p class="intro">Checklists for the inspections station staff do, saved with the date and who did them, so they can be shown to an inspector. Tests and licenses with due dates are on the <a href="#/compliance">Compliance calendar</a>.</p>

    <section class="checklist-cards">
      ${FREQUENCIES.filter((f) => CHECKLISTS[f]?.items.length).map((f) => {
        const c = CHECKLISTS[f];
        const status = calc.checklistStatus(f, logs, today);
        return `<article class="card checklist-card">
          <h2 class="card__title">${esc(c.label)}</h2>
          <p class="card__hint">${esc(c.summary)}</p>
          <p>${checklistPill(status)}</p>
          <p class="muted">${status.last ? `Last done ${mediumDate(status.last)}` : 'No record yet'} · ${c.items.length} items</p>
          <a class="btn btn--primary btn--small" href="#/inspection/new/${f}">Start</a>
        </article>`;
      }).join('')}
    </section>

    <section class="card">
      <h2 class="card__title">Inspection records</h2>
      ${logs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Checklist</th><th>Done by</th><th>Result</th><th></th></tr></thead>
        <tbody>${logs.slice(0, 60).map((l) => {
          const problems = Object.values(l.items || {}).filter((i) => i.status === 'problem').length;
          return `<tr>
            <td>${mediumDate(l.day)}</td>
            <td>${esc(CHECKLISTS[l.template]?.label || l.template)}</td>
            <td>${esc(l.by) || '—'}</td>
            <td>${problems ? pill('bad', `${problems} problem${problems === 1 ? '' : 's'}`) : pill('good', 'All OK')}</td>
            <td class="actions"><a class="link" href="#/inspection/${esc(l.id)}">Open</a></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<p class="empty">No inspections recorded yet.</p>'}
    </section>

    <section class="card">
      <h2 class="card__title">Repairs &amp; service calls</h2>
      <p class="card__hint">Anything fixed, replaced or serviced. Costs here are counted in Monthly profit.</p>
      <form class="inline-form" data-repair-form novalidate>
        <div class="fields">
          ${field({ name: 'day', label: 'Date', type: 'date', value: today })}
          ${selectField({ name: 'equipment', label: 'Equipment', value: 'dispensers', options: equipment })}
          ${field({ name: 'problem', label: 'Problem', type: 'text', wide: true })}
          ${field({ name: 'action', label: 'What was done', type: 'text', wide: true })}
          ${field({ name: 'vendor', label: 'Company / technician', type: 'text' })}
          ${field({ name: 'invoice', label: 'Invoice / work order #', type: 'text' })}
          ${field({ name: 'cost', label: 'Cost', prefix: '$' })}
        </div>
        <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Add to log</button></div>
      </form>
      ${repairs.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Equipment</th><th>Problem</th><th>What was done</th><th>By</th><th class="num">Cost</th><th></th></tr></thead>
        <tbody>${repairs.map((r) => `<tr>
          <td>${mediumDate(r.day)}</td>
          <td>${esc(equipmentLabel(r.equipment))}</td>
          <td>${esc(r.problem)}</td>
          <td>${esc(r.action)}${r.invoice ? `<br><span class="muted">#${esc(r.invoice)}</span>` : ''}</td>
          <td>${esc(r.vendor)}</td>
          <td class="num">${r.cost !== '' && r.cost != null ? fmt.money(Number(r.cost)) : '—'}</td>
          <td class="actions"><button class="btn btn--ghost btn--small" type="button" data-delete-repair="${esc(r.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No repairs logged yet.</p>'}
    </section>`;

  const form = ctx.view.querySelector('[data-repair-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    if (!f.day.value) return alert('Enter the date.');
    if (!f.problem.value.trim() && !f.action.value.trim()) return alert('Describe the problem or what was done.');
    if (f.cost.value.trim() && !Number.isFinite(Number(f.cost.value))) return alert('The cost must be a number.');
    const record = {
      id: newId(), day: f.day.value, equipment: f.equipment.value, problem: f.problem.value.trim(), action: f.action.value.trim(),
      vendor: f.vendor.value.trim(), invoice: f.invoice.value.trim(), cost: f.cost.value.trim(),
    };
    if (await ctx.saveRecord('maintenance', record)) {
      toast('Added to the repair log');
      ctx.rerender();
    }
  });
  ctx.view.querySelectorAll('[data-delete-repair]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this repair from the log?')) return;
      if (await ctx.removeRecord('maintenance', button.dataset.deleteRepair)) {
        toast('Deleted');
        ctx.rerender();
      }
    });
  });
}

// One checklist: a new one (`frequency`) or a saved one (`id`). Printable.
export function renderInspection(ctx, { frequency, id }) {
  const existing = id ? ctx.data.inspections.find((l) => l.id === id) : null;
  if (id && !existing) {
    ctx.view.innerHTML = '<section class="card"><p class="empty">That inspection record doesn\'t exist. <a href="#/inspections">Back to inspections</a>.</p></section>';
    return;
  }
  const template = existing?.template || frequency;
  const checklist = CHECKLISTS[template];
  if (!checklist) {
    location.replace('#/inspections');
    return;
  }
  const today = calc.todayInNewYork();
  const record = existing || { id: newId(), day: today, template, by: '', items: {}, notes: '' };
  // Saved records keep the wording they were done with, even if the checklist changes later.
  const items = existing?.itemsText || checklist.items;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <div class="toolbar no-print">
      <a class="btn btn--ghost" href="#/inspections">All inspections</a>
      <span class="toolbar__spacer"></span>
      <button class="btn btn--ghost" type="button" data-print>Print or save PDF</button>
    </div>
    <form class="sheet inspection" data-inspection-form novalidate>
      <header class="report__head">
        <img src="assets/logo.webp" alt="" width="960" height="251">
        <div>
          <h1>${esc(checklist.title)}</h1>
          <p>${esc(ctx.settings.facility.name)} · ${esc(ctx.settings.facility.address)}${ctx.settings.facility.pbsNumber ? ` · PBS ${esc(ctx.settings.facility.pbsNumber)}` : ''}</p>
        </div>
      </header>
      <p class="muted inspection__intro">${esc(checklist.intro)}</p>
      <div class="fields inspection__meta">
        ${field({ name: 'day', label: 'Date', type: 'date', value: record.day })}
        ${field({ name: 'by', label: 'Inspected by', type: 'text', value: record.by })}
      </div>
      <p class="print-only">Date: ${longDate(record.day)} · Inspected by: ${esc(record.by) || '______________________'}</p>
      <table class="table inspection__table">
        <thead><tr><th>#</th><th>Check</th><th>Result</th><th>Notes / action taken</th></tr></thead>
        <tbody>${items.map((item, i) => {
          const value = record.items?.[item.key] || {};
          return `<tr>
            <td>${i + 1}</td>
            <td>${esc(item.text)}${item.hint ? `<br><span class="muted">${esc(item.hint)}</span>` : ''}</td>
            <td class="inspection__result">${STATUS.map(([v, label]) => `<label class="seg"><input type="radio" name="item.${esc(item.key)}" value="${v}"${value.status === v ? ' checked' : ''}><span>${label}</span></label>`).join('')}</td>
            <td><input class="inspection__note" type="text" name="note.${esc(item.key)}" value="${esc(value.note)}" aria-label="Notes for item ${i + 1}"></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <label class="fld fld--wide"><span class="fld__label">Other notes</span><textarea name="notes" rows="3">${esc(record.notes)}</textarea></label>
      ${record.notes ? `<p class="print-only">Other notes: ${esc(record.notes)}</p>` : ''}
      <p class="print-only inspection__sign">Signature: ______________________________</p>
      <div class="savebar no-print">
        <span class="savebar__status" data-status>${existing ? 'Saved' : 'Not saved yet'}</span>
        <button class="btn btn--ghost" type="button" data-all-ok>Mark the rest OK</button>
        <button class="btn btn--primary" type="submit">Save inspection</button>
      </div>
    </form>`;

  const form = ctx.view.querySelector('[data-inspection-form]');
  ctx.view.querySelector('[data-print]').addEventListener('click', () => window.print());
  form.addEventListener('input', () => {
    ctx.markUnsaved();
    const status = form.querySelector('[data-status]');
    status.textContent = 'Unsaved changes';
    status.classList.add('is-unsaved');
  });
  form.querySelector('[data-all-ok]').addEventListener('click', () => {
    for (const item of items) {
      const group = form.querySelectorAll(`[name="item.${CSS.escape(item.key)}"]`);
      if (![...group].some((r) => r.checked)) group[0].checked = true;
    }
    form.dispatchEvent(new Event('input'));
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = form.elements;
    if (!f.day.value) return alert('Enter the date of the inspection.');
    if (!f.by.value.trim()) return alert('Enter who did the inspection.');
    const answers = {};
    const unanswered = [];
    items.forEach((item, i) => {
      const checked = form.querySelector(`[name="item.${CSS.escape(item.key)}"]:checked`);
      const note = form.querySelector(`[name="note.${CSS.escape(item.key)}"]`).value.trim();
      if (!checked) unanswered.push(i + 1);
      if (checked?.value === 'problem' && !note) answers[item.key] = { status: 'problem', note: '' };
      else answers[item.key] = { status: checked?.value || '', note };
    });
    if (unanswered.length) return alert(`Answer every item (missing: ${unanswered.join(', ')}).`);
    const missingNotes = items.filter((item) => answers[item.key].status === 'problem' && !answers[item.key].note).map((item) => items.indexOf(item) + 1);
    if (missingNotes.length) return alert(`Write what was found and what was done for each problem (items ${missingNotes.join(', ')}).`);
    const saved = {
      ...record, day: f.day.value, by: f.by.value.trim(), items: answers, notes: f.notes.value.trim(),
      itemsText: items, savedAt: new Date().toISOString(),
    };
    if (await ctx.saveRecord('inspections', saved)) {
      ctx.markUnsaved(false);
      toast('Inspection saved');
      location.hash = `#/inspection/${saved.id}`;
    }
  });
}
