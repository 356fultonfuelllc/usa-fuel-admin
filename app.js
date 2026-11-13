// USA Fuel & Mart admin dashboard: daily entry, daily reports, 10-day fuel reconciliation.

import { store } from './store.js';
import * as calc from './calc.js';
import { makeSample, makeSampleExtras, SAMPLE_START_COSTS } from './sample.js';
import {
  usd, fmt, longDate, mediumDate, shortDate, slashDate, periodLabel, esc, getPath, setPath,
  pill, toast, field, selectField, attempt, statTile, deltaLine,
} from './ui.js';
import { renderFuel } from './pages/fuel.js';
import { renderDeposits } from './pages/deposits.js';
import { renderAccounts, renderAccount, renderStatement } from './pages/accounts.js';
import { renderWebsite } from './pages/website.js';
import { renderProfit } from './pages/profit.js';
import { renderTrends } from './pages/trends.js';
import { renderItems, renderItemHistory } from './pages/items.js';
import { renderExport } from './pages/export.js';
import { renderCompliance, complianceAlerts } from './pages/compliance.js';
import { renderInspections, renderInspection, inspectionAlerts } from './pages/inspections.js';
import { CHECKLISTS } from './pages/compliance-data.js';

const view = document.getElementById('view');
const cloud = store.mode === 'cloud';

let settings;
let days = {};
let reconNotes = {};
// Records kept in lists (see store.list) plus the website content.
const COLLECTIONS = ['price_changes', 'deposits', 'house_accounts', 'house_charges', 'house_payments', 'expenses', 'compliance_items', 'inspections', 'maintenance', 'item_reports'];
let extra = { ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])), content: {} };
let unsaved = false;
let currentHash = location.hash || '#/';

const sortedDates = () => Object.keys(days).sort();
const hasSample = () => Object.values(days).some((d) => d.sample);

function sampleBanner() {
  return hasSample()
    ? `<div class="banner no-print">${pill('warn', 'Sample data')}<p>These are made-up numbers so you can see how the reports look. Clear them in <a href="#/settings">Settings</a> before you enter real days.</p></div>`
    : '';
}

// Status for a day's cash over/short.
function cashStatus(summary) {
  if (summary.overShort == null) return pill('idle', 'Not counted');
  if (summary.overShort === 0) return pill('good', 'Even');
  const label = `${summary.overShort > 0 ? 'Over' : 'Short'} ${usd.format(Math.abs(summary.overShort))}`;
  return pill(summary.cashFlag ? 'bad' : 'good', label);
}

function paymentsStatus(summary) {
  if (summary.tenderTotal === 0) return pill('idle', 'Not entered');
  return summary.paymentsFlag ? pill('warn', `Off by ${usd.format(Math.abs(summary.salesVsPayments))}`) : pill('good', 'Balanced');
}

