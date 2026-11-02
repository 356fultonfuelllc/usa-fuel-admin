// Realistic made-up numbers so the reports can be seen before real data exists.
// Every generated day is marked `sample: true`.

import { addDays, pumpedFromSales } from './calc.js';

function random(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Height in inches for a volume in a horizontal cylinder tank (96" diameter).
function inchesFor(gallons, capacity) {
  const target = Math.min(Math.max(gallons / capacity, 0), 1);
  const r = 48;
  const filled = (h) => (r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(2 * r * h - h * h)) / (Math.PI * r * r);
  let lo = 0;
  let hi = 2 * r;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (filled(mid) < target) lo = mid; else hi = mid;
  }
  return Math.round(lo * 100) / 100;
}

// All-in delivered cost per gallon (made up).
const SAMPLE_COSTS = { regular: 2.94, premium: 3.62, diesel: 3.68 };
export const SAMPLE_START_COSTS = { t1: '2.9100', t2: '3.5900', t3: '3.6500' };

export function makeSample(settings, from, to) {
  const rand = random(356);
  const between = (min, max) => min + rand() * (max - min);
  const money = (v) => Math.round(v * 100) / 100;
  const prices = { regular: 3.299, mid: 3.799, premium: 4.199, diesel: 4.099 };
  const inventory = { t1: 9200, t2: 6100, t3: 4300 };
  const water = { t1: 0.25, t2: 0, t3: 0.45 };
  const reorder = { t1: [4200, 7000], t2: [2600, 4500], t3: [2100, 3500] };
  const days = {};

  for (let date = from, i = 0; date <= to; date = addDays(date, 1), i++) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;

    const gallons = {
      regular: between(950, 1350) * (weekend ? 0.9 : 1),
      mid: between(100, 180),
      premium: between(200, 320),
      diesel: between(280, 560) * (weekend ? 0.6 : 1),
    };
    const fuel = {};
    for (const [grade, gal] of Object.entries(gallons)) {
      const g = Math.round(gal * 1000) / 1000;
      // Prices go up a nickel on day 8, matching the sample price log.
      // About a third of gallons sell at the cash price, 10 cents under credit.
      const credit = prices[grade] + (i >= 7 ? 0.05 : 0);
      const cashGallons = g * between(0.28, 0.4);
      fuel[grade] = { gallons: g, amount: money(cashGallons * (credit - 0.1) + (g - cashGallons) * credit) };
    }
    if (i % 5 === 3) fuel.manual = money(between(10, 40));
    const driveOffs = i === 6 ? { amount: 41.25, gallons: 10.05 } : {};

    const departments = {
      grocery: money(between(500, 800)),
      drinks: money(between(400, 650)),
      coffee: money(between(220, 400)),
      beer: money(between(250, 550) * (weekend ? 1.4 : 1)),
      tobacco: money(between(700, 1100)),
      vape: money(between(120, 260)),
      ice: money(between(15, 70)),
      auto: money(between(10, 60)),
      other: money(between(30, 100)),
    };
    const inside = Object.values(departments).reduce((a, b) => a + b, 0);
    departments.bottleDeposits = money(between(5, 25));
    const tax = money((inside - departments.grocery * 0.4) * 0.08625);
    const lottery = { instant: money(between(400, 800)), online: money(between(200, 500)) };
    const lotteryPayouts = money(between(250, 650));
    const fuelAmount = Object.values(fuel).reduce((a, f) => a + (typeof f === 'number' ? f : f.amount), 0);
    const totalSales = money(fuelAmount + inside + lottery.instant + lottery.online + tax);

    const tenders = {
      cash: money(totalSales * between(0.3, 0.36)),
      debit: money(totalSales * between(0.12, 0.16)),
      fleet: money(totalSales * between(0.04, 0.08)),
      house: money(totalSales * between(0.01, 0.03)),
      giftCard: i % 4 === 1 ? money(between(10, 50)) : 0,
    };
    const openPrepays = i === 2 ? 40 : 0;
    // Payments balance with sales + pass-through, less drive-offs, plus prepays still open.
    tenders.credit = money(totalSales + departments.bottleDeposits - (driveOffs.amount || 0) + openPrepays
      - tenders.cash - tenders.debit - tenders.fleet - tenders.house - tenders.giftCard);
    const tenderTotal = Object.values(tenders).reduce((a, b) => a + b, 0);

    const startingBank = 300;
    const cash = { payIns: 0, payOuts: money((rand() < 0.4 ? 0 : between(40, 180)) + lotteryPayouts), cashBack: money(between(40, 120)) };
    const expected = startingBank + tenders.cash + cash.payIns - cash.payOuts - cash.cashBack;
    const miss = i === 8 ? -18.4 : money(between(-2, 2));
    cash.counted = money(expected + miss);
    cash.safeDrops = money(Math.floor((cash.counted - startingBank) / 100) * 100);
    cash.deposit = money(cash.counted - startingBank);
    const register = {
      batchTotal: money(tenders.credit + tenders.debit + tenders.fleet),
      openPrepays,
      totalSales,
      totalPayments: money(tenderTotal + (driveOffs.amount || 0) - openPrepays),
    };
    const cashiers = [
      { name: 'Morning', safeDrops: money(cash.safeDrops * 0.45), overShort: money(miss / 2), voids: String(Math.round(between(0, 4))), refunds: money(between(0, 20)), noSales: String(Math.round(between(2, 9))) },
      { name: 'Evening', safeDrops: money(cash.safeDrops * 0.55), overShort: money(miss / 2), voids: String(Math.round(between(0, 4))), refunds: money(between(0, 20)), noSales: String(Math.round(between(2, 9))) },
    ];
    const counts = { noSales: String(Number(cashiers[0].noSales) + Number(cashiers[1].noSales)), voids: String(Number(cashiers[0].voids) + Number(cashiers[1].voids)), refunds: money(cashiers[0].refunds + cashiers[1].refunds) };

    const day = { date, sample: true, preparedBy: 'Sample', fuel, driveOffs, departments, lottery, tax, customers: Math.round(between(360, 480)), counts, tenders, register, cash, cashiers, tanks: {}, notes: '' };
    const deliveries = [];

    for (const tank of settings.tanks) {
      const start = inventory[tank.key];
      const pumped = pumpedFromSales(day, tank, settings);
      let delivered = 0;
      let ticket = '';
      if (start - pumped < reorder[tank.key][0]) {
        delivered = reorder[tank.key][1];
        ticket = `BOL ${48200 + i * 7 + Number(tank.tankId)}`;
        deliveries.push(`${tank.product} ${delivered.toLocaleString()} gal`);
      }
      // Temperature and meter noise; premium runs short in the first period to show a flagged result.
      const drift = tank.key === 't2' && i < 10 ? between(-11, -4) : between(-6, 6);
      const end = Math.round(start + delivered - pumped + drift);
      water[tank.key] = Math.max(0, Math.round((water[tank.key] + between(-0.02, 0.02)) * 100) / 100);
      day.tanks[tank.key] = {
        time: '22:10',
        start: String(start),
        // The TLS usually measures a little less than the invoice; one premium drop comes up short.
        deliveries: delivered ? [{
          invoiceGallons: String(delivered),
          measured: String(delivered - Math.round(tank.key === 't2' && i > 10 ? 60 : between(0, 15))),
          cost: (SAMPLE_COSTS[tank.role] + between(-0.04, 0.04)).toFixed(4),
          ticket,
        }] : [],
        endGallons: end,
        endInches: inchesFor(end, tank.capacity),
        water: water[tank.key],
      };
      inventory[tank.key] = end;
    }
    if (deliveries.length) day.notes = `Delivery: ${deliveries.join(', ')}.`;
    days[date] = day;
  }
  return days;
}

