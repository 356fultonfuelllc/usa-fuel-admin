// Commander data uploaded by the store PC (cmdr_* tables): turning a closed day into a
// draft daily report, and comparing a saved report with what the register recorded.

import * as calc from './calc.js';
import { fmt } from './ui.js';

// Commander grade keys -> dashboard grade keys.
const GRADE_KEYS = { reg: 'regular', mid: 'mid', prem: 'premium', dsl: 'diesel' };
const TANK_ROLES = { reg: 'regular', prem: 'premium', dsl: 'diesel' };
// Commander sales groups -> the label of the dashboard sales group they fill.
const CATEGORY_LABELS = {
  grocery: 'Grocery & snacks', cold: 'Cold drinks', coffee: 'Coffee & hot food', beer: 'Beer',
  tobacco: 'Cigarettes & tobacco', vape: 'Vape', ice: 'Ice', auto: 'Automotive', other: 'Other', bottle: 'Bottle deposits',
};
const CATEGORY_FALLBACK_KEYS = { cold: 'drinks', bottle: 'bottleDeposits' };

export const OWNER_FIELDS = ['the price per gallon for deliveries (Fuel deliveries page)', 'cash counted', 'bank deposit', 'pay outs', 'prepared by'];

const str = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? '' : String(Math.round(Number(v) * 1000) / 1000));

function groupKeyFor(category, settings) {
  const label = CATEGORY_LABELS[category];
  const byLabel = settings.departments.find((g) => g.label.trim().toLowerCase() === (label || '').toLowerCase());
  if (byLabel) return byLabel.key;
  const fallback = settings.departments.find((g) => g.key === (CATEGORY_FALLBACK_KEYS[category] || category));
  return fallback ? fallback.key : null;
}

function timeLabel(iso) {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : '';
}

// The tank monitor's reading (height, water) belongs to the end-of-day volume when it was
// taken at the same time, or shows the same gallons.
function sameReading(t) {
  if (!t?.tls) return false;
  if (t.tls.time && t.end_time) return t.tls.time === t.end_time;
  return t.tls.volume != null && t.end != null && Math.abs(Number(t.tls.volume) - Number(t.end)) <= 0.5;
}

// Fills blank end heights (inches) and water on a saved day from the tank monitor, only where
// the saved end volume is the same reading. Returns the updated day, or null if nothing to fill.
export function fillInches(day, cmdr, settings) {
  const d = cmdr?.data;
  if (!day || !d) return null;
  const tc = settings.volumeBasis === 'tc';
  let changed = false;
  const next = structuredClone(day);
  for (const tank of settings.tanks) {
    const code = Object.keys(TANK_ROLES).find((k) => TANK_ROLES[k] === tank.role);
    const t = d.tanks?.[code];
    const reading = next.tanks?.[tank.key];
    if (!t || !reading || !sameReading(t)) continue;
    const savedEnd = reading[tc ? 'endTc' : 'endGallons'];
    if (savedEnd === '' || savedEnd == null || Math.abs(Number(savedEnd) - Number(t.end)) > 0.5) continue;
    const blank = (v) => v === undefined || v === null || v === '';
    if (blank(reading.endInches) && t.tls.height != null) { reading.endInches = str(t.tls.height); changed = true; }
    if (blank(reading.water) && t.tls.water != null) { reading.water = str(t.tls.water); changed = true; }
  }
  return changed ? next : null;
}

