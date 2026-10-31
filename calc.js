// Calculations for the daily report and the NYSDEC 10-day inventory reconciliation.
// Everything here is pure: (data, settings) in, numbers out.

export const GRADES = [
  { key: 'regular', label: 'Regular' },
  { key: 'mid', label: 'Mid-Grade' },
  { key: 'premium', label: 'Premium' },
  { key: 'diesel', label: 'Diesel' },
];

// Payment types every station has; more (gift card, check...) are added in Settings.
export const BASE_TENDERS = [
  { key: 'cash', label: 'Cash' },
  { key: 'credit', label: 'Credit cards', hint: 'Includes Apple Pay and Google Pay' },
  { key: 'debit', label: 'Debit cards' },
  { key: 'fleet', label: 'Fleet cards', hint: 'WEX, Fleetcor' },
  { key: 'house', label: 'House accounts', hint: 'Charged to fleet/house accounts' },
];

// Payment types for a day: the base ones, the ones from Settings, and "Other" on older days
// that used it.
export function tenderTypes(settings, day) {
  const types = [...BASE_TENDERS, ...(settings.paymentTypes || []).filter((t) => t.key && t.label)];
  if (day && has(day.tenders?.other) && !types.some((t) => t.key === 'other')) types.push({ key: 'other', label: 'Other' });
  return types;
}

// Where a Commander department can be entered besides the sales groups in Settings.
export const BUILTIN_GROUPS = [
  { key: 'fuel:regular', label: 'Fuel: Regular', type: 'fuel' },
  { key: 'fuel:mid', label: 'Fuel: Mid-Grade', type: 'fuel' },
  { key: 'fuel:premium', label: 'Fuel: Premium', type: 'fuel' },
  { key: 'fuel:diesel', label: 'Fuel: Diesel', type: 'fuel' },
  { key: 'manualFuel', label: 'Manual fuel sales', type: 'fuel' },
  { key: 'lottery:instant', label: 'Lottery: scratch-offs', type: 'lottery' },
  { key: 'lottery:online', label: 'Lottery: draw games', type: 'lottery' },
];

export const GROUP_TYPES = { inside: 'Inside', passthrough: 'Pass-through', fuel: 'Fuel', lottery: 'Lottery' };

export function mapTargets(settings) {
  return [...BUILTIN_GROUPS, ...settings.departments.map((d) => ({ key: d.key, label: d.label, type: d.type || 'inside' }))];
}

// Commander departments that add up into one target, for the hint under each entry field.
export function deptsFor(target, settings) {
  return (settings.deptMap || []).filter((m) => m.group === target && (m.number || m.name));
}

// NYSDEC worksheet: allowable variance = largest of (delivered, pumped, tank volume) x 0.0075
export const VARIANCE_RATE = 0.0075;
export const PERIOD_DAYS = 10;

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const has = (v) => v !== '' && v != null && Number.isFinite(Number(v));
const total = (values) => values.reduce((a, b) => a + b, 0);
const cents = (v) => Math.round(v * 100) / 100;

// ---- Dates (YYYY-MM-DD strings, handled in UTC so time zones never shift a day) ----

export function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function todayInNewYork() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

// ---- Daily report ----

