// Picks where the dashboard keeps its data: the Supabase project in config.js when
// one is set, otherwise this browser's localStorage. Both expose the same async API.
// Opening the dashboard on localhost with ?local forces browser storage, for trying
// things out with sample data without touching the real database.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const forceLocal = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('local');
const useCloud = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) && !forceLocal;

export const store = useCloud
  ? (await import('./cloud.js')).cloudStore
  : (await import('./local.js')).localStore;
