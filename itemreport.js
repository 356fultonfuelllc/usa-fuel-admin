// Reads Verifone Commander PLU and Deal reports (copied text, a saved text file, or a CSV)
// into item and deal rows. Commander's PLU report columns are
// PLU NUMBER, DESCRIPTION, CUST, ITEMS, PRICE, TOT-SALES, RC, %SALES; its Deal report has
// Combo and Mix-N-Match sections with #, DESCRIPTION, #CUST, #COMBOS / #MATCH, TOTAL SALES.

const isInt = (t) => /^-?[\d,]+$/.test(t);
const isMoney = (t) => /^-?\$?[\d,]*\.\d{1,3}$/.test(t);
const toNum = (t) => Number(String(t).replace(/[$,%\s]/g, '')) || 0;
const PLU_TOKEN = /^\d{1,14}(?:[-/]\d{1,3})?$/;
const DEAL_TOKEN = /^[CM]?#?\d{1,6}$/i;

// Text lines: the numbers sit at the end, so find the last "count count price sales" run.
function parsePluLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4 || !PLU_TOKEN.test(tokens[0])) return null;
  for (let i = tokens.length - 4; i >= 1; i -= 1) {
    const [cust, items, price, sales] = tokens.slice(i, i + 4);
    if (isInt(cust) && isInt(items) && isMoney(price) && isMoney(sales)) {
      const name = tokens.slice(1, i).join(' ');
      if (!name) return null;
      return { plu: tokens[0], name, customers: toNum(cust), qty: toNum(items), price: toNum(price), sales: toNum(sales) };
    }
  }
  // Some layouts leave out the customer count.
  for (let i = tokens.length - 3; i >= 1; i -= 1) {
    const [items, price, sales] = tokens.slice(i, i + 3);
    if (isInt(items) && isMoney(price) && isMoney(sales)) {
      const name = tokens.slice(1, i).join(' ');
      if (!name) return null;
      return { plu: tokens[0], name, customers: null, qty: toNum(items), price: toNum(price), sales: toNum(sales) };
    }
  }
  return null;
}

function parseDealLine(line, type) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4 || !DEAL_TOKEN.test(tokens[0])) return null;
  for (let i = tokens.length - 3; i >= 1; i -= 1) {
    const [cust, count, sales] = tokens.slice(i, i + 3);
    if (isInt(cust) && isInt(count) && isMoney(sales)) {
      const name = tokens.slice(1, i).join(' ');
      if (!name) return null;
      return { type, number: tokens[0].replace(/^[CM]?#?/i, ''), name, customers: toNum(cust), count: toNum(count), sales: toNum(sales) };
    }
  }
  return null;
}

function splitCsvLine(line, sep) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { cells.push(cell.trim()); cell = ''; } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

// A spreadsheet export: find the header row and match columns by name.
function parseTable(lines) {
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ',';
  const headerIndex = lines.findIndex((l) => /desc|name|item/i.test(l) && /sales|amount|total/i.test(l) && l.includes(sep));
  if (headerIndex < 0) return null;
  const header = splitCsvLine(lines[headerIndex], sep).map((h) => h.toLowerCase());
  const col = (...patterns) => header.findIndex((h) => patterns.some((p) => p.test(h)));
  const c = {
    plu: col(/^plu/, /upc/, /item\s*(#|no|num|code)/, /^number$/, /^code$/),
    name: col(/desc/, /^name$/, /item name/, /^item$/),
    qty: col(/^items?$/, /qty|quantity|units|sold|count/),
    sales: col(/tot.*sales|sales|amount|total/),
    customers: col(/cust/),
    price: col(/price/),
  };
  if (c.name < 0 || c.sales < 0 || c.qty < 0) return null;
  const items = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsvLine(line, sep);
    const name = cells[c.name];
    if (!name || /^total/i.test(name) || /^total/i.test(cells[0] || '')) continue;
    const sales = cells[c.sales];
    if (sales == null || sales === '' || !Number.isFinite(toNum(sales))) continue;
    items.push({
      plu: c.plu >= 0 ? cells[c.plu] : name,
      name,
      customers: c.customers >= 0 ? toNum(cells[c.customers]) : null,
      qty: toNum(cells[c.qty]),
      price: c.price >= 0 ? toNum(cells[c.price]) : null,
      sales: toNum(sales),
    });
  }
  return { items, deals: [], reportTotal: null, skipped: 0 };
}

export function parseReport(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const table = parseTable(lines);
  if (table && table.items.length) return table;

  const items = [];
  const deals = [];
  let section = 'plu';
  let reportTotal = null;
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const upper = line.toUpperCase();
    if (/COMBO/.test(upper) && !/^\s*[CM]?#?\d/.test(line)) { section = 'combo'; continue; }
    if (/MIX[\s-]*N?[\s-]*(&|AND)?[\s-]*MATCH|\bMATCH DEALS\b/.test(upper) && !/^\s*[CM]?#?\d/.test(line)) { section = 'mix'; continue; }
    if (/\bPLU\b/.test(upper) && /NUMBER|DESCRIPTION|REPORT/.test(upper)) { section = 'plu'; continue; }
    if (/\bDEPARTMENT\b|\bDEPT\b/.test(upper) && /REPORT|DESCRIPTION/.test(upper)) { section = 'skip'; continue; }
    if (/TOTAL/.test(upper)) {
      const money = line.match(/-?\$?[\d,]*\.\d{2}/g);
      if (section === 'plu' && /TOTAL SALES/.test(upper) && !/%/.test(upper) && money) reportTotal = toNum(money[money.length - 1]);
      continue;
    }
    if (section === 'skip') continue;
    const row = section === 'plu' ? parsePluLine(line) : parseDealLine(line, section);
    if (row) (section === 'plu' ? items : deals).push(row);
    else if (/^\s*[CM]?#?\d/.test(line) && /\.\d{2}/.test(line)) skipped += 1;
  }
  return { items, deals, reportTotal, skipped };
}