export function summarizeDay(day, settings) {
  const fuel = GRADES.map((grade) => {
    const gallons = num(day.fuel?.[grade.key]?.gallons);
    const amount = num(day.fuel?.[grade.key]?.amount);
    return { ...grade, gallons, amount, perGallon: gallons ? amount / gallons : null };
  });
  const fuelGallons = total(fuel.map((f) => f.gallons));
  const gradeAmount = total(fuel.map((f) => f.amount));
  const manualFuel = num(day.fuel?.manual);
  const fuelAmount = gradeAmount + manualFuel;
  const driveOffAmount = num(day.driveOffs?.amount);
  const driveOffGallons = num(day.driveOffs?.gallons);

  const groups = settings.departments.map((d) => ({ ...d, type: d.type || 'inside', amount: num(day.departments?.[d.key]) }));
  const departments = groups.filter((d) => d.type === 'inside');
  const passthrough = groups.filter((d) => d.type === 'passthrough');
  const insideAmount = total(departments.map((d) => d.amount));
  const passthroughAmount = total(passthrough.map((d) => d.amount));

  const lotteryInstant = num(day.lottery?.instant);
  const lotteryOnline = num(day.lottery?.online);
  const lotterySales = lotteryInstant + lotteryOnline;
  // Older days had a separate "paid to lottery winners" field; it still comes out of cash.
  const lotteryPayouts = num(day.lottery?.payouts);

  const tax = num(day.tax);
  const totalSales = fuelAmount + insideAmount + lotterySales + tax;

  const tenders = tenderTypes(settings, day).map((t) => ({ ...t, amount: num(day.tenders?.[t.key]) }));
  const tenderTotal = total(tenders.map((t) => t.amount));
  const register = day.register || {};
  const openPrepays = num(register.openPrepays);
  // A drive-off was pumped but never paid; an open prepay was paid but not yet pumped.
  const payments = tenderTotal + driveOffAmount - openPrepays;
  const salesVsPayments = cents(totalSales + passthroughAmount - payments);

  const cash = day.cash || {};
  const startingBankOverride = has(cash.startingBank);
  const startingBank = startingBankOverride ? num(cash.startingBank) : num(settings.startingBank);
  const cashSales = num(day.tenders?.cash);
  const cashBack = num(cash.cashBack);
  const expectedCash = startingBank + cashSales + num(cash.payIns) - num(cash.payOuts)
    - (settings.cashBackNetted ? 0 : cashBack) - lotteryPayouts;
  const countedCash = has(cash.counted) ? num(cash.counted) : null;
  const overShort = countedCash == null ? null : cents(countedCash - expectedCash);

  const customers = num(day.customers);
  const counts = day.counts || {};

  return {
    fuel, fuelGallons, gradeAmount, manualFuel, fuelAmount, driveOffAmount, driveOffGallons,
    departments, insideAmount, passthrough, passthroughAmount,
    lotteryInstant, lotteryOnline, lotterySales, lotteryPayouts,
    tax, totalSales,
    tenders, tenderTotal, openPrepays, payments, salesVsPayments,
    batchTotal: has(register.batchTotal) ? num(register.batchTotal) : null,
    commanderSales: has(register.totalSales) ? num(register.totalSales) : null,
    commanderPayments: has(register.totalPayments) ? num(register.totalPayments) : null,
    startingBank, startingBankOverride, cashSales, payIns: num(cash.payIns), payOuts: num(cash.payOuts), cashBack,
    safeDrops: has(cash.safeDrops) ? num(cash.safeDrops) : null,
    cashiers: (day.cashiers || []).filter((c) => c && (c.name || has(c.safeDrops) || has(c.overShort))),
    expectedCash: cents(expectedCash), countedCash, overShort,
    deposit: has(cash.deposit) ? num(cash.deposit) : null,
    customers, averageSale: customers ? totalSales / customers : null,
    noSales: has(counts.noSales) ? num(counts.noSales) : null,
    voids: has(counts.voids) ? num(counts.voids) : null,
    refunds: has(counts.refunds) ? num(counts.refunds) : null,
    cashFlag: overShort != null && Math.abs(overShort) > num(settings.thresholds.cashOverShort),
    paymentsFlag: Math.abs(salesVsPayments) >= 0.01 && tenderTotal > 0,
  };
}

