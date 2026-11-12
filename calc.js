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

// Fuel the owner put in personal vehicles. How each fill-up was handled:
//   'unpaid' - rung on the register (in Commander's fuel sales) but never paid
//   'paid'   - rung up and paid (own card or cash): a normal sale, kept as a record only
//   'off'    - pumped without the register: not in the sales gallons
// Older rows used onRegister true/false for 'unpaid'/'off'.
export const PERSONAL_MODES = [
  ['unpaid', 'Rung up, not paid'],
  ['paid', 'Rung up and paid'],
  ['off', 'Pumped without the register'],
];

export const personalMode = (p) => p.mode || (p.onRegister === false ? 'off' : 'unpaid');

export function personalFuel(day) {
  const rows = (day.personal || []).filter((p) => p && GRADES.some((g) => g.key === p.grade) && num(p.gallons) > 0);
  const byGrade = Object.fromEntries(GRADES.map((g) => [g.key, { gallons: 0, amount: 0, offGallons: 0 }]));
  for (const p of rows) {
    const mode = personalMode(p);
    if (mode === 'off') byGrade[p.grade].offGallons += num(p.gallons);
    else if (mode === 'unpaid') {
      byGrade[p.grade].gallons += num(p.gallons);
      byGrade[p.grade].amount += num(p.amount);
    }
  }
  // Unpaid and off-register fuel is the owner's draw; paid fuel was bought like any sale.
  const drawRows = rows.filter((p) => personalMode(p) !== 'paid');
  return {
    rows,
    drawRows,
    byGrade,
    gallons: total(rows.map((p) => num(p.gallons))),
    drawGallons: total(drawRows.map((p) => num(p.gallons))),
    registerAmount: total(Object.values(byGrade).map((g) => g.amount)),
  };
}

// Cash paid out of the drawer, one entry per payment: who was paid and what for.
export const PAYOUT_REASONS = [
  ['lottery', 'Lottery winner'],
  ['merchandise', 'Merchandise / vendor'],
  ['supplies', 'Store supplies'],
  ['repairs', 'Repairs'],
  ['wages', 'Wages'],
  ['refund', 'Customer refund'],
  ['other', 'Other'],
];
export const payoutReasonLabel = (key) => (PAYOUT_REASONS.find(([k]) => k === key) || [, 'Other'])[1];

// Itemized pay outs. Older days have one total in cash.payOuts and no list.
export function payoutList(day) {
  return (day?.payouts || [])
    .filter((p) => p && has(p.amount))
    .map((p) => ({ to: String(p.to || '').trim(), reason: p.reason || 'other', amount: num(p.amount), note: String(p.note || '').trim() }));
}

