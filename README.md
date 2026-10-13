# TJ's List

A shared Trader Joe's grocery checklist that installs on an iPhone Home Screen (a PWA).
Anyone with the link can view the list; editing needs the shared password.

**Live app:** https://david-chuang.github.io/tj-list/

## How it works

- Static site: `index.html`, `styles.css`, `app.js`, served by GitHub Pages.
- The list is stored in Supabase (`list_items` table) and syncs live between phones.
- Edits go through database functions that check the shared password (`supabase/password.sql`).
- `sw.js` caches the app so it opens offline; changes made offline sync when back online.

## Common tasks

**Change the editing password:** run `supabase/password.sql` in the Supabase SQL Editor
with a new password in place of `CHANGE-ME`.

**Refresh the product catalog:** put a new `trader_joes_products.csv` in this folder, then

```bash
node scripts/build-catalog.mjs
```

**Ship changes:** bump `VERSION` in `sw.js`, then commit and push. Phones pick up the
new version the next time the app is opened.

**Preview locally:**

```bash
python3 -m http.server 5173
```
