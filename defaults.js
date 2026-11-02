// Starting settings for a new station setup. Everything here can be changed in Settings.

export const DEFAULT_SETTINGS = {
  facility: {
    name: 'USA Fuel & Mart',
    address: '356 Fulton St, Farmingdale, NY 11735',
    phone: '',
    pbsNumber: '',
  },
  tanks: [
    // startCost: cost per gallon of fuel already in the tank before the first recorded delivery.
    { key: 't1', role: 'regular', tankId: '1', product: 'Regular unleaded', capacity: 12000, startCost: '' },
    { key: 't2', role: 'premium', tankId: '2', product: 'Premium unleaded', capacity: 8000, startCost: '' },
    { key: 't3', role: 'diesel', tankId: '3', product: 'Diesel', capacity: 6000, startCost: '' },
  ],
  // Mid-grade blended from regular and premium: 87 + 93 -> 89 is two parts regular, one part premium.
  blendRegularPct: 66.7,
  reconStart: '2026-10-01',
  // Which TLS-350 volume to use for tank inventory: 'gross' (Volume) or 'tc' (TC Volume).
  volumeBasis: 'gross',
  // Cash kept in the drawer at the start of each day.
  startingBank: '',
  // Whether Commander's cash total already has debit cash back taken out.
  cashBackNetted: false,
  // Sales groups entered each night. 'inside' counts as inside sales; 'passthrough' is money
  // collected that isn't a sale (bottle deposits, house-account payments).
  departments: [
    { key: 'grocery', label: 'Grocery & snacks', type: 'inside' },
    { key: 'drinks', label: 'Cold drinks', type: 'inside' },
    { key: 'coffee', label: 'Coffee & hot food', type: 'inside' },
    { key: 'beer', label: 'Beer', type: 'inside' },
    { key: 'tobacco', label: 'Cigarettes & tobacco', type: 'inside' },
    { key: 'vape', label: 'Vape', type: 'inside' },
    { key: 'ice', label: 'Ice', type: 'inside' },
    { key: 'auto', label: 'Automotive', type: 'inside' },
    { key: 'other', label: 'Other', type: 'inside' },
    { key: 'bottleDeposits', label: 'Bottle deposits', type: 'passthrough' },
    { key: 'housePayments', label: 'House-account payments', type: 'passthrough' },
  ],
  // Commander department number -> where it's entered. `group` is a sales group key above,
  // or one of the built-in fuel / lottery targets in calc.BUILTIN_GROUPS.
  deptMap: [
    { number: '9998', name: 'Manual fuel', group: 'manualFuel' },
  ],
  // Payment types beyond cash, credit, debit, fleet and house accounts.
  paymentTypes: [
    { key: 'giftCard', label: 'Gift card' },
    { key: 'check', label: 'Check' },
  ],
  thresholds: {
    cashOverShort: 5,
    tankDailyGallons: 25, // flag a tank's daily over/short beyond this many gallons
    waterIncrease: 0.25,
    depositDays: 2, // flag a deposit not made within this many days
    clearDays: 5, // flag a deposit not cleared by the bank within this many days
  },
  houseAccounts: {
    termsDays: 15,
    nextNumber: 1001,
  },
  // Fuel ordering: never fill a tank past this share of capacity; order this many days ahead.
  // Each tank can also have its own reorder level (tanks[].reorderAt, gallons).
  ordering: {
    maxFillPct: 90,
    leadDays: 1,
  },
  // Card processing: effective fee as a % of card sales. debitPays: which pump price debit gets.
  cards: {
    feePct: '',
    debitPays: 'credit',
  },
  // NY Lottery commission as a % of lottery sales.
  lottery: {
    commissionPct: '',
  },
  // Bills that come every month, for monthly profit: [{ key, label, amount }].
  fixedExpenses: [],
};

// Saved settings from an older version may be missing newer fields; fill them in.
export function withDefaults(saved) {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    facility: { ...base.facility, ...saved.facility },
    thresholds: { ...base.thresholds, ...saved.thresholds },
    houseAccounts: { ...base.houseAccounts, ...saved.houseAccounts },
    ordering: { ...base.ordering, ...saved.ordering },
    cards: { ...base.cards, ...saved.cards },
    lottery: { ...base.lottery, ...saved.lottery },
    tanks: (saved.tanks || base.tanks).map((tank) => ({ ...base.tanks.find((t) => t.key === tank.key), ...tank })),
    // Older saved departments have no type; they were all inside sales. Pass-through groups
    // didn't exist, so add the default ones.
    departments: saved.departments
      ? [
        ...saved.departments.map((d) => ({ type: 'inside', ...d })),
        ...(saved.departments.some((d) => d.type) ? [] : base.departments.filter((d) => d.type === 'passthrough')),
      ]
      : base.departments,
  };
}
