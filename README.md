# TJ's List

A shared Trader Joe's grocery checklist that installs on an iPhone Home Screen (a PWA).
Anyone with the link can view the list; editing needs the shared password.

**Live app:** https://david-chuang.github.io/tj-list/

## How it works

- Static site: `index.html`, `styles.css`, `app.js`, served by GitHub Pages.
- The list is stored in Supabase (`list_items` table) and syncs live between phones.
- Edits go through database functions that check the shared password (`supabase/functions.sql`).
- Prices, sizes, and photos come from `data/catalog.json`. Photos load from Trader Joe's image
  server (small thumbnail rendition) and are never copied into this repo.
- `sw.js` caches the app and viewed product photos so it opens offline; changes made offline
  sync when back online.

## Database setup (new Supabase project)

Run these in Supabase → SQL Editor, in order: `supabase/schema.sql`, `supabase/functions.sql`,
then `supabase/set-password.sql` with your password in place of `CHANGE-ME`.

## Common tasks

**Change the editing password:** run `supabase/set-password.sql` in the Supabase SQL Editor
with a new password in place of `CHANGE-ME`.

**Refresh the product catalog:** put the new export(s) in this folder as
`trader_joes_products.csv` (full catalog) and/or `trader_joes_products_with_images.csv`
(with an `Image URL` column), then

```bash
node scripts/build-catalog.mjs
```

**Ship changes:** bump `VERSION` in `sw.js`, then commit and push. Phones pick up the
new version the next time the app is opened.

**Preview locally:**

```bash
python3 -m http.server 5173
```
