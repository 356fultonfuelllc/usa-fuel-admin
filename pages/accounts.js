// House accounts: fleet/house customers, their charges and payments, and monthly
// Net 15 statements broken out by truck and driver.

import * as calc from '../calc.js';
import { fmt, esc, pill, toast, field, selectField, newId, mediumDate, shortDate, longDate, monthLabel, statTile, usd } from '../ui.js';

const PRODUCTS = calc.PRODUCTS;
const productLabel = (key) => PRODUCTS.find((p) => p.key === key)?.label || key;
const STATUSES = [['active', 'Active'], ['hold', 'On hold'], ['closed', 'Closed']];
const METHODS = [['check', 'Check'], ['ach', 'Bank transfer (ACH)'], ['card', 'Card'], ['cash', 'Cash'], ['other', 'Other']];

function statusPill(account) {
  if (account.status === 'hold') return pill('warn', 'On hold');
  if (account.status === 'closed') return pill('idle', 'Closed');
  return pill('good', 'Active');
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

function nextNumber(accounts) {
  const numbers = accounts.map((a) => Number(String(a.number || '').replace(/\D/g, ''))).filter(Boolean);
  return `HA-${numbers.length ? Math.max(...numbers) + 1 : 1001}`;
}

function accountFields(account = {}) {
  return `<div class="fields">
    ${field({ name: 'name', label: 'Business name', type: 'text', value: account.name, attrs: 'required' })}
    ${field({ name: 'contact', label: 'Contact name', type: 'text', value: account.contact })}
    ${field({ name: 'phone', label: 'Phone', type: 'tel', value: account.phone })}
    ${field({ name: 'email', label: 'Billing email', type: 'email', value: account.email })}
    ${field({ name: 'address', label: 'Billing address', type: 'text', value: account.address, wide: true })}
    ${field({ name: 'discountCents', label: 'Discount', suffix: '¢/gal', value: account.discountCents, hint: 'Off every gallon, below the posted credit price' })}
    ${field({ name: 'creditLimit', label: 'Credit limit', prefix: '$', value: account.creditLimit })}
    ${selectField({ name: 'status', label: 'Status', value: account.status || 'active', options: STATUSES })}
    ${field({ name: 'notes', label: 'Notes', type: 'text', value: account.notes, wide: true })}
  </div>`;
}

function readAccountForm(form) {
  const read = (name) => form.elements[name].value.trim();
  return {
    name: read('name'),
    contact: read('contact'),
    phone: read('phone'),
    email: read('email'),
    address: read('address'),
    discountCents: read('discountCents'),
    creditLimit: read('creditLimit'),
    status: read('status'),
    notes: read('notes'),
  };
}

// ---------------------------------------------------------------------------
// All accounts
// ---------------------------------------------------------------------------

export function renderAccounts(ctx) {
  const today = calc.todayInNewYork();
  const { house_accounts: accounts, house_charges: charges, house_payments: payments } = ctx.data;
  const rows = accounts.slice()
    .sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || a.name.localeCompare(b.name))
    .map((account) => ({ account, s: calc.accountSummary(account, charges, payments, ctx.settings, today) }));
  const sum = (key) => rows.reduce((a, r) => a + r.s[key], 0);

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Fleet</p><h1>House accounts</h1></div>
      <div class="page-head__actions"><button class="btn btn--primary" type="button" data-new-account>New account</button></div>
    </header>

    <section class="card" data-account-form hidden>
      <h2 class="card__title">New house account</h2>
      <form data-new-account-form novalidate>
        ${accountFields()}
        <p class="muted">Add trucks and drivers on the account's page after you save it.</p>
        <div class="button-row form-actions">
          <button class="btn btn--primary" type="submit">Save account</button>
          <button class="btn btn--ghost" type="button" data-cancel-account>Cancel</button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="tiles">
        ${statTile('Total owed', fmt.money(sum('balance')))}
        ${statTile('Past due', fmt.money(sum('pastDue')))}
        ${statTile('Charged this month', fmt.money(sum('monthCharges')))}
        ${statTile('Active accounts', String(accounts.filter((a) => a.status !== 'closed').length))}
      </div>
    </section>

    <section class="card">
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Account</th><th>Number</th><th class="num">Discount</th><th class="num">This month</th><th class="num">Balance</th><th>Past due</th><th>Status</th></tr></thead>
        <tbody>${rows.map(({ account, s }) => `<tr>
          <td><a class="link" href="#/account/${esc(account.id)}">${esc(account.name)}</a></td>
          <td>${esc(account.number)}</td>
          <td class="num">${account.discountCents ? `${esc(account.discountCents)}¢` : '—'}</td>
          <td class="num">${fmt.money(s.monthCharges)}</td>
          <td class="num">${fmt.money(s.balance)}</td>
          <td>${s.pastDue > 0 ? pill('bad', usd.format(s.pastDue)) : pill('good', 'None')}</td>
          <td>${statusPill(account)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<p class="empty">No house accounts yet. Click New account to add your first one.</p>'}
    </section>`;

  const formCard = ctx.view.querySelector('[data-account-form]');
  ctx.view.querySelector('[data-new-account]').addEventListener('click', () => {
    formCard.hidden = false;
    formCard.querySelector('input').focus();
  });
  ctx.view.querySelector('[data-cancel-account]').addEventListener('click', () => { formCard.hidden = true; });
  ctx.view.querySelector('[data-new-account-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const details = readAccountForm(event.currentTarget);
    if (!details.name) return alert('Enter the business name.');
    const account = { id: newId(), day: today, number: nextNumber(accounts), openedOn: today, vehicles: [], ...details };
    if (await ctx.saveRecord('house_accounts', account)) {
      toast(`${account.name} added`);
      location.hash = `#/account/${account.id}`;
    }
  });
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

function vehicleRow(v = {}, i = 0) {
  return `<div class="vehicle-row" data-vehicle-row>
    ${field({ name: `vehicles.${i}.unit`, label: 'Unit #', type: 'text', value: v.unit })}
    ${field({ name: `vehicles.${i}.vehicle`, label: 'Year / make / model', type: 'text', value: v.vehicle })}
    ${field({ name: `vehicles.${i}.plate`, label: 'Plate', type: 'text', value: v.plate })}
    ${field({ name: `vehicles.${i}.driver`, label: 'Driver', type: 'text', value: v.driver })}
    ${selectField({ name: `vehicles.${i}.fuel`, label: 'Fuel', value: v.fuel || '', options: [['', '—'], ...calc.GRADES.map((g) => [g.key, g.label])] })}
    <button class="btn btn--ghost btn--small" type="button" data-remove-vehicle>Remove</button>
  </div>`;
}

export function renderAccount(ctx, id, monthParam) {
  const today = calc.todayInNewYork();
  const { house_accounts: accounts, house_charges: allCharges, house_payments: allPayments } = ctx.data;
  const account = accounts.find((a) => a.id === id);
  if (!account) {
    ctx.view.innerHTML = '<section class="card"><p class="empty">That account doesn\'t exist. <a href="#/accounts">Back to house accounts</a>.</p></section>';
    return;
  }
  const charges = allCharges.filter((c) => c.accountId === id);
  const payments = allPayments.filter((p) => p.accountId === id).sort((a, b) => b.day.localeCompare(a.day));
  const s = calc.accountSummary(account, allCharges, allPayments, ctx.settings, today);
  const month = monthParam || today.slice(0, 7);
  const { start, end } = calc.monthBounds(month);
  const monthCharges = charges.filter((c) => c.day >= start && c.day <= end).sort((a, b) => b.day.localeCompare(a.day));
  const months = [...new Set([...charges, ...payments].map((r) => r.day.slice(0, 7)))].sort().reverse();
  const vehicles = account.vehicles || [];
  const priceChanges = ctx.data.price_changes;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <div class="toolbar no-print"><a class="btn btn--ghost" href="#/accounts">All accounts</a></div>
    <header class="page-head">
      <div>
        <p class="eyebrow">House account ${esc(account.number)}</p>
        <h1>${esc(account.name)}</h1>
        <p class="muted">${[account.contact, account.phone, account.email].filter(Boolean).map(esc).join(' · ') || 'No contact details yet'}</p>
      </div>
      <div class="page-head__actions">
        ${statusPill(account)}
        <button class="btn btn--ghost" type="button" data-edit-account>Edit details &amp; trucks</button>
        <a class="btn btn--primary" href="#/statement/${esc(account.id)}/${month}">Statement · ${monthLabel(month)}</a>
      </div>
    </header>

    <section class="card" data-edit-card hidden>
      <h2 class="card__title">Account details</h2>
      <form data-edit-form novalidate>
        ${accountFields(account)}
        <h3 class="summary__sub">Trucks &amp; drivers allowed to charge</h3>
        <div data-vehicle-list>${vehicles.map(vehicleRow).join('') || ''}</div>
        <button class="btn btn--ghost btn--small" type="button" data-add-vehicle>Add a truck</button>
        <div class="button-row form-actions">
          <button class="btn btn--primary" type="submit">Save details</button>
          <button class="btn btn--ghost" type="button" data-cancel-edit>Cancel</button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="tiles">
        ${statTile('Balance', fmt.money(s.balance))}
        ${statTile('Past due', fmt.money(s.pastDue))}
        ${statTile('Charged this month', fmt.money(s.monthCharges))}
        ${statTile('Last payment', s.lastPayment ? fmt.money(Number(s.lastPayment.amount)) : '—', '', s.lastPayment ? mediumDate(s.lastPayment.day) : '')}
      </div>
      <p class="muted">Discount ${account.discountCents ? `${esc(account.discountCents)}¢ per gallon` : 'none'} · Net ${ctx.settings.houseAccounts.termsDays}${account.creditLimit ? ` · Credit limit ${fmt.money(Number(account.creditLimit))}` : ''}${account.creditLimit && s.balance > Number(account.creditLimit) ? ` ${pill('bad', 'Over credit limit')}` : ''}</p>
    </section>

    <div class="grid-2">
      <section class="card">
        <h2 class="card__title">Add a charge</h2>
        <form data-charge-form novalidate>
          <div class="fields">
            ${field({ name: 'day', label: 'Date', type: 'date', value: today })}
            ${selectField({ name: 'unit', label: 'Truck', value: '', options: [['', 'Choose a truck'], ...vehicles.map((v) => [v.unit, `Unit ${v.unit}${v.vehicle ? ` · ${v.vehicle}` : ''}`]), ['__other', 'Other / not listed']] })}
            ${field({ name: 'driver', label: 'Driver', type: 'text', attrs: 'list="drivers"' })}
            ${selectField({ name: 'product', label: 'Product', value: 'diesel', options: PRODUCTS.map((p) => [p.key, p.label]) })}
            ${field({ name: 'gallons', label: 'Gallons', suffix: 'gal' })}
            ${field({ name: 'price', label: 'Price per gallon', prefix: '$', hint: 'Posted credit price, filled in from your price log' })}
            ${field({ name: 'amount', label: 'Amount charged', prefix: '$', hint: 'The receipt total' })}
            ${field({ name: 'ticket', label: 'Receipt / ticket #', type: 'text' })}
          </div>
          <datalist id="drivers">${[...new Set(vehicles.map((v) => v.driver).filter(Boolean))].map((d) => `<option value="${esc(d)}"></option>`).join('')}</datalist>
          <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Save charge</button></div>
        </form>
      </section>

      <section class="card">
        <h2 class="card__title">Record a payment</h2>
        <form data-payment-form novalidate>
          <div class="fields">
            ${field({ name: 'day', label: 'Date received', type: 'date', value: today })}
            ${field({ name: 'amount', label: 'Amount', prefix: '$' })}
            ${selectField({ name: 'method', label: 'Method', value: 'check', options: METHODS })}
            ${field({ name: 'reference', label: 'Check # / reference', type: 'text' })}
          </div>
          <div class="button-row form-actions"><button class="btn btn--primary" type="submit">Save payment</button></div>
        </form>
      </section>
    </div>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Charges · ${monthLabel(month)}</h2>
        <div class="button-row">
          <a class="btn btn--ghost btn--small" href="#/account/${esc(id)}/${calc.previousMonth(month)}">← Previous</a>
          <a class="btn btn--ghost btn--small" href="#/account/${esc(id)}/${nextMonth(month)}">Next →</a>
        </div>
      </div>
      ${monthCharges.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Truck</th><th>Driver</th><th>Product</th><th class="num">Gallons</th><th class="num">Amount</th><th class="num">Discount</th><th>Ticket</th><th></th></tr></thead>
        <tbody>${monthCharges.map((c) => `<tr>
          <td>${shortDate(c.day)}</td>
          <td>${esc(c.unit) || '—'}</td>
          <td>${esc(c.driver) || '—'}</td>
          <td>${esc(productLabel(c.product))}</td>
          <td class="num">${c.product === 'inside' ? '—' : fmt.number(Number(c.gallons) || 0, 3)}</td>
          <td class="num">${fmt.money(Number(c.amount) || 0)}</td>
          <td class="num">${fmt.money(calc.chargeDiscount(c, account))}</td>
          <td>${esc(c.ticket)}</td>
          <td class="actions"><button class="btn btn--ghost btn--small" type="button" data-delete-charge="${esc(c.id)}">Delete</button></td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<p class="empty">No charges in ${monthLabel(month)}.</p>`}
    </section>

    <div class="grid-2">
      <section class="card">
        <h2 class="card__title">Payments</h2>
        ${payments.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th></th></tr></thead>
          <tbody>${payments.slice(0, 24).map((p) => `<tr>
            <td>${shortDate(p.day)}</td>
            <td class="num">${fmt.money(Number(p.amount) || 0)}</td>
            <td>${esc(METHODS.find(([k]) => k === p.method)?.[1] || p.method)}</td>
            <td>${esc(p.reference)}</td>
            <td class="actions"><button class="btn btn--ghost btn--small" type="button" data-delete-payment="${esc(p.id)}">Delete</button></td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No payments yet.</p>'}
      </section>

      <section class="card">
        <h2 class="card__title">Statements</h2>
        ${months.length ? `<ul class="link-list">${months.map((m) => {
          const st = calc.statement(account, allCharges, allPayments, m, ctx.settings);
          return `<li><a class="link" href="#/statement/${esc(id)}/${m}">${monthLabel(m)}</a><span class="muted">Balance ${fmt.money(st.balance)} · due ${shortDate(st.due)}</span></li>`;
        }).join('')}</ul>` : '<p class="empty">Statements appear once the account has charges or payments.</p>'}
      </section>
    </div>`;

  // ---- Edit details & trucks ----
  const editCard = ctx.view.querySelector('[data-edit-card]');
  const vehicleList = ctx.view.querySelector('[data-vehicle-list]');
  ctx.view.querySelector('[data-edit-account]').addEventListener('click', () => { editCard.hidden = !editCard.hidden; });
  ctx.view.querySelector('[data-cancel-edit]').addEventListener('click', () => { editCard.hidden = true; });
  ctx.view.querySelector('[data-add-vehicle]').addEventListener('click', () => {
    vehicleList.insertAdjacentHTML('beforeend', vehicleRow({}, vehicleList.children.length));
  });
  vehicleList.addEventListener('click', (event) => {
    if (event.target.closest('[data-remove-vehicle]')) event.target.closest('[data-vehicle-row]').remove();
  });
  ctx.view.querySelector('[data-edit-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const details = readAccountForm(event.currentTarget);
    if (!details.name) return alert('Enter the business name.');
    const rows = [...vehicleList.querySelectorAll('[data-vehicle-row]')].map((row) => {
      const get = (key) => row.querySelector(`[name$=".${key}"]`).value.trim();
      return { unit: get('unit'), vehicle: get('vehicle'), plate: get('plate'), driver: get('driver'), fuel: get('fuel') };
    }).filter((v) => v.unit || v.vehicle || v.driver);
    if (await ctx.saveRecord('house_accounts', { ...account, ...details, vehicles: rows })) {
      toast('Account saved');
      ctx.rerender();
    }
  });

  // ---- Charges ----
  const chargeForm = ctx.view.querySelector('[data-charge-form]');
  const el = (name) => chargeForm.elements[name];
  let amountTyped = false;
  let priceTyped = false;
  const fillPrice = () => {
    const product = el('product').value;
    if (priceTyped || product === 'inside') return;
    const day = el('day').value;
    const prices = ctx.days[day] ? calc.dayPrices(ctx.days[day], priceChanges, day) : calc.defaultPrices(day, ctx.days, priceChanges);
    el('price').value = prices.credit[product] ?? '';
  };
  const fillAmount = () => {
    if (amountTyped) return;
    const gallons = Number(el('gallons').value);
    const price = Number(el('price').value);
    el('amount').value = gallons && price ? (Math.round(gallons * price * 100) / 100).toFixed(2) : '';
  };
  el('unit').addEventListener('change', () => {
    const vehicle = vehicles.find((v) => v.unit === el('unit').value);
    if (vehicle?.driver && !el('driver').value) el('driver').value = vehicle.driver;
    if (vehicle?.fuel) { el('product').value = vehicle.fuel; fillPrice(); fillAmount(); }
  });
  el('product').addEventListener('change', () => { fillPrice(); fillAmount(); });
  el('day').addEventListener('change', () => { fillPrice(); fillAmount(); });
  el('gallons').addEventListener('input', fillAmount);
  el('price').addEventListener('input', () => { priceTyped = true; fillAmount(); });
  el('amount').addEventListener('input', () => { amountTyped = true; });
  fillPrice();

  chargeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const product = el('product').value;
    const amount = Number(el('amount').value);
    if (!el('day').value || !amount) return alert('Enter the date and the amount charged.');
    if (product !== 'inside' && !Number(el('gallons').value)) return alert('Enter the gallons for a fuel charge.');
    const unit = el('unit').value === '__other' ? '' : el('unit').value;
    const charge = {
      id: newId(),
      day: el('day').value,
      accountId: id,
      unit,
      driver: el('driver').value.trim(),
      product,
      gallons: product === 'inside' ? '' : el('gallons').value,
      price: product === 'inside' ? '' : el('price').value,
      amount: amount.toFixed(2),
      ticket: el('ticket').value.trim(),
    };
    if (account.status === 'hold' && !confirm(`${account.name} is on hold. Record this charge anyway?`)) return;
    if (await ctx.saveRecord('house_charges', charge)) {
      toast(`Charge saved: ${usd.format(amount)}`);
      ctx.rerender();
    }
  });

  ctx.view.querySelectorAll('[data-delete-charge]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this charge?')) return;
      if (await ctx.removeRecord('house_charges', button.dataset.deleteCharge)) {
        toast('Charge deleted');
        ctx.rerender();
      }
    });
  });

  // ---- Payments ----
  ctx.view.querySelector('[data-payment-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Number(form.elements.amount.value);
    if (!form.elements.day.value || !amount) return alert('Enter the date and the amount received.');
    const payment = {
      id: newId(),
      day: form.elements.day.value,
      accountId: id,
      amount: amount.toFixed(2),
      method: form.elements.method.value,
      reference: form.elements.reference.value.trim(),
    };
    if (await ctx.saveRecord('house_payments', payment)) {
      toast(`Payment saved: ${usd.format(amount)}`);
      ctx.rerender();
    }
  });
  ctx.view.querySelectorAll('[data-delete-payment]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this payment?')) return;
      if (await ctx.removeRecord('house_payments', button.dataset.deletePayment)) {
        toast('Payment deleted');
        ctx.rerender();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Printable statement
// ---------------------------------------------------------------------------

export function renderStatement(ctx, id, month) {
  const account = ctx.data.house_accounts.find((a) => a.id === id);
  if (!account) {
    ctx.view.innerHTML = '<section class="card"><p class="empty">That account doesn\'t exist. <a href="#/accounts">Back to house accounts</a>.</p></section>';
    return;
  }
  const { facility } = ctx.settings;
  const st = calc.statement(account, ctx.data.house_charges, ctx.data.house_payments, month, ctx.settings);

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <div class="toolbar no-print">
      <a class="btn btn--ghost" href="#/account/${esc(id)}/${month}">Back to account</a>
      <span class="toolbar__spacer"></span>
      <a class="btn btn--ghost" href="#/statement/${esc(id)}/${calc.previousMonth(month)}">← ${monthLabel(calc.previousMonth(month))}</a>
      <a class="btn btn--ghost" href="#/statement/${esc(id)}/${nextMonth(month)}">${monthLabel(nextMonth(month))} →</a>
      <button class="btn btn--primary" type="button" data-print>Print or save PDF</button>
    </div>

    <article class="sheet report statement">
      <header class="report__head">
        <img src="assets/logo.webp" alt="" width="960" height="251">
        <div>
          <h1>Account statement</h1>
          <p>${monthLabel(month)}</p>
          <p class="muted">${esc(facility.name)} · ${esc(facility.address)}${facility.phone ? ` · ${esc(facility.phone)}` : ''}</p>
        </div>
        <div class="statement__meta">
          <p><span>Account</span>${esc(account.number)}</p>
          <p><span>Statement date</span>${shortDate(st.end)}, ${st.end.slice(0, 4)}</p>
          <p><span>Payment due</span><strong>${longDate(st.due)}</strong></p>
        </div>
      </header>

      <div class="statement__top">
        <div>
          <h2>Bill to</h2>
          <p><strong>${esc(account.name)}</strong>${account.contact ? `<br>Attn: ${esc(account.contact)}` : ''}${account.address ? `<br>${esc(account.address)}` : ''}</p>
        </div>
        <table class="table table--report statement__summary">
          <tbody>
            <tr><td>Previous balance</td><td class="num">${fmt.money(st.previous)}</td></tr>
            <tr><td>− Payments received</td><td class="num">${fmt.money(st.paymentsTotal)}</td></tr>
            <tr><td>+ New charges</td><td class="num">${fmt.money(st.chargesTotal)}</td></tr>
            <tr><td>− Fleet discount${account.discountCents ? ` (${esc(account.discountCents)}¢ × ${fmt.number(st.gallons, 1)} gal)` : ''}</td><td class="num">${fmt.money(st.discountTotal)}</td></tr>
          </tbody>
          <tfoot><tr><th>Balance due</th><th class="num">${fmt.money(st.balance)}</th></tr></tfoot>
        </table>
      </div>

      <section>
        <h2>Charges by truck</h2>
        ${st.groups.length ? st.groups.map((g) => `
          <h3 class="statement__unit">Unit ${esc(g.unit)}${g.vehicle ? ` · ${esc(g.vehicle)}` : ''}</h3>
          <div class="table-wrap"><table class="table table--report">
            <thead><tr><th>Date</th><th>Ticket</th><th>Driver</th><th>Product</th><th class="num">Gallons</th><th class="num">Price</th><th class="num">Amount</th><th class="num">Discount</th></tr></thead>
            <tbody>${g.lines.map((l) => `<tr>
              <td>${shortDate(l.day)}</td><td>${esc(l.ticket)}</td><td>${esc(l.driver)}</td><td>${esc(productLabel(l.product))}</td>
              <td class="num">${l.product === 'inside' ? '' : fmt.number(Number(l.gallons) || 0, 3)}</td>
              <td class="num">${l.price ? fmt.ppg(Number(l.price)) : ''}</td>
              <td class="num">${fmt.money(Number(l.amount) || 0)}</td>
              <td class="num">${l.discount ? fmt.money(l.discount) : ''}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><th colspan="4">Unit ${esc(g.unit)} total</th><th class="num">${fmt.number(g.gallons, 3)}</th><th></th><th class="num">${fmt.money(g.amount)}</th><th class="num">${fmt.money(g.discount)}</th></tr></tfoot>
          </table></div>`).join('') : '<p class="muted">No charges this month.</p>'}
      </section>

      ${st.payments.length ? `<section>
        <h2>Payments received</h2>
        <div class="table-wrap"><table class="table table--report">
          <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead>
          <tbody>${st.payments.map((p) => `<tr><td>${shortDate(p.day)}</td><td>${esc(METHODS.find(([k]) => k === p.method)?.[1] || p.method)}</td><td>${esc(p.reference)}</td><td class="num">${fmt.money(Number(p.amount) || 0)}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>` : ''}

      <footer class="report__foot statement__foot">
        <p><strong>Terms: Net ${ctx.settings.houseAccounts.termsDays}.</strong> Please pay the balance due by ${longDate(st.due)}. Make checks payable to ${esc(facility.name)}.</p>
        <p>Questions about this statement? Email sales@usafuelandmart.com${facility.phone ? ` or call ${esc(facility.phone)}` : ''}.</p>
      </footer>
    </article>`;

  ctx.view.querySelector('[data-print]').addEventListener('click', () => window.print());
}