// Fills a blank draft (from the day form's own blankDay) with what the Commander recorded.
// Owner fields stay blank. Returns { draft, flags }.
export function applyToDraft(draft, cmdr, settings) {
  const d = cmdr.data || {};
  const flags = [];
  const tc = settings.volumeBasis === 'tc';

  for (const [code, grade] of Object.entries(GRADE_KEYS)) {
    const f = d.fuel?.[code];
    if (!f) continue;
    draft.fuel[grade] = { gallons: str(f.gallons), amount: str(f.sales), cashGallons: str(f.cash_gallons) };
    for (const level of ['cash', 'credit']) {
      if (f[`${level}_price_status`] === 'confirmed' && f[`${level}_price`]) {
        draft.prices[level][grade] = String(f[`${level}_price`]);
      } else if (f[`${level}_gallons`] > 0) {
        flags.push(`${grade} ${level} price changed during the day (average ${fmt.ppg(f[`${level}_price`])}); kept the price on file. Check it.`);
      }
    }
  }
  draft.fuel.manual = str(d.categories?.manual_fuel ?? 0);

  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const amount = d.categories?.[category];
    if (amount == null) continue;
    const key = groupKeyFor(category, settings);
    if (key) draft.departments[key] = str(amount);
    else if (Number(amount)) flags.push(`${label} ${fmt.money(Number(amount))}: no matching sales group in Settings.`);
  }
  for (const dept of d.unmapped_departments || []) flags.push(`Commander department ${dept.number} ${dept.name} (${fmt.money(dept.sales)}) has no group yet; counted as Other.`);

  draft.tax = str(d.sales_tax);
  draft.customers = str(d.customer_count);
  draft.counts = { noSales: str(d.no_sale_count), voids: str(d.void_count), refunds: str(d.refunds) };
  draft.tenders = { ...draft.tenders, cash: str(d.mop?.CASH), credit: str(d.cards?.credit), debit: str(d.cards?.debit), fleet: str(d.cards?.fleet) };
  draft.register = { ...draft.register, batchTotal: str(d.cards?.batch_total), totalSales: str(d.commander_total), totalPayments: str(d.commander_total) };
  draft.cash = { ...draft.cash, payIns: str(d.pay_ins), cashBack: str(d.cash_back), safeDrops: str(d.safe_drops) };

  for (const tank of settings.tanks) {
    const code = Object.keys(TANK_ROLES).find((k) => TANK_ROLES[k] === tank.role);
    const t = d.tanks?.[code];
    if (!t) continue;
    const reading = draft.tanks[tank.key];
    reading.time = t.reading_time || '';
    reading[tc ? 'endTc' : 'endGallons'] = str(t.end);
    if (tc) flags.push(`${tank.product}: the Commander gives gross volume; Settings uses temperature-corrected. Check the end volume.`);
    reading.pumped = str(t.pumped);
    if (sameReading(t)) {
      if (t.tls.height != null) reading.endInches = str(t.tls.height);
      if (t.tls.water != null) reading.water = str(t.tls.water);
    }
    if (reading.start !== '' && t.start != null && Math.abs(Number(reading.start) - Number(t.start)) > 0.5) {
      flags.push(`${tank.product}: start ${fmt.number(Number(reading.start))} (from the previous day) but the TLS says ${fmt.number(t.start)}.`);
    }
    if (reading.start === '' && t.start != null) reading.start = str(t.start);
    reading.deliveries = (d.deliveries || []).filter((x) => x.tank === code).map((x) => ({ invoiceGallons: '', measured: str(x.tls_gallons), cost: '', ticket: '' }));
    for (const x of (d.deliveries || []).filter((y) => y.tank === code)) {
      flags.push(`${tank.product} delivery of ${fmt.number(x.tls_gallons)} gal at ${timeLabel(x.time)}: add the price per gallon on the Fuel deliveries page.`);
    }
  }

  if (!draft.notes) {
    const notes = [];
    if (Number(d.void_count)) notes.push(`Voids: ${d.void_count} tickets, ${fmt.money(Number(d.void_amount || 0))}.`);
    for (const x of d.deliveries || []) {
      const tank = settings.tanks.find((t) => t.role === TANK_ROLES[x.tank]);
      notes.push(`Delivery (TLS): ${tank ? tank.product : x.tank} +${fmt.number(x.tls_gallons)} gal at ${timeLabel(x.time)}.`);
    }
    if (!Number(d.safe_drops)) notes.push('No safe drops recorded.');
    draft.notes = notes.join('\n');
  }

  draft.import = {
    source: 'commander',
    status: 'needs_review',
    period: cmdr.period_name || d.period_name || '',
    pulledAt: cmdr.pulled_at || d.pulled_at || '',
    createdAt: new Date().toISOString(),
    flags,
  };
  return { draft, flags };
}

