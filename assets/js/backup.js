/* backup.js - private cloud backup (Google Drive "appDataFolder" and OneDrive "App folder").
 *
 * Privacy model (the site itself is public, the backups are not):
 *  - No secret is stored in this repo. A "client ID" is public by design; it only says which app is asking.
 *  - You sign in with YOUR account; the browser then talks straight to Google / Microsoft. No server of ours is involved.
 *  - Only the minimum permission is requested: Google "drive.appdata" (a hidden folder only this app can open, it cannot
 *    see any of your other Drive files) and Microsoft "Files.ReadWrite.AppFolder" (the private Apps/<app name> folder).
 *  - Access tokens are kept in this browser's localStorage only, never inside the .db, so they are never exported or uploaded.
 */
(function () {
    'use strict';
    const LS = 'tracker_cloud_v1';
    const FILE_LATEST = 'gowtham_tracker_latest.db';
    const SNAP_PREFIX = 'gowtham_tracker_', SNAP_RE = /^gowtham_tracker_(\d{4}-\d{2}-\d{2})\.db$/;
    const KEEP_DAILY = 14;
    const G_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const MS_SCOPE = 'Files.ReadWrite.AppFolder offline_access';
    const MS_AUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';   // personal Microsoft accounts (OneDrive personal)
    const GRAPH = 'https://graph.microsoft.com/v1.0';
    const DEFAULTS = (window.CLOUD_BACKUP_CONFIG || {});

    /* ---------- tiny state store (localStorage, never throws) ---------- */
    function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
    function save(s) { try { localStorage.setItem(LS, JSON.stringify(s)); return true; } catch (e) { return false; } }
    let state = load();            // { googleClientId, msClientId, provider, auto, google:{token,exp}, ms:{token,exp,refresh}, last:{...}, lastHash }
    const persist = () => save(state);
    const listeners = [];
    const emit = () => listeners.forEach(f => { try { f(api.status()); } catch (e) { } });

    const redirectUri = () => new URL('oauth.html', location.href).href;
    const clientId = p => (p === 'google' ? (state.googleClientId || DEFAULTS.googleClientId) : (state.msClientId || DEFAULTS.msClientId)) || '';
    const now = () => Date.now();
    const todayStr = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

    function loadScript(src) {
        return new Promise((res, rej) => {
            const s = document.createElement('script'); s.src = src; s.async = true;
            s.onload = res; s.onerror = () => rej(new Error('Could not load ' + new URL(src).host + ' (are you offline?)'));
            document.head.appendChild(s);
        });
    }
    async function sha(u8) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', u8)); return Array.from(h, b => b.toString(16).padStart(2, '0')).join(''); }
    const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

    /* ---------- Google: Identity Services token client (implicit, appdata scope) ---------- */
    let gClient = null;
    async function googleToken(interactive) {
        const g = state.google;
        if (g && g.token && g.exp > now() + 60000) return g.token;
        const id = clientId('google'); if (!id) throw new Error('Add your Google client ID first.');
        if (!(window.google && google.accounts && google.accounts.oauth2)) await loadScript('https://accounts.google.com/gsi/client');
        return new Promise((resolve, reject) => {
            gClient = google.accounts.oauth2.initTokenClient({
                client_id: id, scope: G_SCOPE,
                callback: r => {
                    if (r.error) return reject(new Error(r.error_description || r.error));
                    state.google = { token: r.access_token, exp: now() + (Number(r.expires_in) || 3600) * 1000 }; persist(); resolve(r.access_token);
                },
                error_callback: e => reject(new Error(e && e.type === 'popup_failed_to_open' ? 'Sign-in popup was blocked. Tap "Reconnect".' : (e && (e.message || e.type)) || 'Google sign-in failed'))
            });
            // prompt '' = silent when consent was already given; interactive first connect lets Google ask
            gClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        });
    }

    /* ---------- Microsoft: OAuth code + PKCE in a popup (oauth.html relays the result) ---------- */
    async function msTokenRequest(params) {
        const r = await fetch(MS_AUTH + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(j.error_description || j.error || 'Microsoft sign-in failed'); e.code = j.error; throw e; }
        state.ms = { token: j.access_token, exp: now() + (Number(j.expires_in) || 3600) * 1000, refresh: j.refresh_token || (state.ms && state.ms.refresh) || '' }; persist();
        return j.access_token;
    }
    async function msInteractive() {
        const id = clientId('ms'); if (!id) throw new Error('Add your Microsoft application (client) ID first.');
        const verifier = rand(48), challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))), st = rand(16);
        const url = MS_AUTH + '/authorize?' + new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: MS_SCOPE, state: st, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
        const code = await new Promise((resolve, reject) => {
            const w = window.open(url, 'ms_oauth', 'width=520,height=680'); if (!w) return reject(new Error('Sign-in popup was blocked. Allow popups for this site and try again.'));
            const done = fn => v => { clearInterval(t); removeEventListener('message', onMsg); fn(v); };
            const ok = done(resolve), bad = done(reject);
            const onMsg = ev => {
                if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'tracker-oauth') return;
                if (ev.data.state !== st) return bad(new Error('Sign-in state mismatch - try again.'));
                ev.data.error ? bad(new Error(ev.data.error_description || ev.data.error)) : ok(ev.data.code);
            };
            addEventListener('message', onMsg);
            const t = setInterval(() => { if (w.closed) bad(new Error('Sign-in window was closed.')); }, 600);
        });
        return msTokenRequest({ client_id: id, grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: verifier, scope: MS_SCOPE });
    }
    async function msToken(interactive) {
        const m = state.ms;
        if (m && m.token && m.exp > now() + 60000) return m.token;
        if (m && m.refresh) {
            try { return await msTokenRequest({ client_id: clientId('ms'), grant_type: 'refresh_token', refresh_token: m.refresh, scope: MS_SCOPE }); }
            catch (e) { if (!interactive) throw e; }
        }
        if (!interactive) throw new Error('Microsoft sign-in expired. Tap "Reconnect".');
        return msInteractive();
    }

    /* ---------- provider operations: list / upload / download / remove ---------- */
    async function call(url, token, opts = {}) {
        const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {}) }));
        if (!r.ok) { let m = ''; try { const j = await r.json(); m = (j.error && (j.error.message || j.error)) || ''; } catch (e) { } const e = new Error((m || 'HTTP ' + r.status)); e.status = r.status; throw e; }
        return r;
    }
    const providers = {
        google: {
            label: 'Google Drive', token: googleToken,
            async list(t) {
                const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '200', fields: 'files(id,name,size,modifiedTime)', orderBy: 'modifiedTime desc' });
                return ((await (await call('https://www.googleapis.com/drive/v3/files?' + q, t)).json()).files || []).map(f => ({ id: f.id, name: f.name, size: Number(f.size) || 0, modified: f.modifiedTime }));
            },
            async put(t, name, bytes, existing) {
                if (existing) return call('https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=media', t, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
                const b = '----trk' + rand(9), meta = JSON.stringify({ name, parents: ['appDataFolder'] });
                const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${b}--`]);
                return call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', t, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
            },
            async get(t, f) { return new Uint8Array(await (await call('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media', t)).arrayBuffer()); },
            async del(t, f) { return call('https://www.googleapis.com/drive/v3/files/' + f.id, t, { method: 'DELETE' }); }
        },
        ms: {
            label: 'OneDrive', token: msToken,
            async list(t) {
                const j = await (await call(GRAPH + '/me/drive/special/approot/children?$select=id,name,size,lastModifiedDateTime&$top=200', t)).json();
                return (j.value || []).filter(f => f.name.endsWith('.db')).map(f => ({ id: f.id, name: f.name, size: f.size || 0, modified: f.lastModifiedDateTime })).sort((a, b) => b.modified.localeCompare(a.modified));
            },
            async put(t, name, bytes) { const r = await call(GRAPH + '/me/drive/special/approot:/' + encodeURIComponent(name) + ':/content', t, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes }); const j = await r.json().catch(() => ({})); return { modified: j.lastModifiedDateTime || '' }; },
            async get(t, f) { return new Uint8Array(await (await call(GRAPH + '/me/drive/items/' + f.id + '/content', t)).arrayBuffer()); },
            async del(t, f) { return call(GRAPH + '/me/drive/items/' + f.id, t, { method: 'DELETE' }); }
        }
    };

    /* ---------- backup logic ---------- */
    let busy = false, timer = null, lastError = '';
    const setLast = (p, patch) => { state.last = Object.assign({}, state.last || {}, { [p]: Object.assign({}, (state.last || {})[p] || {}, patch) }); persist(); };

    async function backupNow(getBytes, opts = {}) {
        const interactive = !!opts.interactive, force = !!opts.force;
        const names = enabledProviders(); if (!names.length) throw new Error('Connect Google Drive or OneDrive first.');
        if (busy) return { skipped: 'busy' };
        busy = true; emit();
        const bytes = getBytes(), hash = await sha(bytes), results = {};
        try {
            for (const p of names) {
                const P = providers[p];
                try {
                    if (!force && (state.lastHash || {})[p] === hash && (state.last || {})[p] && !(state.last[p].error)) { results[p] = 'unchanged'; state.dirty = false; persist(); continue; }
                    const t = await P.token(interactive);
                    let files = await P.list(t);
                    const latest = files.find(f => f.name === FILE_LATEST);
                    const up = await P.put(t, FILE_LATEST, bytes, latest);
                    if (up && up.modified) { state.cloudMod = Object.assign({}, state.cloudMod, { [p]: up.modified }); }
                    const snap = SNAP_PREFIX + todayStr() + '.db';          // one dated copy per day, so a bad day can be rolled back
                    if (!files.some(f => f.name === snap)) {
                        await P.put(t, snap, bytes, null);
                        files = await P.list(t);
                        const old = files.filter(f => SNAP_RE.test(f.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(KEEP_DAILY);
                        for (const f of old) { try { await P.del(t, f); } catch (e) { } }
                    } else {
                        await P.put(t, snap, bytes, files.find(f => f.name === snap));
                    }
                    state.lastHash = Object.assign({}, state.lastHash, { [p]: hash });
                    state.dirty = false; setLast(p, { at: new Date().toISOString(), error: '' }); results[p] = 'ok';
                } catch (e) {
                    if (e.status === 401 && state[p]) state[p].exp = 0;
                    setLast(p, { error: e.message || String(e) }); results[p] = 'error: ' + (e.message || e); lastError = e.message || String(e);
                }
            }
        } finally { busy = false; emit(); }
        return results;
    }
    const enabledProviders = () => ['google', 'ms'].filter(p => state.on && state.on[p]);

    const api = {
        redirectUri,
        onChange(f) { listeners.push(f); },
        config() { return { googleClientId: state.googleClientId || DEFAULTS.googleClientId || '', msClientId: state.msClientId || DEFAULTS.msClientId || '' }; },
        setClientId(p, v) { state[p === 'google' ? 'googleClientId' : 'msClientId'] = String(v || '').trim(); persist(); emit(); },
        status() {
            const mk = p => ({ key: p, label: providers[p].label, hasId: !!clientId(p), connected: !!(state.on && state.on[p]), last: (state.last || {})[p] || {} });
            return { providers: [mk('google'), mk('ms')], auto: state.auto !== false, busy, error: lastError };
        },
        async connect(p, getBytes) {
            const P = providers[p]; await P.token(true);
            state.on = Object.assign({}, state.on, { [p]: true }); persist(); lastError = ''; emit();
            if (getBytes) await backupNow(getBytes, { interactive: true, force: true });
        },
        disconnect(p) {
            state.on = Object.assign({}, state.on, { [p]: false }); delete state[p]; if (state.lastHash) delete state.lastHash[p]; if (state.last) delete state.last[p];
            persist(); emit();
        },
        setAuto(v) { state.auto = !!v; persist(); emit(); },
        backupNow,
        /* Called after every save. Waits for quiet, then uploads silently (no popups). */
        schedule(getBytes) {
            state.dirty = true; persist();          // this device has changes the cloud copy does not have
            if (state.auto === false || !enabledProviders().length) return;
            clearTimeout(timer); timer = setTimeout(() => { backupNow(getBytes, { interactive: false }).catch(e => { lastError = e.message; emit(); }); }, 20000);
        },
        /* Compare this device with the cloud 'latest' copy. Never needs a popup (interactive:false).
         * none     : same as the cloud
         * load     : cloud changed, this device did not        -> safe to load the cloud copy
         * upload   : this device changed, cloud did not        -> back up
         * conflict : both changed since the last sync          -> the user must choose
         * empty    : nothing in the cloud yet                  -> back up
         * signin   : no usable sign-in (needs one tap)         */
        async checkSync(p, interactive) {
            if (!(state.on && state.on[p])) return { action: 'off' };
            const P = providers[p];
            let t; try { t = await P.token(!!interactive); } catch (e) { return { action: 'signin', error: e.message }; }
            const files = await P.list(t), file = files.find(f => f.name === FILE_LATEST);
            if (!file) return { action: 'empty' };
            const cloudChanged = file.modified !== ((state.cloudMod || {})[p] || ''), localChanged = !!state.dirty;
            if (!cloudChanged && !localChanged) return { action: 'none', file };
            if (cloudChanged && !localChanged) return { action: 'load', file };
            if (!cloudChanged && localChanged) return { action: 'upload', file };
            return { action: 'conflict', file };
        },
        markSynced(p, file) { state.cloudMod = Object.assign({}, state.cloudMod, { [p]: file.modified }); state.dirty = false; persist(); },
        isConnected(p) { return !!(state.on && state.on[p]); },
        async list(p) { const P = providers[p]; return P.list(await P.token(false).catch(() => P.token(true))); },
        async download(p, file) { const P = providers[p]; return P.get(await P.token(false).catch(() => P.token(true)), file); }
    };
    window.CloudBackup = api;
})();
