# Private cloud backup + Android app (v5.4)

The site is public, but **your data is not on it**: it lives in your browser/phone. Backup goes from your device
straight to **your own** Google Drive / OneDrive, into a hidden app-only folder. There is no server in between and
no secret in this repo.

| | Google Drive | OneDrive |
|---|---|---|
| Permission asked | `drive.appdata` (hidden app folder; cannot see your other files) | `Files.ReadWrite.AppFolder` (private `Apps/<app>` folder) |
| Files kept | `gowtham_tracker_latest.db` + last 14 daily copies | same |
| Sign-in lasts | ~1 hour, renewed silently while signed in to Google | refresh token, ~1 day |

If the app was closed longer than the sign-in lasts, open it and tap **Settings → Reconnect** once. Backups resume.
Only *saved* data is backed up (same as Export DB). Backups are not encrypted by the app; anyone with access to your
Google/Microsoft account could read them.

## One-time setup (≈10 minutes, free)

Your site address is `https://tracker.gowthams.com` (from `CNAME`). Use that exact origin below.

### Google Drive
1. <https://console.cloud.google.com> → create a project → **APIs & Services → Library** → enable **Google Drive API**.
2. **OAuth consent screen** → External → fill app name + your email → add scope `.../auth/drive.appdata` →
   add yourself under **Test users** (leave it in *Testing*; no verification needed for personal use. In Testing mode,
   Google makes you re-consent about every 7 days; set *In production* to avoid that, `drive.appdata` is a non-sensitive scope).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized JavaScript origins*: `https://tracker.gowthams.com` (add `http://localhost:8000` to test locally). No redirect URI needed.
4. Copy the **Client ID**.

### OneDrive (personal Microsoft account)
1. <https://entra.microsoft.com> (or portal.azure.com) → **App registrations → New registration**.
2. Supported account types: **Personal Microsoft accounts only** (or "any directory + personal").
3. Redirect URI: platform **Single-page application (SPA)** → `https://tracker.gowthams.com/oauth.html`
   (shown in Settings too; add `http://localhost:8000/oauth.html` to test locally).
4. **API permissions** → Microsoft Graph → Delegated → `Files.ReadWrite.AppFolder` and `offline_access`.
5. Copy the **Application (client) ID**.

### Use it
Open the app → **Settings → Private cloud backup** → paste the ID → **Connect**. Repeat on each device
(or put the IDs in `backup-config.js` and commit; client IDs are public by design, **never** a client secret).
Restore on any device: **Settings → Restore…** and pick `latest` or a dated copy.

## Android app

It is a **PWA**: open `https://tracker.gowthams.com` in Chrome on Android → menu → **Install app** / *Add to Home screen*.
It then runs full-screen with its own icon and works offline. Everything above (backup/restore) works the same.

Want a real `.apk`/Play Store listing? Wrap the same site as a Trusted Web Activity at <https://www.pwabuilder.com>
(enter the URL → Android). A TWA runs in Chrome, so the Google/Microsoft sign-in works; a plain WebView wrapper
would not, because Google blocks sign-in inside embedded WebViews.

Note: the installed app and the Chrome tab share storage on the same phone, but your PC and phone have separate data;
use Backup/Restore to move data between them.
