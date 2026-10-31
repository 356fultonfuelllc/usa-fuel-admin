// USA Fuel & Mart admin dashboard: daily entry, daily reports, 10-day fuel reconciliation.

import { store } from './store.js';
import * as calc from './calc.js';
import { makeSample, makeSampleExtras, SAMPLE_START_COSTS } from './sample.js';
import {
  usd, fmt, longDate, mediumDate, shortDate, slashDate, periodLabel, esc, getPath, setPath,
  pill, toast, field, attempt, statTile, deltaLine,
} from './ui.js';
import { renderFuel } from './pages/fuel.js';
import { renderDeposits } from './pages/deposits.js';
import { renderAccounts, renderAccount, renderStatement } from './pages/accounts.js';
import { renderWebsite } from './pages/website.js';

const view = document.getElementById('view');
const cloud = store.mode === 'cloud';

let settings;
let days = {};
let reconNotes = {};
// Records kept in lists (see store.list) plus the website content.
const COLLECTIONS = ['price_changes', 'deposits', 'house_accounts', 'house_charges', 'house_payments'];
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

// The register's house-account total for a day vs the charges recorded on accounts.
function houseCheck(date, day) {
  const rungUp = Number(day.tenders?.house) || 0;
  const recorded = calc.houseChargesOn(date, extra.house_charges);
  if (!rungUp && !recorded) return '';
  const tone = Math.abs(rungUp - recorded) < 0.01 ? pill('good', 'Matches') : pill('warn', `Off by ${usd.format(Math.abs(rungUp - recorded))}`);
  return `<div><span>House charges</span>${tone}</div>
    <p class="muted">Register ${fmt.money(rungUp)} · recorded on accounts ${fmt.money(recorded)}. <a href="#/accounts">House accounts</a></p>`;
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
    const rungUp = Number(days[d].tenders?.house) || 0;
    const recorded = calc.houseChargesOn(d, extra.house_charges);
    if ((rungUp || recorded) && Math.abs(rungUp - recorded) >= 0.01 && d >= calc.addDays(today, -14)) {
      items.push(['warn', `House charges for ${mediumDate(d)} don't match the register (${usd.format(recorded)} recorded, ${usd.format(rungUp)} rung up).`, '#/accounts', 'Accounts']);
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
      ${statTile('Fuel profit', fuelProfit == null ? '—' : fmt.moneyCompact(fuelProfit), '', fuelProfit == null ? 'Add delivery costs to see it' : `${fmt.cents(fuelProfit / (current.fuelGallons || 1))} a gallon`)}
      ${statTile('Inside sales', fmt.moneyCompact(current.insideAmount), deltaLine(current.insideAmount, comparable?.insideAmount))}
      ${statTile('Cash over/short', fmt.signedMoney(Math.round(current.overShort * 100) / 100), '', `${current.count} days counted`)}
    </div>
    <p class="muted">Last 7 days entered: ${shortDate(from)} – ${shortDate(latest)}.</p>`;
  }

  const periodStart = calc.periodStartFor(today, settings);
  const period = today >= settings.reconStart ? calc.reconcilePeriod(periodStart, days, settings) : [];
  const items = attentionItems(today);

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
    departments: {},
    lottery: {},
    tax: '',
    customers: '',
    tenders: {},
    cash: { startingBank: previous?.cash?.startingBank ?? '' },
    tanks: Object.fromEntries(settings.tanks.map((t) => [t.key, { time: previous?.tanks?.[t.key]?.time || '' }])),
    notes: '',
  };
}


function renderEntry(dateParam) {
  const date = dateParam || calc.todayInNewYork();
  const exists = Boolean(days[date]);
  const draft = exists ? structuredClone(days[date]) : blankDay(date);
  const value = (path) => getPath(draft, path);
  const previousDay = days[calc.addDays(date, -1)];

  const tankCards = settings.tanks.map((tank) => {
    const carried = previousDay?.tanks?.[tank.key]?.endGallons;
    const base = `tanks.${tank.key}`;
    return `<fieldset class="tank">
      <legend>${esc(tank.product)} <span class="muted">Tank ${esc(tank.tankId)} · ${fmt.number(tank.capacity)} gal</span></legend>
      <div class="fields fields--tank">
        ${field({ name: `${base}.time`, label: 'Reading time', type: 'time', value: value(`${base}.time`) })}
        ${field({ name: `${base}.start`, label: 'Start inventory', suffix: 'gal', value: value(`${base}.start`), placeholder: carried != null ? fmt.number(Number(carried)) : 'Required', hint: carried != null ? "Blank uses yesterday's end" : 'No reading saved for yesterday' })}
        ${field({ name: `${base}.delivered`, label: 'Gallons delivered', suffix: 'gal', value: value(`${base}.delivered`), placeholder: '0' })}
        ${field({ name: `${base}.cost`, label: 'Cost per gallon', prefix: '$', value: value(`${base}.cost`), hint: 'All-in, from the delivery invoice' })}
        ${field({ name: `${base}.ticket`, label: 'Delivery ticket #', type: 'text', value: value(`${base}.ticket`) })}
        ${field({ name: `${base}.endInches`, label: 'End height', suffix: 'in', value: value(`${base}.endInches`), hint: 'TLS-350 inventory: Height' })}
        ${field({ name: `${base}.endGallons`, label: 'End inventory', suffix: 'gal', value: value(`${base}.endGallons`), hint: 'TLS-350 inventory: Volume' })}
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
        <section class="card">
          <h2 class="card__title">Fuel sales</h2>
          <p class="card__hint">From the Commander fuel report, by grade.</p>
          <div class="grade-grid">
            <span class="grade-grid__head">Grade</span><span class="grade-grid__head">Gallons</span><span class="grade-grid__head">Sales</span>
            ${calc.GRADES.map((g) => `
              <span class="grade-grid__label">${g.label}</span>
              ${field({ name: `fuel.${g.key}.gallons`, label: `${g.label} gallons`, suffix: 'gal', value: value(`fuel.${g.key}.gallons`) })}
              ${field({ name: `fuel.${g.key}.amount`, label: `${g.label} sales`, prefix: '$', value: value(`fuel.${g.key}.amount`) })}`).join('')}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Inside sales by department</h2>
          <p class="card__hint">From the Commander department report. Before tax.</p>
          <div class="fields">
            ${settings.departments.map((d) => field({ name: `departments.${d.key}`, label: d.label, prefix: '$', value: value(`departments.${d.key}`) })).join('')}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Lottery, tax and customers</h2>
          <div class="fields">
            ${field({ name: 'lottery.instant', label: 'Scratch-off sales', prefix: '$', value: value('lottery.instant') })}
            ${field({ name: 'lottery.online', label: 'Draw game sales', prefix: '$', value: value('lottery.online') })}
            ${field({ name: 'lottery.payouts', label: 'Paid to lottery winners', prefix: '$', value: value('lottery.payouts'), hint: 'If Commander records these as a Pay Out, leave this at 0.' })}
            ${field({ name: 'tax', label: 'Sales tax collected', prefix: '$', value: value('tax') })}
            ${field({ name: 'customers', label: 'Customer count', value: value('customers') })}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Payments by type</h2>
          <p class="card__hint">From the Commander summary, by method of payment.</p>
          <div class="fields">
            ${calc.TENDERS.map((t) => field({ name: `tenders.${t.key}`, label: t.label, prefix: '$', value: value(`tenders.${t.key}`), hint: t.hint })).join('')}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Cash</h2>
          <div class="fields">
            ${field({ name: 'cash.startingBank', label: 'Starting bank', prefix: '$', value: value('cash.startingBank') })}
            ${field({ name: 'cash.payIns', label: 'Pay ins', prefix: '$', value: value('cash.payIns') })}
            ${field({ name: 'cash.payOuts', label: 'Pay outs', prefix: '$', value: value('cash.payOuts'), hint: 'Vendors and other cash paid out' })}
            ${field({ name: 'cash.cashBack', label: 'Debit cash back', prefix: '$', value: value('cash.cashBack') })}
            ${field({ name: 'cash.counted', label: 'Cash counted', prefix: '$', value: value('cash.counted'), hint: 'Drawer plus all safe drops' })}
            ${field({ name: 'cash.deposit', label: 'Bank deposit', prefix: '$', value: value('cash.deposit') })}
          </div>
        </section>

        <section class="card">
          <h2 class="card__title">Tank readings</h2>
          <p class="card__hint">From the Veeder-Root TLS-350 inventory report at close, plus any delivery tickets.</p>
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
  const status = view.querySelector('[data-save-status]');

  function refresh() {
    const s = calc.summarizeDay(draft, settings);
    const merged = { ...days, [date]: draft };
    const lines = settings.tanks.map((tank) => [tank, calc.tankLine(date, tank, merged, settings)]);

    for (const [tank, line] of lines) {
      view.querySelector(`[name="tanks.${tank.key}.pumped"]`).placeholder = fmt.number(calc.pumpedFromSales(draft, tank, settings));
      const box = view.querySelector(`[data-tank-line="${tank.key}"]`);
      box.innerHTML = line.start == null
        ? 'Enter the start inventory to calculate this tank.'
        : `Start ${fmt.number(line.start)} + delivered ${fmt.number(line.delivered)} − pumped ${fmt.number(line.pumped)} = book <strong>${fmt.number(line.book)}</strong>${line.end != null ? ` · end ${fmt.number(line.end)} · over/short <strong>${fmt.signed(line.overShort)}</strong>` : ''}${line.waterFlag ? ` ${pill('warn', 'Water rose')}` : ''}`;
    }

    summaryBox.innerHTML = `
      <h2 class="card__title">Day summary</h2>
      <dl class="summary">
        <div><dt>Fuel</dt><dd>${fmt.number(s.fuelGallons, 1)} gal · ${fmt.money(s.fuelAmount)}</dd></div>
        <div><dt>Inside sales</dt><dd>${fmt.money(s.insideAmount)}</dd></div>
        <div><dt>Lottery sales</dt><dd>${fmt.money(s.lotterySales)}</dd></div>
        <div><dt>Sales tax</dt><dd>${fmt.money(s.tax)}</dd></div>
        <div class="summary__total"><dt>Total sales</dt><dd>${fmt.money(s.totalSales)}</dd></div>
        <div><dt>Payments</dt><dd>${fmt.money(s.tenderTotal)}</dd></div>
      </dl>
      <div class="checks">
        <div><span>Sales vs payments</span>${paymentsStatus(s)}</div>
        <div><span>Cash</span>${cashStatus(s)}</div>
        ${s.overShort != null ? `<p class="muted">Expected ${fmt.money(s.expectedCash)}, counted ${fmt.money(s.countedCash)}.</p>` : ''}
        ${houseCheck(date, draft)}
      </div>
      <h3 class="summary__sub">Tanks today</h3>
      <dl class="summary">
        ${lines.map(([tank, line]) => `<div><dt>${esc(tank.product)}</dt><dd>${line.overShort != null ? `${fmt.signed(line.overShort)} gal` : '—'}</dd></div>`).join('')}
      </dl>`;
  }

  form.addEventListener('input', (event) => {
    const input = event.target;
    if (!input.name) return;
    setPath(draft, input.name, input.value);
    unsaved = true;
    status.textContent = 'Unsaved changes';
    status.classList.add('is-unsaved');
    refresh();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    draft.date = date;
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
  const lastWeek = days[calc.addDays(date, -7)] ? calc.summarizeDay(days[calc.addDays(date, -7)], settings) : null;
  const lines = settings.tanks.map((tank) => [tank, calc.tankLine(date, tank, days, settings)]);
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
        <section>
          <h2>Fuel sales</h2>
          <table class="table table--report">
            <thead><tr><th>Grade</th><th class="num">Gallons</th><th class="num">Sales</th><th class="num">Avg $/gal</th></tr></thead>
            <tbody>${s.fuel.map((f) => `<tr><td>${f.label}</td><td class="num">${fmt.number(f.gallons, 3)}</td><td class="num">${fmt.money(f.amount)}</td><td class="num">${f.perGallon ? `$${f.perGallon.toFixed(3)}` : '—'}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th>Total</th><th class="num">${fmt.number(s.fuelGallons, 3)}</th><th class="num">${fmt.money(s.fuelAmount)}</th><th></th></tr></tfoot>
          </table>
        </section>

        <section>
          <h2>Inside sales</h2>
          <table class="table table--report">
            <tbody>${s.departments.map((d) => `<tr><td>${esc(d.label)}</td><td class="num">${fmt.money(d.amount)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th>Total inside</th><th class="num">${fmt.money(s.insideAmount)}</th></tr></tfoot>
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
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Payments</h2>
          <table class="table table--report">
            <tbody>${s.tenders.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">${fmt.money(t.amount)}</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><th>Total payments</th><th class="num">${fmt.money(s.tenderTotal)}</th></tr>
              <tr><td>Sales vs payments</td><td class="num">${paymentsStatus(s)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Cash</h2>
          <table class="table table--report">
            <tbody>
              <tr><td>Starting bank</td><td class="num">${fmt.money(Number(day.cash?.startingBank) || 0)}</td></tr>
              <tr><td>+ Cash sales</td><td class="num">${fmt.money(s.cashSales)}</td></tr>
              <tr><td>+ Pay ins</td><td class="num">${fmt.money(Number(day.cash?.payIns) || 0)}</td></tr>
              <tr><td>− Pay outs</td><td class="num">${fmt.money(Number(day.cash?.payOuts) || 0)}</td></tr>
              <tr><td>− Lottery winners paid</td><td class="num">${fmt.money(s.lotteryPayouts)}</td></tr>
              <tr><td>− Debit cash back</td><td class="num">${fmt.money(Number(day.cash?.cashBack) || 0)}</td></tr>
            </tbody>
            <tfoot>
              <tr><th>Expected cash</th><th class="num">${fmt.money(s.expectedCash)}</th></tr>
              <tr><td>Cash counted</td><td class="num">${fmt.money(s.countedCash)}</td></tr>
              <tr><th>Over/short</th><th class="num">${fmt.signedMoney(s.overShort)}</th></tr>
              <tr><td>Bank deposit</td><td class="num">${fmt.money(s.deposit)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h2>Lottery</h2>
          <table class="table table--report">
            <tbody>
              <tr><td>Lottery sales</td><td class="num">${fmt.money(s.lotterySales)}</td></tr>
              <tr><td>Paid to winners</td><td class="num">${fmt.money(s.lotteryPayouts)}</td></tr>
            </tbody>
            <tfoot><tr><th>Net lottery</th><th class="num">${fmt.money(s.lotteryNet)}</th></tr></tfoot>
          </table>
        </section>

        <section class="report-grid__wide">
          <h2>Tank readings</h2>
          <div class="table-wrap"><table class="table table--report">
            <thead><tr><th>Tank</th><th>Time</th><th class="num">Start</th><th class="num">+ Delivered</th><th class="num">− Pumped</th><th class="num">= Book</th><th class="num">End (in)</th><th class="num">End (gal)</th><th class="num">Over/short</th><th class="num">Water (in)</th></tr></thead>
            <tbody>${lines.map(([tank, l]) => `<tr>
              <td>${esc(tank.product)}${l.ticket ? `<br><span class="muted">${esc(l.ticket)}</span>` : ''}</td>
              <td>${esc(l.time) || '—'}</td>
              <td class="num">${fmt.number(l.start)}</td>
              <td class="num">${fmt.number(l.delivered)}</td>
              <td class="num">${fmt.number(l.pumped)}</td>
              <td class="num">${fmt.number(l.book)}</td>
              <td class="num">${fmt.number(l.endInches, 2)}</td>
              <td class="num">${fmt.number(l.end)}</td>
              <td class="num">${fmt.signed(l.overShort)}</td>
              <td class="num">${fmt.number(l.water, 2)}${l.waterFlag ? ` ${pill('warn', 'Rose')}` : ''}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <p class="muted">Mid-grade gallons split ${fmt.number(settings.blendRegularPct, 1)}% to the regular tank and ${fmt.number(100 - settings.blendRegularPct, 1)}% to the premium tank.</p>
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
        <p class="card__hint">Use the tank ID numbers from your PBS registration.</p>
        ${draft.tanks.map((t, i) => `<div class="fields fields--row">
          ${field({ name: `tanks.${i}.tankId`, label: 'Tank ID', type: 'text', value: t.tankId })}
          ${field({ name: `tanks.${i}.product`, label: 'Product', type: 'text', value: t.product })}
          ${field({ name: `tanks.${i}.capacity`, label: 'Capacity', suffix: 'gal', value: t.capacity })}
          ${field({ name: `tanks.${i}.startCost`, label: 'Starting cost / gal', prefix: '$', value: t.startCost, hint: 'For fuel already in the tank before your first logged delivery' })}
        </div>`).join('')}
        <div class="fields">
          ${field({ name: 'blendRegularPct', label: 'Mid-grade from the regular tank', suffix: '%', value: value('blendRegularPct'), hint: 'The rest comes from the premium tank. 87 + 93 blended to 89 is 66.7%; 87 + 91 is 50%.' })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Reconciliation and alerts</h2>
        <div class="fields">
          ${field({ name: 'reconStart', label: 'First 10-day period starts', type: 'date', value: value('reconStart') })}
          ${field({ name: 'thresholds.cashOverShort', label: 'Flag cash over/short beyond', prefix: '$', value: value('thresholds.cashOverShort') })}
          ${field({ name: 'thresholds.waterIncrease', label: 'Flag a water rise of', suffix: 'in', value: value('thresholds.waterIncrease') })}
          ${field({ name: 'thresholds.depositDays', label: 'Flag deposits not made within', suffix: 'days', value: value('thresholds.depositDays') })}
          ${field({ name: 'thresholds.clearDays', label: 'Flag deposits not cleared after', suffix: 'days', value: value('thresholds.clearDays') })}
          ${field({ name: 'houseAccounts.termsDays', label: 'House account terms: net', suffix: 'days', value: value('houseAccounts.termsDays') })}
        </div>
      </section>

      <section class="card">
        <h2 class="card__title">Inside sales departments</h2>
        <p class="card__hint">Match these to the departments in Commander.</p>
        <div class="dept-list" data-dept-list>
          ${draft.departments.map((d, i) => `<div class="dept">
            ${field({ name: `departments.${i}.label`, label: `Department ${i + 1}`, type: 'text', value: d.label })}
            <button class="btn btn--ghost btn--small" type="button" data-remove-dept="${i}" aria-label="Remove ${esc(d.label)}">Remove</button>
          </div>`).join('')}
        </div>
        <button class="btn btn--ghost btn--small" type="button" data-add-dept>Add department</button>
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

  view.querySelector('[data-add-dept]').addEventListener('click', () => {
    draft.departments.push({ key: `dept-${Date.now().toString(36)}`, label: 'New department' });
    markUnsaved();
    rerenderKeepingDraft(draft);
  });
  view.querySelectorAll('[data-remove-dept]').forEach((button) => {
    button.addEventListener('click', () => {
      draft.departments.splice(Number(button.dataset.removeDept), 1);
      markUnsaved();
      rerenderKeepingDraft(draft);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    draft.tanks.forEach((t) => { t.capacity = Number(t.capacity) || 0; });
    draft.blendRegularPct = Number(draft.blendRegularPct) || 0;
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
