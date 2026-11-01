GOWTHAM SCHEDULES & EXPENSE TRACKER  (offline build v5.3)
==========================================================

HOW TO USE
  1. Unzip the whole folder anywhere.
  2. Double-click index.html (Chrome, Edge, Firefox or Safari). No internet and no server needed.
  3. Keep the "assets" folder next to index.html.

IMPORTING A DATABASE
  "Import DB" accepts v5 files and v4 files (gowtham_tracker_v4_*.db). A v4 file is upgraded in place when it is opened
  (two columns + a settings table are added; nothing is removed). v3 and older files are rejected with a clear message and
  your current data stays untouched - open them once in the v4.0 build and export first. "Export DB" always writes schema v5.
  The header always shows which file the data came from (or the last export name) and whether anything is unsaved.

WHAT IS NEW IN v5.3
  * Charts and "Where the money went" show ALL currencies: one chart / ranking block per currency (amounts in different
    currencies are never added together). The "Currency (charts & ranking)" selector is gone.
  * "Due dates & still to pay": currency chips (All / AED / INR ... pick one or several). Ticked rows always count in the
    selected total, paused ones included - untick a row to leave it out. The "shown" total still leaves paused rows out
    and says how many.

WHAT WAS NEW IN v5.2
  * Dashboard: "Still to pay" and "Due dates in this window" are one card, "Due dates & still to pay". Pick the period
    (the dashboard window, Today -> end of this month, or the next 7/14/30/60/90 days), a status (All, Unpaid, Overdue,
    Pending, Paid, Paused) and filters (search, category, commitment, min / max amount, include overdue). It shows the
    total of what is listed, and you can tick rows to see the total of just those.
  * Expense Log: tick rows (checkbox column on a laptop, the small square on a phone card) to see their total in a bar
    at the bottom; edit or delete them from there.
  * Pay Commitments: "Due between" date filter (with This month / Rest of month / Next month / This year buttons). It
    uses the real due dates of every frequency, shows the due dates per row and the total due in the range.
  * Status: a commitment with nothing overdue and nothing due this month (e.g. Yearly due in March) is now "Upcoming".
  * A small note icon next to a name shows its notes (only when there is a note).

WHAT WAS NEW IN v5.1
  * Pay Commitments: select rows (tap a card on a phone, tick a row on a laptop) and act on them from one sticky
    selection bar at the bottom: count + total of the selection, Mark paid / Mark pending / Pause / Resume / Archive /
    Edit / Delete. The total is always in view, no scrolling to the top.
  * Fix: single rows could not be ticked on laptops (only "select all" worked); tapping a commitment on a phone now selects it.
  * "Undo" removes the payment logged most recently (not the one with the latest due date).
  * Amounts are shown with thousands separators ("12,500.00") and switch to a plain number while you edit them.
  * Region removed from the screens (currency is enough); the column stays in the database so older files still import.
  * Compact layout: one-line page headers on phones, search / filters behind a search icon, two-line cards; on laptops
    Commitments and Expense Log are one line per row, spreadsheet style.
  * Every form field has a name (removes the browser's autofill warning).
  * "StorageType.persistent is deprecated" is printed by Chrome itself (DevTools device mode or an extension); the app
    does not use that API.

WHAT WAS NEW IN v5.0
  * Pay Commitments - Pause / Resume: pausing leaves THIS month's due date out of the dashboard totals (Required,
    Outstanding, Next N days, charts, due-date list) so you see exactly what you plan to pay this month. The pause ends by
    itself when the month changes (an unpaid paused date then counts as overdue again). "Mark paid" on a paused row lifts it.
  * Pay Commitments - Archive / Restore: archived commitments move to the "Archived" tab and are left out of every
    calculation until restored. Their past payments stay in the Expense Log as actual spend.
  * The pay button always shows the real state: "Mark paid · <date>" (green) when something is unpaid, "Mark pending"
    (amber, undoes the payment) once this month is paid, "Resume" when paused. Fixes the mobile card that stayed green.
  * Mobile dropdowns: Category / Method used <datalist>, which iOS never opens on tap and Android filters to the text already
    typed. They are now a tappable combobox (full list on tap, filter as you type, keyboard arrows on desktop).
    Native selects get a consistent chevron and finger-sized height on touch screens; the edit sheet uses dvh so its
    buttons are never hidden behind the browser toolbar; hover colours no longer "stick" after a tap.
  * Settings page: Auto-save switch (OFF by default, stored in the database). Off = typing in tables stays unsaved until
    Save DB / "Save now"; actions (Mark paid, Pause, Archive, Save row, Delete, form Save) still save straight away but only
    the row they touch. An amber bar offers Save now / Discard; closing the tab with unsaved changes asks first.
  * Light and dark theme. Default follows the device (prefers-color-scheme) and switches with it; Settings can force one.
  * Header shows the database file name (imported file / last export) and "Saved", "Saved · not exported" or "Unsaved".
  * Dashboard: "Due dates in this window" now sits directly below "Still to pay in the next N days" (N = 7/14/30/60/90).
    New windows: Next 6 months, Next 12 months, Rest of this year. "Where the money went" follows every window:
    Auto = Spent for past windows, Still to pay (future money) for future windows, Spent + still to pay for the current one;
    or pick a view, group by category or item, and open the matching rows in the Expense Log.

WHAT WAS NEW IN v4.1
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
  Colours are CSS variables defined in build-css/tailwind.config.js (dark values + the light-theme mapping).
