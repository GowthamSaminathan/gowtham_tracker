# Finance Tracker v5.0 - schema and audit notes

## 1. Schema v5 (`PRAGMA user_version = 5`)

```sql
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT 'UAE', category TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AED',
  frequency TEXT NOT NULL DEFAULT 'Monthly',      -- Monthly | Bi-Monthly | Yearly | One-Time
  dueDay INTEGER, dueMonth INTEGER,               -- NULL for One-Time; dueMonth only for Yearly / Bi-Monthly
  startDate TEXT NOT NULL,                        -- ISO YYYY-MM-DD, first day the commitment is active
  endDate TEXT,                                   -- ISO; NULL = ongoing. For One-Time it IS the due date
  method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  pausedMonth TEXT,                               -- v5: 'YYYY-MM' the commitment is paused for; only active while it is the current month
  archived INTEGER NOT NULL DEFAULT 0);           -- v5: 1 = archived (excluded from all calculations until restored)

CREATE TABLE expense_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actualDate TEXT NOT NULL,                       -- when the money was actually spent / recorded
  commitmentDate TEXT,                            -- the planned due date this row settles (NULL if none)
  commitmentId INTEGER,                           -- link to commitments.id (NULL = ordinary expense)
  region, category, item, amount REAL, currency, method, notes);

CREATE TABLE events (                             -- replaces events_list; Events AND Tasks in one table
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Event',   -- Event | Task
  eventDate TEXT NOT NULL,                        -- ISO; the first/only date
  repeat TEXT NOT NULL DEFAULT 'None',            -- None | Yearly  (birthdays, anniversaries)
  budget REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AED',
  done INTEGER NOT NULL DEFAULT 0,                -- tasks only
  notes TEXT NOT NULL DEFAULT '');
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');   -- v5, validated on read and write:
--   autoSave '0'|'1' (default '0') · theme 'system'|'light'|'dark' (default 'system')
--   dbName (file last imported) · lastExport (file name of the last Export DB) · exportPending '0'|'1' (changed since export/import)
-- indexes: expense_logs(actualDate), expense_logs(commitmentId, commitmentDate), commitments(startDate,endDate), events(eventDate)
```

Design decisions
* **Status is derived, not stored.** `status` and `paidMonth` columns are gone. Status is computed from the commitment's
  start/end dates, its due dates and the expense-log rows linked to it. A stored flag can never go out of sync.
* **A payment = an expense-log row with (commitmentId, commitmentDate).** That pair identifies exactly which due date was settled,
  so an old month can never be "re-paid" and nothing needs resetting when a month rolls over.
* **Events + people + tasks = one `events` table.** The old "relation" field is kept as text in `notes`.
  No join tables or foreign keys remain for events.

## 2. Status rules (`Core.statusOf`)
Due dates = every date generated from frequency/dueDay/dueMonth inside `[startDate, endDate]` (clamped, e.g. 31st -> last day of short months, Feb 29 in leap years only).

| Status    | Rule |
|-----------|------|
| Archived  | `archived = 1` (checked first) |
| Upcoming  | today < startDate |
| Overdue   | at least one due date before today (inside start..end) has no linked payment |
| Completed | has an endDate and every due date in start..end is paid (or the range ended with no due dates) |
| Paused    | `pausedMonth` = current month and this month still has an unpaid due date |
| Paid      | not overdue and this month's due date(s) are all paid (ongoing commitments show this until the next cycle) |
| Pending   | everything else: active, something still to pay now or later |

Unpaid due dates in the paused month are never "missed" while the pause is active; once the month is over the pause lapses
and such a date is overdue like any other (pausing defers, it does not cancel). A due date that is today is *not* overdue. "Mark paid" settles the oldest missed due date first, otherwise the next one.

## 3. Opening and importing files
`Core.ensureSchema(db)` is the only gate, used on startup and on **Import DB**:
* empty database -> fresh v5 schema created;
* `user_version = 5` with all tables and columns -> accepted (a missing `settings` table / indexes are added);
* `user_version = 4` with every v4 table and column -> **upgraded in place** in one transaction: `ALTER TABLE commitments ADD COLUMN
  pausedMonth`, `... archived`, `CREATE TABLE settings`, stamp 5. Nothing is rewritten or removed;
* older / unstamped tracker files -> rejected (`OLD_SCHEMA`), newer than 5 -> rejected (`NEWER_SCHEMA`), a v4/v5 stamp with missing tables or columns -> rejected (`BAD_SCHEMA`), untouched.
Import also refuses empty files and SQLite files that contain none of the tracker tables ("this file is not a tracker database").
A rejected import restores the previous database; a rejected *stored* database is kept in browser storage under `sqlite_db_rejected_backup`.
On import the file name is stored as `dbName` and shown in the header.

Export: **Export DB** writes `gowtham_tracker_v5_YYYY-MM-DD_HH-MM-SS.db` (local time) and records it as `lastExport`.

