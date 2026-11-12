# Gowtham Schedules & Pay

A private tracker for recurring payments, everyday expenses, events and tasks. It runs entirely in your browser: there is no account and no server, and your data stays on your device unless you turn on backup to your own OneDrive or Google Drive.

- **Use it:** <https://tracker.gowthams.com>
- **Try it with sample data:** <https://tracker.gowthams.com/?demo=1>

Current version: 5.7.0

## What it does

| Tab | What you do there |
|---|---|
| Dashboard | See what is required, paid, outstanding and overdue for any time window, per currency. Charts, "where the money goes", loan progress, upcoming events. Act on any due date directly. |
| Pay Commitments | Your recurring payments: rent, loans, bills, subscriptions, insurance. Monthly, every two months, yearly or one-time. |
| Expense Log | Everything actually spent. A payment for a commitment is a log row linked to that due date. |
| Events & Tasks | Birthdays, renewals and to-dos, with optional yearly repeat and a budget. |
| Settings | Auto-save, theme, privacy mask, demo, export/import, cloud backup. |

Amounts in different currencies are never added together; every total is shown per currency.

## Getting started

**In a browser.** Open the link above. A browser that has never opened the app starts in the demo, so you can look around first. Choose **Use my own data** to start your own empty tracker.

**As an app on Android.** Open the site in Chrome, then menu → **Install app** (or *Add to Home screen*). It opens full screen with its own icon and works offline. On iPhone use Safari → Share → *Add to Home Screen*; on a computer use the install icon in the address bar.

**From a folder, with no internet.** Download the repository and double-click `index.html`. Keep the `assets` folder next to it. Cloud backup and installing as an app need the hosted site; everything else works from the folder.

## Paying, pausing and skipping

Select a commitment in **Pay Commitments** (tap a card on a phone, tick a row on a computer) and use the bar at the bottom. The same actions are on the **Dashboard**: open the ⋮ menu on a row of *Due dates & still to pay*, or tick several rows and use the buttons above the list.

| Action | What it does | When to use it |
|---|---|---|
| Mark paid | Adds an Expense Log row linked to that due date. | You paid it. |
| Mark pending | Removes that payment again. | You marked it by mistake. |
| Not required | Settles one due date without a payment. Nothing is logged, it is never overdue, and it is left out of the totals. Undo with **Required again**. | A payment you do not have to make this time. |
| Pause | Leaves this month's due date out of this month's totals. Ends by itself when the month changes; if still unpaid it then counts as overdue. | You will pay later and want this month's picture without it. |
| Archive | Moves the commitment out of every calculation until you restore it (Pay → Archived). Past payments stay in the log. | A commitment that has ended or is on hold. |

### Statuses

Status is worked out from the due dates and the linked payments; it is never stored, so it cannot go out of sync.

| Status | Meaning |
|---|---|
| Overdue | A due date before today is unpaid. |
| Pending | Something is still to pay this month. |
| Paid | Nothing overdue and this month's due date is paid. |
| Skipped | This month's due date was marked *not required*. |
| Paused | Paused for this month. |
| Upcoming | Not started yet, or nothing is due this month. |
| Completed | It has an end date and every due date is paid or marked not required. |
| Archived | In the archive. |

## Privacy mask

The eye button in the header (also in Settings → Privacy) hides amounts (`AED ••••`) and shows only the first letters of payment names (`Re••••`) in lists, totals and charts. It changes only how this device displays the data. Exports and backups keep the real values, and opening a row to edit it shows them.

## Demo

The demo fills the app with invented sample data: about twenty commitments in three currencies, a year of payments, six months of everyday spending, and some events and tasks. It always shows a mix of paid, pending, overdue, paused and skipped items.

The demo lives in memory only. It is never saved in the browser and never backed up, and it does not touch your own data. Open it from Settings → Demo, with `?demo=1` on the address, or share that link with someone.

## Where your data is

Your data is a SQLite database kept in this browser's storage on this device. A different browser or device has its own separate data.

- **Export DB** downloads the database as a `.db` file. **Import DB** replaces the current data with a file.
- **Export CSV** writes a spreadsheet-friendly copy.
- Clearing the browser's site data deletes the app's data, so keep an export or turn on cloud backup.

## Cloud backup and sync

Backup is optional. It sends the saved database from your device straight to **your own** OneDrive or Google Drive. No other server is involved, and the app asks only for its own app folder, so it cannot see your other files.

| | OneDrive | Google Drive |
|---|---|---|
| Permission | `Files.ReadWrite.AppFolder` (the `Apps/<app name>` folder) | `drive.appdata` (a hidden app folder) |
| Backup after each save | Yes | Yes |
| Loads the newer copy when the app opens | Yes | No, use Restore |
| Sign-in lasts | About a day | About an hour |

What is kept in the drive: `gowtham_tracker_latest.db`, one dated copy per day for the last 14 days, and up to five "kept" copies made when one side replaced the other.

**How sync decides (OneDrive).** When the app opens or comes back to the front it compares this device with the drive:

- The drive is newer and nothing changed here: the drive copy is loaded.
- Only this device changed, or the drive is empty: this device is uploaded.
- Both changed, or this device has data and has never synced: the app asks which copy to keep. The copy that loses is saved to the drive first as a "kept" copy, so it can still be restored.

