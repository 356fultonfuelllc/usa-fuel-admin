// Accountant export: spreadsheet (CSV) files for a month or any date range.

import * as calc from '../calc.js';
import { esc, toast, field, monthLabel, mediumDate } from '../ui.js';

let chosen = null; // { from, to } kept while moving around the dashboard

// One CSV cell: quoted when needed, numbers left as numbers.
function cell(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
  const text = String(value);
  return /[",\r\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${text.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : text;
}

function csv(rows) {
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

function download(name, rows) {
  const blob = new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

function datesIn(days, from, to) {
  return Object.keys(days).filter((d) => d >= from && d <= to).sort();
}

function monthsIn(from, to) {
  const months = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = calc.addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
  return months;
}

// ---- The files ----

function dailySales(ctx, from, to) {
  const { settings, days } = ctx;
  const groups = settings.departments;
  const inside = groups.filter((d) => (d.type || 'inside') === 'inside');
  const pass = groups.filter((d) => d.type === 'passthrough');
  const tenderTypes = calc.tenderTypes(settings, { tenders: Object.assign({}, ...datesIn(days, from, to).map((d) => days[d].tenders || {})) });
  const costsByDate = calc.tankCosts(days, settings);
  const header = [
    'Date', 'Prepared by',
    ...calc.GRADES.flatMap((g) => [`${g.label} gallons`, `${g.label} sales`]),
    'Manual fuel sales', 'Fuel gallons', 'Fuel sales',
    ...inside.map((d) => d.label), 'Inside sales',
    ...pass.map((d) => `${d.label} (pass-through)`),
    'Lottery scratch-off', 'Lottery draw', 'Sales tax', 'Total sales',
    ...tenderTypes.map((t) => `${t.label} payments`), 'Total payments',
    'Drive-offs', 'Personal fuel gallons', 'Personal fuel on register', 'Open prepays', 'Batch number', 'Card batch total', 'Sales vs payments difference',
    'Starting bank', 'Pay ins', 'Pay outs', 'Debit cash back', 'Expected cash', 'Cash counted', 'Cash over/short', 'Bank deposit',
    'Customers', 'Fuel cost of goods (est.)', 'Fuel profit (est.)',
  ];
  const rows = [header];
  const totals = new Array(header.length).fill(0);
  for (const date of datesIn(days, from, to)) {
    const day = days[date];
    const s = calc.summarizeDay(day, settings);
    const margin = calc.dayMargin(day, calc.gradeCosts(costsByDate[date], settings));
    const row = [
      date, day.preparedBy || '',
      ...s.fuel.flatMap((f) => [f.gallons, round2(f.amount)]),
      round2(s.manualFuel), s.fuelGallons, round2(s.fuelAmount),
      ...inside.map((d) => round2(num(day.departments?.[d.key]) || 0)), round2(s.insideAmount),
      ...pass.map((d) => round2(num(day.departments?.[d.key]) || 0)),
      round2(s.lotteryInstant), round2(s.lotteryOnline), round2(s.tax), round2(s.totalSales),
      ...tenderTypes.map((t) => round2(num(day.tenders?.[t.key]) || 0)), round2(s.tenderTotal),
      round2(s.driveOffAmount), s.personalGallons || null, round2(s.personalAmount) || null, round2(s.openPrepays), day.register?.batchNumber || '', round2(s.batchTotal), s.tenderTotal ? s.salesVsPayments : null,
      round2(s.startingBank), round2(s.payIns), round2(s.payOuts), round2(s.cashBack), s.expectedCash, s.countedCash, s.overShort, s.deposit,
      s.customers || null,
      margin.profit == null ? null : round2(s.gradeAmount - margin.profit), round2(margin.profit),
    ];
    row.forEach((v, i) => { if (typeof v === 'number' && i > 1 && !/^(Starting bank|Expected cash|Cash counted)$/.test(header[i])) totals[i] += v; });
    rows.push(row);
  }
  if (rows.length > 1) rows.push(totals.map((v, i) => (i === 0 ? 'Total' : i === 1 ? '' : /^(Starting bank|Expected cash|Cash counted)$/.test(header[i]) ? '' : round2(v))));
  return rows;
}

function expenses(ctx, from, to) {
  const { settings } = ctx;
  const rows = [['Date', 'Type', 'Category', 'Paid to', 'Description', 'Reference', 'Amount']];
  for (const m of monthsIn(from, to)) {
    for (const bill of settings.fixedExpenses || []) {
      if (num(bill.amount) == null) continue;
      rows.push([`${m}-01`, 'Monthly bill', '', '', bill.label, monthLabel(m), num(bill.amount)]);
    }
  }
  const inRange = (r) => r.day >= from && r.day <= to;
  const category = (key) => (calc.EXPENSE_CATEGORIES.find(([k]) => k === key) || [key, 'Other'])[1];
  for (const e of ctx.data.expenses.filter(inRange)) rows.push([e.day, 'One-off', category(e.category), e.vendor, e.note, '', num(e.amount)]);
  for (const r of ctx.data.maintenance.filter(inRange).filter((x) => num(x.cost) != null)) {
    rows.push([r.day, 'Repair', 'Repairs & maintenance', r.vendor, [r.problem, r.action].filter(Boolean).join(' — '), r.invoice, num(r.cost)]);
  }
  const body = rows.slice(1).sort((a, b) => a[0].localeCompare(b[0]));
  const total = body.reduce((a, r) => a + (r[6] || 0), 0);
  return [rows[0], ...body, ...(body.length ? [['Total', '', '', '', '', '', round2(total)]] : [])];
}

function deliveries(ctx, from, to) {
  const { settings, days } = ctx;
  const rows = [['Date', 'Tank', 'Product', 'Invoice gallons', 'TLS measured increase', 'Landed cost per gallon', 'Invoice total (est.)', 'Ticket / BOL']];
  for (const date of datesIn(days, from, to)) {
    for (const tank of settings.tanks) {
      for (const d of calc.deliveriesOf(days[date].tanks?.[tank.key])) {
        const gallons = num(d.invoiceGallons);
        const cost = num(d.cost);
        rows.push([date, tank.tankId, tank.product, gallons, num(d.measured), cost, gallons != null && cost != null ? round2(gallons * cost) : null, d.ticket || '']);
      }
    }
  }
  return rows;
}

function deposits(ctx, from, to) {
  const { settings, days } = ctx;
  const records = Object.fromEntries(ctx.data.deposits.map((r) => [r.id, r]));
  const today = calc.todayInNewYork();
  const rows = [['Sales date', 'Deposit amount', 'Deposited on', 'Slip #', 'Cleared on', 'Amount bank shows', 'Difference', 'Status', 'Note']];
  for (const date of datesIn(days, from, to)) {
    const s = calc.depositState(date, days[date], records[date], settings, today);
    if (s.state === 'none') continue;
    const r = records[date] || {};
    rows.push([date, s.amount, r.depositedOn || '', r.slip || '', r.clearedOn || '', s.clearedAmount ?? null, s.difference ?? null, s.state, r.note || '']);
  }
  return rows;
}

function houseAccounts(ctx, from, to) {
  const accounts = Object.fromEntries(ctx.data.house_accounts.map((a) => [a.id, a]));
  const product = (key) => (calc.PRODUCTS.find((p) => p.key === key) || { label: key }).label;
  const rows = [['Date', 'Account #', 'Account', 'Type', 'Unit / truck', 'Driver', 'Product', 'Gallons', 'Price', 'Amount', 'Discount', 'Reference']];
  const inRange = (r) => r.day >= from && r.day <= to;
  for (const c of ctx.data.house_charges.filter(inRange)) {
    const a = accounts[c.accountId];
    rows.push([c.day, a?.number || '', a?.name || '', 'Charge', c.unit, c.driver, product(c.product), num(c.gallons), num(c.price), num(c.amount), calc.chargeDiscount(c, a), c.ticket || '']);
  }
  for (const p of ctx.data.house_payments.filter(inRange)) {
    const a = accounts[p.accountId];
    rows.push([p.day, a?.number || '', a?.name || '', 'Payment', '', '', '', null, null, num(p.amount), null, [p.method, p.reference].filter(Boolean).join(' ')]);
  }
  return [rows[0], ...rows.slice(1).sort((x, y) => x[0].localeCompare(y[0]))];
}

function monthlySummary(ctx, from, to) {
  const rows = [['Month', 'Days entered', 'Fuel gallons sold', 'Fuel profit (before card fees)', 'Inside sales', 'Inside profit (est.)', 'Lottery sales', 'Lottery commission', 'Gross profit', 'Card fees (est.)', 'Monthly bills', 'One-off expenses', 'Repairs', 'Total expenses', 'Net profit', 'Personal fuel gallons', 'Personal fuel at cost (owner draw)']];
  for (const m of monthsIn(from, to)) {
    const p = calc.monthProfit(m, ctx.days, ctx.settings, { priceChanges: ctx.data.price_changes, expenses: ctx.data.expenses, maintenance: ctx.data.maintenance });
    rows.push([
      monthLabel(m), p.daysEntered, Math.round(p.fuelGallons), round2(p.fuelProfit), round2(p.insideSales), round2(p.insideProfit),
      round2(p.lotterySales), round2(p.lotteryProfit), round2(p.grossProfit), round2(p.cardFees),
      round2(p.fixed.reduce((a, e) => a + e.amount, 0)), round2(p.byCategory.reduce((a, c) => a + c.amount, 0)), round2(p.repairCost),
      round2(p.expenseTotal), round2(p.net), p.personalGallons || null, round2(p.personalCost),
    ]);
  }
  return rows;
}

const FILES = [
  { key: 'daily', label: 'Daily sales', hint: 'One row per day: fuel by grade, inside sales by group, lottery, tax, payments by type, cash, deposit and estimated fuel profit. Totals at the bottom.', build: dailySales },
  { key: 'summary', label: 'Monthly profit summary', hint: 'One row per month, as on the Monthly profit page. Inside profit and card fees are estimates from the rates in Settings.', build: monthlySummary },
  { key: 'expenses', label: 'Expenses', hint: 'Monthly bills, one-off expenses and repair costs.', build: expenses },
  { key: 'deliveries', label: 'Fuel deliveries', hint: 'Each delivery with invoice gallons, landed cost and ticket number.', build: deliveries },
  { key: 'deposits', label: 'Bank deposits', hint: 'Each day\'s deposit, when it was made and cleared, and any difference.', build: deposits },
  { key: 'house', label: 'House accounts', hint: 'Charges and payments on fleet/house accounts.', build: houseAccounts },
];

export function renderExport(ctx) {
  const today = calc.todayInNewYork();
  const lastMonth = calc.previousMonth(today.slice(0, 7));
  const { start, end } = calc.monthBounds(lastMonth);
  const range = chosen || { from: start, to: end };
  const counts = Object.fromEntries(FILES.map((f) => [f.key, Math.max(0, f.build(ctx, range.from, range.to).length - 1)]));
  const fileName = (f) => `usa-fuel-${f.key}-${range.from}-to-${range.to}.csv`;

  ctx.view.innerHTML = `
    ${ctx.banner()}
    <header class="page-head">
      <div><p class="eyebrow">Money</p><h1>Accountant export</h1></div>
    </header>
    <p class="intro">Spreadsheet files (CSV) that open in Excel, Google Sheets or QuickBooks. Pick a month or any range, then download what your accountant needs. The Monthly profit page can also be printed or saved as a PDF.</p>

    <section class="card">
      <h2 class="card__title">Dates</h2>
      <form class="export-range" data-range-form novalidate>
        <div class="fields">
          ${field({ name: 'month', label: 'A whole month', type: 'month', value: range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith('-01') && range.to === calc.monthBounds(range.from.slice(0, 7)).end ? range.from.slice(0, 7) : '' })}
          ${field({ name: 'from', label: 'Or from', type: 'date', value: range.from })}
          ${field({ name: 'to', label: 'To', type: 'date', value: range.to })}
        </div>
      </form>
      <p class="muted">${mediumDate(range.from)} – ${mediumDate(range.to)}</p>
    </section>

    <section class="card">
      <div class="card__head">
        <h2 class="card__title">Files</h2>
        <button class="btn btn--primary" type="button" data-download-all>Download all</button>
      </div>
      <ul class="export-list">${FILES.map((f) => `<li>
        <div><strong>${esc(f.label)}</strong> <span class="muted">· ${counts[f.key]} row${counts[f.key] === 1 ? '' : 's'}</span><p class="muted">${esc(f.hint)}</p></div>
        <button class="btn btn--ghost btn--small" type="button" data-download="${f.key}"${counts[f.key] ? '' : ' disabled'}>Download</button>
      </li>`).join('')}</ul>
      <p class="muted">"Download all" saves each file separately; your browser may ask once to allow multiple downloads. Fuel profit, inside profit and card fees are estimates from your entries and Settings; the deposits, payments and expenses are as entered.</p>
    </section>`;

  const form = ctx.view.querySelector('[data-range-form]');
  form.addEventListener('change', (event) => {
    const f = form.elements;
    if (event.target.name === 'month' && f.month.value) {
      const b = calc.monthBounds(f.month.value);
      chosen = { from: b.start, to: b.end };
    } else if (f.from.value && f.to.value) {
      if (f.to.value < f.from.value) return alert('"To" must be on or after "From".');
      chosen = { from: f.from.value, to: f.to.value };
    } else return;
    renderExport(ctx);
  });
  ctx.view.querySelectorAll('[data-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const f = FILES.find((x) => x.key === button.dataset.download);
      download(fileName(f), f.build(ctx, range.from, range.to));
    });
  });
  ctx.view.querySelector('[data-download-all]').addEventListener('click', async () => {
    const files = FILES.filter((f) => counts[f.key]);
    for (const f of files) {
      download(fileName(f), f.build(ctx, range.from, range.to));
      await new Promise((r) => setTimeout(r, 400));
    }
    toast(`Downloaded ${files.length} file${files.length === 1 ? '' : 's'}`);
  });
}