## 4. Audit - edge cases found and how they are handled
1. **Month length** - day 29/30/31 in short months clamps to the last day; Yearly Feb 29 -> Feb 28 in non-leap years. (unit-tested)
2. **Time zones** - all dates are plain local-calendar ISO strings; no `toISOString()` (UTC) anywhere, so a payment at 01:00 in UTC+4 is not logged on the previous day.
3. **Date rollover while the app stays open** - the "today" clock refreshes when the tab becomes visible again.
4. **Editing a schedule after payments exist** - changing frequency/day/start/end can orphan earlier linked payments (they keep their `commitmentDate`). The app asks for confirmation; orphaned payments stay in the log as history and simply no longer match a due date.
5. **Deleting a commitment** - its expense rows are kept and unlinked (`commitmentId` cleared), so spend history is never lost.
6. **Undo payment** - removes the latest linked expense row (confirmation shown), the due date becomes unpaid again.
7. **Double payment** - impossible: one (commitmentId, commitmentDate) pair can only be paid once; a second click pays the next due date.
8. **Mixed currencies** - never summed. Every total is grouped per currency (AED and INR on separate lines); charts show one chosen currency.
9. **Partial / over-payments** - a payment settles a whole due date regardless of the amount paid (the log keeps the real amount, and "Actual spend" uses it). Part-payments are not modelled; log the extra as a separate expense.
10. **End before start / no due date inside the range** - blocked by validation with a clear message.
11. **One-Time without a due date** - validation requires it.
12. **Sorting while typing** - rows are never re-ordered by typing. New rows are drafts pinned on top, numbered `•`, and are only committed with *Save row*. Sort/filter is re-applied only when you press *Apply sort / filters*, change a filter, or save a row.
13. **Row numbers** are positions in the current view (1..n; across pages for the Expense Log), not database ids, so they stay sequential after filtering or deleting.
14. **Expense-log "server-side"** - this is an offline single-file app, so "server-side" means the SQLite engine: filtering, multi-column sorting (3 levels), pagination and per-currency totals are executed as parameterised SQL (no string concatenation of user input; LIKE wildcards escaped). Quick client-side filters (search/region/frequency/status) on commitments stay in memory.
15. **Large data** - the DB is stored base64 in `localStorage` (~5 MB quota, roughly 100k+ rows is far away but not unlimited). A full quota shows an error and asks you to Export DB. IndexedDB is the next step if you outgrow it.
16. **Import safety** - invalid/other SQLite files are rejected without touching current data; the existing database stays loaded.
17. **Open risks left by design** - no multi-device sync; no automatic currency conversion (a rate table would be needed for a single grand total); no recurring-event "done per year" for tasks.

## 5. v4.1 additions
18. **Chart currency** - the tooltip callback used to capture the currency in force when the chart was first drawn, so switching to INR kept "AED" in tooltips/axis. The chart now reads the selected currency at draw and tooltip time and updates the axis title.
19. **Dashboard windows** - this/next/last month, last 3/6 months, next 3 months, year to date, chosen months, chosen year; previous/next stepping; the comparison window is the equally long period just before. Totals stay per currency.
20. **Drafts** - cannot be paid or selected; "Save & mark paid" saves first; closing the tab with unsaved drafts prompts.
21. **Responsive** - header no longer overflows at 320 px and 768 px; checked at 320/375/414/768/1024/1280/1920 px.
22. **Performance** - single-pass analytics with memoisation, option lists keep object identity so lists are not re-rendered on every keystroke. Measured on 300 commitments + 6000 expense rows: Pay-tab keystroke ~546 -> ~340 ms, window switch ~241 -> ~175 ms. A per-row validation cache was tried and made things slower, so it was not kept.

## 6. v5.0 additions
23. **Pause is month-scoped** - stored as `pausedMonth`, so no job is needed to "un-pause"; it is ignored once the month changes.
    `Core.analyze` drops unpaid paused-month dates from every total and returns them as `pausedOcc` / `pausedTotal` for display.
    Paying a paused row settles the paused date (`payTarget` ignores the pause) and clears the pause.
24. **Archive** - `analyze`, the next-N-days list, overdue list and fixed-term card skip archived rows. Expense Log rows linked to an
    archived commitment still count as actual spend (money really left the account) and the link is kept.
25. **Auto-save off** - explicit actions write only their own rows (`INSERT OR REPLACE` / `UPDATE` / `DELETE` by id); table edits
    stay in memory. While edits are unsaved the Expense Log SQL runs on a throw-away copy of the in-memory rows, so filters match
    the screen without saving. Settings are written on their own, so changing one never saves pending edits.
26. **Mobile dropdowns** - `<datalist>` replaced by an Alpine combobox (`window.combo`) because iOS never opens a datalist on tap and
    Android only lists entries matching the current text. Native selects use `appearance:none` + an SVG chevron.
27. **Theme** - every colour family is a CSS variable (`tailwind.config.js`); `:root[data-theme="light"]` remaps them. A tiny inline
    script applies the saved/system theme before first paint. Charts are redrawn on a theme change.
28. **"Where the money went"** - `Core.moneyBreakdown` (actual / planned / outstanding / projected, by category or item) for any window;
    `breakdownMode('auto')` picks actual for past, outstanding for future, projected for the current window.