A device never replaces a drive copy it has not seen. The header shows the state: *Backed up 9:41 · auto*, *Backup pending*, *Choose a copy*, *Sign in to sync* or *Backup failed*.

Limits to know about: backups run only while the app is open and signed in; if it has been closed longer than the sign-in lasts, open it and tap **Reconnect** once. Backups are not encrypted by the app, so protect your Microsoft or Google account with two-step sign-in. Two devices cannot be merged row by row; one copy wins.

### One-time setup

You register the app once with Microsoft and/or Google and paste the resulting ID into Settings → Private cloud backup. An ID like this is public by design and is not a secret. Never put a client *secret* anywhere in this project.

**OneDrive (personal Microsoft account)**

1. Go to <https://entra.microsoft.com> → App registrations → New registration.
2. Supported account types: *Personal Microsoft accounts only*.
3. Redirect URI: platform *Single-page application (SPA)*, value `https://tracker.gowthams.com/oauth.html`.
4. API permissions → Microsoft Graph → Delegated: `Files.ReadWrite.AppFolder` and `offline_access`.
5. Copy the *Application (client) ID*.

**Google Drive**

1. Go to <https://console.cloud.google.com>, create a project and enable the *Google Drive API*.
2. OAuth consent screen: External, add the scope `.../auth/drive.appdata`, and add yourself as a test user.
3. Credentials → Create credentials → OAuth client ID → *Web application*. Authorized JavaScript origin: `https://tracker.gowthams.com`.
4. Copy the *Client ID*.

Then open Settings → Private cloud backup, paste the ID and choose **Connect**. To pre-fill the IDs on every device, put them in `backup-config.js`.

If you host the app at another address, use that address in the steps above. The exact redirect address is shown in Settings.

## Security and privacy

- The website and this repository are public, but they contain only the app's code. Your data is never in the repository.
- Sign-in tokens are kept in this browser only. They are never written into the database, so they are never exported or uploaded.
- All text you enter is shown as text, never run as code. CSV export guards against spreadsheet formulas.
- The app refuses to run inside another site's frame, and the offline cache stores only the app's own files.
- Anyone who can push to this repository can change the code that runs with your drive sign-in. Turn on two-step sign-in for GitHub, protect the `main` branch, and do not add collaborators you do not trust.
- Do not commit exported `.db` or `.csv` files. `.gitignore` already excludes them.

## Data model

Schema version 5 (`PRAGMA user_version = 5`). Version 4 files are upgraded when opened; older files are rejected and left unchanged.

| Table | Holds |
|---|---|
| `commitments` | name, category, amount, currency, frequency, due day/month, start and end date, method, notes, paused month, archived flag |
| `expense_logs` | actual date, description, category, amount, currency, method, notes, and the linked commitment and due date for payments |
| `events` | title, kind (Event or Task), date, yearly repeat, budget, currency, done flag, notes |
| `skips` | commitment and due date marked *not required*. Added in 5.7 and created automatically when missing |
| `settings` | auto-save, theme, last imported and exported file names |

A payment is an `expense_logs` row with a `commitmentId` and a `commitmentDate`. That pair identifies the exact due date it settles.

Validation rules: amounts are numbers above 0 rounded to two decimals; due day is 1–31 and is clamped to shorter months; a one-time commitment needs a due date; a linked payment must point at a real due date of its commitment.

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | The app's screens |
| `assets/js/core.js` | Dates, due dates, status, analytics, schema and validation. No screen code, so it also runs in Node |
| `assets/js/app.js` | Screen logic (Alpine.js component) |
| `assets/js/backup.js` | OneDrive and Google Drive backup |
| `assets/js/demo.js` | Sample data for the demo |
| `backup-config.js` | Optional public client IDs |
| `oauth.html` | Landing page of the OneDrive sign-in window |
| `sw.js`, `manifest.webmanifest`, `assets/icons/` | Offline cache and install-as-app |
| `assets/css/`, `assets/webfonts/` | Compiled Tailwind CSS and Font Awesome icons |
| `assets/js/alpine.min.js`, `chart.umd.js`, `sql-wasm*.js` | Bundled libraries: Alpine.js 3.14.1, Chart.js, sql.js 1.12.0 |
| `assets/licenses/` | Licences of the bundled libraries |
| `build-css/` | Rebuilds the CSS when new Tailwind classes are used |

## Development

Serve the folder locally, for example `python3 -m http.server 8000`, and open `http://localhost:8000`.

Rebuild the CSS after adding Tailwind classes to `index.html`:

```
cd build-css
npm install
npm run build
```

When releasing, change the version in three places so browsers and installed apps pick up the new files: `appVersion` in `assets/js/app.js`, `VERSION` in `sw.js`, and the `?v=` tags in `index.html`.

## Recent changes

- **5.7** Privacy mask; pay, pause, skip and archive from the dashboard; "not required this time"; demo with sample data; safer cloud sync (a device never replaces a drive copy it has not seen); layout fixes for small and mid-size screens.
- **5.6** Backup status in the header; upload straight after Save.
- **5.5** OneDrive sign-in on open, automatic load of the newer copy.
- **5.4** Private backup to OneDrive and Google Drive; installable, offline app.
- **5.0–5.3** Pause and archive, selection bar, due-date card, per-currency charts, settings page.

The full history is in the commit log.