function periodStatus(result) {
  if (result.complete) return result.exceeds ? pill('bad', 'Over limit') : pill('good', 'Within limit');
  if (result.daysEntered && result.exceeds) return pill('warn', 'Running over');
  return pill('idle', `${result.daysEntered} of 10 days`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = [
  [/^#\/?$/, renderHome, 'home'],
  [/^#\/day(?:\/(\d{4}-\d{2}-\d{2}))?$/, renderEntry, 'day'],
  [/^#\/days$/, renderDays, 'days'],
  [/^#\/report\/(\d{4}-\d{2}-\d{2})$/, renderReport, 'days'],
  [/^#\/recon$/, renderReconList, 'recon'],
  [/^#\/recon\/(\d{4}-\d{2}-\d{2})$/, renderWorksheets, 'recon'],
  [/^#\/fuel(?:\/(\d{4}-\d{2}))?$/, (month) => renderFuel(ctx, month), 'fuel'],
  [/^#\/deposits(?:\/(\d{4}-\d{2}))?$/, (month) => renderDeposits(ctx, month), 'deposits'],
  [/^#\/accounts$/, () => renderAccounts(ctx), 'accounts'],
  [/^#\/account\/([\w-]+)(?:\/(\d{4}-\d{2}))?$/, (id, month) => renderAccount(ctx, id, month), 'accounts'],
  [/^#\/statement\/([\w-]+)\/(\d{4}-\d{2})$/, (id, month) => renderStatement(ctx, id, month), 'accounts'],
  [/^#\/website$/, () => renderWebsite(ctx), 'website'],
  [/^#\/profit(?:\/(\d{4}-\d{2}))?$/, (month) => renderProfit(ctx, month), 'profit'],
  [/^#\/trends$/, () => renderTrends(ctx), 'trends'],
  [/^#\/items$/, () => renderItems(ctx), 'items'],
  [/^#\/item\/([^/]+)$/, (key) => renderItemHistory(ctx, 'item', decodeURIComponent(key)), 'items'],
  [/^#\/deal\/([^/]+)$/, (key) => renderItemHistory(ctx, 'deal', decodeURIComponent(key)), 'items'],
  [/^#\/export$/, () => renderExport(ctx), 'export'],
  [/^#\/compliance$/, () => renderCompliance(ctx), 'compliance'],
  [/^#\/inspections$/, () => renderInspections(ctx), 'inspections'],
  [/^#\/inspection\/new\/(daily|weekly|monthly|annual)$/, (frequency) => renderInspection(ctx, { frequency }), 'inspections'],
  [/^#\/inspection\/([\w-]+)$/, (id) => renderInspection(ctx, { id }), 'inspections'],
  [/^#\/settings$/, renderSettings, 'settings'],
];

// What the page modules (pages/*.js) get to work with.
const ctx = {
  view,
  store,
  get settings() { return settings; },
  get days() { return days; },
  get data() { return extra; },
  banner: () => sampleBanner(),
  rerender: () => route(),
  markUnsaved(on = true) { unsaved = on; },
  async saveRecord(collection, record) {
    if (!(await attempt(() => store.save(collection, record), "Couldn't save. Nothing was lost on screen; try again."))) return false;
    extra[collection] = [...extra[collection].filter((r) => r.id !== record.id), structuredClone(record)];
    return true;
  },
  async removeRecord(collection, id) {
    if (!(await attempt(() => store.remove(collection, id), "Couldn't delete that."))) return false;
    extra[collection] = extra[collection].filter((r) => r.id !== id);
    return true;
  },
  async saveContent(key, data) {
    if (!(await attempt(() => store.saveContent(key, data), "Couldn't save to the website."))) return false;
    extra.content = { ...extra.content, [key]: structuredClone(data) };
    return true;
  },
};

function route() {
  const hash = location.hash || '#/';
  if (unsaved && hash !== currentHash) {
    if (!confirm('You have unsaved changes. Leave this page without saving?')) {
      history.replaceState(null, '', currentHash);
      return;
    }
    unsaved = false;
  }
  currentHash = hash;
  const match = routes.find(([pattern]) => pattern.test(hash));
  if (!match) {
    location.replace('#/');
    return;
  }
  const [pattern, render, section] = match;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  render(...hash.match(pattern).slice(1));
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Sign-in (only when the dashboard is connected to Supabase)
// ---------------------------------------------------------------------------

function renderLogin(message) {
  document.body.classList.add('is-locked');
  view.innerHTML = `
    <section class="login card">
      <img class="login__logo" src="assets/logo.webp" alt="USA Fuel &amp; Mart" width="960" height="251">
      <h1>Owner sign-in</h1>
      <form data-login-form>
        <input type="text" name="username" value="${esc(store.adminLogin)}" autocomplete="username" hidden>
        <label class="fld"><span class="fld__label">Admin password</span><span class="fld__control"><input type="password" name="password" autocomplete="current-password" required autofocus></span></label>
        <button class="btn btn--primary" type="submit">Sign in</button>
      </form>
      <p class="login__error" role="alert" data-login-error>${esc(message || '')}</p>
    </section>`;

  const form = view.querySelector('[data-login-form]');
  const error = view.querySelector('[data-login-error]');
  const submit = form.querySelector('[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      await store.signIn(form.elements.password.value);
      await start();
    } catch (err) {
      error.textContent = /invalid login credentials/i.test(err.message)
        ? 'Wrong password.'
        : /failed to fetch|network/i.test(err.message)
          ? "Couldn't reach the server. Check your internet connection and try again."
          : /rate limit|too many/i.test(err.message)
            ? 'Too many attempts. Wait a few minutes and try again.'
            : `Couldn't sign in: ${err.message}`;
      submit.disabled = false;
    }
  });
}

// Settings → Change password (while signed in; no email involved).
function renderSetPassword(user) {
  document.body.classList.add('is-locked');
  view.innerHTML = `
    <section class="login card">
      <img class="login__logo" src="assets/logo.webp" alt="USA Fuel &amp; Mart" width="960" height="251">
      <h1>Change your password</h1>
      <form data-password-form>
        <input type="email" name="email" value="${esc(user.email)}" autocomplete="username" hidden>
        <label class="fld"><span class="fld__label">New password</span><span class="fld__control"><input type="password" name="password" autocomplete="new-password" minlength="10" required></span><span class="fld__hint">At least 10 characters. Your browser or password manager can suggest one.</span></label>
        <label class="fld"><span class="fld__label">Type it again</span><span class="fld__control"><input type="password" name="confirm" autocomplete="new-password" minlength="10" required></span></label>
        <button class="btn btn--primary" type="submit">Save password</button>
        <button class="btn btn--ghost" type="button" data-cancel>Cancel</button>
      </form>
      <p class="login__error" role="alert" data-login-error></p>
    </section>`;

  view.querySelector('[data-cancel]').addEventListener('click', () => start());

  const form = view.querySelector('[data-password-form]');
  const error = view.querySelector('[data-login-error]');
  const submit = form.querySelector('[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const { password, confirm: again } = form.elements;
    if (password.value !== again.value) {
      error.textContent = "Those two passwords don't match.";
      return;
    }
    submit.disabled = true;
    try {
      await store.setPassword(password.value);
      toast('Password saved');
      await start();
    } catch (err) {
      error.textContent = `Couldn't save the password: ${err.message}`;
      submit.disabled = false;
    }
  });
}

async function signOut() {
  if (unsaved && !confirm('You have unsaved changes. Sign out anyway?')) return;
  unsaved = false;
  await store.signOut();
  renderLogin('Signed out.');
}

let started = false;

async function start() {
  try {
    if (cloud) {
      const user = await store.currentUser();
      if (!user) return renderLogin();
      if (!(await store.isAdmin())) {
        await store.signOut();
        return renderLogin(`${user.email} isn't on the owner list. Run the last step in admin/SETUP.md.`);
      }
      document.querySelector('[data-user]').textContent = user.email;
    }
    await reload();
  } catch (err) {
    view.innerHTML = `<section class="card"><h1 class="card__title">Couldn't load the dashboard</h1><p>${esc(err.message)}</p><p class="muted">Check your internet connection and reload the page.</p></section>`;
    return;
  }

  document.body.classList.remove('is-locked');
  document.body.classList.toggle('is-cloud', cloud);
  if (!started) {
    started = true;
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', (event) => {
      if (unsaved) event.preventDefault();
    });
    document.querySelector('[data-sign-out]').addEventListener('click', signOut);
  }
  route();
}


// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function windowTotals(from, to) {
  const list = sortedDates().filter((d) => d >= from && d <= to).map((d) => calc.summarizeDay(days[d], settings));
  const sum = (key) => list.reduce((a, s) => a + (s[key] ?? 0), 0);
  return {
    count: list.length,
    cashCounted: list.filter((x) => x.overShort != null).length,
    fuelGallons: sum('fuelGallons'),
    totalSales: sum('totalSales'),
    insideAmount: sum('insideAmount'),
    overShort: sum('overShort'),
  };
}



function attentionItems(today) {
  const items = [];
  const dates = sortedDates();
  const earliest = dates[0] || today;

  // Fuel to order.
  for (const tank of settings.tanks) {
    const o = calc.tankOutlook(tank, days, settings, today);
    if (o.state === 'order') items.push(['bad', `Order ${tank.product.toLowerCase()}: about ${fmt.number(o.estimate)} gal left${o.daysOfSupply != null ? ` (${fmt.number(o.daysOfSupply, 1)} days)` : ''}. Room for ${fmt.number(o.room)} gal.`, '#/fuel', 'Fuel ordering']);
    else if (o.state === 'soon') items.push(['warn', `Order ${tank.product.toLowerCase()} by ${mediumDate(o.reorderDate)}: about ${fmt.number(o.daysOfSupply, 1)} days left.`, '#/fuel', 'Fuel ordering']);
  }
  // Compliance items due within 30 days, and staff checklists that are overdue.
  for (const { item, status } of complianceAlerts(extra.compliance_items, today)) {
    items.push([status.state === 'overdue' ? 'bad' : 'warn', status.state === 'overdue' ? `${item.name} was due ${mediumDate(status.due)}.` : `${item.name} is due ${mediumDate(status.due)}.`, '#/compliance', 'Compliance']);
  }
  for (const { frequency, status } of inspectionAlerts(extra.inspections, today)) {
    const label = CHECKLISTS[frequency].title;
    items.push([frequency === 'daily' ? 'warn' : 'bad', status.state === 'never' ? `No ${label.toLowerCase()} recorded yet.` : `${label} was due ${mediumDate(status.due)}.`, `#/inspection/new/${frequency}`, 'Start it']);
  }

  // Missing days in the last 30 days (only after the first entered day).
  for (let d = calc.addDays(today, -1); d >= earliest && d >= calc.addDays(today, -30); d = calc.addDays(d, -1)) {
    if (!days[d]) items.push(['warn', `No report entered for ${mediumDate(d)}.`, `#/day/${d}`, 'Enter it']);
  }
  for (const d of dates.slice().reverse()) {
    const s = calc.summarizeDay(days[d], settings);
    if (s.cashFlag) items.push(['bad', `Cash ${s.overShort > 0 ? 'over' : 'short'} ${usd.format(Math.abs(s.overShort))} on ${mediumDate(d)}.`, `#/report/${d}`, 'View day']);
    if (s.paymentsFlag) items.push(['warn', `Sales and payments don't match by ${usd.format(Math.abs(s.salesVsPayments))} on ${mediumDate(d)}.`, `#/day/${d}`, 'Check entry']);
  }
  for (const start of calc.periodStarts(settings, today).reverse()) {
    for (const result of calc.reconcilePeriod(start, days, settings)) {
      const note = reconNotes[`${start}:${result.tank.key}`] || {};
      if (result.complete && result.exceeds && !note.cause) {
        items.push(['bad', `${result.tank.product} tank is over the allowable variance for ${periodLabel(start)}. Investigate and record the cause.`, `#/recon/${start}`, 'Open worksheet']);
      }
      if (result.waterFlag && !note.cause) {
        items.push(['warn', `Water rose in the ${result.tank.product.toLowerCase()} tank during ${periodLabel(start)}.`, `#/recon/${start}`, 'Open worksheet']);
      }
    }
  }

  // Deposits and house-account charges from the last 45 days.
  const depositRecords = Object.fromEntries(extra.deposits.map((r) => [r.id, r]));
  for (const d of dates.slice().reverse().filter((x) => x >= calc.addDays(today, -45))) {
    const dep = calc.depositState(d, days[d], depositRecords[d], settings, today);
    const link = `#/deposits/${d.slice(0, 7)}`;
    if (dep.state === 'overdue') items.push(['warn', `The ${usd.format(dep.amount)} from ${mediumDate(d)} hasn't been deposited.`, link, 'Deposits']);
    if (dep.state === 'late') items.push(['warn', `The ${mediumDate(d)} deposit of ${usd.format(dep.amount)} hasn't cleared the bank.`, link, 'Deposits']);
    if (dep.state === 'mismatch') items.push(['bad', `The bank shows ${usd.format(dep.clearedAmount)} for the ${mediumDate(d)} deposit of ${usd.format(dep.amount)}.`, link, 'Deposits']);
    // Other checks that failed in the last 14 days (cash and sales vs payments are listed above).
    if (d >= calc.addDays(today, -14)) {
      for (const c of calc.dayChecks(d, days, settings, { houseCharges: calc.houseChargesOn(d, extra.house_charges) })) {
        if (!c.available || c.ok || c.key === 'cash' || c.key === 'payments') continue;
        const diff = c.unit === 'money' ? usd.format(Math.abs(c.diff)) : `${fmt.number(Math.abs(c.diff))} gal`;
        const link = c.key === 'house' ? '#/accounts' : `#/day/${d}`;
        items.push([c.key.startsWith('delivery') || c.key.startsWith('tank') ? 'bad' : 'warn', `${c.label} is off by ${diff} on ${mediumDate(d)} (${c.a[0]} vs ${c.b[0]}).`, link, c.key === 'house' ? 'Accounts' : 'Check entry']);
      }
    }
  }
  for (const account of extra.house_accounts) {
    const s = calc.accountSummary(account, extra.house_charges, extra.house_payments, settings, today);
    if (s.pastDue > 0) items.push(['bad', `${account.name} is ${usd.format(s.pastDue)} past due.`, `#/account/${account.id}`, 'View account']);
  }
  return items;
}

function renderHome() {
  const today = calc.todayInNewYork();
  const dates = sortedDates();
  const latest = dates.at(-1);
  const todaysDay = days[today];

  let tiles = `<p class="empty">No days entered yet. <a href="#/day/${today}">Enter today's numbers</a>, or load sample data in <a href="#/settings">Settings</a> to look around.</p>`;
  if (latest) {
    const from = calc.addDays(latest, -6);
    const current = windowTotals(from, latest);
    const previous = windowTotals(calc.addDays(from, -7), calc.addDays(latest, -7));
    const comparable = previous.count === 7 ? previous : null;
    const costsByDate = calc.tankCosts(days, settings);
    const margins = dates.filter((d) => d >= from && d <= latest).map((d) => calc.dayMargin(days[d], calc.gradeCosts(costsByDate[d], settings)));
    const fuelProfit = margins.some((m) => m.profit != null) ? margins.reduce((a, m) => a + (m.profit || 0), 0) : null;
    tiles = `<div class="tiles tiles--5">
      ${statTile('Total sales', fmt.moneyCompact(current.totalSales), deltaLine(current.totalSales, comparable?.totalSales))}
      ${statTile('Fuel gallons', fmt.number(current.fuelGallons), deltaLine(current.fuelGallons, comparable?.fuelGallons))}
      ${statTile('Fuel profit', fuelProfit == null ? '—' : fmt.moneyCompact(fuelProfit), '', fuelProfit == null ? (current.fuelGallons ? 'Add fuel costs in Settings or on deliveries' : 'No fuel sales entered yet') : `${fmt.cents(fuelProfit / (current.fuelGallons || 1))} a gallon`)}
      ${statTile('Inside sales', fmt.moneyCompact(current.insideAmount), deltaLine(current.insideAmount, comparable?.insideAmount))}
      ${statTile('Cash over/short', current.cashCounted ? fmt.signedMoney(Math.round(current.overShort * 100) / 100) : '—', '', `${current.cashCounted} of ${current.count} ${current.count === 1 ? 'day' : 'days'} counted`)}
    </div>
    <p class="muted">${current.count === 1 ? `1 day entered: ${shortDate(latest)}.` : `${current.count} days entered between ${shortDate(from)} and ${shortDate(latest)}.`}</p>`;
  }

  const periodStart = calc.periodStartFor(today, settings);
  const period = today >= settings.reconStart ? calc.reconcilePeriod(periodStart, days, settings) : [];
  const items = attentionItems(today);

  const outlook = settings.tanks.map((tank) => calc.tankOutlook(tank, days, settings, today));
  view.innerHTML = `
    ${sampleBanner()}
    <header class="page-head">
      <div><p class="eyebrow">Overview</p><h1>${longDate(today)}</h1></div>
      <div class="page-head__actions">
        ${todaysDay ? `<a class="btn btn--ghost" href="#/report/${today}">Today's report</a>` : ''}
        <a class="btn btn--primary" href="#/day/${today}">${todaysDay ? 'Edit today' : "Enter today's numbers"}</a>
      </div>
    </header>

    <section class="card">
      <h2 class="card__title">Last 7 days</h2>
      ${tiles}
    </section>

    ${outlook.some((o) => o.latest) ? `<section class="card">
      <div class="card__head">
        <h2 class="card__title">Tank levels</h2>
        <a class="link" href="#/fuel">Fuel ordering</a>
      </div>
      <div class="tank-levels">${outlook.map((o) => `<div class="tank-level tank-level--${o.state}">
        <div class="tank-level__head"><strong>${esc(o.tank.product.replace(' unleaded', ''))}</strong>${{ order: pill('bad', 'Order now'), soon: pill('warn', 'Order soon'), ok: pill('good', 'OK'), unknown: pill('idle', 'No reading') }[o.state]}</div>
        <div class="tank-level__bar" role="img" aria-label="${o.latest ? `${Math.round(o.fullPct * 100)}% full` : 'No reading'}"><span style="width:${o.latest ? Math.min(100, Math.round(o.fullPct * 100)) : 0}%"></span><i style="left:${Math.min(100, Math.round(o.reorderAt / (o.capacity || 1) * 100))}%"></i></div>
        <p class="muted">${o.latest ? `${fmt.number(o.estimate)} of ${fmt.number(o.capacity)} gal${o.daysOfSupply != null ? ` · ${fmt.number(o.daysOfSupply, 1)} days` : ''}` : 'No reading yet'}</p>
      </div>`).join('')}</div>
    </section>` : ''}

    <div class="grid-2">
      <section class="card">
        <div class="card__head">
          <h2 class="card__title">Current 10-day period</h2>
          ${period.length ? `<a class="link" href="#/recon/${periodStart}">Open worksheets</a>` : ''}
        </div>
        ${period.length ? `<p class="muted">${periodLabel(periodStart)}</p>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tank</th><th class="num">Over/short</th><th class="num">Allowed</th><th>Status</th></tr></thead>
          <tbody>${period.map((r) => `<tr>
            <td>${esc(r.tank.product)}</td>
            <td class="num">${r.daysEntered ? fmt.signed(r.overShort) : '—'}</td>
            <td class="num">±${fmt.number(r.allowable, 1)}</td>
            <td>${periodStatus(r)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted">Reconciliation periods start on the date set in Settings.</p>'}
      </section>

      <section class="card">
        <h2 class="card__title">Needs attention</h2>
        ${items.length ? `<ul class="alerts">${items.slice(0, 8).map(([tone, text, href, action]) => `<li>${pill(tone, tone === 'bad' ? 'Action' : 'Check')}<span>${esc(text)}</span><a class="link" href="${href}">${action}</a></li>`).join('')}</ul>
          ${items.length > 8 ? `<p class="muted">And ${items.length - 8} more.</p>` : ''}` : `<p>${pill('good', 'All clear')}</p>`}
      </section>
    </div>`;
}

// ---------------------------------------------------------------------------
// Daily entry
// ---------------------------------------------------------------------------

function blankDay(date) {
  const previous = days[calc.addDays(date, -1)];
  return {
    date,
    preparedBy: previous?.preparedBy || '',
    fuel: {},
    // Prices carry over from the last report or the price log; they can be changed.
    prices: calc.defaultPrices(date, days, extra.price_changes),
    driveOffs: {},
    departments: {},
    lottery: {},
    tax: '',
    customers: '',
    counts: {},
    tenders: {},
    // The card batch number counts up by one each day.
    register: { batchNumber: /^\d+$/.test(previous?.register?.batchNumber ?? '') ? String(Number(previous.register.batchNumber) + 1) : '' },
    cash: {},
    payouts: [],
    cashiers: [],
    personal: [],
    // Start inventory is filled in from yesterday's ending volume; it can be changed.
    tanks: Object.fromEntries(settings.tanks.map((t) => {
      const end = calc.endVolume(previous?.tanks?.[t.key], settings);
      return [t.key, { time: previous?.tanks?.[t.key]?.time || '', start: end == null ? '' : String(end), deliveries: [] }];
    })),
    notes: '',
  };
}

// Older days stored one delivery per tank as delivered/cost/ticket; edit them as a list.
function upgradeDraft(draft, date) {
  draft.prices = calc.dayPrices(draft, extra.price_changes, date);
  draft.cashiers ||= [];
  draft.personal ||= [];
  // Older days have one pay outs total; it becomes the first line of the list.
  if (!Array.isArray(draft.payouts)) {
    const old = draft.cash?.payOuts;
    draft.payouts = old !== '' && old != null && Number(old)
      ? [{ to: '', reason: 'other', amount: String(old), note: 'Entered as one total before pay outs were itemized' }]
      : [];
  }
  if (draft.cash) delete draft.cash.payOuts;
  for (const tank of settings.tanks) {
    const reading = (draft.tanks ||= {})[tank.key] ||= {};
    if (!Array.isArray(reading.deliveries)) {
      reading.deliveries = calc.deliveriesOf(reading).map((d) => ({ ...d }));
      delete reading.delivered;
      delete reading.cost;
      delete reading.ticket;
    }
  }
  return draft;
}

const signedMoneyOrGal = (v, unit) => (unit === 'money' ? fmt.signedMoney(v) : `${fmt.signed(v)} gal`);
const moneyOrGal = (v, unit) => (unit === 'money' ? fmt.money(v) : `${fmt.number(v)} gal`);

// One line per check: the two numbers, the difference, and red when outside tolerance.
function checkRows(checks) {
  if (!checks.length) return '<p class="muted">Checks appear as you enter numbers.</p>';
  return `<ul class="check-list">${checks.map((c) => `<li class="check-row${c.available && !c.ok ? ' is-bad' : ''}">
    <div class="check-row__head"><span>${esc(c.label)}</span>${!c.available ? pill('idle', 'Waiting') : c.ok ? pill('good', c.diff ? signedMoneyOrGal(c.diff, c.unit) : 'Matches') : pill('bad', signedMoneyOrGal(c.diff, c.unit))}</div>
    <p>${esc(c.a[0])} ${moneyOrGal(c.a[1], c.unit)} · ${esc(c.b[0])} ${c.b[1] == null ? '—' : moneyOrGal(c.b[1], c.unit)}${c.available ? ` · difference ${signedMoneyOrGal(c.diff, c.unit)}` : ''}</p>
    ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
  </li>`).join('')}</ul>`;
}

const deptHint = (target, extraText = '') => {
  const list = calc.deptsFor(target, settings).map((m) => [m.number, m.name].filter(Boolean).join(' ')).join(', ');
  return [list ? `Commander ${list}` : '', extraText].filter(Boolean).join('. ');
};

function deliveryRows(tank, deliveries) {
  const base = `tanks.${tank.key}.deliveries`;
  return deliveries.map((d, i) => `<div class="delivery" data-delivery="${i}">
    <p class="delivery__title">Delivery ${i + 1}</p>
    <div class="fields fields--tank">
      ${field({ name: `${base}.${i}.invoiceGallons`, label: 'Invoice gallons', suffix: 'gal', value: d.invoiceGallons })}
      ${field({ name: `${base}.${i}.measured`, label: 'TLS measured increase', suffix: 'gal', value: d.measured, hint: 'TLS-350 delivery report' })}
      ${field({ name: `${base}.${i}.cost`, label: 'Landed cost / gal', prefix: '$', value: d.cost, hint: 'Incl. taxes and freight' })}
      ${field({ name: `${base}.${i}.ticket`, label: 'Ticket / BOL #', type: 'text', value: d.ticket })}
    </div>
    <button class="btn btn--ghost btn--small" type="button" data-remove-delivery="${tank.key}:${i}">Remove delivery</button>
  </div>`).join('');
}

function personalRows(rows) {
  return rows.map((p, i) => `<div class="personal-row" data-personal="${i}">
    ${selectField({ name: `personal.${i}.grade`, label: 'Grade', value: p.grade || 'regular', options: calc.GRADES.map((g) => [g.key, g.label]) })}
    ${field({ name: `personal.${i}.gallons`, label: 'Gallons', suffix: 'gal', value: p.gallons })}
    ${field({ name: `personal.${i}.amount`, label: 'Pump $', prefix: '$', value: p.amount, hint: calc.personalMode(p) === 'off' ? 'Not needed' : 'What the pump/register shows' })}
    ${field({ name: `personal.${i}.note`, label: 'Vehicle / note', type: 'text', value: p.note })}
    <div class="personal-row__mode">${selectField({ name: `personal.${i}.mode`, label: 'How it was handled', value: calc.personalMode(p), options: calc.PERSONAL_MODES })}</div>
    <button class="btn btn--ghost btn--small" type="button" data-remove-personal="${i}" aria-label="Remove personal fuel ${i + 1}">Remove</button>
  </div>`).join('');
}

function payoutRows(rows) {
  return rows.map((p, i) => `<div class="payout-row" data-payout="${i}">
    ${field({ name: `payouts.${i}.to`, label: 'Paid to', type: 'text', value: p.to, placeholder: 'Who got the cash', attrs: 'list="payee-list"' })}
    ${selectField({ name: `payouts.${i}.reason`, label: 'What for', value: p.reason || 'other', options: calc.PAYOUT_REASONS })}
    ${field({ name: `payouts.${i}.amount`, label: 'Amount', prefix: '$', value: p.amount })}
    ${field({ name: `payouts.${i}.note`, label: 'Invoice # / note', type: 'text', value: p.note })}
    <button class="btn btn--ghost btn--small" type="button" data-remove-payout="${i}" aria-label="Remove pay out ${i + 1}">Remove</button>
  </div>`).join('');
}

// Everyone paid out before, so names autocomplete the same way each time.
function payeeOptions() {
  const names = new Set();
  for (const day of Object.values(days)) for (const p of calc.payoutList(day)) if (p.to) names.add(p.to);
  return [...names].sort((a, b) => a.localeCompare(b)).map((n) => `<option value="${esc(n)}"></option>`).join('');
}

function cashierRows(cashiers) {
  return cashiers.map((c, i) => `<div class="cashier-row" data-cashier="${i}">
    ${field({ name: `cashiers.${i}.name`, label: 'Cashier', type: 'text', value: c.name })}
    ${field({ name: `cashiers.${i}.safeDrops`, label: 'Safe drops', prefix: '$', value: c.safeDrops })}
    ${field({ name: `cashiers.${i}.overShort`, label: 'Over/short', prefix: '$', value: c.overShort })}
    ${field({ name: `cashiers.${i}.voids`, label: 'Voids', value: c.voids })}
    ${field({ name: `cashiers.${i}.refunds`, label: 'Refunds', prefix: '$', value: c.refunds })}
    ${field({ name: `cashiers.${i}.noSales`, label: 'No-sales', value: c.noSales })}
    <button class="btn btn--ghost btn--small" type="button" data-remove-cashier="${i}" aria-label="Remove cashier ${i + 1}">Remove</button>
  </div>`).join('');
}

function renderEntry(dateParam) {
  const date = dateParam || calc.todayInNewYork();
  const exists = Boolean(days[date]);
  const draft = upgradeDraft(exists ? structuredClone(days[date]) : blankDay(date), date);
  const value = (path) => getPath(draft, path);
  const tc = settings.volumeBasis === 'tc';
  const endKey = tc ? 'endTc' : 'endGallons';
  const inside = settings.departments.filter((d) => (d.type || 'inside') === 'inside');
  const passthrough = settings.departments.filter((d) => d.type === 'passthrough');
  const tenders = calc.tenderTypes(settings, draft);

  const tankCards = settings.tanks.map((tank) => {
    const base = `tanks.${tank.key}`;
    return `<fieldset class="tank">
      <legend>${esc(tank.product)} <span class="muted">Tank ${esc(tank.tankId)} · ${fmt.number(tank.capacity)} gal</span></legend>
      <div class="fields fields--tank">
        ${field({ name: `${base}.time`, label: 'Reading time', type: 'time', value: value(`${base}.time`) })}
        ${field({ name: `${base}.start`, label: 'Start inventory', suffix: 'gal', value: value(`${base}.start`), placeholder: 'Required', hint: "Filled from yesterday's end" })}
      </div>
      <div class="deliveries" data-deliveries="${tank.key}">${deliveryRows(tank, value(`${base}.deliveries`))}</div>
      <button class="btn btn--ghost btn--small" type="button" data-add-delivery="${tank.key}">Add delivery</button>
      <div class="fields fields--tank tank__end">
        ${field({ name: `${base}.${endKey}`, label: tc ? 'End volume (TC)' : 'End volume (gross)', suffix: 'gal', value: value(`${base}.${endKey}`), hint: tc ? 'TLS-350 inventory: TC Volume' : 'TLS-350 inventory: Volume' })}
        ${field({ name: `${base}.endInches`, label: 'End height (optional)', suffix: 'in', value: value(`${base}.endInches`) })}
        ${field({ name: `${base}.water`, label: 'Water', suffix: 'in', value: value(`${base}.water`), hint: 'TLS-350 inventory: Water' })}
        ${field({ name: `${base}.pumped`, label: 'Gallons pumped', suffix: 'gal', value: value(`${base}.pumped`), hint: 'Blank uses fuel sales' })}
      </div>
      <p class="tank__line" data-tank-line="${tank.key}"></p>
    </fieldset>`;
  }).join('');

  view.innerHTML = `
    ${sampleBanner()}
    <header class="page-head">
      <div><p class="eyebrow">${exists ? 'Edit day' : 'New day'}</p><h1>${longDate(date)}</h1></div>
      <div class="page-head__actions">
        <label class="date-jump">Go to date <input type="date" value="${date}" data-date-jump></label>
        ${exists ? `<a class="btn btn--ghost" href="#/report/${date}">View report</a>` : ''}
      </div>
    </header>

    <div class="entry">
      <form class="entry__form" data-entry-form novalidate>
        <p class="muted entry__tip">Tab or Enter moves to the next box. Enter on the last box saves the day.</p>
        <section class="card">
          <h2 class="card__title">Fuel sales</h2>
          <p class="card__hint">From the Commander fuel report, by grade. Prices fill in from the last report or the price log; type over them if the pumps were different. Credit follows the cash price until you change it.</p>
          <div class="grade-grid">
            <span class="grade-grid__head">Grade</span><span class="grade-grid__head">Gallons</span><span class="grade-grid__head">Sales</span><span class="grade-grid__head">Cash price</span><span class="grade-grid__head">Credit price</span>
            ${calc.GRADES.map((g) => `
              <span class="grade-grid__label">${g.label}</span>
              ${field({ name: `fuel.${g.key}.gallons`, label: `${g.label} gallons`, suffix: 'gal', value: value(`fuel.${g.key}.gallons`) })}
              ${field({ name: `fuel.${g.key}.amount`, label: `${g.label} sales`, prefix: '$', value: value(`fuel.${g.key}.amount`) })}
              ${field({ name: `prices.cash.${g.key}`, label: `${g.label} cash price`, prefix: '$', value: value(`prices.cash.${g.key}`) })}
              ${field({ name: `prices.credit.${g.key}`, label: `${g.label} credit price`, prefix: '$', value: value(`prices.credit.${g.key}`) })}`).join('')}
          </div>
          <details class="details split-details"${calc.GRADES.some((g) => value(`fuel.${g.key}.cashGallons`)) ? ' open' : ''}>
            <summary>Cash / credit split (optional)</summary>
            <p class="card__hint">Gallons sold at the cash price, from Commander's fuel report by price level. Leave blank to use the estimate shown.</p>
            <div class="fields">
              ${calc.GRADES.map((g) => field({ name: `fuel.${g.key}.cashGallons`, label: `${g.label} at cash price`, suffix: 'gal', value: value(`fuel.${g.key}.cashGallons`) })).join('')}
            </div>
          </details>
          <div class="fields fields--after">
            ${field({ name: 'fuel.manual', label: 'Manual fuel sales', prefix: '$', value: value('fuel.manual'), hint: deptHint('manualFuel') || 'Commander dept 9998' })}
            ${field({ name: 'driveOffs.amount', label: 'Drive-offs', prefix: '$', value: value('driveOffs.amount') })}
            ${field({ name: 'driveOffs.gallons', label: 'Drive-off gallons', suffix: 'gal', value: value('driveOffs.gallons') })}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Personal fuel</h2>
          <p class="card__hint">Fuel you put in your own vehicles. <strong>Rung up, not paid:</strong> it's in the fuel sales above but nobody paid, so it's counted with payments to balance the day and left out of fuel profit. <strong>Rung up and paid:</strong> a normal sale (your card or cash); kept as a record only. <strong>Pumped without the register:</strong> added to the gallons pumped from the tank.</p>
          <div class="personal-list" data-personal-list>${personalRows(draft.personal)}</div>
          <button class="btn btn--ghost btn--small" type="button" data-add-personal>Add personal fuel</button>
        </section>

        <section class="card">
          <h2 class="card__title">Inside sales</h2>
          <p class="card__hint">From the Commander department report. Before tax. Fuel departments and dept 9998 never go here.</p>
          <div class="fields">
            ${inside.map((d) => field({ name: `departments.${d.key}`, label: d.label, prefix: '$', value: value(`departments.${d.key}`), hint: deptHint(d.key) })).join('')}
          </div>
        </section>

        ${passthrough.length ? `<section class="card">
          <h2 class="card__title">Pass-through</h2>
          <p class="card__hint">Money collected that isn't a sale. Not counted in sales, but included when balancing against payments.</p>
          <div class="fields">
            ${passthrough.map((d) => field({ name: `departments.${d.key}`, label: d.label, prefix: '$', value: value(`departments.${d.key}`), hint: deptHint(d.key) })).join('')}
          </div>
        </section>` : ''}

        <section class="card">
          <h2 class="card__title">Lottery</h2>
          <div class="fields">
            ${field({ name: 'lottery.instant', label: 'Scratch-off sales', prefix: '$', value: value('lottery.instant'), hint: deptHint('lottery:instant') })}
            ${field({ name: 'lottery.online', label: 'Draw game sales', prefix: '$', value: value('lottery.online'), hint: deptHint('lottery:online') })}
          </div>
          ${Number(value('lottery.payouts')) ? `<p class="muted">This day was entered before the change: ${fmt.money(Number(value('lottery.payouts')))} paid to winners is still taken out of expected cash.</p>` : ''}
        </section>

        <section class="card">
          <h2 class="card__title">Tax and counts</h2>
          <div class="fields">
            ${field({ name: 'tax', label: 'Sales tax collected', prefix: '$', value: value('tax') })}
            ${field({ name: 'customers', label: 'Customer count', value: value('customers') })}
            ${field({ name: 'counts.noSales', label: 'No-sale count', value: value('counts.noSales') })}
            ${field({ name: 'counts.voids', label: 'Void count', value: value('counts.voids') })}
            ${field({ name: 'counts.refunds', label: 'Refunds', prefix: '$', value: value('counts.refunds') })}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Payments</h2>
          <p class="card__hint">From the Commander summary, by method of payment. Every amount is net, after refunds.</p>
          <div class="fields">
            ${tenders.map((t) => field({ name: `tenders.${t.key}`, label: `${t.label} (net)`, prefix: '$', value: value(`tenders.${t.key}`), hint: t.hint })).join('')}
          </div>
          <h3 class="card__sub">From the register reports</h3>
          <div class="fields">
            ${field({ name: 'register.batchNumber', label: 'Batch number', value: value('register.batchNumber'), hint: "Filled from yesterday's batch + 1" })}
            ${field({ name: 'register.batchTotal', label: 'Card network batch total', prefix: '$', value: value('register.batchTotal') })}
            ${field({ name: 'register.openPrepays', label: 'Open prepays at close', prefix: '$', value: value('register.openPrepays') })}
            ${field({ name: 'register.totalSales', label: 'Commander total sales', prefix: '$', value: value('register.totalSales'), hint: 'Copied from the report, for the cross-check' })}
            ${field({ name: 'register.totalPayments', label: 'Commander total payments', prefix: '$', value: value('register.totalPayments'), hint: 'Copied from the report, for the cross-check' })}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Cash</h2>
          <div class="fields">
            ${field({ name: 'cash.startingBank', label: 'Starting bank', prefix: '$', value: value('cash.startingBank'), placeholder: settings.startingBank === '' ? 'Set in Settings' : String(settings.startingBank), hint: 'From Settings. Type only to override today.' })}
            ${field({ name: 'cash.payIns', label: 'Pay ins', prefix: '$', value: value('cash.payIns') })}
            ${field({ name: 'cash.cashBack', label: 'Debit cash back', prefix: '$', value: value('cash.cashBack'), hint: settings.cashBackNetted ? 'Not subtracted: Settings says the cash total already has it taken out' : '' })}
            ${field({ name: 'cash.safeDrops', label: 'Safe drops total', prefix: '$', value: value('cash.safeDrops') })}
            ${field({ name: 'cash.counted', label: 'Cash counted', prefix: '$', value: value('cash.counted'), hint: 'Drawer plus all safe drops' })}
            ${field({ name: 'cash.deposit', label: 'Bank deposit', prefix: '$', value: value('cash.deposit') })}
          </div>
          <h3 class="card__sub">Pay outs</h3>
          <p class="card__hint">Every bit of cash paid out of the drawer: lottery winners, vendors paid on delivery, supplies, repairs. One line per payment.</p>
          <div class="payouts" data-payouts>${payoutRows(draft.payouts)}</div>
          <datalist id="payee-list">${payeeOptions()}</datalist>
          <div class="button-row payouts__foot">
            <button class="btn btn--ghost btn--small" type="button" data-add-payout>Add pay out</button>
            <span class="muted" data-payout-total></span>
          </div>
          <h3 class="card__sub">By cashier</h3>
          <div class="cashiers" data-cashiers>${cashierRows(draft.cashiers)}</div>
          <button class="btn btn--ghost btn--small" type="button" data-add-cashier>Add cashier</button>
        </section>

        <section class="card">
          <h2 class="card__title">Tank readings</h2>
          <p class="card__hint">From the Veeder-Root TLS-350 inventory report at close, plus any delivery tickets. Using ${tc ? 'temperature-corrected' : 'gross'} volume (change in Settings).</p>
          ${tankCards}
        </section>

        <section class="card">
          <h2 class="card__title">Notes</h2>
          <div class="fields">
            ${field({ name: 'preparedBy', label: 'Prepared by', type: 'text', value: value('preparedBy') })}
          </div>
          <label class="fld fld--wide"><span class="fld__label">Notes</span><textarea name="notes" rows="3">${esc(value('notes'))}</textarea></label>
        </section>

        <div class="savebar">
          <span class="savebar__status" data-save-status>${exists ? 'Saved' : 'Not saved yet'}</span>
          ${exists ? '<button class="btn btn--ghost" type="button" data-delete-day>Delete day</button>' : ''}
          <button class="btn btn--primary" type="submit">Save day</button>
        </div>
      </form>

      <aside class="entry__summary card" data-entry-summary aria-live="polite"></aside>
    </div>`;

  const form = view.querySelector('[data-entry-form]');
  const summaryBox = view.querySelector('[data-entry-summary]');
  const creditGaps = Object.fromEntries(calc.GRADES.map((g) => {
    const gap = Number(value(`prices.credit.${g.key}`)) - Number(value(`prices.cash.${g.key}`));
    return [g.key, value(`prices.credit.${g.key}`) && value(`prices.cash.${g.key}`) && gap > 0 ? gap : 0.1];
  }));
  const status = view.querySelector('[data-save-status]');

  const markUnsaved = () => {
    unsaved = true;
    status.textContent = 'Unsaved changes';
    status.classList.add('is-unsaved');
  };

  function refresh() {
    const s = calc.summarizeDay(draft, settings);
    const payoutTotal = view.querySelector('[data-payout-total]');
    payoutTotal.textContent = s.payouts.length ? `Total paid out ${fmt.money(s.payOuts)} (${s.payouts.length} ${s.payouts.length === 1 ? 'payment' : 'payments'})` : 'No pay outs today';
    const merged = { ...days, [date]: draft };
    const lines = settings.tanks.map((tank) => [tank, calc.tankLine(date, tank, merged, settings), calc.tankRunning(date, tank, merged, settings)]);
    const checks = calc.dayChecks(date, merged, settings, { houseCharges: calc.houseChargesOn(date, extra.house_charges) });

    for (const g of calc.GRADES) {
      const box = view.querySelector(`[name="fuel.${g.key}.cashGallons"]`);
      const untyped = structuredClone(draft);
      if (untyped.fuel?.[g.key]) delete untyped.fuel[g.key].cashGallons;
      const split = calc.priceLevelSplit(untyped, g.key, extra.price_changes, date);
      box.placeholder = split?.cashGallons != null ? `≈ ${fmt.number(split.cashGallons, 1)}` : '';
    }
    for (const [tank, line] of lines) {
      view.querySelector(`[name="tanks.${tank.key}.pumped"]`).placeholder = fmt.number(calc.pumpedFromSales(draft, tank, settings));
      const box = view.querySelector(`[data-tank-line="${tank.key}"]`);
      box.innerHTML = line.start == null
        ? 'Enter the start inventory to calculate this tank.'
        : `Start ${fmt.number(line.start)} + delivered ${fmt.number(line.delivered)} − pumped ${fmt.number(line.pumped)} = book <strong>${fmt.number(line.book)}</strong>${line.end != null ? ` · end ${fmt.number(line.end)} · over/short <strong class="${line.overFlag ? 'is-bad-text' : ''}">${fmt.signed(line.overShort)}</strong>` : ''}${line.waterFlag ? ` ${pill('warn', 'Water rose')}` : ''}`;
    }

    summaryBox.innerHTML = `
      <h2 class="card__title">Day summary</h2>
      <dl class="summary">
        <div><dt>Fuel</dt><dd>${fmt.number(s.fuelGallons, 1)} gal · ${fmt.money(s.fuelAmount)}</dd></div>
        <div><dt>Inside sales</dt><dd>${fmt.money(s.insideAmount)}</dd></div>
        <div><dt>Lottery sales</dt><dd>${fmt.money(s.lotterySales)}</dd></div>
        <div><dt>Sales tax</dt><dd>${fmt.money(s.tax)}</dd></div>
        <div class="summary__total"><dt>Total sales</dt><dd>${fmt.money(s.totalSales)}</dd></div>
        ${s.passthroughAmount ? `<div><dt>Pass-through</dt><dd>${fmt.money(s.passthroughAmount)}</dd></div>` : ''}
        ${s.personalGallons ? `<div><dt>Personal fuel</dt><dd>${fmt.number(s.personalGallons, 1)} gal${s.personalAmount ? ` · ${fmt.money(s.personalAmount)}` : ''}</dd></div>` : ''}
        <div><dt>Payments</dt><dd>${fmt.money(s.tenderTotal)}</dd></div>
      </dl>
      <h3 class="summary__sub">Checks</h3>
      ${checkRows(checks)}
      <h3 class="summary__sub">Tanks over/short</h3>
      <table class="mini-table">
        <thead><tr><th></th><th class="num">Today</th><th class="num">10-day</th><th class="num">Month</th></tr></thead>
        <tbody>${lines.map(([tank, line, run]) => `<tr>
          <th>${esc(tank.product.replace(' unleaded', ''))}</th>
          <td class="num${line.overFlag ? ' is-bad-text' : ''}">${line.overShort != null ? fmt.signed(line.overShort) : '—'}</td>
          <td class="num">${run.period.counted ? fmt.signed(run.period.value) : '—'}</td>
          <td class="num">${run.month.counted ? fmt.signed(run.month.value) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="muted">Gallons. Red when a day is off by more than ${fmt.number(Number(settings.thresholds.tankDailyGallons))}.</p>`;
  }

  form.addEventListener('change', (event) => {
    const match = /^personal\.(\d+)\.mode$/.exec(event.target.name || '');
    if (!match) return;
    delete draft.personal[Number(match[1])].onRegister;
    view.querySelector('[data-personal-list]').innerHTML = personalRows(draft.personal);
    view.querySelector(`[name="personal.${match[1]}.mode"]`).focus();
  });

  form.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.name) return;
    setPath(draft, input.name, input.value);
    // The credit price keeps its gap to the cash price, until it's typed.
    const priceMatch = /^prices\.(cash|credit)\.(\w+)$/.exec(input.name);
    if (priceMatch?.[1] === 'credit') input.dataset.typed = 'yes';
    if (priceMatch?.[1] === 'cash' && input.value !== '' && Number.isFinite(Number(input.value))) {
      const creditBox = view.querySelector(`[name="prices.credit.${priceMatch[2]}"]`);
      if (!creditBox.dataset.typed) {
        creditBox.value = String(Math.round((Number(input.value) + creditGaps[priceMatch[2]]) * 1000) / 1000);
        setPath(draft, creditBox.name, creditBox.value);
      }
    }
    // Fill in the pump $ for personal fuel from the posted credit price, until it's typed.
    const personalMatch = /^personal\.(\d+)\.(gallons|grade)$/.exec(input.name);
    if (personalMatch) {
      const row = draft.personal[Number(personalMatch[1])];
      const amountBox = view.querySelector(`[name="personal.${personalMatch[1]}.amount"]`);
      if (row && amountBox && (row.amount === '' || amountBox.dataset.auto === 'yes')) {
        const price = calc.dayPrices(draft, extra.price_changes, date).credit[row.grade];
        if (price && Number(row.gallons) > 0) {
          row.amount = (Number(row.gallons) * Number(price)).toFixed(2);
          amountBox.value = row.amount;
          amountBox.dataset.auto = 'yes';
        }
      }
    } else if (/^personal\.\d+\.amount$/.test(input.name)) {
      delete input.dataset.auto;
    }
    markUnsaved();
    refresh();
  });

  // Enter moves to the next box, like Tab, so a whole day can be typed without the mouse.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const target = event.target;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || !target.name) return;
    event.preventDefault();
    const boxes = [...form.querySelectorAll('input[name], select[name]')].filter((el) => !el.disabled && el.offsetParent !== null);
    const next = boxes[boxes.indexOf(target) + 1];
    if (next) {
      next.focus();
      next.select?.();
    } else {
      form.requestSubmit();
    }
  });

  form.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-delivery]');
    const remove = event.target.closest('[data-remove-delivery]');
    if (add || remove) {
      const [key, index] = (add ? add.dataset.addDelivery : remove.dataset.removeDelivery).split(':');
      const list = draft.tanks[key].deliveries;
      if (add) list.push({ invoiceGallons: '', measured: '', cost: '', ticket: '' });
      else list.splice(Number(index), 1);
      const tank = settings.tanks.find((t) => t.key === key);
      view.querySelector(`[data-deliveries="${key}"]`).innerHTML = deliveryRows(tank, list);
      if (add) view.querySelector(`[name="tanks.${key}.deliveries.${list.length - 1}.invoiceGallons"]`).focus();
      markUnsaved();
      refresh();
      return;
    }
    const addPersonal = event.target.closest('[data-add-personal]');
    const removePersonal = event.target.closest('[data-remove-personal]');
    if (addPersonal || removePersonal) {
      if (addPersonal) draft.personal.push({ grade: 'regular', gallons: '', amount: '', note: '', mode: 'unpaid' });
      else draft.personal.splice(Number(removePersonal.dataset.removePersonal), 1);
      view.querySelector('[data-personal-list]').innerHTML = personalRows(draft.personal);
      if (addPersonal) view.querySelector(`[name="personal.${draft.personal.length - 1}.gallons"]`).focus();
      markUnsaved();
      refresh();
      return;
    }
    const addPayout = event.target.closest('[data-add-payout]');
    const removePayout = event.target.closest('[data-remove-payout]');
    if (addPayout || removePayout) {
      if (addPayout) draft.payouts.push({ to: '', reason: 'lottery', amount: '', note: '' });
      else draft.payouts.splice(Number(removePayout.dataset.removePayout), 1);
      view.querySelector('[data-payouts]').innerHTML = payoutRows(draft.payouts);
      if (addPayout) view.querySelector(`[name="payouts.${draft.payouts.length - 1}.to"]`).focus();
      markUnsaved();
      refresh();
      return;
    }
    const addCashier = event.target.closest('[data-add-cashier]');
    const removeCashier = event.target.closest('[data-remove-cashier]');
    if (addCashier || removeCashier) {
      if (addCashier) draft.cashiers.push({ name: '', safeDrops: '', overShort: '', voids: '', refunds: '', noSales: '' });
      else draft.cashiers.splice(Number(removeCashier.dataset.removeCashier), 1);
      view.querySelector('[data-cashiers]').innerHTML = cashierRows(draft.cashiers);
      if (addCashier) view.querySelector(`[name="cashiers.${draft.cashiers.length - 1}.name"]`).focus();
      markUnsaved();
      refresh();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    draft.date = date;
    draft.cashiers = draft.cashiers.filter((c) => Object.values(c).some((v) => String(v ?? '').trim() !== ''));
    draft.personal = draft.personal.filter((p) => Number(p.gallons) > 0);
    draft.payouts = draft.payouts.filter((p) => String(p.amount ?? '').trim() !== '' || String(p.to ?? '').trim() !== '');
    const missing = draft.payouts.findIndex((p) => String(p.amount ?? '').trim() === '' || !Number.isFinite(Number(p.amount)));
    if (missing >= 0) {
      alert(`Pay out ${missing + 1}${draft.payouts[missing].to ? ` (${draft.payouts[missing].to})` : ''} needs an amount.`);
      view.querySelector(`[name="payouts.${missing}.amount"]`)?.focus();
      return;
    }
    for (const tank of settings.tanks) {
      draft.tanks[tank.key].deliveries = draft.tanks[tank.key].deliveries.filter((d) => Object.values(d).some((v) => String(v ?? '').trim() !== ''));
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const saved = await attempt(() => store.saveDay(draft), "Couldn't save this day. Your numbers are still on the screen, so try Save again.");
    button.disabled = false;
    if (!saved) return;
    days[date] = structuredClone(draft);
    unsaved = false;
    status.textContent = 'Saved';
    status.classList.remove('is-unsaved');
    toast(`Saved ${mediumDate(date)}`);
    if (!exists) renderEntry(date);
  });

  view.querySelector('[data-delete-day]')?.addEventListener('click', async () => {
    if (!confirm(`Delete everything entered for ${longDate(date)}?`)) return;
    if (!(await attempt(() => store.deleteDay(date), "Couldn't delete this day."))) return;
    delete days[date];
    unsaved = false;
    toast('Day deleted');
    location.hash = '#/days';
  });

  view.querySelector('[data-date-jump]').addEventListener('change', (event) => {
    if (event.target.value) location.hash = `#/day/${event.target.value}`;
  });

  refresh();
}

// ---------------------------------------------------------------------------
// Daily reports list
// ---------------------------------------------------------------------------

function renderDays() {
  const dates = sortedDates().reverse();
  view.innerHTML = `
    ${sampleBanner()}
    <header class="page-head">
      <div><p class="eyebrow">Daily reports</p><h1>All days</h1></div>
      <div class="page-head__actions"><a class="btn btn--primary" href="#/day/${calc.todayInNewYork()}">Enter today's numbers</a></div>
    </header>
    <section class="card">
      ${dates.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th class="num">Fuel gallons</th><th class="num">Total sales</th><th>Payments</th><th>Cash</th><th class="num">Tanks (gal)</th><th></th></tr></thead>
        <tbody>${dates.map((d) => {
          const s = calc.summarizeDay(days[d], settings);
          const tankText = settings.tanks.map((t) => {
            const line = calc.tankLine(d, t, days, settings);
            return line.overShort == null ? '—' : fmt.signed(line.overShort);
          }).join(' / ');
          return `<tr>
            <td><a class="link" href="#/report/${d}">${mediumDate(d)}</a></td>
            <td class="num">${fmt.number(s.fuelGallons)}</td>
            <td class="num">${fmt.money(s.totalSales)}</td>
            <td>${paymentsStatus(s)}</td>
            <td>${cashStatus(s)}</td>
            <td class="num">${tankText}</td>
            <td class="actions"><a class="link" href="#/day/${d}">Edit</a></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="muted">Tanks column: daily over/short for ${settings.tanks.map((t) => esc(t.product.toLowerCase())).join(' / ')}.</p>`
        : `<p class="empty">No days yet. <a href="#/day/${calc.todayInNewYork()}">Enter today's numbers</a>.</p>`}
    </section>`;
}

// ---------------------------------------------------------------------------
// Printable daily report
// ---------------------------------------------------------------------------

function renderReport(date) {
  const day = days[date];
  if (!day) {
    view.innerHTML = `<section class="card"><p class="empty">Nothing entered for ${longDate(date)}. <a href="#/day/${date}">Enter it now</a>.</p></section>`;
    return;
  }
  const s = calc.summarizeDay(day, settings);
  const prices = calc.dayPrices(day, extra.price_changes, date);
  const priceText = (price) => (price ? `$${Number(price).toFixed(3)}` : '—');
  const lastWeek = days[calc.addDays(date, -7)] ? calc.summarizeDay(days[calc.addDays(date, -7)], settings) : null;
  const lines = settings.tanks.map((tank) => [tank, calc.tankLine(date, tank, days, settings), calc.tankRunning(date, tank, days, settings)]);
  const checks = calc.dayChecks(date, days, settings, { houseCharges: calc.houseChargesOn(date, extra.house_charges) });
  const dates = sortedDates();
  const index = dates.indexOf(date);
  const prev = dates[index - 1];
  const next = dates[index + 1];

  const compare = (current, before, money) => {
    if (!before) return '';
    const diff = current - before;
    return `<span class="report-kpi__delta">${diff >= 0 ? '▲' : '▼'} ${money ? usd.format(Math.abs(diff)) : fmt.number(Math.abs(diff))} vs last ${fmt.date(date, { weekday: 'long' })}</span>`;
  };

  view.innerHTML = `
    ${sampleBanner()}
    <div class="toolbar no-print">
      <a class="btn btn--ghost" href="#/days">All days</a>
      <span class="toolbar__spacer"></span>
      ${prev ? `<a class="btn btn--ghost" href="#/report/${prev}">← ${shortDate(prev)}</a>` : ''}
      ${next ? `<a class="btn btn--ghost" href="#/report/${next}">${shortDate(next)} →</a>` : ''}
      <a class="btn btn--ghost" href="#/day/${date}">Edit</a>
      <button class="btn btn--primary" type="button" data-print>Print or save PDF</button>
    </div>

    <article class="sheet report">
      <header class="report__head">
        <img src="assets/logo.webp" alt="" width="960" height="251">
        <div>
          <h1>Daily report</h1>
          <p>${longDate(date)}</p>
          <p class="muted">${esc(settings.facility.name)} · ${esc(settings.facility.address)}</p>
        </div>
        <p class="report__by">Prepared by ${esc(day.preparedBy || '—')}</p>
      </header>

      <div class="report-kpis">
        <div class="report-kpi"><span>Total sales</span><strong>${fmt.money(s.totalSales)}</strong>${compare(s.totalSales, lastWeek?.totalSales, true)}</div>
        <div class="report-kpi"><span>Fuel gallons</span><strong>${fmt.number(s.fuelGallons, 1)}</strong>${compare(s.fuelGallons, lastWeek?.fuelGallons)}</div>
        <div class="report-kpi"><span>Inside sales</span><strong>${fmt.money(s.insideAmount)}</strong>${compare(s.insideAmount, lastWeek?.insideAmount, true)}</div>
        <div class="report-kpi"><span>Cash over/short</span><strong>${fmt.signedMoney(s.overShort)}</strong>${cashStatus(s)}</div>
      </div>

      <div class="report-grid">
        <section class="report-grid__fuel">
          <h2>Fuel sales</h2>
          <table class="table table--report">
            <thead><tr><th>Grade</th><th class="num">Gallons</th><th class="num">Sales</th><th class="num">Avg $/gal</th><th class="num">Cash</th><th class="num">Credit</th></tr></thead>
            <tbody>${s.fuel.map((f) => `<tr><td>${f.label}</td><td class="num">${fmt.number(f.gallons, 3)}</td><td class="num">${fmt.money(f.amount)}</td><td class="num">${f.perGallon ? `$${f.perGallon.toFixed(3)}` : '—'}</td><td class="num">${priceText(prices.cash[f.key])}</td><td class="num">${priceText(prices.credit[f.key])}</td></tr>`).join('')}
              ${s.manualFuel ? `<tr><td>Manual fuel</td><td class="num"></td><td class="num">${fmt.money(s.manualFuel)}</td><td colspan="3"></td></tr>` : ''}</tbody>
            <tfoot><tr><th>Total</th><th class="num">${fmt.number(s.fuelGallons, 3)}</th><th class="num">${fmt.money(s.fuelAmount)}</th><th colspan="3"></th></tr>
              ${s.driveOffAmount || s.driveOffGallons ? `<tr><td>Drive-offs</td><td class="num">${fmt.number(s.driveOffGallons, 3)}</td><td class="num">${fmt.money(s.driveOffAmount)}</td><td colspan="3"></td></tr>` : ''}
              ${calc.personalFuel(day).rows.map((p) => `<tr><td>Personal: ${esc(calc.GRADES.find((g) => g.key === p.grade).label)}${p.note ? ` <span class="muted">(${esc(p.note)})</span>` : ''} <span class="muted">· ${esc(calc.PERSONAL_MODES.find(([k]) => k === calc.personalMode(p))[1].toLowerCase())}</span></td><td class="num">${fmt.number(Number(p.gallons), 3)}</td><td class="num">${calc.personalMode(p) === 'off' ? '—' : fmt.money(Number(p.amount) || 0)}</td><td></td></tr>`).join('')}</tfoot>
          </table>
        </section>

        <section>
          <h2>Inside sales</h2>
          <table class="table table--report">
            <tbody>${s.departments.map((d) => `<tr><td>${esc(d.label)}</td><td class="num">${fmt.money(d.amount)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th>Total inside</th><th class="num">${fmt.money(s.insideAmount)}</th></tr>
              ${s.passthrough.filter((d) => d.amount).map((d) => `<tr><td>${esc(d.label)} <span class="muted">(pass-through)</span></td><td class="num">${fmt.money(d.amount)}</td></tr>`).join('')}</tfoot>
          </table>
        </section>

        <section>
          <h2>Sales summary</h2>
          <table class="table table--report">
            <tbody>
              <tr><td>Fuel</td><td class="num">${fmt.money(s.fuelAmount)}</td></tr>
              <tr><td>Inside sales</td><td class="num">${fmt.money(s.insideAmount)}</td></tr>
              <tr><td>Lottery: scratch-off</td><td class="num">${fmt.money(s.lotteryInstant)}</td></tr>
              <tr><td>Lottery: draw games</td><td class="num">${fmt.money(s.lotteryOnline)}</td></tr>
              <tr><td>Sales tax</td><td class="num">${fmt.money(s.tax)}</td></tr>
            </tbody>
            <tfoot>
              <tr><th>Total sales</th><th class="num">${fmt.money(s.totalSales)}</th></tr>
              <tr><td>Customers · average sale</td><td class="num">${fmt.number(s.customers)} · ${fmt.money(s.averageSale)}</td></tr>
              <tr><td>No-sales · voids · refunds</td><td class="num">${fmt.number(s.noSales)} · ${fmt.number(s.voids)} · ${fmt.money(s.refunds)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Payments (net)</h2>
          <table class="table table--report">
            <tbody>${s.tenders.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${fmt.money(t.amount)}</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><th>Total payments</th><th class="num">${fmt.money(s.tenderTotal)}</th></tr>
              ${s.openPrepays ? `<tr><td>Open prepays at close</td><td class="num">${fmt.money(s.openPrepays)}</td></tr>` : ''}
              <tr><td>Card batch total${day.register?.batchNumber ? ` <span class="muted">(batch ${esc(day.register.batchNumber)})</span>` : ''}</td><td class="num">${fmt.money(s.batchTotal)}</td></tr>
              <tr><td>Commander sales · payments</td><td class="num">${fmt.money(s.commanderSales)} · ${fmt.money(s.commanderPayments)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Cash</h2>
          <table class="table table--report">
            <tbody>
              <tr><td>Starting bank${s.startingBankOverride ? ' (changed today)' : ''}</td><td class="num">${fmt.money(s.startingBank)}</td></tr>
              <tr><td>+ Cash sales</td><td class="num">${fmt.money(s.cashSales)}</td></tr>
              <tr><td>+ Pay ins</td><td class="num">${fmt.money(s.payIns)}</td></tr>
              <tr><td>− Pay outs</td><td class="num">${fmt.money(s.payOuts)}</td></tr>
              ${s.payouts.map((p) => `<tr class="report-subrow"><td>${esc(p.to || 'Not named')} · ${esc(calc.payoutReasonLabel(p.reason))}${p.note ? ` <span class="muted">(${esc(p.note)})</span>` : ''}</td><td class="num">${fmt.money(p.amount)}</td></tr>`).join('')}
              ${s.lotteryPayouts ? `<tr><td>− Lottery winners paid</td><td class="num">${fmt.money(s.lotteryPayouts)}</td></tr>` : ''}
              <tr><td>− Debit cash back${settings.cashBackNetted ? ' (already netted)' : ''}</td><td class="num">${settings.cashBackNetted ? '—' : fmt.money(s.cashBack)}</td></tr>
            </tbody>
            <tfoot>
              <tr><th>Expected cash</th><th class="num">${fmt.money(s.expectedCash)}</th></tr>
              <tr><td>Cash counted${s.safeDrops != null ? ` (safe drops ${fmt.money(s.safeDrops)})` : ''}</td><td class="num">${fmt.money(s.countedCash)}</td></tr>
              <tr><th>Over/short</th><th class="num">${fmt.signedMoney(s.overShort)}</th></tr>
              <tr><td>Bank deposit</td><td class="num">${fmt.money(s.deposit)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Checks</h2>
          <table class="table table--report table--checks">
            <tbody>${checks.length ? checks.map((c) => `<tr class="${c.available && !c.ok ? 'is-bad' : ''}">
              <td>${esc(c.label)}<br><span class="muted">${moneyOrGal(c.a[1], c.unit)} vs ${c.b[1] == null ? '—' : moneyOrGal(c.b[1], c.unit)}</span></td>
              <td class="num">${c.available ? (c.ok && !c.diff ? 'OK' : signedMoneyOrGal(c.diff, c.unit)) : '—'}</td>
            </tr>`).join('') : '<tr><td colspan="2" class="muted">Nothing to check yet.</td></tr>'}</tbody>
          </table>
        </section>

        ${s.cashiers.length ? `<section class="report-grid__wide">
          <h2>By cashier</h2>
          <div class="table-wrap"><table class="table table--report">
            <thead><tr><th>Cashier</th><th class="num">Safe drops</th><th class="num">Over/short</th><th class="num">Voids</th><th class="num">Refunds</th><th class="num">No-sales</th></tr></thead>
            <tbody>${s.cashiers.map((c) => `<tr><td>${esc(c.name) || '—'}</td><td class="num">${c.safeDrops === '' || c.safeDrops == null ? '—' : fmt.money(Number(c.safeDrops))}</td><td class="num">${c.overShort === '' || c.overShort == null ? '—' : fmt.signedMoney(Number(c.overShort))}</td><td class="num">${esc(c.voids) || '—'}</td><td class="num">${c.refunds === '' || c.refunds == null ? '—' : fmt.money(Number(c.refunds))}</td><td class="num">${esc(c.noSales) || '—'}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>` : ''}

        <section class="report-grid__wide">
          <h2>Tank readings</h2>
          <div class="table-wrap"><table class="table table--report">
            <thead><tr><th>Tank</th><th>Time</th><th class="num">Start</th><th class="num">+ Delivered</th><th class="num">− Pumped</th><th class="num">= Book</th><th class="num">End (in)</th><th class="num">End (gal)</th><th class="num">Over/short</th><th class="num">10-day</th><th class="num">Water (in)</th></tr></thead>
            <tbody>${lines.map(([tank, l, run]) => `<tr>
              <td>${esc(tank.product)}${l.deliveries.length ? `<br><span class="muted">${l.deliveries.map((d) => `${d.ticket ? `#${esc(d.ticket)} ` : ''}${fmt.number(Number(d.invoiceGallons) || 0)} gal${d.measured !== '' && d.measured != null ? ` (TLS ${fmt.number(Number(d.measured))})` : ''}${d.cost ? ` @ $${Number(d.cost).toFixed(4)}` : ''}`).join('; ')}</span>` : ''}</td>
              <td>${esc(l.time) || '—'}</td>
              <td class="num">${fmt.number(l.start)}</td>
              <td class="num">${fmt.number(l.delivered)}</td>
              <td class="num">${fmt.number(l.pumped)}</td>
              <td class="num">${fmt.number(l.book)}</td>
              <td class="num">${fmt.number(l.endInches, 2)}</td>
              <td class="num">${fmt.number(l.end)}</td>
              <td class="num${l.overFlag ? ' is-bad-text' : ''}">${fmt.signed(l.overShort)}</td>
              <td class="num">${run.period.counted ? fmt.signed(run.period.value) : '—'}</td>
              <td class="num">${fmt.number(l.water, 2)}${l.waterFlag ? ` ${pill('warn', 'Rose')}` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <p class="muted">${settings.volumeBasis === 'tc' ? 'Temperature-corrected' : 'Gross'} volume. Mid-grade gallons split ${fmt.number(settings.blendRegularPct, 1)}% to the regular tank and ${fmt.number(100 - settings.blendRegularPct, 1)}% to the premium tank.</p>
        </section>

        ${day.notes ? `<section class="report-grid__wide"><h2>Notes</h2><p>${esc(day.notes)}</p></section>` : ''}
      </div>
      <footer class="report__foot">Printed ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</footer>
    </article>`;

  view.querySelector('[data-print]').addEventListener('click', () => window.print());
}

// ---------------------------------------------------------------------------
// 10-day reconciliation
// ---------------------------------------------------------------------------

function renderReconList() {
  const today = calc.todayInNewYork();
  const starts = calc.periodStarts(settings, today).reverse();
  view.innerHTML = `
    ${sampleBanner()}
    <header class="page-head">
      <div><p class="eyebrow">Fuel reconciliation</p><h1>10-day periods</h1></div>
    </header>
    <p class="intro">Each period follows the NYSDEC 10-Day Inventory Reconciliation Worksheet for Metered USTs. The allowable variance is 0.75% of the largest of gallons delivered, gallons pumped or tank volume.</p>
    ${starts.length ? starts.map((start) => {
      const results = calc.reconcilePeriod(start, days, settings);
      return `<section class="card">
        <div class="card__head">
          <h2 class="card__title">${periodLabel(start)}</h2>
          <a class="btn btn--ghost" href="#/recon/${start}">Open worksheets</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tank</th><th class="num">Delivered</th><th class="num">Pumped</th><th class="num">Over/short</th><th class="num">Allowed</th><th>Result</th><th>Water</th></tr></thead>
          <tbody>${results.map((r) => `<tr>
            <td>${esc(r.tank.product)}</td>
            <td class="num">${fmt.number(r.delivered)}</td>
            <td class="num">${fmt.number(r.pumped)}</td>
            <td class="num">${r.daysEntered ? fmt.signed(r.overShort) : '—'}</td>
            <td class="num">±${fmt.number(r.allowable, 1)}</td>
            <td>${periodStatus(r)}</td>
            <td>${r.waterFlag ? pill('warn', 'Rose') : pill('good', 'Steady')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </section>`;
    }).join('') : `<section class="card"><p class="empty">The first period starts ${longDate(settings.reconStart)}. Change it in <a href="#/settings">Settings</a>.</p></section>`}`;
}

function worksheet(result) {
  const { tank, start } = result;
  const key = `${start}:${tank.key}`;
  const note = reconNotes[key] || {};
  const waterAnswer = note.waterAnswer || (result.waterFlag ? 'yes' : 'no');
  const yesNo = (yes) => `<span class="yn"><span class="${yes ? 'is-on' : ''}">YES</span><span class="${yes ? '' : 'is-on'}">NO</span></span>`;
  const missing = result.rows.filter((r) => !r.complete).length;

  return `<article class="sheet worksheet">
    <h2 class="worksheet__title">10-Day Inventory Reconciliation Worksheet for Metered USTs</h2>
    <div class="worksheet__info">
      <p><span>Facility name</span>${esc(settings.facility.name)}</p>
      <p><span>PBS number</span>${esc(settings.facility.pbsNumber) || '<em class="missing">Add in Settings</em>'}</p>
      <p><span>Address</span>${esc(settings.facility.address)}</p>
      <p><span>Tank ID no.</span>${esc(tank.tankId)}</p>
      <p><span>Product stored</span>${esc(tank.product)}</p>
      <p><span>Tank volume</span>${fmt.number(tank.capacity)} gal</p>
    </div>
    <p class="worksheet__period">Inventory record for period from <strong>${slashDate(start)}</strong> to <strong>${slashDate(result.end)}</strong></p>
    ${missing ? `<p class="worksheet__warn no-print">${pill('warn', `${missing} day${missing === 1 ? '' : 's'} incomplete`)} Enter the missing days to finish this worksheet.</p>` : ''}

    <table class="ws-table">
      <thead>
        <tr><th rowspan="2">Day</th><th rowspan="2">Date &amp; time</th><th>Start stick inventory</th><th>Gallons delivered</th><th>Gallons pumped</th><th>Book inventory [A]</th><th colspan="2">End stick inventory [B]</th><th>Daily over (+) or short (−) [B] − [A]</th><th rowspan="2">Water (in)</th></tr>
        <tr><th>(gal)</th><th>(+) (gal)</th><th>(−) (gal)</th><th>(=) (gal)</th><th>(in)</th><th>(gal)</th><th>(gal)</th></tr>
      </thead>
      <tbody>${result.rows.map((r, i) => `<tr class="${r.complete ? '' : 'is-missing'}">
        <td>${i + 1}</td>
        <td>${slashDate(r.date)}${r.time ? ` ${esc(r.time)}` : ''}</td>
        <td>${fmt.number(r.start)}</td>
        <td>${r.entered ? fmt.number(r.delivered) : '—'}</td>
        <td>${fmt.number(r.pumped)}</td>
        <td>${fmt.number(r.book)}</td>
        <td>${fmt.number(r.endInches, 2)}</td>
        <td>${fmt.number(r.end)}</td>
        <td>${fmt.signed(r.overShort)}</td>
        <td>${fmt.number(r.water, 2)}</td>
      </tr>`).join('')}</tbody>
    </table>

    <div class="ws-totals">
      <p><span>Total gallons delivered</span><strong>${fmt.number(result.delivered)}</strong></p>
      <p><span>Total gallons pumped</span><strong>${fmt.number(result.pumped)}</strong></p>
      <p><span>Total tank volume</span><strong>${fmt.number(result.capacity)}</strong></p>
      <p><span>Largest of the three (${result.largestLabel}) × 0.0075 = allowable variance</span><strong>${fmt.number(result.largest)} × 0.0075 = ${fmt.number(result.allowable, 1)}</strong></p>
      <p><span>Total gallons over/short (sign dropped)</span><strong>${fmt.number(Math.abs(result.overShort))} <span class="muted">(${fmt.signed(result.overShort)})</span></strong></p>
    </div>

    <div class="ws-questions">
      <p>Is the total gallons over/short larger than the allowable variance? ${yesNo(result.exceeds)}</p>
      <p>Is there an increase, fluctuation or recurrence of water in the bottom of the tank?
        <span class="no-print"><select data-water-answer="${key}"><option value="no"${waterAnswer === 'no' ? ' selected' : ''}>No</option><option value="yes"${waterAnswer === 'yes' ? ' selected' : ''}>Yes</option></select></span>
        <span class="print-only">${yesNo(waterAnswer === 'yes')}</span>
      </p>
    </div>

    <p class="ws-rule">If either answer is yes, 6 NYCRR Part 613-2.4(a)(2) requires the operator to investigate. If within 48 hours the cause can't be explained by recordkeeping errors, temperature or other factors unrelated to leakage, notify the owner and the NYSDEC Spill Hotline (1-800-457-7362) and take the tank out of service under Part 613-2.6(a) until it's inspected or tested and repaired.</p>

    <div class="ws-explain print-block">
      <h3>Explanation of exceedance of allowable variance</h3>
      <p class="ws-line"><span>Cause determined to be:</span> ${esc(note.cause)}</p>
      <p class="ws-line"><span>Required action taken (inspection, repairs, tests) on ${note.actionDate ? slashDate(note.actionDate) : '____/____/______'}:</span> ${esc(note.action)}</p>
      <p class="ws-line"></p>
      <p class="ws-line"></p>
    </div>

    <div class="ws-explain no-print">
      <h3>Explanation of exceedance of allowable variance</h3>
      <label class="fld fld--wide"><span class="fld__label">Cause determined to be</span><textarea rows="2" data-note="${key}" data-note-field="cause">${esc(note.cause)}</textarea></label>
      <div class="fields">
        <label class="fld"><span class="fld__label">Action taken on</span><span class="fld__control"><input type="date" value="${esc(note.actionDate)}" data-note="${key}" data-note-field="actionDate"></span></label>
      </div>
      <label class="fld fld--wide"><span class="fld__label">Required action taken (inspection, repairs, tests)</span><textarea rows="3" data-note="${key}" data-note-field="action">${esc(note.action)}</textarea></label>
    </div>
  </article>`;
}

function renderWorksheets(start) {
  const results = calc.reconcilePeriod(start, days, settings);
  const today = calc.todayInNewYork();
  const prev = calc.addDays(start, -10);
  const next = calc.addDays(start, 10);

  view.innerHTML = `
    ${sampleBanner()}
    <div class="toolbar no-print">
      <a class="btn btn--ghost" href="#/recon">All periods</a>
      <span class="toolbar__spacer"></span>
      ${prev >= settings.reconStart ? `<a class="btn btn--ghost" href="#/recon/${prev}">← Previous period</a>` : ''}
      ${next <= today ? `<a class="btn btn--ghost" href="#/recon/${next}">Next period →</a>` : ''}
      <button class="btn btn--primary" type="button" data-print>Print or save PDF</button>
    </div>
    <p class="intro no-print">${periodLabel(start)}. One worksheet per tank; printing puts each on its own page. Notes you type below save automatically.</p>
    ${results.map(worksheet).join('')}`;

  view.querySelector('[data-print]').addEventListener('click', () => window.print());

  const saveNote = async (key, fieldName, value) => {
    const [periodStart, tankKey] = key.split(':');
    const note = { ...(reconNotes[key] || {}), [fieldName]: value };
    if (!(await attempt(() => store.saveReconNote(periodStart, tankKey, note), "Couldn't save this worksheet note. What you typed is still in the box, so change it again to retry."))) return;
    reconNotes[key] = note;
    toast('Worksheet note saved');
  };

  view.querySelectorAll('[data-note]').forEach((input) => {
    input.addEventListener('change', () => saveNote(input.dataset.note, input.dataset.noteField, input.value));
  });
  view.querySelectorAll('[data-water-answer]').forEach((select) => {
    select.addEventListener('change', async () => {
      await saveNote(select.dataset.waterAnswer, 'waterAnswer', select.value);
      renderWorksheets(start);
    });
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function renderSettings() {
  const draft = structuredClone(settings);
  const value = (path) => getPath(draft, path);

  view.innerHTML = `
    ${sampleBanner()}
    <header class="page-head"><div><p class="eyebrow">Settings</p><h1>Station setup</h1></div></header>
    <form class="settings" data-settings-form novalidate>
      <section class="card">
        <h2 class="card__title">Facility</h2>
        <p class="card__hint">Printed on every 10-day worksheet. The PBS number is on your NYSDEC Petroleum Bulk Storage registration certificate.</p>
        <div class="fields">
          ${field({ name: 'facility.name', label: 'Facility name', type: 'text', value: value('facility.name') })}
          ${field({ name: 'facility.address', label: 'Address', type: 'text', value: value('facility.address'), wide: true })}
          ${field({ name: 'facility.pbsNumber', label: 'PBS number', type: 'text', value: value('facility.pbsNumber'), placeholder: '1-XXXXXX' })}
          ${field({ name: 'facility.phone', label: 'Station phone', type: 'tel', value: value('facility.phone'), hint: 'Printed on house-account statements' })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Tanks</h2>
        <p class="card__hint">Use the tank ID numbers from your PBS registration. Check the capacities against your tank charts.</p>
        ${draft.tanks.map((t, i) => `<div class="fields fields--row">
          ${field({ name: `tanks.${i}.tankId`, label: 'Tank ID', type: 'text', value: t.tankId })}
          ${field({ name: `tanks.${i}.product`, label: 'Product', type: 'text', value: t.product })}
          ${field({ name: `tanks.${i}.capacity`, label: 'Capacity', suffix: 'gal', value: t.capacity })}
          ${field({ name: `tanks.${i}.startCost`, label: 'Starting cost / gal', prefix: '$', value: t.startCost, hint: 'For fuel already in the tank before your first logged delivery' })}
          ${field({ name: `tanks.${i}.reorderAt`, label: 'Reorder at', suffix: 'gal', value: t.reorderAt ?? '', placeholder: 'Automatic', hint: 'Blank: 2 days of sales past the lead time, at least 10% of the tank' })}
        </div>`).join('')}
        <div class="fields">
          ${field({ name: 'blendRegularPct', label: 'Mid-grade: regular share', suffix: '%', value: value('blendRegularPct') })}
          ${field({ name: 'blendPremiumPct', label: 'Mid-grade: premium share', suffix: '%', value: draft.blendPremiumPct ?? Math.round((100 - Number(draft.blendRegularPct)) * 10) / 10, hint: 'The two must add up to 100. 87 + 93 blended to 89 is 66.7 / 33.3.' })}
          ${field({ name: 'ordering.maxFillPct', label: 'Fill tanks up to', suffix: '% full', value: value('ordering.maxFillPct'), hint: 'Used for how much fits in a delivery' })}
          ${field({ name: 'ordering.leadDays', label: 'Order this far ahead', suffix: 'days', value: value('ordering.leadDays'), hint: 'How long your supplier takes to deliver' })}
          ${selectField({ name: 'volumeBasis', label: 'Tank volume to use', value: draft.volumeBasis, options: [['gross', 'Gross (TLS Volume)'], ['tc', 'Temperature-corrected (TLS TC Volume)']], hint: 'Used everywhere: daily entry, book inventory and the 10-day worksheet. Change it only at the start of a 10-day period.' })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Cash</h2>
        <div class="fields">
          ${field({ name: 'startingBank', label: 'Starting bank', prefix: '$', value: value('startingBank'), hint: 'Cash in the drawer when the day starts. Each day can override it.' })}
          ${selectField({ name: 'cashBackNetted', label: 'Debit cash back', value: draft.cashBackNetted === true || draft.cashBackNetted === 'yes' ? 'yes' : 'no', options: [['no', 'Subtract from cash'], ['yes', 'Already out of cash total']], hint: "Choose the second if Commander's cash total already has cash back taken out" })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Cards and lottery</h2>
        <p class="card__hint">For profit. Your effective card rate is total processing fees ÷ card sales on a monthly statement.</p>
        <div class="fields">
          ${field({ name: 'cards.feePct', label: 'Card processing rate', suffix: '%', value: value('cards.feePct'), placeholder: 'e.g. 2.5' })}
          ${selectField({ name: 'cards.debitPays', label: 'Debit at the pump pays', value: draft.cards.debitPays, options: [['credit', 'The credit price'], ['cash', 'The cash price']] })}
          ${field({ name: 'lottery.commissionPct', label: 'Lottery commission', suffix: '%', value: value('lottery.commissionPct'), hint: 'What NY Lottery pays you on sales' })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Monthly bills</h2>
        <p class="card__hint">Bills that come every month (rent, payroll, utilities, insurance...). One-off costs go on the Monthly profit page. Don't include fuel or store merchandise: their cost is already taken off in fuel profit and the inside margin % below.</p>
        <div class="group-list">
          ${draft.fixedExpenses.map((e, i) => `<div class="group-row">
            ${field({ name: `fixedExpenses.${i}.label`, label: `Bill ${i + 1}`, type: 'text', value: e.label })}
            ${field({ name: `fixedExpenses.${i}.amount`, label: 'Per month', prefix: '$', value: e.amount })}
            <button class="btn btn--ghost btn--small" type="button" data-remove-bill="${i}" aria-label="Remove ${esc(e.label)}">Remove</button>
          </div>`).join('')}
        </div>
        <button class="btn btn--ghost btn--small" type="button" data-add-bill>Add a bill</button>
      </section>

      <section class="card">
        <h2 class="card__title">Reconciliation and alerts</h2>
        <div class="fields">
          ${field({ name: 'reconStart', label: 'First 10-day period starts', type: 'date', value: value('reconStart') })}
          ${field({ name: 'thresholds.cashOverShort', label: 'Flag cash over/short beyond', prefix: '$', value: value('thresholds.cashOverShort') })}
          ${field({ name: 'thresholds.tankDailyGallons', label: 'Flag a tank off by more than', suffix: 'gal/day', value: value('thresholds.tankDailyGallons'), hint: 'Also used for delivery shortfalls. The 10-day worksheet keeps the NYSDEC 0.75% limit.' })}
          ${field({ name: 'thresholds.waterIncrease', label: 'Flag a water rise of', suffix: 'in', value: value('thresholds.waterIncrease') })}
          ${field({ name: 'thresholds.depositDays', label: 'Flag deposits not made within', suffix: 'days', value: value('thresholds.depositDays') })}
          ${field({ name: 'thresholds.clearDays', label: 'Flag deposits not cleared after', suffix: 'days', value: value('thresholds.clearDays') })}
          ${field({ name: 'houseAccounts.termsDays', label: 'House account terms: net', suffix: 'days', value: value('houseAccounts.termsDays') })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Sales groups</h2>
        <p class="card__hint">What you enter each night. Inside groups count as inside sales. Pass-through groups (bottle deposits, house-account payments) are collected but aren't sales. Margin is the share of each sale you keep after the cost of the goods, used for monthly profit.</p>
        <div class="group-list">
          ${draft.departments.map((d, i) => `<div class="group-row">
            ${field({ name: `departments.${i}.label`, label: `Group ${i + 1}`, type: 'text', value: d.label })}
            ${selectField({ name: `departments.${i}.type`, label: 'Type', value: d.type || 'inside', options: [['inside', 'Inside'], ['passthrough', 'Pass-through']] })}
            ${(d.type || 'inside') === 'inside' ? field({ name: `departments.${i}.marginPct`, label: 'Margin', suffix: '%', value: d.marginPct ?? '', placeholder: 'e.g. 30' }) : '<span></span>'}
            <button class="btn btn--ghost btn--small" type="button" data-remove-dept="${i}" aria-label="Remove ${esc(d.label)}">Remove</button>
          </div>`).join('')}
        </div>
        <button class="btn btn--ghost btn--small" type="button" data-add-dept>Add group</button>
      </section>

      <section class="card">
        <h2 class="card__title">Commander department mapping</h2>
        <p class="card__hint">Which Commander departments add up into each box on the nightly entry. Fuel departments and dept 9998 (manual fuel) never count as inside sales.</p>
        ${draft.deptMap.length ? `<div class="map-list">
          ${draft.deptMap.map((m, i) => {
            const targets = calc.mapTargets(draft);
            const target = targets.find((t) => t.key === m.group);
            return `<div class="map-row">
              ${field({ name: `deptMap.${i}.number`, label: 'Dept #', type: 'text', value: m.number })}
              ${field({ name: `deptMap.${i}.name`, label: 'Commander name', type: 'text', value: m.name })}
              ${selectField({ name: `deptMap.${i}.group`, label: 'Goes to', value: m.group, options: [['', 'Choose…'], ...targets.map((t) => [t.key, `${t.label} · ${calc.GROUP_TYPES[t.type]}`])] })}
              <span class="map-row__type">${target ? calc.GROUP_TYPES[target.type] : ''}</span>
              <button class="btn btn--ghost btn--small" type="button" data-remove-map="${i}" aria-label="Remove dept ${esc(m.number)}">Remove</button>
            </div>`;
          }).join('')}
        </div>` : '<p class="empty">No departments mapped yet.</p>'}
        <button class="btn btn--ghost btn--small" type="button" data-add-map>Add department</button>
      </section>

      <section class="card">
        <h2 class="card__title">Payment types</h2>
        <p class="card__hint">Cash, credit, debit, fleet and house accounts are always there. Add the other methods of payment Commander reports.</p>
        <div class="group-list">
          ${draft.paymentTypes.map((t, i) => `<div class="group-row">
            ${field({ name: `paymentTypes.${i}.label`, label: `Payment type ${i + 1}`, type: 'text', value: t.label })}
            <button class="btn btn--ghost btn--small" type="button" data-remove-pay="${i}" aria-label="Remove ${esc(t.label)}">Remove</button>
          </div>`).join('')}
        </div>
        <button class="btn btn--ghost btn--small" type="button" data-add-pay>Add payment type</button>
      </section>

      <div class="savebar">
        <span class="savebar__status" data-save-status>Saved</span>
        <button class="btn btn--primary" type="submit">Save settings</button>
      </div>
    </form>

    ${cloud ? `<section class="card">
      <h2 class="card__title">Your login</h2>
      <p class="card__hint">Signed in as ${esc(document.querySelector('[data-user]').textContent)}.</p>
      <button class="btn btn--ghost" type="button" data-change-password>Change password</button>
    </section>` : ''}

    <section class="card">
      <h2 class="card__title">Data</h2>
      <p class="card__hint">${cloud
        ? 'Saved securely online, and every change to a daily report is kept in its history. A downloaded backup is still a good idea now and then. Restoring a backup adds or replaces days; it never deletes any.'
        : 'Right now your data lives only in this browser on this computer. Download a backup regularly.'}</p>
      <div class="button-row">
        <button class="btn btn--ghost" type="button" data-export>Download backup</button>
        <label class="btn btn--ghost">Restore backup<input type="file" accept="application/json" hidden data-import></label>
        ${cloud ? '' : `<button class="btn btn--ghost" type="button" data-sample>Load sample data</button>
        <button class="btn btn--danger" type="button" data-clear>${hasSample() ? 'Clear sample data' : 'Delete all data'}</button>`}
      </div>
    </section>`;

  const form = view.querySelector('[data-settings-form]');
  const status = view.querySelector('[data-save-status]');
  const markUnsaved = () => {
    unsaved = true;
    status.textContent = 'Unsaved changes';
    status.classList.add('is-unsaved');
  };

  form.addEventListener('input', (event) => {
    if (!event.target.name) return;
    setPath(draft, event.target.name, event.target.value);
    markUnsaved();
  });

  // Rows added or removed in a list re-render the page, keeping what's been typed.
  const listChange = (change) => () => {
    change();
    markUnsaved();
    rerenderKeepingDraft(draft);
  };
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}`;
  view.querySelector('[data-add-dept]').addEventListener('click', listChange(() => draft.departments.push({ key: uid('grp'), label: 'New group', type: 'inside' })));
  view.querySelector('[data-add-map]').addEventListener('click', listChange(() => draft.deptMap.push({ number: '', name: '', group: '' })));
  view.querySelector('[data-add-pay]').addEventListener('click', listChange(() => draft.paymentTypes.push({ key: uid('pay'), label: 'New payment type' })));
  view.querySelectorAll('[data-remove-dept]').forEach((b) => b.addEventListener('click', listChange(() => draft.departments.splice(Number(b.dataset.removeDept), 1))));
  view.querySelectorAll('[data-remove-map]').forEach((b) => b.addEventListener('click', listChange(() => draft.deptMap.splice(Number(b.dataset.removeMap), 1))));
  view.querySelector('[data-add-bill]').addEventListener('click', listChange(() => draft.fixedExpenses.push({ key: uid('bill'), label: '', amount: '' })));
  view.querySelectorAll('[data-remove-bill]').forEach((b) => b.addEventListener('click', listChange(() => draft.fixedExpenses.splice(Number(b.dataset.removeBill), 1))));
  view.querySelectorAll('[data-remove-pay]').forEach((b) => b.addEventListener('click', listChange(() => draft.paymentTypes.splice(Number(b.dataset.removePay), 1))));
  // Keep the two blend shares adding up to 100 as either one is typed.
  form.addEventListener('input', (event) => {
    const other = { blendRegularPct: 'blendPremiumPct', blendPremiumPct: 'blendRegularPct' }[event.target.name];
    if (!other || event.target.value === '') return;
    const rest = Math.round((100 - Number(event.target.value)) * 10) / 10;
    if (Number.isFinite(rest)) {
      form.elements[other].value = rest;
      setPath(draft, other, String(rest));
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const regular = Number(draft.blendRegularPct);
    const premium = Number(draft.blendPremiumPct ?? 100 - regular);
    if (!Number.isFinite(regular) || !Number.isFinite(premium) || Math.abs(regular + premium - 100) > 0.05) {
      return alert('The mid-grade regular and premium shares must add up to 100.');
    }
    if (draft.deptMap.some((m) => (m.number || m.name) && !m.group)) return alert('Choose where each Commander department goes, or remove the empty rows.');
    delete draft.blendPremiumPct;
    draft.tanks.forEach((t) => { t.capacity = Number(t.capacity) || 0; });
    draft.blendRegularPct = regular;
    draft.cashBackNetted = draft.cashBackNetted === true || draft.cashBackNetted === 'yes';
    draft.thresholds.tankDailyGallons = Number(draft.thresholds.tankDailyGallons) || 0;
    draft.deptMap = draft.deptMap.filter((m) => m.number || m.name);
    draft.paymentTypes = draft.paymentTypes.filter((t) => t.label.trim());
    draft.fixedExpenses = draft.fixedExpenses.filter((e) => e.label.trim() || e.amount !== '');
    draft.ordering.maxFillPct = Number(draft.ordering.maxFillPct) || 90;
    draft.ordering.leadDays = Number(draft.ordering.leadDays) || 0;
    draft.thresholds.cashOverShort = Number(draft.thresholds.cashOverShort) || 0;
    draft.thresholds.waterIncrease = Number(draft.thresholds.waterIncrease) || 0;
    draft.thresholds.depositDays = Number(draft.thresholds.depositDays) || 0;
    draft.thresholds.clearDays = Number(draft.thresholds.clearDays) || 0;
    draft.houseAccounts.termsDays = Number(draft.houseAccounts.termsDays) || 15;
    if (!(await attempt(() => store.saveSettings(draft), "Couldn't save settings."))) return;
    settings = structuredClone(draft);
    unsaved = false;
    status.textContent = 'Saved';
    status.classList.remove('is-unsaved');
    toast('Settings saved');
  });

  view.querySelector('[data-export]').addEventListener('click', async () => {
    let data;
    if (!(await attempt(async () => { data = await store.exportAll(); }, "Couldn't download the backup."))) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `usa-fuel-backup-${calc.todayInNewYork()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  view.querySelector('[data-import]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await store.importAll(JSON.parse(await file.text()));
      await reload();
      toast('Backup restored');
      renderSettings();
    } catch (error) {
      alert(error.message || 'Could not read that backup file.');
    }
  });

  view.querySelector('[data-change-password]')?.addEventListener('click', async () => {
    if (unsaved && !confirm('You have unsaved settings. Leave them and change your password?')) return;
    unsaved = false;
    renderSetPassword(await store.currentUser());
  });

  view.querySelector('[data-sample]')?.addEventListener('click', async () => {
    if (Object.keys(days).length && !confirm('Loading sample data replaces every day you have entered. Continue?')) return;
    await store.clearAll();
    const sampleSettings = structuredClone(settings);
    sampleSettings.tanks.forEach((t) => { if (!t.startCost) t.startCost = SAMPLE_START_COSTS[t.key] || ''; });
    if (sampleSettings.startingBank === '') sampleSettings.startingBank = 300;
    await store.saveSettings(sampleSettings);
    const today = calc.todayInNewYork();
    const sample = makeSample(sampleSettings, sampleSettings.reconStart, calc.addDays(today, -1));
    for (const day of Object.values(sample)) await store.saveDay(day);
    const { content, ...lists } = makeSampleExtras(sampleSettings, sample, today);
    for (const [collection, records] of Object.entries(lists)) {
      for (const record of records) await store.save(collection, record);
    }
    for (const [key, data] of Object.entries(content)) await store.saveContent(key, data);
    await reload();
    toast('Sample data loaded');
    location.hash = '#/';
  });

  view.querySelector('[data-clear]')?.addEventListener('click', async () => {
    const message = hasSample() ? 'Remove all sample days, accounts, deposits and website content?' : 'Delete every day and worksheet note? Download a backup first if you might need them.';
    if (!confirm(message)) return;
    const keep = settings;
    await store.clearAll();
    await store.saveSettings(keep);
    await reload();
    toast('Data cleared');
    renderSettings();
  });
}

function rerenderKeepingDraft(draft) {
  const saved = settings;
  settings = draft;
  renderSettings();
  settings = saved;
  unsaved = true;
  const status = view.querySelector('[data-save-status]');
  status.textContent = 'Unsaved changes';
  status.classList.add('is-unsaved');
}

async function reload() {
  settings = await store.getSettings();
  days = await store.getDays();
  reconNotes = await store.getReconNotes();
  const lists = await Promise.all(COLLECTIONS.map((c) => store.list(c)));
  extra = { ...Object.fromEntries(COLLECTIONS.map((c, i) => [c, lists[i]])), content: await store.getContent() };
}

start();
