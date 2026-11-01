# Finance Tracker v4 - schema, migration and audit notes

## 1. Schema v4 (`PRAGMA user_version = 4`)

```sql
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT 'UAE', category TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'AED',
  frequency TEXT NOT NULL DEFAULT 'Monthly',      -- Monthly | Bi-Monthly | Yearly | One-Time
  dueDay INTEGER, dueMonth INTEGER,               -- NULL for One-Time; dueMonth only for Yearly / Bi-Monthly
  startDate TEXT NOT NULL,                        -- ISO YYYY-MM-DD, first day the commitment is active
  endDate TEXT,                                   -- ISO; NULL = ongoing. For One-Time it IS the due date
  method TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');

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
| Upcoming  | today < startDate |
| Overdue   | at least one due date before today (inside start..end) has no linked payment |
| Completed | has an endDate and every due date in start..end is paid (or the range ended with no due dates) |
| Paid      | not overdue and this month's due date(s) are all paid (ongoing commitments show this until the next cycle) |
| Pending   | everything else: active, something still to pay now or later |

A due date that is today is *not* overdue. "Mark paid" settles the oldest missed due date first, otherwise the next one.

## 3. Migration (any older file -> v4)
Runs automatically on load **and** on Import. `ensureLatest()`:
1. Reads `user_version` and the table list. Newer than 4 -> refused. Empty/unknown -> fresh v4.
2. Copies a **pre-upgrade backup** into browser storage first (`Download pre-upgrade backup` appears on the dashboard).
3. Reads all old rows into memory (v1 `uae_payments`/`india_payments`, v2/v3 `commitments`, `expense_logs`, `events_list`).
4. In ONE transaction: drops old tables, creates v4, inserts mapped rows **keeping the original ids**, verifies the row counts
   match, stamps `user_version = 4`. Any error -> ROLLBACK, the original database is untouched.
5. Idempotent: running it on a v4 file does nothing.

Field mapping
| Old | New |
|-----|-----|
| commitments.* | same columns (ids kept); `dueDay`/`dueMonth` coerced to INTEGER; legacy `"15-Nov"` text -> dueMonth 11, dueDay 15 |
| Monthly / Bi-Monthly / Yearly | `startDate` = 1st of the month it was last paid (if "Paid" in an earlier month) otherwise 1st of the current month; `endDate` = NULL (ongoing) |
| One-Time | `startDate` = `endDate` = old due date (today if it was missing/invalid) |
| `status = 'Paid'` (+ `paidMonth`) | the matching expense row (same item name, in the paid month, preferring equal amount) gets `commitmentId` + `commitmentDate` -> becomes a linked payment. If no row matches it is listed in the upgrade report ("Paid but no log found") and shows unpaid |
| expense_logs.date | `actualDate`; `commitmentDate` = NULL unless linked above |
| events_list (name, relation, eventDay/eventMonth or "15-May") | `events` row: kind Event, eventDate = that day this year, repeat Yearly; relation -> notes |
| uae_payments / india_payments (v1) | commitments with region UAE/AED, India/INR |

Why start = 1st of the current month: it avoids a flood of false "overdue" items for months that were never tracked, and matches the old behaviour (an unpaid monthly item is overdue only if its due day already passed this month).

Export: **Export DB** always writes the v4 file (`gowtham_tracker_v4_YYYY-MM-DD.db`). Older apps cannot open it; keep the pre-upgrade backup if you need to go back.

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
11. **One-Time without a due date** - validation requires it; legacy rows without one use the migration date.
12. **Sorting while typing** - rows are never re-ordered by typing. New rows are drafts pinned on top, numbered `•`, and are only committed with *Save row*. Sort/filter is re-applied only when you press *Apply sort / filters*, change a filter, or save a row.
13. **Row numbers** are positions in the current view (1..n; across pages for the Expense Log), not database ids, so they stay sequential after filtering or deleting.
14. **Expense-log "server-side"** - this is an offline single-file app, so "server-side" means the SQLite engine: filtering, multi-column sorting (3 levels), pagination and per-currency totals are executed as parameterised SQL (no string concatenation of user input; LIKE wildcards escaped). Quick client-side filters (search/region/frequency/status) on commitments stay in memory.
15. **Large data** - the DB is stored base64 in `localStorage` (~5 MB quota, roughly 100k+ rows is far away but not unlimited). A full quota shows an error and asks you to Export DB. IndexedDB is the next step if you outgrow it.
16. **Import safety** - invalid/other SQLite files are rejected without touching current data; the existing database stays loaded.
17. **Open risks left by design** - no multi-device sync; no automatic currency conversion (a rate table would be needed for a single grand total); no recurring-event "done per year" for tasks.
