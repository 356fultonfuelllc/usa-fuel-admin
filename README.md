# USA Fuel & Mart admin dashboard

The owner's dashboard, served at https://admin.usafuelandmart.com by GitHub Pages. The public website lives in the separate `usa-fuel-website` repository.

- Daily reports and the NYSDEC 10-Day Inventory Reconciliation Worksheet
- Fuel prices and margin, bank deposits, house accounts with monthly statements
- Website controls: announcement banner, deals and holiday hours shown on usafuelandmart.com

Data is stored in Supabase, never in this repository. Sign-in is the admin password only. Setup: [SETUP.md](SETUP.md).

## Preview locally

```
python3 -m http.server 4322
```

Then open http://localhost:4322/?local to try it with made-up data in this browser (Settings → Load sample data), without touching the real data.

Files: `calc.js` (all math), `store.js` (picks storage), `local.js` / `cloud.js` (browser vs Supabase), `app.js` (overview, entry, reports, reconciliation, settings), `pages/` (fuel, deposits, accounts, website), `ui.js` (shared helpers), `sample.js` (demo data), `supabase-setup.sql` (database), `admin.css`.