// The owner asked for this: replace the numbers the register reports on a saved day with the
// Commander's, keeping every owner field (cash counted, deposit, pay outs, personal fuel,
// cashiers, invoice gallons / cost / ticket, prices, notes, prepared by).
export function correctFromCommander(day, cmdr, settings) {
  const d = cmdr.data || {};
  const next = structuredClone(day);
  const tc = settings.volumeBasis === 'tc';
  next.fuel ||= {};
  for (const [code, grade] of Object.entries(GRADE_KEYS)) {
    const f = d.fuel?.[code];
    if (f) next.fuel[grade] = { ...(next.fuel[grade] || {}), gallons: str(f.gallons), amount: str(f.sales), cashGallons: str(f.cash_gallons) };
    for (const level of ['cash', 'credit']) {
      next.prices ||= { cash: {}, credit: {} };
      next.prices[level] ||= {};
      if ((next.prices[level][grade] ?? '') === '' && f?.[`${level}_price_status`] === 'confirmed') next.prices[level][grade] = String(f[`${level}_price`]);
    }
  }
  next.fuel.manual = str(d.categories?.manual_fuel ?? 0);
  next.departments ||= {};
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const key = groupKeyFor(category, settings);
    if (key && d.categories?.[category] != null) next.departments[key] = str(d.categories[category]);
  }
  next.tax = str(d.sales_tax);
  next.customers = str(d.customer_count);
  next.counts = { ...(next.counts || {}), noSales: str(d.no_sale_count), voids: str(d.void_count), refunds: str(d.refunds) };
  next.tenders = { ...(next.tenders || {}), cash: str(d.mop?.CASH), credit: str(d.cards?.credit), debit: str(d.cards?.debit), fleet: str(d.cards?.fleet) };
  next.register = { ...(next.register || {}), batchTotal: str(d.cards?.batch_total), totalSales: str(d.commander_total), totalPayments: str(d.commander_total) };
  next.cash = { ...(next.cash || {}), payIns: str(d.pay_ins), cashBack: str(d.cash_back), safeDrops: str(d.safe_drops) };
  for (const tank of settings.tanks) {
    const code = Object.keys(TANK_ROLES).find((k) => TANK_ROLES[k] === tank.role);
    const t = d.tanks?.[code];
    if (!t) continue;
    const reading = (next.tanks ||= {})[tank.key] ||= { deliveries: [] };
    reading.time = t.reading_time || reading.time || '';
    reading[tc ? 'endTc' : 'endGallons'] = str(t.end);
    reading.pumped = str(t.pumped);
    if ((reading.start ?? '') === '' && t.start != null) reading.start = str(t.start);
    if (sameReading(t)) {
      if (t.tls.height != null) reading.endInches = str(t.tls.height);
      if (t.tls.water != null) reading.water = str(t.tls.water);
    }
    // Deliveries: the TLS measured gallons go on the owner's delivery lines (invoice, cost
    // and ticket stay as typed); a delivery the owner didn't enter is added with those blank.
    const measured = (d.deliveries || []).filter((x) => x.tank === code);
    const lines = Array.isArray(reading.deliveries) ? reading.deliveries : calc.deliveriesOf(reading).map((x) => ({ ...x }));
    measured.forEach((x, i) => {
      if (lines[i]) lines[i] = { ...lines[i], measured: str(x.tls_gallons) };
      else lines.push({ invoiceGallons: '', measured: str(x.tls_gallons), cost: '', ticket: '' });
    });
    reading.deliveries = lines;
    delete reading.delivered;
    delete reading.cost;
    delete reading.ticket;
  }
  next.import = { ...(next.import || {}), source: next.import?.source || 'manual', correctedFromCommander: new Date().toISOString(), period: cmdr.period_name || d.period_name || '' };
  if (next.import.status === 'needs_review') next.import.status = 'reviewed';
  return next;
}