// Every check for one day: the two numbers compared, the difference, and whether it's
// within tolerance. `houseCharges` is the total charged to house accounts that day.
export function dayChecks(date, days, settings, { houseCharges = 0 } = {}) {
  const day = days[date];
  if (!day) return [];
  const s = summarizeDay(day, settings);
  const cashTolerance = num(settings.thresholds.cashOverShort);
  const gallonTolerance = num(settings.thresholds.tankDailyGallons);
  const checks = [];
  const add = (key, label, a, b, { unit = 'money', tolerance = 0.005, note = '' } = {}) => {
    const available = a[1] != null && b[1] != null;
    const diff = available ? (unit === 'money' ? cents(a[1] - b[1]) : Math.round(a[1] - b[1])) : null;
    checks.push({ key, label, a, b, diff, unit, note, available, ok: available ? Math.abs(diff) <= tolerance : null });
  };

  if (s.tenderTotal > 0) {
    add('payments', 'Sales vs payments', ['Sales + pass-through', cents(s.totalSales + s.passthroughAmount)], ['Payments', cents(s.payments)], {
      note: `Payments = all payment types${s.driveOffAmount ? ` + drive-offs ${money(s.driveOffAmount)}` : ''}${s.openPrepays ? ` − open prepays ${money(s.openPrepays)}` : ''}.`,
    });
  }
  if (s.commanderSales != null) add('commanderSales', 'Sales vs Commander', ['Our sales', cents(s.totalSales)], ['Commander total sales', s.commanderSales]);
  if (s.commanderPayments != null) add('commanderPayments', 'Payments vs Commander', ['Our payments', cents(s.payments)], ['Commander total payments', s.commanderPayments]);
  if (s.countedCash != null) {
    add('cash', 'Cash over/short', ['Counted', s.countedCash], ['Expected', s.expectedCash], { tolerance: cashTolerance });
  }
  if (s.deposit != null && s.countedCash != null) {
    const next = days[addDays(date, 1)];
    const nextBank = has(next?.cash?.startingBank) ? num(next.cash.startingBank) : has(settings.startingBank) ? num(settings.startingBank) : null;
    add('deposit', 'Bank deposit', ['Deposit', s.deposit], ['Counted − next starting bank', nextBank == null ? null : cents(s.countedCash - nextBank)], {
      note: nextBank == null ? 'Set the starting bank in Settings to check this.' : '',
    });
  }
  if (s.batchTotal != null) {
    const cards = total(s.tenders.filter((t) => ['credit', 'debit', 'fleet'].includes(t.key)).map((t) => t.amount));
    add('batch', 'Card batch', ['Network batch total', s.batchTotal], ['Credit + debit + fleet', cents(cards)]);
  }
  const house = num(day.tenders?.house);
  if (house || houseCharges) add('house', 'House accounts', ['Register', house], ['Charges entered', houseCharges]);

  for (const tank of settings.tanks) {
    const line = tankLine(date, tank, days, settings);
    if (line.overShort != null) {
      add(`tank:${tank.key}`, `${tank.product} tank`, ['TLS end volume', line.end], ['Book inventory', line.book], { unit: 'gal', tolerance: gallonTolerance });
    }
    line.deliveries.forEach((d, i) => {
      if (!has(d.measured) || !has(d.invoiceGallons)) return;
      const label = `${tank.product} delivery${line.deliveries.length > 1 ? ` ${i + 1}` : ''}${d.ticket ? ` (#${d.ticket})` : ''}`;
      const measured = Math.round(num(d.measured));
      const invoice = Math.round(num(d.invoiceGallons));
      // Only a shortfall is a problem: the tank went up by less than the invoice says.
      checks.push({
        key: `delivery:${tank.key}:${i}`, label, a: ['TLS measured increase', measured], b: ['Invoice gallons', invoice],
        diff: measured - invoice, unit: 'gal', note: '', available: true, ok: invoice - measured <= gallonTolerance,
      });
    });
  }
  return checks;
}

const money = (v) => `$${v.toFixed(2)}`;

// ---- Tanks ----

// How many gallons of each grade come out of each tank. Mid-grade is blended at the
// dispenser from the regular and premium tanks.
export function tankWeights(tank, settings) {
  const regularShare = num(settings.blendRegularPct) / 100;
  if (tank.role === 'regular') return { regular: 1, mid: regularShare };
  if (tank.role === 'premium') return { premium: 1, mid: 1 - regularShare };
  if (tank.role === 'diesel') return { diesel: 1 };
  return {};
}

export function pumpedFromSales(day, tank, settings) {
  const weights = tankWeights(tank, settings);
  return Math.round(total(Object.entries(weights).map(([grade, w]) => num(day.fuel?.[grade]?.gallons) * w)));
}

// The TLS-350 volume used for inventory: gross (Volume) or temperature-corrected (TC Volume).
export function endVolume(reading, settings) {
  const value = settings.volumeBasis === 'tc' ? reading?.endTc : reading?.endGallons;
  return has(value) ? Math.round(num(value)) : null;
}

// Deliveries into a tank on a day. Older days stored one delivery as delivered/cost/ticket.
export function deliveriesOf(reading) {
  if (Array.isArray(reading?.deliveries)) return reading.deliveries.filter((d) => d && (has(d.invoiceGallons) || has(d.measured)));
  if (has(reading?.delivered) && num(reading.delivered) > 0) {
    return [{ invoiceGallons: reading.delivered, cost: reading.cost ?? '', ticket: reading.ticket || '', measured: '' }];
  }
  return [];
}

// One tank's line for one day: start + delivered - pumped = book; end - book = over/short.
// Start defaults to the previous day's ending inventory. Delivered is invoice gallons.
export function tankLine(date, tank, days, settings) {
  const day = days[date];
  const reading = day?.tanks?.[tank.key] || {};
  const previous = days[addDays(date, -1)]?.tanks?.[tank.key];
  const previousEnd = endVolume(previous, settings);

  let start = null;
  if (has(reading.start)) start = Math.round(num(reading.start));
  else if (previousEnd != null) start = previousEnd;

  const deliveries = deliveriesOf(reading);
  const delivered = Math.round(total(deliveries.map((d) => num(d.invoiceGallons))));
  const pumped = day ? (has(reading.pumped) ? Math.round(num(reading.pumped)) : pumpedFromSales(day, tank, settings)) : null;
  const end = endVolume(reading, settings);
  const book = start == null || pumped == null ? null : start + delivered - pumped;
  const overShort = book == null || end == null ? null : end - book;

  const water = has(reading.water) ? num(reading.water) : null;
  const previousWater = previous && has(previous.water) ? num(previous.water) : null;
  const waterRise = water != null && previousWater != null ? water - previousWater : null;

  return {
    date,
    entered: Boolean(day),
    time: reading.time || '',
    start,
    startIsCarried: !has(reading.start) && start != null,
    deliveries,
    delivered,
    ticket: deliveries.map((d) => d.ticket).filter(Boolean).join(', '),
    pumped,
    pumpedIsOverride: has(reading.pumped),
    book,
    endInches: has(reading.endInches) ? num(reading.endInches) : null,
    end,
    overShort,
    overFlag: overShort != null && Math.abs(overShort) > num(settings.thresholds.tankDailyGallons),
    water,
    waterFlag: waterRise != null && waterRise >= num(settings.thresholds.waterIncrease),
    complete: overShort != null,
  };
}

// Running over/short for a tank: the 10-day period and the month up to `date`.
export function tankRunning(date, tank, days, settings) {
  const sum = (from) => {
    let value = 0;
    let counted = 0;
    for (let d = from; d <= date; d = addDays(d, 1)) {
      const line = tankLine(d, tank, days, settings);
      if (line.overShort != null) { value += line.overShort; counted += 1; }
    }
    return { value, counted };
  };
  const periodStart = date >= settings.reconStart ? periodStartFor(date, settings) : date;
  return { period: sum(periodStart), periodStart, month: sum(`${date.slice(0, 7)}-01`) };
}

// ---- 10-day periods ----

export function periodStartFor(date, settings) {
  const offset = daysBetween(settings.reconStart, date);
  const index = Math.floor(offset / PERIOD_DAYS);
  return addDays(settings.reconStart, index * PERIOD_DAYS);
}

export function periodDates(start) {
  return Array.from({ length: PERIOD_DAYS }, (_, i) => addDays(start, i));
}

export function reconcileTank(start, tank, days, settings) {
  const rows = periodDates(start).map((date) => tankLine(date, tank, days, settings));
  const done = rows.filter((r) => r.complete);
  const delivered = total(rows.map((r) => r.delivered));
  const pumped = total(rows.map((r) => r.pumped || 0));
  const capacity = num(tank.capacity);
  const largest = Math.max(delivered, pumped, capacity);
  const allowable = Math.round(largest * VARIANCE_RATE * 10) / 10;
  const overShort = total(done.map((r) => r.overShort));

  return {
    tank,
    start,
    end: addDays(start, PERIOD_DAYS - 1),
    rows,
    daysEntered: done.length,
    complete: done.length === PERIOD_DAYS,
    delivered,
    pumped,
    capacity,
    largest,
    largestLabel: largest === capacity ? 'tank volume' : largest === delivered ? 'gallons delivered' : 'gallons pumped',
    allowable,
    overShort,
    exceeds: Math.abs(overShort) > allowable,
    waterFlag: rows.some((r) => r.waterFlag),
  };
}

export function reconcilePeriod(start, days, settings) {
  return settings.tanks.map((tank) => reconcileTank(start, tank, days, settings));
}

export function periodStarts(settings, upTo) {
  const starts = [];
  for (let s = settings.reconStart; s <= upTo; s = addDays(s, PERIOD_DAYS)) starts.push(s);
  return starts;
}

export function nowInNewYork() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// ---- Fuel cost and margin ----

// Average cost per gallon of the fuel in each tank at the end of each day. A delivery
// blends its invoice cost with the fuel already in the tank, weighted by gallons.
export function tankCosts(days, settings) {
  const average = Object.fromEntries(settings.tanks.map((t) => [t.key, has(t.startCost) ? num(t.startCost) : null]));
  const byDate = {};
  for (const date of Object.keys(days).sort()) {
    for (const tank of settings.tanks) {
      const deliveries = deliveriesOf(days[date].tanks?.[tank.key]);
      let volume = null;
      for (const d of deliveries) {
        const gallons = num(d.invoiceGallons);
        if (gallons <= 0 || !has(d.cost)) continue;
        if (volume == null) volume = tankLine(date, tank, days, settings).start || 0;
        const current = average[tank.key];
        average[tank.key] = current == null || volume <= 0 ? num(d.cost) : (volume * current + gallons * num(d.cost)) / (volume + gallons);
        volume += gallons;
      }
    }
    byDate[date] = { ...average };
  }
  return byDate;
}

// Cost per gallon by grade; mid-grade is the blend of the regular and premium tanks.
export function gradeCosts(costsByTank, settings) {
  const forRole = (role) => {
    const tank = settings.tanks.find((t) => t.role === role);
    return tank ? costsByTank?.[tank.key] ?? null : null;
  };
  const regular = forRole('regular');
  const premium = forRole('premium');
  const share = num(settings.blendRegularPct) / 100;
  return {
    regular,
    premium,
    diesel: forRole('diesel'),
    mid: regular != null && premium != null ? regular * share + premium * (1 - share) : null,
  };
}

// Realized margin for a day: what each gallon actually sold for, less what it cost.
export function dayMargin(day, costs) {
  const grades = GRADES.map((grade) => {
    const gallons = num(day.fuel?.[grade.key]?.gallons);
    const amount = num(day.fuel?.[grade.key]?.amount);
    const cost = costs[grade.key];
    const price = gallons ? amount / gallons : null;
    return {
      ...grade,
      gallons,
      amount,
      price,
      cost,
      margin: price != null && cost != null ? price - cost : null,
      profit: gallons && cost != null ? amount - gallons * cost : null,
    };
  });
  const sold = grades.filter((g) => g.gallons > 0);
  const known = sold.filter((g) => g.profit != null);
  const gallons = total(known.map((g) => g.gallons));
  const profit = total(known.map((g) => g.profit));
  return { grades, profit: known.length ? profit : null, perGallon: gallons ? profit / gallons : null, complete: known.length === sold.length };
}

// The posted prices in effect at a moment (YYYY-MM-DDTHH:MM, New York time).
export function pricesAt(priceChanges, when) {
  return priceChanges
    .filter((p) => p.effectiveAt <= when)
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
    .at(-1) || null;
}

// ---- Bank deposits ----

export function depositState(date, day, record, settings, today) {
  const amount = has(day?.cash?.deposit) ? cents(num(day.cash.deposit)) : null;
  if (!amount) return { state: 'none', amount };
  const r = record || {};
  if (r.clearedOn) {
    const clearedAmount = has(r.clearedAmount) ? cents(num(r.clearedAmount)) : amount;
    const difference = cents(clearedAmount - amount);
    return { state: difference ? 'mismatch' : 'cleared', amount, clearedAmount, difference };
  }
  if (r.depositedOn) {
    const waiting = daysBetween(r.depositedOn, today);
    return { state: waiting > num(settings.thresholds.clearDays) ? 'late' : 'transit', amount, waiting };
  }
  const age = daysBetween(date, today);
  return { state: age > num(settings.thresholds.depositDays) ? 'overdue' : 'pending', amount, age };
}

// ---- House accounts ----

export const PRODUCTS = [...GRADES, { key: 'inside', label: 'Inside purchase' }];

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

// Fuel charges earn the account's fixed cents-off discount; inside purchases don't.
export function chargeDiscount(charge, account) {
  return charge.product === 'inside' ? 0 : cents((num(charge.gallons) * num(account?.discountCents)) / 100);
}

export function balanceThrough(account, charges, payments, date) {
  const charged = charges.filter((c) => c.accountId === account.id && c.day <= date);
  const paid = payments.filter((p) => p.accountId === account.id && p.day <= date);
  return cents(total(charged.map((c) => num(c.amount) - chargeDiscount(c, account))) - total(paid.map((p) => num(p.amount))));
}

// One month's statement, with charges grouped by truck (unit).
export function statement(account, charges, payments, month, settings) {
  const { start, end } = monthBounds(month);
  const inPeriod = (r) => r.accountId === account.id && r.day >= start && r.day <= end;
  const periodCharges = charges.filter(inPeriod).sort((a, b) => a.day.localeCompare(b.day));
  const groups = [];
  for (const charge of periodCharges) {
    const unit = charge.unit || 'No unit given';
    let group = groups.find((g) => g.unit === unit);
    if (!group) {
      const vehicle = (account.vehicles || []).find((v) => v.unit === charge.unit);
      group = { unit, vehicle: vehicle?.vehicle || '', lines: [] };
      groups.push(group);
    }
    group.lines.push({ ...charge, discount: chargeDiscount(charge, account) });
  }
  for (const group of groups) {
    group.gallons = total(group.lines.filter((l) => l.product !== 'inside').map((l) => num(l.gallons)));
    group.amount = cents(total(group.lines.map((l) => num(l.amount))));
    group.discount = cents(total(group.lines.map((l) => l.discount)));
  }
  groups.sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true }));

  const periodPayments = payments.filter(inPeriod).sort((a, b) => a.day.localeCompare(b.day));
  const previous = balanceThrough(account, charges, payments, addDays(start, -1));
  const chargesTotal = cents(total(groups.map((g) => g.amount)));
  const discountTotal = cents(total(groups.map((g) => g.discount)));
  const paymentsTotal = cents(total(periodPayments.map((p) => num(p.amount))));
  return {
    account,
    month,
    start,
    end,
    due: addDays(end, num(settings.houseAccounts.termsDays)),
    previous,
    groups,
    payments: periodPayments,
    gallons: total(groups.map((g) => g.gallons)),
    chargesTotal,
    discountTotal,
    paymentsTotal,
    balance: cents(previous + chargesTotal - discountTotal - paymentsTotal),
  };
}