export function payoutTotal(day) {
  const list = payoutList(day);
  return list.length ? cents(total(list.map((p) => p.amount))) : num(day?.cash?.payOuts);
}

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
  const personal = personalFuel(day);
  const personalAmount = personal.registerAmount;
  // A drive-off was pumped but never paid; so was personal fuel rung on the register.
  // An open prepay was paid but not yet pumped.
  const payments = tenderTotal + driveOffAmount + personalAmount - openPrepays;
  const salesVsPayments = cents(totalSales + passthroughAmount - payments);

  const cash = day.cash || {};
  const startingBankOverride = has(cash.startingBank);
  const startingBank = startingBankOverride ? num(cash.startingBank) : num(settings.startingBank);
  const cashSales = num(day.tenders?.cash);
  const cashBack = num(cash.cashBack);
  const payOuts = payoutTotal(day);
  const expectedCash = startingBank + cashSales + num(cash.payIns) - payOuts
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
    personalGallons: personal.gallons, personalAmount,
    batchTotal: has(register.batchTotal) ? num(register.batchTotal) : null,
    commanderSales: has(register.totalSales) ? num(register.totalSales) : null,
    commanderPayments: has(register.totalPayments) ? num(register.totalPayments) : null,
    startingBank, startingBankOverride, cashSales, payIns: num(cash.payIns), payOuts, payouts: payoutList(day), cashBack,
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
      note: `Payments = all payment types${s.driveOffAmount ? ` + drive-offs ${money(s.driveOffAmount)}` : ''}${s.personalAmount ? ` + personal fuel ${money(s.personalAmount)}` : ''}${s.openPrepays ? ` − open prepays ${money(s.openPrepays)}` : ''}.`,
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
  // Personal fuel pumped outside the register isn't in the sales gallons, but left the tank.
  const off = personalFuel(day).byGrade;
  return Math.round(total(Object.entries(weights).map(([grade, w]) => (num(day.fuel?.[grade]?.gallons) + (off[grade]?.offGallons || 0)) * w)));
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
  const personal = personalFuel(day).byGrade;
  const grades = GRADES.map((grade) => {
    // Personal fuel rung on the register isn't a sale; leave it out of profit.
    const gallons = Math.max(0, num(day.fuel?.[grade.key]?.gallons) - personal[grade.key].gallons);
    const amount = Math.max(0, num(day.fuel?.[grade.key]?.amount) - personal[grade.key].amount);
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
  // What the personal fuel cost (the owner's draw), at the tanks' average cost.
  const draw = personalFuel(day).drawRows;
  const personalCost = draw.length && draw.every((p) => costs[p.grade] != null)
    ? total(draw.map((p) => num(p.gallons) * costs[p.grade])) : draw.length ? null : 0;
  return { grades, profit: known.length ? profit : null, perGallon: gallons ? profit / gallons : null, complete: known.length === sold.length, personalCost };
}

// The posted prices in effect at a moment (YYYY-MM-DDTHH:MM, New York time).
export function pricesAt(priceChanges, when) {
  return priceChanges
    .filter((p) => p.effectiveAt <= when)
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
    .at(-1) || null;
}

// The prices for one report: what's on the report, otherwise the log at the end of that day.
export function dayPrices(day, priceChanges, date) {
  const logged = pricesAt(priceChanges, `${date}T23:59`);
  const level = (name) => Object.fromEntries(GRADES.map((g) => [g.key, has(day?.prices?.[name]?.[g.key]) ? String(day.prices[name][g.key]) : String(logged?.[name]?.[g.key] ?? '')]));
  return { cash: level('cash'), credit: level('credit') };
}

// Starting prices for a new report: the last report's, unless a newer price change is logged.
export function defaultPrices(date, days, priceChanges) {
  const previous = Object.keys(days).filter((d) => d < date).sort().at(-1);
  const prices = dayPrices(days[previous], priceChanges, date);
  const logged = pricesAt(priceChanges, `${date}T23:59`);
  if (logged?.effectiveAt > `${previous}T23:59`) {
    for (const level of ['cash', 'credit']) {
      for (const g of GRADES) if (has(logged[level]?.[g.key])) prices[level][g.key] = String(logged[level][g.key]);
    }
  }
  return prices;
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

// ---- Fuel ordering ----

// Where each tank stands at the last reading, how fast it's selling, and how much fits.
export function tankOutlook(tank, days, settings, today) {
  const dates = Object.keys(days).filter((d) => d <= today).sort();
  const latest = dates.slice().reverse().find((d) => endVolume(days[d].tanks?.[tank.key], settings) != null) || null;
  const recent = dates.slice(-7).map((d) => tankLine(d, tank, days, settings).pumped).filter((v) => v != null && v > 0);
  const perDay = recent.length ? total(recent) / recent.length : null;
  const capacity = num(tank.capacity);
  const leadDays = num(settings.ordering?.leadDays ?? 1);
  // Without a set reorder level: keep two days of sales beyond the delivery lead time,
  // and never go under 10% of the tank.
  const reorderAt = has(tank.reorderAt)
    ? num(tank.reorderAt)
    : Math.round(Math.max(capacity * 0.1, (perDay || 0) * (leadDays + 2)) / 100) * 100;
  const maxFill = Math.round(capacity * num(settings.ordering?.maxFillPct || 90) / 100);
  if (!latest) return { tank, latest: null, perDay, capacity, reorderAt, maxFill, state: 'unknown' };

  const level = endVolume(days[latest].tanks[tank.key], settings);
  // Readings are taken at close; take off what has sold since then (whole days only).
  const elapsed = Math.max(0, daysBetween(latest, today) - 1);
  const estimate = perDay == null ? level : Math.max(0, Math.round(level - perDay * elapsed));
  const daysOfSupply = perDay ? estimate / perDay : null;
  const daysToReorder = perDay ? (estimate - reorderAt) / perDay : null;
  const room = Math.max(0, Math.floor((maxFill - estimate) / 100) * 100);
  let state = 'ok';
  if (estimate <= reorderAt || (daysToReorder != null && daysToReorder <= leadDays)) state = 'order';
  else if (daysToReorder != null && daysToReorder <= leadDays + 2) state = 'soon';
  return {
    tank, latest, level, estimate, elapsed, perDay, samples: recent.length, capacity, reorderAt, maxFill, leadDays,
    daysOfSupply, daysToReorder, room, fullPct: capacity ? estimate / capacity : null, state,
    reorderDate: daysToReorder == null ? null : addDays(today, Math.max(0, Math.floor(daysToReorder))),
  };
}

// ---- Cash vs credit ----

// Gallons and dollars sold at the cash and credit price for one grade on one day. Uses the
// split typed from Commander when there is one; otherwise works it out from the day's gallons,
// dollars and posted prices (only exact when prices didn't change that day).
export function priceLevelSplit(day, gradeKey, priceChanges, date) {
  const personal = personalFuel(day).byGrade[gradeKey];
  const gallons = Math.max(0, num(day.fuel?.[gradeKey]?.gallons) - personal.gallons);
  const amount = Math.max(0, num(day.fuel?.[gradeKey]?.amount) - personal.amount);
  if (!gallons) return null;
  const prices = dayPrices(day, priceChanges, date);
  const cashPrice = prices.cash[gradeKey] ? num(prices.cash[gradeKey]) : null;
  const creditPrice = prices.credit[gradeKey] ? num(prices.credit[gradeKey]) : null;
  const typed = day.fuel?.[gradeKey]?.cashGallons;
  if (has(typed)) {
    const cashGallons = Math.min(gallons, Math.max(0, num(typed)));
    const cashAmount = cashPrice != null ? cashGallons * cashPrice : (amount / gallons) * cashGallons;
    return { gallons, amount, cashGallons, creditGallons: gallons - cashGallons, cashAmount, creditAmount: amount - cashAmount, exact: true, reliable: true };
  }
  if (cashPrice == null || creditPrice == null || creditPrice <= cashPrice) return { gallons, amount, cashGallons: null, creditGallons: null, exact: false, reliable: false, reason: 'Log both cash and credit prices to split this grade.' };
  const changedToday = priceChanges.some((p) => p.effectiveAt.slice(0, 10) === date && pricesAt(priceChanges, `${date}T00:00`));
  const raw = (gallons * creditPrice - amount) / (creditPrice - cashPrice);
  const cashGallons = Math.min(gallons, Math.max(0, raw));
  const clamped = raw < -0.5 || raw > gallons + 0.5;
  const cashAmount = cashGallons * cashPrice;
  return {
    gallons, amount, cashGallons, creditGallons: gallons - cashGallons, cashAmount, creditAmount: amount - cashAmount,
    exact: false, reliable: !changedToday && !clamped,
    reason: changedToday ? 'Prices changed during the day, so this is an estimate.' : clamped ? "The day's dollars don't fit the posted prices (discounts?), so this is an estimate." : '',
  };
}

// Cash and credit profit for one grade-day, with card fees taken off credit-price sales.
export function priceLevelProfit(split, cost, settings) {
  if (!split || split.cashGallons == null || cost == null) return null;
  const feeRate = num(settings.cards?.feePct) / 100;
  const fees = split.creditAmount * feeRate;
  return {
    cashProfit: split.cashAmount - split.cashGallons * cost,
    creditProfit: split.creditAmount - split.creditGallons * cost - fees,
    fees,
  };
}

// ---- Monthly profit ----

export const EXPENSE_CATEGORIES = [
  ['payroll', 'Payroll'], ['rent', 'Rent / mortgage'], ['utilities', 'Utilities'], ['insurance', 'Insurance'],
  ['repairs', 'Repairs & maintenance'], ['supplies', 'Supplies'], ['fees', 'Bank & card fees'], ['taxes', 'Taxes & licenses'],
  ['professional', 'Accounting & legal'], ['other', 'Other'],
];

const categoryName = (key) => (EXPENSE_CATEGORIES.find(([k]) => k === key) || [key, 'Other'])[1];

// One day's profit before expenses. `day` is null for a date that only has an expense.
function dayProfitRow(date, day, margin, groups, feeRate, commissionRate, settings, priceChanges) {
  const grades = margin ? margin.grades.filter((g) => g.gallons > 0) : [];
  // Cash-price vs credit-price fuel, before card fees (fees come off the day's card sales below).
  const levels = grades.map((g) => {
    const split = day ? priceLevelSplit(day, g.key, priceChanges, date) : null;
    if (!split || split.cashGallons == null || g.cost == null) {
      return { key: g.key, label: g.label, split: false, reason: g.cost == null ? 'No cost for this grade yet.' : split?.reason || 'Not split.' };
    }
    return {
      key: g.key, label: g.label, split: true, exact: split.exact, reliable: split.reliable, reason: split.reason || '',
      cashGallons: split.cashGallons, creditGallons: split.creditGallons,
      cashAmount: split.cashAmount, creditAmount: split.creditAmount,
      cashPrice: split.cashGallons ? split.cashAmount / split.cashGallons : null,
      creditPrice: split.creditGallons ? split.creditAmount / split.creditGallons : null,
      cashProfit: split.cashAmount - split.cashGallons * g.cost,
      creditProfit: split.creditAmount - split.creditGallons * g.cost,
    };
  });
  const splitRows = levels.filter((l) => l.split);
  const tenders = day ? tenderTypes(settings, day).map((t) => ({ key: t.key, label: t.label, amount: num(day.tenders?.[t.key]) })).filter((t) => t.amount) : [];
  const inside = Object.values(groups)
    .map((g) => {
      const sales = num(day?.departments?.[g.key]);
      return { key: g.key, label: g.label, sales, marginPct: g.marginPct, profit: has(g.marginPct) ? sales * num(g.marginPct) / 100 : null };
    })
    .filter((g) => g.sales);
  const insideSales = total(inside.map((g) => g.sales));
  const insideProfit = total(inside.map((g) => g.profit || 0));
  const lotterySales = num(day?.lottery?.instant) + num(day?.lottery?.online);
  const lotteryProfit = commissionRate == null ? null : lotterySales * commissionRate;
  const cardSales = num(day?.tenders?.credit) + num(day?.tenders?.debit) + num(day?.tenders?.fleet);
  const fuelProfit = margin?.profit ?? null;
  return {
    date,
    hasReport: Boolean(day),
    grades,
    gallons: total(grades.map((g) => g.gallons)),
    fuelSales: total(grades.map((g) => g.amount)) + num(day?.fuel?.manual),
    manualFuel: num(day?.fuel?.manual),
    fuelProfit,
    perGallon: margin?.perGallon ?? null,
    fuelComplete: margin ? margin.complete : true,
    levels,
    cashGallons: total(splitRows.map((l) => l.cashGallons)),
    creditGallons: total(splitRows.map((l) => l.creditGallons)),
    cashFuelProfit: splitRows.length ? total(splitRows.map((l) => l.cashProfit)) : null,
    creditFuelProfit: splitRows.length ? total(splitRows.map((l) => l.creditProfit)) : null,
    splitComplete: splitRows.length === levels.length,
    splitEstimated: splitRows.some((l) => !l.exact),
    tenders,
    tenderTotal: total(tenders.map((t) => t.amount)),
    inside, insideSales, insideProfit,
    insideComplete: inside.every((g) => g.profit != null),
    lotterySales, lotteryProfit,
    grossProfit: (fuelProfit || 0) + insideProfit + (lotteryProfit || 0),
    cardSales,
    cardFees: feeRate == null ? null : cardSales * feeRate,
    personalCost: margin?.personalCost || 0,
  };
}

export function monthProfit(month, days, settings, { priceChanges = [], expenses = [], maintenance = [] } = {}) {
  const { start, end } = monthBounds(month);
  const dates = Object.keys(days).filter((d) => d >= start && d <= end).sort();
  const costsByDate = tankCosts(days, settings);
  let fuelProfit = 0;
  let fuelKnown = false;
  let fuelGallons = 0;
  let cardSales = 0;
  let lotterySales = 0;
  let personalGallons = 0;
  let personalCost = 0;
  const groups = Object.fromEntries(settings.departments.filter((d) => (d.type || 'inside') === 'inside').map((d) => [d.key, { ...d, sales: 0 }]));
  const feeRate = has(settings.cards?.feePct) ? num(settings.cards.feePct) / 100 : null;
  const commissionRate = has(settings.lottery?.commissionPct) ? num(settings.lottery.commissionPct) / 100 : null;
  const daily = [];
  for (const date of dates) {
    const day = days[date];
    const margin = dayMargin(day, gradeCosts(costsByDate[date], settings));
    daily.push(dayProfitRow(date, day, margin, groups, feeRate, commissionRate, settings, priceChanges));
    if (margin.profit != null) { fuelProfit += margin.profit; fuelKnown = true; }
    const personal = personalFuel(day);
    personalGallons += personal.drawGallons;
    if (personal.drawGallons) personalCost = margin.personalCost == null || personalCost == null ? null : personalCost + margin.personalCost;
    fuelGallons += total(margin.grades.map((g) => g.gallons));
    cardSales += num(day.tenders?.credit) + num(day.tenders?.debit) + num(day.tenders?.fleet);
    lotterySales += num(day.lottery?.instant) + num(day.lottery?.online);
    for (const key of Object.keys(groups)) groups[key].sales += num(day.departments?.[key]);
  }
  const inside = Object.values(groups).map((g) => ({ ...g, profit: has(g.marginPct) ? g.sales * num(g.marginPct) / 100 : null }));
  const insideSales = total(inside.map((g) => g.sales));
  const insideProfit = total(inside.map((g) => g.profit || 0));
  const insideMissing = inside.filter((g) => g.sales > 0 && g.profit == null);
  const lotteryProfit = has(settings.lottery?.commissionPct) ? lotterySales * num(settings.lottery.commissionPct) / 100 : null;
  const grossProfit = (fuelKnown ? fuelProfit : 0) + insideProfit + (lotteryProfit || 0);

  const cardFees = has(settings.cards?.feePct) ? cardSales * num(settings.cards.feePct) / 100 : null;
  const fixed = (settings.fixedExpenses || []).filter((e) => has(e.amount)).map((e) => ({ label: e.label, amount: num(e.amount) }));
  const inMonth = (r) => r.day >= start && r.day <= end;
  const oneOff = expenses.filter(inMonth);
  const repairs = maintenance.filter(inMonth).filter((m) => has(m.cost));
  const byCategory = EXPENSE_CATEGORIES.map(([key, label]) => ({ key, label, amount: total(oneOff.filter((e) => (e.category || 'other') === key).map((e) => num(e.amount))) }))
    .filter((c) => c.amount);
  const repairCost = total(repairs.map((m) => num(m.cost)));
  const expenseTotal = (cardFees || 0) + total(fixed.map((e) => e.amount)) + total(byCategory.map((c) => c.amount)) + repairCost;
  const net = grossProfit - expenseTotal;

  // Gallons a day needed to cover expenses, after inside and lottery profit.
  const daysInMonth = daysBetween(start, end) + 1;
  const perGallon = fuelKnown && fuelGallons ? fuelProfit / fuelGallons : null;
  const fromFuel = expenseTotal - insideProfit - (lotteryProfit || 0);
  const breakEvenPerDay = perGallon && perGallon > 0 ? Math.max(0, fromFuel) / perGallon / daysInMonth : null;

  // Day by day: monthly bills spread evenly over the month; one-off expenses and repairs on
  // the day they're dated (a dated expense on a day with no report still gets a row).
  const billsPerDay = total(fixed.map((e) => e.amount)) / daysInMonth;
  const dated = (date) => [
    ...oneOff.filter((e) => e.day === date).map((e) => ({ label: categoryName(e.category), detail: [e.vendor, e.note].filter(Boolean).join(' · '), amount: num(e.amount) })),
    ...repairs.filter((m) => m.day === date).map((m) => ({ label: 'Repairs', detail: [m.problem || m.action, m.vendor].filter(Boolean).join(' · '), amount: num(m.cost) })),
  ];
  for (const date of new Set([...oneOff.map((e) => e.day), ...repairs.map((m) => m.day)])) {
    if (!days[date]) daily.push(dayProfitRow(date, null, null, groups, feeRate, commissionRate, settings, priceChanges));
  }
  for (const row of daily) {
    row.expenses = dated(row.date);
    row.expenseAmount = total(row.expenses.map((e) => e.amount));
    row.bills = row.hasReport ? billsPerDay : 0;
    row.net = row.grossProfit - (row.cardFees || 0) - row.expenseAmount - row.bills;
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  return {
    month, start, end, dates, daysEntered: dates.length, daysInMonth,
    fuelProfit: fuelKnown ? fuelProfit : null, fuelGallons, perGallon,
    inside, insideSales, insideProfit, insideMissing,
    lotterySales, lotteryProfit,
    grossProfit,
    cardSales, cardFees, fixed, oneOff, byCategory, repairs, repairCost, expenseTotal, net,
    breakEvenPerDay, gallonsPerDay: dates.length ? fuelGallons / dates.length : null,
    daily, billsPerDay,
    personalGallons, personalCost,
  };
}

// ---- Compliance calendar and inspections ----

export function addInterval(date, every, unit) {
  const [y, m, d] = date.split('-').map(Number);
  const n = num(every);
  if (unit === 'days') return addDays(date, n);
  const months = unit === 'years' ? n * 12 : n;
  // Same day of the month, or the month's last day if it's shorter.
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export function complianceStatus(item, today, soonDays = 30) {
  const lastDone = (item.history || []).map((h) => h.date).filter(Boolean).sort().at(-1) || item.lastDone || '';
  const due = item.dueDate || (lastDone && has(item.every) ? addInterval(lastDone, item.every, item.unit || 'years') : '');
  if (!due) return { lastDone, due: '', state: 'unknown', days: null };
  const days = daysBetween(today, due);
  return { lastDone, due, days, state: days < 0 ? 'overdue' : days <= soonDays ? 'soon' : 'ok' };
}

// When a checklist of a given frequency is next due, from the last time it was done.
export const CHECKLIST_DAYS = { daily: 1, weekly: 7, monthly: 30, annual: 365 };

export function checklistStatus(frequency, logs, today) {
  const last = logs.filter((l) => l.template === frequency).map((l) => l.day).sort().at(-1) || '';
  if (!last) return { last: '', due: today, state: 'never', days: null };
  const due = addDays(last, CHECKLIST_DAYS[frequency]);
  const days = daysBetween(today, due);
  return { last, due, days, state: days < 0 ? 'overdue' : days === 0 ? 'due' : 'ok' };
}