// What differs between a saved day and the Commander's numbers for it.
export function differences(day, cmdr, settings) {
  const d = cmdr?.data;
  if (!day || !d) return [];
  const out = [];
  const money = (label, saved, commander) => {
    if (commander == null) return;
    const a = Number(saved || 0);
    if (Math.abs(a - Number(commander)) > 0.005) out.push({ label, saved: fmt.money(a), commander: fmt.money(Number(commander)) });
  };
  const count = (label, saved, commander) => {
    if (commander == null) return;
    if (Number(saved || 0) !== Number(commander)) out.push({ label, saved: String(Number(saved || 0)), commander: String(commander) });
  };
  for (const [code, grade] of Object.entries(GRADE_KEYS)) {
    const f = d.fuel?.[code];
    if (!f) continue;
    const g = calc.GRADES.find((x) => x.key === grade).label;
    if (Math.abs(Number(day.fuel?.[grade]?.gallons || 0) - Number(f.gallons)) > 0.0005) {
      out.push({ label: `${g} gallons`, saved: fmt.number(Number(day.fuel?.[grade]?.gallons || 0), 3), commander: fmt.number(Number(f.gallons), 3) });
    }
    money(`${g} sales`, day.fuel?.[grade]?.amount, f.sales);
  }
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const key = groupKeyFor(category, settings);
    if (key) money(label, day.departments?.[key], d.categories?.[category]);
  }
  money('Sales tax', day.tax, d.sales_tax);
  count('Customers', day.customers, d.customer_count);
  money('Cash payments', day.tenders?.cash, d.mop?.CASH);
  money('Credit cards', day.tenders?.credit, d.cards?.credit);
  money('Debit cards', day.tenders?.debit, d.cards?.debit);
  money('Fleet cards', day.tenders?.fleet, d.cards?.fleet);
  money('Commander total sales', day.register?.totalSales, d.commander_total);
  return out;
}

// Status of a day in the Daily reports list.
export function dayStatus(day, cmdr, settings) {
  if (!cmdr) return null;
  if (!day) return { tone: 'idle', label: 'Pulled', title: 'In from the Commander; the draft is created when the dashboard opens.' };
  if (day.import?.status === 'needs_review') return { tone: 'warn', label: 'Needs review', title: 'Imported from the Commander. Check it and add the owner fields, then Save day.' };
  const diffs = differences(day, cmdr, settings);
  if (diffs.length) return { tone: 'bad', label: `Differs (${diffs.length})`, title: diffs.map((x) => `${x.label}: saved ${x.saved}, Commander ${x.commander}`).join('\n') };
  return { tone: 'good', label: day.import?.source === 'commander' ? 'Imported' : 'Matches', title: 'Saved numbers match the Commander.' };
}

// Item-sales reports built from the Commander's daily item and deal rows, in the shape the
// Item sales page uses for saved reports.
export function itemReports(items, deals) {
  const byDate = {};
  for (const i of items) {
    (byDate[i.business_date] ||= { items: [], deals: [] }).items.push({
      plu: i.upc, name: i.description || 'NO DESCRIPTION', customers: i.customers, qty: i.units, price: Number(i.price), sales: Number(i.sales),
    });
  }
  for (const x of deals) {
    (byDate[x.business_date] ||= { items: [], deals: [] }).deals.push({
      type: x.deal_type === 'combo' ? 'combo' : 'mix', number: x.promotion_id, name: x.name, customers: x.customers ?? 0, count: x.count, sales: Number(x.sales),
    });
  }
  return Object.entries(byDate).map(([date, r]) => ({ id: `cmdr-${date}`, day: date, from: date, to: date, items: r.items, deals: r.deals, source: 'commander' }));
}

// Tank monitor readings from the latest live snapshot, by dashboard tank key. Only used when
// the snapshot is recent (default 3 hours), so a store PC that's been offline can't mislead.
export function liveTanks(snapshot, settings, maxAgeHours = 3) {
  if (!snapshot?.data?.tanks || Date.now() - new Date(snapshot.taken_at).getTime() > maxAgeHours * 3600000) return {};
  const out = {};
  for (const tank of settings.tanks) {
    const code = Object.keys(TANK_ROLES).find((k) => TANK_ROLES[k] === tank.role);
    const t = snapshot.data.tanks[code];
    if (!t) continue;
    out[tank.key] = {
      volume: t.tls?.volume ?? t.end ?? null,
      height: t.tls?.height ?? null,
      water: t.tls?.water ?? null,
      temperature: t.tls?.temperature ?? null,
      at: snapshot.taken_at,
    };
  }
  return out;
}