// Price log, deposits, house accounts and website content to go with the sample days.
export function makeSampleExtras(settings, days, today) {
  const rand = random(1776);
  const between = (min, max) => min + rand() * (max - min);
  const dates = Object.keys(days).sort();
  const first = dates[0];
  const credit = { regular: 3.299, mid: 3.799, premium: 4.199, diesel: 4.099 };
  const cashOf = (prices) => Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Math.round((v - 0.1) * 1000) / 1000]));
  const raised = Object.fromEntries(Object.entries(credit).map(([k, v]) => [k, Math.round((v + 0.05) * 1000) / 1000]));
  const priceDay = addDays(first, 7);
  const price_changes = [
    { id: 'sample-price-1', day: first, effectiveAt: `${first}T06:00`, credit, cash: cashOf(credit), note: 'Opening prices', sample: true },
    { id: 'sample-price-2', day: priceDay, effectiveAt: `${priceDay}T06:00`, credit: raised, cash: cashOf(raised), note: 'Supplier increase', sample: true },
  ];

  const deposits = dates.filter((d) => d <= addDays(today, -3)).map((d, i) => {
    const amount = Number(days[d].cash.deposit);
    const record = { id: d, day: d, depositedOn: addDays(d, 1), slip: String(5100 + i), sample: true };
    if (addDays(d, 3) <= today) {
      record.clearedOn = addDays(d, 3);
      if (i === 4) record.clearedAmount = (amount - 20).toFixed(2);
    }
    return record;
  });

  const house_accounts = [
    { id: 'sample-acct-1', day: first, number: 'HA-1001', name: 'Island Towing & Recovery', contact: 'Mike Russo', phone: '(555) 555-0141', email: 'billing@example.com', address: '45 Route 109, Farmingdale, NY 11735', discountCents: '8', creditLimit: '5000', status: 'active', openedOn: first, sample: true,
      vehicles: [{ unit: '12', vehicle: '2019 Ford F-550 rollback', plate: 'TWN1212', driver: 'Mike Russo', fuel: 'diesel' }, { unit: '14', vehicle: '2021 Ram 5500 wrecker', plate: 'TWN1414', driver: 'Ana Diaz', fuel: 'diesel' }] },
    { id: 'sample-acct-2', day: first, number: 'HA-1002', name: 'GreenScape Landscaping', contact: 'Tom Walsh', phone: '(555) 555-0152', email: 'office@example.com', address: '12 Main St, Farmingdale, NY 11735', discountCents: '5', creditLimit: '2500', status: 'active', openedOn: first, sample: true,
      vehicles: [{ unit: '3', vehicle: '2020 Chevy Silverado 2500', plate: 'GRN0303', driver: 'Tom Walsh', fuel: 'regular' }, { unit: '7', vehicle: '2018 Isuzu NPR', plate: 'GRN0707', driver: 'Luis Ortega', fuel: 'diesel' }] },
  ];

  // Split each day's house-account register total into charges, so the two always match.
  const house_charges = [];
  for (const d of dates) {
    let remaining = Math.round(Number(days[d].tenders.house) * 100);
    const parts = remaining > 15000 ? 2 : 1;
    for (let p = 0; p < parts; p++) {
      const account = house_accounts[(dates.indexOf(d) + p) % 2];
      const vehicle = account.vehicles[Math.floor(rand() * account.vehicles.length)];
      const cents = p === parts - 1 ? remaining : Math.round(remaining * between(0.4, 0.6));
      remaining -= cents;
      const price = (d >= priceDay ? raised : credit)[vehicle.fuel];
      house_charges.push({
        id: `sample-charge-${d}-${p}`, day: d, accountId: account.id, unit: vehicle.unit, driver: vehicle.driver,
        product: vehicle.fuel, gallons: (cents / 100 / price).toFixed(3), price: String(price), amount: (cents / 100).toFixed(2),
        ticket: String(80000 + house_charges.length * 13), sample: true,
      });
    }
  }
  const house_payments = [
    { id: 'sample-payment-1', day: addDays(first, 9), accountId: 'sample-acct-1', amount: '500.00', method: 'check', reference: '2231', sample: true },
  ];

  const content = {
    deals: { sample: true, items: [
      { id: 'sample-deal-1', tag: 'Fill-up perk', title: "Fill up. Coffee's on us.", text: 'Pump 10 gallons or more and grab a free hot coffee inside.', featured: true, active: true, start: '', end: '' },
      { id: 'sample-deal-2', tag: 'Every week', title: 'Combo of the Week', text: 'A new snack and drink combo every week. Ask at the register.', featured: false, active: true, start: '', end: '' },
      { id: 'sample-deal-3', tag: 'Rewards', title: 'Coffee Club', text: 'Buy 9 coffees and your 10th is free. Ask for a punch card.', featured: false, active: true, start: '', end: '' },
    ] },
    announcement: { sample: true, active: false, message: 'Diesel is back in stock.', tone: 'info', start: '', end: '' },
    holiday_hours: { sample: true, items: [
      { id: 'sample-holiday-1', date: '2026-11-26', name: 'Thanksgiving', closed: false, open: '08:00', close: '14:00' },
      { id: 'sample-holiday-2', date: '2026-12-25', name: 'Christmas Day', closed: true, open: '06:00', close: '22:00' },
    ] },
  };
  return { price_changes, deposits, house_accounts, house_charges, house_payments, content };
}