// Balance today, and how much of it is past its due date.
export function accountSummary(account, charges, payments, settings, today) {
  const balance = balanceThrough(account, charges, payments, today);
  let month = previousMonth(today.slice(0, 7));
  if (addDays(monthBounds(month).end, num(settings.houseAccounts.termsDays)) >= today) month = previousMonth(month);
  const { end } = monthBounds(month);
  const owed = balanceThrough(account, charges, payments, end);
  const paidSince = total(payments.filter((p) => p.accountId === account.id && p.day > end && p.day <= today).map((p) => num(p.amount)));
  const thisMonth = monthBounds(today.slice(0, 7));
  const monthCharges = cents(total(charges
    .filter((c) => c.accountId === account.id && c.day >= thisMonth.start && c.day <= today)
    .map((c) => num(c.amount))));
  const lastPayment = payments.filter((p) => p.accountId === account.id).sort((a, b) => a.day.localeCompare(b.day)).at(-1) || null;
  return { balance, pastDue: Math.max(0, cents(owed - paidSince)), monthCharges, lastPayment };
}

// Total rung up to house accounts on a day, to compare with the register's house-account total.
export function houseChargesOn(date, charges) {
  return cents(total(charges.filter((c) => c.day === date).map((c) => num(c.amount))));
}

// ---- Website content ----

export function activeDeals(content, today) {
  return (content?.deals?.items || []).filter((d) => d.active !== false && (!d.start || d.start <= today) && (!d.end || d.end >= today));
}

export function holidayOn(content, date) {
  return (content?.holiday_hours?.items || []).find((h) => h.date === date) || null;
}