// What a delivery really put in the tank, from the store PC's 15-minute tank readings.
// The tank monitor's delivery report is how much the tank rose, so fuel sold while the truck
// unloaded is missing from it. Take the last reading before the tank started rising and the
// first one after it stopped: delivered = volume after - volume before + gallons pumped from
// that tank in between. Both ends use the tank monitor's own clock, so a wrong TLS clock
// doesn't matter. `snapshots` are { taken_at, tanks } rows, oldest first.
export function trackDelivery(snapshots, tankCode, time, measured) {
  const points = [];
  for (const s of snapshots || []) {
    const t = s.tanks?.[tankCode];
    const at = t?.tls?.time ? String(t.tls.time).slice(0, 16) : null;
    if (!at || t.tls.volume == null || t.pumped == null) continue;
    if (points.length && points.at(-1).at === at) continue; // same reading pulled twice
    points.push({ at, iso: t.tls.time, takenAt: s.taken_at, volume: Number(t.tls.volume), pumped: Number(t.pumped) });
  }
  const when = String(time || '').slice(0, 16);
  const end = points.findIndex((p) => p.at >= when);
  if (!when || end < 2) return null;
  const NOISE = 15; // gallons a reading can wander without a delivery
  const rise = (i) => points[i].volume - points[i - 1].volume + (points[i].pumped - points[i - 1].pumped);
  // The delivery is stamped when it ended; the last rise is at that reading or just before.
  let i = end;
  for (let back = 0; back < 2 && i > 1 && rise(i) <= NOISE; back += 1) i -= 1;
  if (rise(i) <= NOISE) return null;
  let first = i;
  while (first >= 2 && rise(first - 1) > NOISE) first -= 1;
  if (first < 2) return null; // the rise starts before the readings do
  let last = i;
  while (last + 1 < points.length && rise(last + 1) > NOISE) last += 1;
  const before = points[first - 1];
  const after = points[last];
  const sold = after.pumped - before.pumped;
  if (sold < 0) return null; // the register's period closed in between
  const gallons = after.volume - before.volume + sold;
  // Far from the tank monitor's own figure means two deliveries or a bad reading: don't guess.
  if (Number.isFinite(measured) && measured > 0 && Math.abs(gallons - measured) > Math.max(300, measured * 0.1)) return null;
  const clockFast = Math.round((Date.parse(after.iso) - Date.parse(after.takenAt)) / 60000 / 15) * 15;
  return { gallons: Math.round(gallons), sold: Math.round(sold * 10) / 10, from: before.at, to: after.at, clockFast };
}

// Every delivery in a date range: invoice gallons against what the tank monitor measured.
// Short = the tank went up by more than the tolerance less than the invoice says.
// No-price = no price per gallon yet, so it can't count toward fuel cost.
export function deliveries(days, settings, from, to) {
  const tolerance = Number(settings.thresholds?.tankDailyGallons ?? 25);
  const rows = [];
  for (const date of Object.keys(days).filter((d) => d >= from && d <= to).sort()) {
    for (const tank of settings.tanks) {
      const lines = calc.deliveriesOf(days[date].tanks?.[tank.key]);
      lines.forEach((d, i) => {
        const invoice = d.invoiceGallons === '' || d.invoiceGallons == null ? null : Number(d.invoiceGallons);
        const measured = d.measured === '' || d.measured == null ? null : Number(d.measured);
        const cost = d.cost === '' || d.cost == null ? null : Number(d.cost);
        const tracked = d.tracked?.gallons ?? null;
        // Compare the invoice with the tracked gallons when known: the TLS figure alone runs
        // short by whatever sold during the delivery.
        const actual = tracked ?? measured;
        const diff = invoice != null && actual != null ? actual - invoice : null;
        // Gallons used everywhere: the invoice when entered, otherwise the TLS measured gallons.
        const gallons = calc.deliveredGallons(d);
        let state = 'ok';
        if (invoice != null && actual != null && invoice - actual > tolerance) state = 'short';
        else if (cost == null) state = 'no-price';
        else if (actual == null) state = 'no-tls';
        const shortGallons = state === 'short' ? invoice - actual : 0;
        rows.push({
          date, tank, index: i, ticket: d.ticket || '', invoice, measured, tracked, track: d.tracked || null, gallons, diff, cost, state,
          total: cost != null ? gallons * cost : null,
          shortGallons, shortValue: shortGallons && cost != null ? shortGallons * cost : null,
        });
      });
    }
  }
  return { rows, tolerance };
}

// Tank monitor alarms from the newest Commander data, newest first.
export function tankAlarms(cmdr) {
  const source = cmdr.latest?.data?.tank_alarms
    || Object.values(cmdr.days || {}).sort((a, b) => b.business_date.localeCompare(a.business_date))[0]?.data?.tank_alarms
    || [];
  return source.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export { GRADE_KEYS, TANK_ROLES };
