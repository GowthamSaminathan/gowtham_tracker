GOWTHAM SCHEDULES & EXPENSE TRACKER  (offline build v3.2)
=========================================================

HOW TO USE
  1. Unzip the whole folder anywhere.
  2. Double-click index.html  (Chrome, Edge, Firefox or Safari). No internet and no server needed.
  3. Keep the "assets" folder next to index.html - the app needs it.

FIRST RUN
  The app starts completely empty (no sample data). Use "Add first commitment" on the dashboard.

WHERE IS MY DATA?
  Inside this browser's local storage (as a real SQLite database).
  - Different browser, different folder/computer = separate data.
  - Use "Export DB" regularly for a backup file (.db). "Import DB" restores it on any device.
  - Clearing browser site-data deletes the app's data, so keep an exported backup.
  - Dashboard > "Clear all data" wipes everything (asks first).

WHAT IS INSIDE
  index.html                  the app
  assets/css/tailwind.css     compiled Tailwind CSS (no CDN, no warning)
  assets/css/fontawesome.min.css + assets/webfonts/   icons
  assets/js/alpine.min.js     Alpine.js 3.14.1
  assets/js/sql-wasm.js       sql.js 1.12.0 (SQLite in the browser)
  assets/js/sql-wasm-binary.js  the SQLite engine embedded as base64 (so it loads from disk without fetch)
  assets/licenses/            licences of the bundled libraries
  build-css/                  only needed if you edit index.html and add NEW Tailwind classes

REBUILDING THE CSS (optional, needs Node.js once)
  cd build-css
  npm install
  npm run build
  -> regenerates assets/css/tailwind.css from the classes used in index.html

DATA RULES (validated in the app)
  Amount            number above 0, stored as REAL (rounded to 2 decimals)
  Monthly           due day 1-31 (INTEGER)
  Yearly/Bi-Monthly month (1-12) + day valid for that month (INTEGER); Feb allows up to 29
  One-Time          a real calendar date (YYYY-MM-DD)
  Expense log       valid date, description, amount above 0
  Events            name + valid day/month, budget 0 or more
  Invalid fields are outlined in red; invalid items cannot be marked as paid.
