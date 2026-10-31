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
  departments: [
    { key: 'grocery', label: 'Grocery & snacks' },
    { key: 'drinks', label: 'Cold drinks' },
    { key: 'coffee', label: 'Coffee & hot food' },
    { key: 'beer', label: 'Beer' },
    { key: 'tobacco', label: 'Cigarettes & tobacco' },
    { key: 'vape', label: 'Vape' },
    { key: 'ice', label: 'Ice' },
    { key: 'auto', label: 'Automotive' },
    { key: 'other', label: 'Other' },
  ],
  thresholds: {
    cashOverShort: 5,
    waterIncrease: 0.25,
    depositDays: 2, // flag a deposit not made within this many days
    clearDays: 5, // flag a deposit not cleared by the bank within this many days
  },
  houseAccounts: {
    termsDays: 15,
    nextNumber: 1001,
  },
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
    tanks: (saved.tanks || base.tanks).map((tank) => ({ ...base.tanks.find((t) => t.key === tank.key), ...tank })),
  };
}
