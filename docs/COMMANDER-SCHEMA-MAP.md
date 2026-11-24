# How the dashboard stores data today (for the Commander import)

Source of truth: `supabase-setup.sql`, `cloud.js`, `app.js`, `calc.js`, `defaults.js`, `pages/*.js` in this repo (usa-fuel-admin).
Project ref `uwfqairueldnsiyaouwx`. Written 2026-11-24 from the code; the live database was not queried (no SQL access from this machine yet).

## Security model (RLS)
- `public.admins (user_id uuid → auth.users)` is the allow-list. `public.is_admin()` (security definer) = "is auth.uid() in admins".
- Every dashboard table has one policy: `for all to authenticated using (is_admin()) with check (is_admin())`. Anonymous gets nothing, except `site_content`, which anyone can read (the public website shows it).
- The owner signs in as **sales@usafuelandmart.com** (password only, no email links). Sign-ups are off.
- **For the `station` user:** do NOT add it to `admins`, because that would give it every table. Use a separate allow-list (`public.stations` + `public.is_station()`) and policies only on `cmdr_*` tables.
- History: `daily_report_history` (trigger on `daily_reports` update/delete) and `change_history` (trigger on every record-list table) keep previous versions. Nothing is ever lost on edit.

## A day = one JSON blob
`public.daily_reports (report_date date PK, data jsonb, updated_at, updated_by)`. `data` is exactly what the "Enter a day" form saves:

| Form field | Key in `data` |
|---|---|
| Prepared by / Notes | `preparedBy`, `notes` (owner fields) |
| Grade gallons / sales | `fuel.<regular\|mid\|premium\|diesel>.gallons` / `.amount` |
| Gallons at cash price | `fuel.<grade>.cashGallons` |
| Cash / credit price | `prices.cash.<grade>`, `prices.credit.<grade>` |
| Manual fuel sales | `fuel.manual` |
| Drive-offs $ / gal | `driveOffs.amount`, `driveOffs.gallons` |
| Personal fuel | `personal[] {grade, gallons, amount, note, mode}` (owner field) |
| Inside sales groups | `departments.<groupKey>`. Group keys come from **Settings → Sales groups** (defaults: grocery, drinks, coffee, beer, tobacco, vape, ice, auto, other). Read the live settings before mapping, because the owner may have renamed or added groups. |
| Pass-through | `departments.bottleDeposits`, `departments.housePayments` |
| Lottery | `lottery.instant`, `lottery.online` |
| Sales tax / customers | `tax`, `customers` |
| No-sales / voids / refunds | `counts.noSales`, `counts.voids`, `counts.refunds` |
| Payments (net) | `tenders.<cash\|credit\|debit\|fleet\|house\|…>` (extra types from Settings) |
| Batch number / batch total | `register.batchNumber`, `register.batchTotal` |
| Open prepays | `register.openPrepays` |
| Commander total sales / payments | `register.totalSales`, `register.totalPayments` |
| Starting bank (override) | `cash.startingBank` |
| Pay ins / cash back / safe drops | `cash.payIns`, `cash.cashBack`, `cash.safeDrops` |
| Cash counted / bank deposit | `cash.counted`, `cash.deposit` (owner fields) |
| Pay outs | `payouts[] {to, reason, amount, note}` (owner field; older days: `cash.payOuts`) |
| By cashier | `cashiers[] {name, safeDrops, overShort, voids, refunds, noSales}` |
| Tanks | `tanks.<t1\|t2\|t3>`. Keys from Settings → Tanks (`role`: regular / premium / diesel). Fields: `time`, `start`, `endGallons` (or `endTc`), `endInches`, `water`, `pumped` |
| Deliveries | `tanks.<key>.deliveries[] {invoiceGallons, measured, cost, ticket}`. `measured` = TLS measured increase; the other three are owner fields (from the invoice) |

All numbers are stored as the strings typed into the form (`""` = blank). `calc.summarizeDay` does every total and check.

## Item sales
`public.item_reports (id text PK, day date, data jsonb, updated_at)`. "Save report" writes:
`data = { id, day (=to), from, to, items: [{plu, name, customers, qty, price, sales}], deals: [{type: 'combo'|'mix', number, name, customers, count, sales}], reportTotal, fileName, addedAt }`.
`#/items` groups items by `plu` (so one UPC at two prices adds together) and deals by `type:number`. **14 reports were already saved by hand** (Oct 24–30 as one report, then daily Oct 31–Nov 12). Commander imports for the same dates would double-count unless `#/items` prefers Commander data for dates it has.

## Price history
`public.price_changes (id text PK, day date, data jsonb)`. "Log a price change" writes
`data = { id, day, effectiveAt: 'YYYY-MM-DDTHH:MM', credit: {regular, mid, premium, diesel}, cash: {…}, note }`. Credit is required; cash is optional per grade. The daily form fills prices from the last report or from this log (`calc.defaultPrices`).

## Other tables (not touched by the import)
`settings (id=1, data jsonb)`, `recon_notes`, `deposits`, `house_accounts`, `house_charges`, `house_payments`, `expenses`, `compliance_items`, `inspections`, `maintenance`, `site_content`. Every record-list table has the same shape: `(id text PK, day date, data jsonb, updated_at)`.

## Mapping notes for spec §8
- The spec's grade keys `reg/mid/prem/dsl` map to `regular/mid/premium/diesel`; `sales` → `amount`; `cash_gallons` → `cashGallons`.
- `categories.*` → `departments.<groupKey>` by matching the group's label, read from live Settings.
- `cards.credit/debit/fleet` → `tenders.credit/debit/fleet`; `mop.CASH` → `tenders.cash`.
- `commander_total` → `register.totalSales` **and** `register.totalPayments` (the spec maps both labels to one value).
- Tanks: Commander `reg/prem/dsl` (after the label swap in `usa_commander.py`) → the Settings tank whose `role` is regular / premium / diesel; `end` → `endGallons` (or `endTc` when Settings uses TC volume); `reading_time` → `time`.
- Deliveries: `tls_gallons` → `measured`; `invoiceGallons`, `cost` and `ticket` stay blank.
