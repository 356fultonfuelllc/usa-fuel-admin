// Prototype storage: this browser's localStorage. Used when admin/config.js has no
// Supabase project, or when the page is opened on localhost with ?local.

import { withDefaults } from './defaults.js';

const KEY = 'usafuel-admin-v1';
const blank = () => ({ settings: withDefaults(), days: {}, recon: {}, collections: {}, content: {} });

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.settings) return { ...blank(), ...saved, settings: withDefaults(saved.settings) };
  } catch {
    // fall through to a fresh state
  }
  return blank();
}

let state = read();

function write() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export const localStore = {
  mode: 'local',

  async getSettings() {
    return structuredClone(state.settings);
  },
  async saveSettings(settings) {
    state.settings = structuredClone(settings);
    write();
  },

  async getDays() {
    return structuredClone(state.days);
  },
  async saveDay(day) {
    state.days[day.date] = structuredClone(day);
    write();
  },
  async deleteDay(date) {
    delete state.days[date];
    write();
  },

  // Notes for a tank's 10-day period: cause, action taken, water answer.
  async getReconNotes() {
    return structuredClone(state.recon);
  },
  async saveReconNote(periodStart, tankKey, note) {
    state.recon[`${periodStart}:${tankKey}`] = structuredClone(note);
    write();
  },

  // Lists of records (price changes, deposits, house accounts, charges, payments).
  // Every record has an `id` and a `day` (YYYY-MM-DD).
  async list(collection) {
    return Object.values(structuredClone(state.collections[collection] || {}));
  },
  async save(collection, record) {
    state.collections[collection] = { ...state.collections[collection], [record.id]: structuredClone(record) };
    write();
  },
  async remove(collection, id) {
    delete state.collections[collection]?.[id];
    write();
  },

  // Website content: deals, announcement, holiday hours.
  async getContent() {
    return structuredClone(state.content);
  },
  async saveContent(key, data) {
    state.content[key] = structuredClone(data);
    write();
  },

  async exportAll() {
    return structuredClone(state);
  },
  async importAll(data) {
    if (!data || !data.settings || !data.days) throw new Error('That file is not a USA Fuel dashboard backup.');
    state = { ...blank(), ...structuredClone(data), settings: withDefaults(data.settings) };
    write();
  },
  async clearAll() {
    state = blank();
    write();
  },
};
