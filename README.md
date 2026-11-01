# GOWTHAM SCHEDULES \& EXPENSE TRACKER  (offline build v3.2)

# =========================================================

# 

# HOW TO USE

# &#x20; 1. Unzip the whole folder anywhere.

# &#x20; 2. Double-click index.html  (Chrome, Edge, Firefox or Safari). No internet and no server needed.

# &#x20; 3. Keep the "assets" folder next to index.html - the app needs it.

# 

# FIRST RUN

# &#x20; The app starts completely empty (no sample data). Use "Add first commitment" on the dashboard.

# 

# WHERE IS MY DATA?

# &#x20; Inside this browser's local storage (as a real SQLite database).

# &#x20; - Different browser, different folder/computer = separate data.

# &#x20; - Use "Export DB" regularly for a backup file (.db). "Import DB" restores it on any device.

# &#x20; - Clearing browser site-data deletes the app's data, so keep an exported backup.

# &#x20; - Dashboard > "Clear all data" wipes everything (asks first).

# 

# WHAT IS INSIDE

# &#x20; index.html                  the app

# &#x20; assets/css/tailwind.css     compiled Tailwind CSS (no CDN, no warning)

# &#x20; assets/css/fontawesome.min.css + assets/webfonts/   icons

# &#x20; assets/js/alpine.min.js     Alpine.js 3.14.1

# &#x20; assets/js/sql-wasm.js       sql.js 1.12.0 (SQLite in the browser)

# &#x20; assets/js/sql-wasm-binary.js  the SQLite engine embedded as base64 (so it loads from disk without fetch)

# &#x20; assets/licenses/            licences of the bundled libraries

# &#x20; build-css/                  only needed if you edit index.html and add NEW Tailwind classes

# 

# REBUILDING THE CSS (optional, needs Node.js once)

# &#x20; cd build-css

# &#x20; npm install

# &#x20; npm run build

# &#x20; -> regenerates assets/css/tailwind.css from the classes used in index.html

# 

# DATA RULES (validated in the app)

# &#x20; Amount            number above 0, stored as REAL (rounded to 2 decimals)

# &#x20; Monthly           due day 1-31 (INTEGER)

# &#x20; Yearly/Bi-Monthly month (1-12) + day valid for that month (INTEGER); Feb allows up to 29

# &#x20; One-Time          a real calendar date (YYYY-MM-DD)

# &#x20; Expense log       valid date, description, amount above 0

# &#x20; Events            name + valid day/month, budget 0 or more

# &#x20; Invalid fields are outlined in red; invalid items cannot be marked as paid.

