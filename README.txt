GOWTHAM SCHEDULES & EXPENSE TRACKER  (offline build v4.1)
==========================================================

HOW TO USE
  1. Unzip the whole folder anywhere.
  2. Double-click index.html (Chrome, Edge, Firefox or Safari). No internet and no server needed.
  3. Keep the "assets" folder next to index.html.

IMPORTING A DATABASE
  "Import DB" accepts files exported from the v4 builds (gowtham_tracker_v4_YYYY-MM-DD_HH-MM-SS.db). Older files (v3 and before) are
  rejected with a clear message and your current data stays untouched - open the old build, press "Export DB" there first
  and use the v4.0 build once to upgrade it. There is no migration inside this version.
  "Export DB" always writes schema v4.

WHAT IS NEW IN v4.1
  * Currency fix: the "Actual expenses vs upcoming obligations" chart (labels, axis title, tooltips) now follows the currency you pick.
  * Old-database migration removed (smaller, safer code). Wrong / empty / unrelated files are refused on import.
  * Dashboard: previous / next arrows and a reset button for the time window; "Overdue now" and "Next 30 days" cards;
    paid-progress bar; "Where the money went" ranked categories; fixed-term commitments with the amount still to pay;
    status chips on the due-date list; period-over-period spend trend (this period vs the previous one);
    "Show data as a table" under the charts; your window and currency are remembered.
  * Unsaved draft rows cannot be marked paid or selected, and the browser warns before closing with unsaved drafts.
  * Layout fixes: no sideways scrolling at any width (320 px to 1920 px). The Commitments and Expense Log tables now fit laptop
    screens (1024 px and up) without a horizontal scrollbar: related fields are stacked in two lines per cell.

WHAT WAS NEW IN v4
  * Commitments have a Start date and End date; status (Upcoming / Pending / Overdue / Paid / Completed) is calculated from them.
  * Row numbers (#) on Commitments, Expense Log and Events.
  * Expense Log: Actual date + Commitment date, SQL filters, 3-level sorting, paging, per-currency totals.
  * Events & Tasks: one simple table (Event or Task, optional yearly repeat, budget).
  * Mobile: Expense Log, Commitments and Events are read-only cards (tap Edit to change).
  * Typing in a row never re-sorts the list; new rows are drafts until you press "Save row".

WHERE IS MY DATA?
  In this browser's local storage, as a real SQLite database. Use "Export DB" for backups.

FILES
  index.html, assets/ (css, js, webfonts, licenses), build-css/ (only to rebuild Tailwind), SCHEMA_AND_AUDIT.md
  assets/js/core.js = all date / status / SQL / schema-check logic (no UI).  assets/js/app.js = the screen logic.

REBUILDING THE CSS (optional, needs Node.js)
  cd build-css && npm install && npm run build
