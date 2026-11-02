// Supabase storage and sign-in. Tables, security rules and the owner allow-list are
// created by admin/supabase-setup.sql.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ADMIN_LOGIN } from './config.js';
import { withDefaults } from './defaults.js';

// Record lists and the Supabase table each one lives in.
const COLLECTIONS = ['price_changes', 'deposits', 'house_accounts', 'house_charges', 'house_payments', 'expenses', 'compliance_items', 'inspections', 'maintenance'];

// Sign-in is email + password only; the dashboard never sends email.
const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { detectSessionInUrl: false } });
const PAGE = 1000;

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Supabase returns at most 1,000 rows per request, so read in pages.
async function readAll(table, columns, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = check(await db.from(table).select(columns).order(order).range(from, from + PAGE - 1));
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function upsertInChunks(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    check(await db.from(table).upsert(rows.slice(i, i + 500)));
  }
}

const now = () => new Date().toISOString();

export const cloudStore = {
  mode: 'cloud',

  // ---- Sign-in ----
  async currentUser() {
    const { data } = await db.auth.getSession();
    return data.session?.user || null;
  },
  adminLogin: ADMIN_LOGIN,
  async signIn(password) {
    check(await db.auth.signInWithPassword({ email: ADMIN_LOGIN, password }));
  },
  async setPassword(password) {
    check(await db.auth.updateUser({ password }));
  },
  async signOut() {
    await db.auth.signOut();
  },
  // The allow-list only lets an owner see their own row, so any row back means access.
  async isAdmin() {
    return check(await db.from('admins').select('user_id').limit(1)).length > 0;
  },

  // ---- Data ----
  async getSettings() {
    const row = check(await db.from('settings').select('data').eq('id', 1).maybeSingle());
    return withDefaults(row?.data);
  },
  async saveSettings(settings) {
    check(await db.from('settings').upsert({ id: 1, data: settings, updated_at: now() }));
  },

  async getDays() {
    const rows = await readAll('daily_reports', 'report_date, data', 'report_date');
    return Object.fromEntries(rows.map((r) => [r.report_date, r.data]));
  },
  async saveDay(day) {
    check(await db.from('daily_reports').upsert({ report_date: day.date, data: day, updated_at: now() }));
  },
  async deleteDay(date) {
    check(await db.from('daily_reports').delete().eq('report_date', date));
  },

  async getReconNotes() {
    const rows = await readAll('recon_notes', 'period_start, tank_key, data', 'period_start');
    return Object.fromEntries(rows.map((r) => [`${r.period_start}:${r.tank_key}`, r.data]));
  },
  async saveReconNote(periodStart, tankKey, note) {
    check(await db.from('recon_notes').upsert({ period_start: periodStart, tank_key: tankKey, data: note, updated_at: now() }));
  },

  // Lists of records. Every record has an `id` and a `day` (YYYY-MM-DD).
  async list(collection) {
    if (!COLLECTIONS.includes(collection)) throw new Error(`Unknown list: ${collection}`);
    return (await readAll(collection, 'data', 'day')).map((r) => r.data);
  },
  async save(collection, record) {
    check(await db.from(collection).upsert({ id: record.id, day: record.day, data: record, updated_at: now() }));
  },
  async remove(collection, id) {
    check(await db.from(collection).delete().eq('id', id));
  },

  // Website content: deals, announcement, holiday hours. The public site reads these too.
  async getContent() {
    const rows = check(await db.from('site_content').select('key, data'));
    return Object.fromEntries(rows.map((r) => [r.key, r.data]));
  },
  async saveContent(key, data) {
    check(await db.from('site_content').upsert({ key, data, updated_at: now() }));
  },

  async exportAll() {
    const collections = {};
    for (const name of COLLECTIONS) {
      collections[name] = Object.fromEntries((await this.list(name)).map((r) => [r.id, r]));
    }
    return {
      settings: await this.getSettings(),
      days: await this.getDays(),
      recon: await this.getReconNotes(),
      collections,
      content: await this.getContent(),
    };
  },
  // Restoring adds or replaces records; it never deletes anything that isn't in the backup.
  async importAll(data) {
    if (!data || !data.settings || !data.days) throw new Error('That file is not a USA Fuel dashboard backup.');
    const realDays = Object.values(data.days).filter((day) => !day.sample);
    await this.saveSettings(withDefaults(data.settings));
    await upsertInChunks('daily_reports', realDays.map((day) => ({ report_date: day.date, data: day, updated_at: now() })));
    await upsertInChunks('recon_notes', Object.entries(data.recon || {}).map(([key, note]) => {
      const [periodStart, tankKey] = key.split(':');
      return { period_start: periodStart, tank_key: tankKey, data: note, updated_at: now() };
    }));
    for (const name of COLLECTIONS) {
      const records = Object.values(data.collections?.[name] || {}).filter((r) => !r.sample);
      await upsertInChunks(name, records.map((r) => ({ id: r.id, day: r.day, data: r, updated_at: now() })));
    }
    for (const [key, value] of Object.entries(data.content || {})) {
      if (!value?.sample) await this.saveContent(key, value);
    }
  },
};
