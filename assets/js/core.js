/* core.js - pure logic (no DOM). Works in the browser (window.Core) and in Node (require) so it can be unit-tested.
 *  - date helpers (local calendar dates as ISO "YYYY-MM-DD" strings, never timezone math)
 *  - occurrence generation + derived status for payment commitments (based on startDate / endDate)
 *  - dashboard time windows + analytics
 *  - SQL builder for the Expense Log (filter / multi-column sort / pagination)
 *  - schema v5 (v4 files are upgraded in place by adding the pause/archive columns and the settings table;
 *    anything older is rejected with a clear message)
 *  - settings (key/value, validated)
 *  - validation
 */
(function (root) {
    'use strict';
    const SCHEMA_VERSION = 5;

    /* ------------------------------------------------------------------ schema */
    const SCHEMA = {
        commitments:  { name: 'TEXT', region: 'TEXT', category: 'TEXT', amount: 'REAL', currency: 'TEXT', frequency: 'TEXT', dueDay: 'INTEGER', dueMonth: 'INTEGER', startDate: 'TEXT', endDate: 'TEXT', method: 'TEXT', notes: 'TEXT', pausedMonth: 'TEXT', archived: 'INTEGER' },
        expense_logs: { actualDate: 'TEXT', commitmentDate: 'TEXT', commitmentId: 'INTEGER', region: 'TEXT', category: 'TEXT', item: 'TEXT', amount: 'REAL', currency: 'TEXT', method: 'TEXT', notes: 'TEXT' },
        events:       { title: 'TEXT', kind: 'TEXT', eventDate: 'TEXT', repeat: 'TEXT', budget: 'REAL', currency: 'TEXT', done: 'INTEGER', notes: 'TEXT' }
    };
    const V5_ADDED = { commitments: ['pausedMonth', 'archived'] };            // columns added by the v4 -> v5 upgrade
    const SETTINGS_DDL = "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')";
    const NULLABLE = new Set(['dueDay', 'dueMonth', 'endDate', 'commitmentDate', 'commitmentId', 'pausedMonth']);
    const DEFAULTS = { region: 'UAE', currency: 'AED', frequency: 'Monthly', kind: 'Event', repeat: 'None' };
    const ENUMS = { frequency: ['Monthly', 'Bi-Monthly', 'Yearly', 'One-Time'], kind: ['Event', 'Task'], repeat: ['None', 'Yearly'] };
    const INDEXES = [
        'CREATE INDEX IF NOT EXISTS idx_logs_actual ON expense_logs(actualDate)',
        'CREATE INDEX IF NOT EXISTS idx_logs_commitment ON expense_logs(commitmentId, commitmentDate)',
        'CREATE INDEX IF NOT EXISTS idx_commitments_dates ON commitments(startDate, endDate)',
        'CREATE INDEX IF NOT EXISTS idx_events_date ON events(eventDate)'
    ];
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /* ------------------------------------------------------------------ numbers */
    const toInt = v => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isInteger(n) ? n : null; };
    const toMoney = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
    const addTo = (map, cur, amt) => { map[cur] = Math.round(((map[cur] || 0) + amt) * 100) / 100; };

    /* ------------------------------------------------------------------ dates (ISO strings, local calendar) */
    const pad2 = n => String(n).padStart(2, '0');
    const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
    const isMonthKey = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
    const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const ymd = s => s.split('-').map(Number);
    const validISO = s => { if (!isISO(s)) return false; const [y, m, d] = ymd(s); return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); };
    const todayISO = (d = new Date()) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());          // local, NOT toISOString()
    const monthKey = s => s.slice(0, 7);
    const monthStart = (y, m) => iso(y, m, 1);
    const monthEnd = (y, m) => iso(y, m, daysInMonth(y, m));
    const clampDay = (y, m, d) => Math.min(d, daysInMonth(y, m));
    const addMonths = (y, m, n) => { const t = y * 12 + (m - 1) + n; return [Math.floor(t / 12), (t % 12) + 1]; };
    const addDays = (s, n) => { const [y, m, d] = ymd(s); return todayISO(new Date(y, m - 1, d + n)); };
    const daysBetween = (a, b) => { const [ay, am, ad] = ymd(a), [by, bm, bd] = ymd(b); return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5); };
    const fmtDate = s => { if (!validISO(s)) return s || '—'; const [y, m, d] = ymd(s); return `${d} ${MONTH_NAMES[m - 1]} ${y}`; };

    /* ------------------------------------------------------------------ occurrences & status */
    // Every due date of a commitment inside [from, to], clipped to the commitment's own [startDate, endDate].
    function occurrencesOf(c, from, to) {
        if (!validISO(c.startDate)) return [];
        const hasEnd = validISO(c.endDate);
        const lo = from > c.startDate ? from : c.startDate;
        const hi = (hasEnd && c.endDate < to) ? c.endDate : to;
        if (lo > hi) return [];
        if (c.frequency === 'One-Time') return (hasEnd && c.endDate >= lo && c.endDate <= hi) ? [c.endDate] : [];   // endDate IS the due date
        const day = toInt(c.dueDay), mon = toInt(c.dueMonth);
        if (!(day >= 1 && day <= 31)) return [];
        if (c.frequency === 'Yearly' && !(mon >= 1 && mon <= 12)) return [];
        const anchor = c.frequency === 'Bi-Monthly' ? ((mon >= 1 && mon <= 12) ? mon : ymd(c.startDate)[1]) : 0;
        const [ly, lm] = ymd(lo), [hy, hm] = ymd(hi), out = [];
        for (let t = ly * 12 + lm - 1, last = hy * 12 + hm - 1; t <= last && out.length < 1200; t++) {
            const y = Math.floor(t / 12), m = (t % 12) + 1;
            if (c.frequency === 'Yearly' && m !== mon) continue;
            if (c.frequency === 'Bi-Monthly' && (((m - anchor) % 2) + 2) % 2 !== 0) continue;
            const d = iso(y, m, clampDay(y, m, day));
            if (d >= lo && d <= hi) out.push(d);
        }
        return out;
    }
    const occKey = (id, date) => `${id}|${date}`;
    // A payment = expense-log row linked to (commitmentId, commitmentDate). That pair identifies the occurrence it settles.
    function buildPaidIndex(logs) {
        const m = new Map();
        logs.forEach(l => { if (toInt(l.commitmentId) && validISO(l.commitmentDate)) { const k = occKey(Number(l.commitmentId), l.commitmentDate); if (!m.has(k)) m.set(k, l); } });
        return m;
    }

    /* Pause = "skip this month in the dashboard". It is stored as the month it applies to (YYYY-MM) and is only
     * active while that month is the current month, so it lapses by itself when the month rolls over.            */
    const pauseActive = (c, today) => isMonthKey(c.pausedMonth) && c.pausedMonth === monthKey(today);
    const isArchived = c => !!Number(c.archived);

    /* Derived status - never stored.
     *  Archived  : moved to the archive (excluded from every calculation until restored)
     *  Upcoming  : today < startDate, or nothing overdue and no due date in the current month (e.g. a Yearly
     *              commitment due in another month, the off-month of a Bi-Monthly one, a One-Time due later)
     *  Overdue   : at least one due date before today (inside start..end) has no linked payment (paused-month dates excluded)
     *  Completed : has an endDate and EVERY due date in start..end is paid (or the range has no due dates and has ended)
     *  Paused    : paused for the current month and this month still has an unpaid due date
     *  Paid      : nothing overdue and this month's due date(s) are all paid (cycle settled)
     *  Pending   : everything else (active, something still to pay now or later)                                      */
    function statusOf(c, paid, today) {
        const base = { status: 'Pending', missed: [], next: '', paidCount: 0, total: 0, invalid: false, paused: false, pausedDue: [] };
        if (!validISO(c.startDate) || (c.endDate && (!validISO(c.endDate) || c.endDate < c.startDate))) return { ...base, invalid: true, status: isArchived(c) ? 'Archived' : 'Pending' };
        const finite = validISO(c.endDate);
        const horizon = finite ? c.endDate : addDays(today, 400);
        const occ = occurrencesOf(c, c.startDate, horizon);
        const isPaid = d => paid.has(occKey(c.id, d));
        const pz = pauseActive(c, today), skip = d => pz && monthKey(d) === c.pausedMonth;
        const missed = occ.filter(d => d < today && !isPaid(d) && !skip(d));
        const nextUnpaid = occ.find(d => d >= today && !isPaid(d) && !skip(d)) || '';
        const thisMonth = occ.filter(d => monthKey(d) === monthKey(today));
        const pausedDue = pz ? thisMonth.filter(d => !isPaid(d)) : [];
        const r = { ...base, missed, next: missed[0] || nextUnpaid, paidCount: occ.filter(isPaid).length, total: finite ? occ.length : 0, paused: pz, pausedDue };
        if (isArchived(c)) return { ...r, status: 'Archived' };
        if (today < c.startDate) return { ...r, status: 'Upcoming', next: occ.find(d => !skip(d)) || '' };
        if (missed.length) return { ...r, status: 'Overdue' };
        if (finite && ((occ.length && occ.every(isPaid)) || (!occ.length && c.endDate < today))) return { ...r, status: 'Completed' };
        if (pausedDue.length) return { ...r, status: 'Paused' };
        if (thisMonth.length && thisMonth.every(isPaid)) return { ...r, status: 'Paid' };
        if (!thisMonth.length) return { ...r, status: 'Upcoming' };          // nothing due this month: next due date is in a later month
        return r;
    }
    // Which due date should "Mark paid" settle? oldest missed one, else this month's, else the next upcoming one.
    // A pause is ignored here: paying a paused commitment settles the paused due date (the app resumes it first).
    function payTarget(c, paid, today) {
        const s = statusOf({ ...c, pausedMonth: '', archived: 0 }, paid, today);
        if (s.invalid) return '';
        return s.missed[0] || s.next || '';
    }

    /* ------------------------------------------------------------------ dashboard windows */
    const RANGE_SPANS = { last3: [-2, 3], last6: [-5, 6], next3: [1, 3], next6: [1, 6], next12: [1, 12], ytd: true, rest: true };
    const RANGE_LABELS = { last3: 'Last 3 months', last6: 'Last 6 months', next3: 'Next 3 months', next6: 'Next 6 months', next12: 'Next 12 months', ytd: 'Year to date', rest: 'Rest of this year' };
    function makeWindow(sel, today) {
        const [ty, tm] = ymd(today), months = [];
        const push = (y, m) => months.push({ key: `${y}-${pad2(m)}`, y, m, label: `${MONTH_NAMES[m - 1]} ${y}`, start: monthStart(y, m), end: monthEnd(y, m) });
        let label = '', error = '';
        const mode = sel.mode || 'this';
        if (RANGE_SPANS[mode]) {
            const span = mode === 'ytd' ? [1 - tm, tm] : mode === 'rest' ? [0, 13 - tm] : RANGE_SPANS[mode];
            for (let i = 0; i < span[1]; i++) { const [y, m] = addMonths(ty, tm, span[0] + i); push(y, m); }
            label = RANGE_LABELS[mode] + (months.length > 1 ? ` (${months[0].label} – ${months[months.length - 1].label})` : ` (${months[0].label})`);
        } else if (mode === 'this' || mode === 'next' || mode === 'last') {
            const [y, m] = addMonths(ty, tm, mode === 'next' ? 1 : mode === 'last' ? -1 : 0); push(y, m);
            label = `${{ this: 'This month', next: 'Next month', last: 'Last month' }[mode]} (${months[0].label})`;
        } else if (mode === 'year') {
            const y = toInt(sel.year) || ty; for (let m = 1; m <= 12; m++) push(y, m); label = `Year ${y}`;
        } else {
            const fy = toInt(sel.fromY), fm = toInt(sel.fromM), ey = toInt(sel.toY), em = toInt(sel.toM);
            const n = (ey * 12 + em) - (fy * 12 + fm) + 1;
            if (![fy, fm, ey, em].every(Number.isInteger)) error = 'Choose a start and end month.';
            else if (n < 1) error = 'The end month must be the same as or after the start month.';
            else if (n > 36) error = 'Select at most 36 months.';
            else { for (let i = 0; i < n; i++) { const [y, m] = addMonths(fy, fm, i); push(y, m); } label = n === 1 ? months[0].label : `${months[0].label} – ${months[n - 1].label}`; }
        }
        if (error) { const [y, m] = [ty, tm]; push(y, m); label = months[0].label; }
        return { mode, months, start: months[0].start, end: months[months.length - 1].end, label, error };
    }
    function previousWindow(win) {
        const n = win.months.length, f = win.months[0], [y, m] = addMonths(f.y, f.m, -n), [ey, em] = addMonths(y, m, n - 1);
        return makeWindow({ mode: 'months', fromY: y, fromM: m, toY: ey, toM: em }, win.start);
    }
    // Selection that is one window earlier (dir -1) or later (+1). Years step by one year, everything else by the window length.
    function shiftSelection(win, dir) {
        const f = win.months[0], n = win.months.length;
        if (win.mode === 'year') return { mode: 'year', year: Math.min(2100, Math.max(1990, f.y + dir)) };
        const [y, m] = addMonths(f.y, f.m, dir * n), [ey, em] = addMonths(y, m, n - 1);
        if (y < 1990 || ey > 2100) return null;
        return { mode: 'months', fromY: y, fromM: m, toY: ey, toM: em };
    }
    const MODES = ['this', 'next', 'last', 'last3', 'last6', 'next3', 'next6', 'next12', 'rest', 'ytd', 'months', 'year'];
    // Never trust a stored selection: returns a safe selection object.
    function sanitizeSelection(sel, today) {
        const [ty, tm] = ymd(today), out = { mode: 'this', fromM: tm, fromY: ty, toM: tm, toY: ty, year: ty };
        if (!sel || typeof sel !== 'object' || !MODES.includes(sel.mode)) return out;
        out.mode = sel.mode;
        const ok = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;
        ['fromM', 'toM'].forEach(k => { if (ok(sel[k], 1, 12)) out[k] = Number(sel[k]); });
        ['fromY', 'toY', 'year'].forEach(k => { if (ok(sel[k], 1990, 2100)) out[k] = Number(sel[k]); });
        return out;
    }

    /* ------------------------------------------------------------------ analytics */
    // Archived commitments are skipped entirely. Unpaid due dates of a commitment paused for the current month are
    // left out of every total and returned separately (pausedOcc / pausedTotal) so the UI can say what was excluded.
    function analyze(commitments, logs, win, today) {
        const paid = buildPaidIndex(logs), occ = [], pausedOcc = [], pausedTotal = {};
        let archivedCount = 0;
        commitments.forEach(c => {
            if (isArchived(c)) { archivedCount++; return; }
            const pz = pauseActive(c, today);
            occurrencesOf(c, win.start, win.end).forEach(date => {
                const log = paid.get(occKey(c.id, date)) || null;
                const o = { c, id: c.id, date, paid: !!log, log, overdue: !log && date < today, currency: c.currency || 'AED', amount: toMoney(c.amount), month: monthKey(date), paused: false };
                if (pz && !log && o.month === c.pausedMonth) { o.paused = true; o.overdue = false; pausedOcc.push(o); addTo(pausedTotal, o.currency, o.amount); return; }
                occ.push(o);
            });
        });
        const byDate = (a, b) => a.date.localeCompare(b.date) || String(a.c.name).localeCompare(String(b.c.name));
        occ.sort(byDate); pausedOcc.sort(byDate);
        const required = {}, paidBy = {}, outstanding = {}, overdue = {}, actual = {}, category = {};
        const perKey = new Map(win.months.map(m => [m.key, { key: m.key, label: m.label, required: {}, actual: {} }]));      // one pass, no per-month filtering
        occ.forEach(o => {
            addTo(required, o.currency, o.amount);
            if (o.paid) addTo(paidBy, o.currency, o.amount); else addTo(outstanding, o.currency, o.amount);
            if (o.overdue) addTo(overdue, o.currency, o.amount);
            const pm = perKey.get(o.month); if (pm) addTo(pm.required, o.currency, o.amount);
        });
        let logCount = 0;
        logs.forEach(l => {
            if (!validISO(l.actualDate) || l.actualDate < win.start || l.actualDate > win.end) return;
            logCount++;
            const cur = l.currency || 'AED', amt = toMoney(l.amount), k = l.category || 'Uncategorized';
            addTo(actual, cur, amt); (category[k] = category[k] || {}); addTo(category[k], cur, amt);
            const pm = perKey.get(monthKey(l.actualDate)); if (pm) addTo(pm.actual, cur, amt);
        });
        return { occ, pausedOcc, pausedTotal, archivedCount, required, paid: paidBy, outstanding, overdue, actual, category, perMonth: [...perKey.values()], logCount, paidCount: occ.filter(o => o.paid).length, overdueCount: occ.filter(o => o.overdue).length };
    }
    // Spend of ONE currency: window vs the equally long previous window.
    // One month -> cumulative daily line; several months -> one point per month. Single pass over the logs.
    function trend(logs, win, prev, cur, today) {
        const byDay = new Map(), byMonth = new Map();
        logs.forEach(l => {
            if ((l.currency || 'AED') !== cur || !validISO(l.actualDate)) return;
            const a = toMoney(l.amount);
            byDay.set(l.actualDate, (byDay.get(l.actualDate) || 0) + a);
            const k = monthKey(l.actualDate); byMonth.set(k, (byMonth.get(k) || 0) + a);
        });
        const r2 = v => Math.round(v * 100) / 100, labels = [], a = [], b = [];
        if (win.months.length === 1) {
            const m = win.months[0], pm = prev.months[0], dm = daysInMonth(m.y, m.m), dp = daysInMonth(pm.y, pm.m), n = Math.max(dm, dp);
            let ca = 0, cb = 0;
            for (let d = 1; d <= n; d++) {
                labels.push(String(d));
                const da = iso(m.y, m.m, Math.min(d, dm)), db = iso(pm.y, pm.m, Math.min(d, dp));
                if (d <= dm) ca += byDay.get(da) || 0;
                if (d <= dp) cb += byDay.get(db) || 0;
                a.push(d > dm || da > today ? null : r2(ca));          // never draw the future of the running month
                b.push(d <= dp ? r2(cb) : null);
            }
        } else {
            win.months.forEach((m, i) => { labels.push(m.label); a.push(r2(byMonth.get(m.key) || 0)); b.push(prev.months[i] ? r2(byMonth.get(prev.months[i].key) || 0) : null); });
        }
        const sumRange = w => { let s = 0; w.months.forEach(m => { s += byMonth.get(m.key) || 0; }); return s; };
        const curTotal = r2(sumRange(win)), prevTotal = r2(sumRange(prev));
        return { labels, current: a, previous: b, curTotal, prevTotal, delta: r2(curTotal - prevTotal), pct: prevTotal ? ((curTotal - prevTotal) / prevTotal) * 100 : null };
    }
    /* "Where the money went / will go" for ONE currency and the selected window.
     *  actual      : Expense Log rows dated inside the window (money that really went out)
     *  planned     : every counted due date in the window, split into paid / still to pay
     *  outstanding : due dates in the window that are still unpaid (future money)
     *  projected   : actual spend + what is still to pay in the window (spent so far + still coming)
     * `an` is the result of analyze() for the same window, so paused and archived commitments are already excluded.
     * Rows carry `a` (spent / paid) and `o` (still to pay) so the UI can draw a two-part bar. Beyond `top` rows fold into "Other". */
    const BREAKDOWN_MODES = ['actual', 'planned', 'outstanding', 'projected'];
    function breakdownMode(mode, win, today) {
        if (BREAKDOWN_MODES.includes(mode)) return mode;
        return win.end < today ? 'actual' : win.start > today ? 'outstanding' : 'projected';         // "auto"
    }
    function moneyBreakdown(an, logs, win, cur, mode, group = 'category', top = 8) {
        const m = new Map(); let spent = 0, due = 0;
        const label = (v, dflt) => String(v || '').trim() || dflt;
        const keyLog = l => group === 'item' ? label(l.item, 'Untitled') : label(l.category, 'Uncategorized');
        const keyOcc = o => group === 'item' ? label(o.c.name, 'Untitled') : label(o.c.category, 'General');   // "General" = what Mark paid logs for an empty category
        const add = (k, a, o) => { const e = m.get(k) || { cat: k, a: 0, o: 0, count: 0 }; e.a += a; e.o += o; e.count++; m.set(k, e); spent += a; due += o; };
        if (mode === 'actual' || mode === 'projected') logs.forEach(l => {
            if ((l.currency || 'AED') !== cur || !validISO(l.actualDate) || l.actualDate < win.start || l.actualDate > win.end) return;
            add(keyLog(l), toMoney(l.amount), 0);
        });
        if (mode === 'planned') an.occ.forEach(o => { if (o.currency === cur) add(keyOcc(o), o.paid ? o.amount : 0, o.paid ? 0 : o.amount); });
        if (mode === 'outstanding' || mode === 'projected') an.occ.forEach(o => { if (o.currency === cur && !o.paid) add(keyOcc(o), 0, o.amount); });
        const total = spent + due;
        let rows = [...m.values()].map(e => ({ ...e, total: e.a + e.o })).sort((x, y) => y.total - x.total || x.cat.localeCompare(y.cat));
        if (rows.length > top) {
            const rest = rows.slice(top - 1), sum = k => rest.reduce((s, r) => s + r[k], 0);
            rows = [...rows.slice(0, top - 1), { cat: 'Other', a: sum('a'), o: sum('o'), total: sum('total'), count: sum('count'), folded: rest.length }];
        }
        return { mode, group, total: toMoney(total), spent: toMoney(spent), due: toMoney(due), rows: rows.map(r => ({ ...r, a: toMoney(r.a), o: toMoney(r.o), total: toMoney(r.total), share: total ? r.total / total : 0 })) };
    }

    /* ------------------------------------------------------------------ events */
    function nextEventDate(e, today) {
        if (!validISO(e.eventDate)) return '';
        if (e.repeat !== 'Yearly') return e.eventDate;
        const [, m, d] = ymd(e.eventDate), [ty] = ymd(today);
        let c = iso(ty, m, clampDay(ty, m, d));
        if (c < today) c = iso(ty + 1, m, clampDay(ty + 1, m, d));
        return c;
    }
    function eventState(e, today) {
        const n = nextEventDate(e, today);
        if (e.kind === 'Task') return e.done ? 'Done' : (n && n < today ? 'Overdue' : n === today ? 'Due today' : 'Open');
        if (!n) return 'No date';
        return n === today ? 'Today' : (n < today ? 'Past' : 'Upcoming');
    }

    /* ------------------------------------------------------------------ Expense-log SQL (parameterised) */
    const escLike = s => String(s).replace(/[\\%_]/g, '\\$&');
    const SORT_COLS = {
        actualDate: 'actualDate', commitmentDate: '(commitmentDate IS NULL), commitmentDate', item: 'item COLLATE NOCASE',
        category: 'category COLLATE NOCASE', region: 'region', amount: 'amount', currency: 'currency', method: 'method COLLATE NOCASE', linked: '(commitmentId IS NULL)'
    };
    function buildLogQuery(f = {}, sorts = [], page = {}) {
        const w = [], p = [], eq = (col, v) => { if (v && v !== 'All') { w.push(`${col} = ?`); p.push(v); } };
        if (f.q && String(f.q).trim()) { const like = '%' + escLike(String(f.q).trim()) + '%'; w.push("(item LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')"); p.push(like, like, like); }
        if (validISO(f.actualFrom)) { w.push('actualDate >= ?'); p.push(f.actualFrom); }
        if (validISO(f.actualTo)) { w.push('actualDate <= ?'); p.push(f.actualTo); }
        if (validISO(f.commitFrom)) { w.push('commitmentDate >= ?'); p.push(f.commitFrom); }
        if (validISO(f.commitTo)) { w.push('commitmentDate <= ?'); p.push(f.commitTo); }
        eq('category', f.category); eq('region', f.region); eq('currency', f.currency); eq('method', f.method);
        if (f.link === 'linked') w.push('commitmentId IS NOT NULL'); else if (f.link === 'unlinked') w.push('commitmentId IS NULL');
        if (f.minAmt !== '' && f.minAmt != null && Number.isFinite(Number(f.minAmt))) { w.push('amount >= ?'); p.push(Number(f.minAmt)); }
        if (f.maxAmt !== '' && f.maxAmt != null && Number.isFinite(Number(f.maxAmt))) { w.push('amount <= ?'); p.push(Number(f.maxAmt)); }
        const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
        const order = sorts.filter(s => s && SORT_COLS[s.col]).slice(0, 3).map(s => {
            const dir = s.dir === 'desc' ? 'DESC' : 'ASC', expr = SORT_COLS[s.col];
            return s.col === 'commitmentDate' ? `(commitmentDate IS NULL), commitmentDate ${dir}` : `${expr} ${dir}`;
        });
        order.push('id DESC');
        const size = Math.min(Math.max(toInt(page.size) || 25, 1), 500), offset = Math.max(toInt(page.offset) || 0, 0);
        return {
            sql: `SELECT id FROM expense_logs ${where} ORDER BY ${order.join(', ')} LIMIT ? OFFSET ?`, params: [...p, size, offset],
            countSql: `SELECT COUNT(*) AS n FROM expense_logs ${where}`, totalsSql: `SELECT currency, ROUND(SUM(amount), 2) AS total FROM expense_logs ${where} GROUP BY currency`, filterParams: p
        };
    }
    function queryAll(db, sql, params = []) {
        const st = db.prepare(sql), out = [];
        try { st.bind(params); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
        return out;
    }

    /* ------------------------------------------------------------------ DB: schema */
    const rowsOf = (db, sql) => { const r = db.exec(sql); return r.length ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; };
    const listTables = db => rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);
    const getVersion = db => Number(rowsOf(db, 'PRAGMA user_version')[0].user_version) || 0;
    const colDDL = (c, ty) => `${c} ${ty}` + (NULLABLE.has(c) ? '' : ` NOT NULL DEFAULT ${ty === 'TEXT' ? `'${DEFAULTS[c] ?? ''}'` : 0}`);
    function createSchema(db) {
        for (const [t, cols] of Object.entries(SCHEMA)) db.run(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${Object.entries(cols).map(([c, ty]) => colDDL(c, ty)).join(', ')})`);
        db.run(SETTINGS_DDL);
        INDEXES.forEach(s => db.run(s));
    }
    const INS = t => `INSERT INTO ${t} (id, ${Object.keys(SCHEMA[t]).join(', ')}) VALUES (${['?'].concat(Object.keys(SCHEMA[t]).map(() => '?')).join(', ')})`;
    const UPSERT = t => INS(t).replace(/^INSERT/, 'INSERT OR REPLACE');
    // Turns an in-memory row into safe DB values (never throws, so a half-edited row can always be saved)
    function dbValues(table, r) {
        const vals = [toInt(r.id)];
        for (const [c, ty] of Object.entries(SCHEMA[table])) {
            let v = r[c];
            if (ty === 'REAL') v = Math.max(0, toMoney(v));
            else if (ty === 'INTEGER') {
                v = (c === 'done' || c === 'archived') ? (Number(v) ? 1 : 0) : toInt(v);
                if (c === 'dueDay' && !(v >= 1 && v <= 31)) v = null;
                if (c === 'dueMonth' && !(v >= 1 && v <= 12)) v = null;
                if (c === 'commitmentId' && !(v > 0)) v = null;
            } else {
                v = (v === null || v === undefined) ? '' : String(v);
                if (c === 'pausedMonth' && !isMonthKey(v)) v = '';
                if (ENUMS[c] && !ENUMS[c].includes(v)) v = DEFAULTS[c];
                if (NULLABLE.has(c) && v === '') v = null;
                else if (v === '' && DEFAULTS[c] && c !== 'category') v = DEFAULTS[c];
            }
            vals.push(v);
        }
        return vals;
    }
    function inTx(db, fn) { db.run('BEGIN'); try { const r = fn(); db.run('COMMIT'); return r; } catch (e) { try { db.run('ROLLBACK'); } catch (_) { } throw e; } }

    // Opens a tracker database. Empty -> fresh v5. v5 -> checked. v4 -> checked, then upgraded in place (two columns + settings
    // table, nothing is rewritten or removed). Older / newer / damaged files are rejected and NOT changed.
    function ensureSchema(db) {
        const ver = getVersion(db), tables = listTables(db), fail = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
        if (ver > SCHEMA_VERSION) throw fail('NEWER_SCHEMA', `This database was created by a newer app version (schema ${ver}).`);
        const check = v => {
            for (const [t, cols] of Object.entries(SCHEMA)) {
                if (!tables.includes(t)) throw fail('BAD_SCHEMA', `This v${v} database is missing the "${t}" table.`);
                const have = rowsOf(db, `PRAGMA table_info(${t})`).map(r => r.name);
                const miss = Object.keys(cols).filter(c => !have.includes(c) && (v >= 5 || !(V5_ADDED[t] || []).includes(c)));
                if (miss.length) throw fail('BAD_SCHEMA', `Table "${t}" is missing column(s): ${miss.join(', ')}.`);
            }
        };
        if (ver === SCHEMA_VERSION) {
            check(SCHEMA_VERSION);
            createSchema(db);                                    // only adds the settings table / indexes if they are missing
            return { fresh: false };
        }
        if (ver === 4) {
            check(4);
            inTx(db, () => {
                for (const [t, cols] of Object.entries(V5_ADDED)) {
                    const have = rowsOf(db, `PRAGMA table_info(${t})`).map(r => r.name);
                    cols.filter(c => !have.includes(c)).forEach(c => db.run(`ALTER TABLE ${t} ADD COLUMN ${colDDL(c, SCHEMA[t][c])}`));
                }
                createSchema(db);
                db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
            });
            return { fresh: false, upgradedFrom: 4 };
        }
        if (!tables.length) { inTx(db, () => { createSchema(db); db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`); }); return { fresh: true }; }
        throw fail('OLD_SCHEMA', `This database is from an older version (schema ${ver}). Older files are no longer converted - open it once in the v4.0 build, export it, and import that file here.`);
    }

    /* ------------------------------------------------------------------ settings (stored in the database, validated on read and write) */
    const fileName = v => typeof v === 'string' && v.length <= 255 && !/[\u0000-\u001f\u007f]/.test(v);
    const SETTINGS = {
        autoSave: { def: '0', ok: v => v === '0' || v === '1' },                       // off by default
        theme: { def: 'system', ok: v => ['system', 'light', 'dark'].includes(v) },     // system = follow prefers-color-scheme
        dbName: { def: '', ok: fileName },                                              // file this data was last imported from
        lastExport: { def: '', ok: fileName },                                          // file name of the last Export DB
        exportPending: { def: '0', ok: v => v === '0' || v === '1' }                    // 1 = data changed since the last export / import
    };
    function readSettings(db) {
        const out = Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.def]));
        try { rowsOf(db, 'SELECT key, value FROM settings').forEach(r => { const s = SETTINGS[r.key], v = String(r.value); if (s && s.ok(v)) out[r.key] = v; }); } catch (e) { /* no settings table yet -> defaults */ }
        return out;
    }
    function writeSetting(db, key, value) {
        const s = SETTINGS[key], v = String(value);
        if (!s || !s.ok(v)) throw new Error(`Invalid setting ${key}=${v}`);
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, v]);
    }

    /* ------------------------------------------------------------------ validation (returns {field: message}) */
    const money = v => !(v === '' || v === null || v === undefined) && Number.isFinite(Number(v));
    function validateCommitment(o) {
        const e = {};
        if (!String(o.name || '').trim()) e.name = 'Name is required'; else if (String(o.name).length > 100) e.name = 'Name is too long (max 100)';
        if (!money(o.amount) || Number(o.amount) <= 0) e.amount = 'Amount must be a number above 0'; else if (Number(o.amount) > 1e12) e.amount = 'Amount is too large';
        if (!ENUMS.frequency.includes(o.frequency)) e.frequency = 'Choose a frequency';
        if (!validISO(o.startDate)) e.startDate = 'Select a valid start date';
        const hasEnd = !(o.endDate === '' || o.endDate === null || o.endDate === undefined);
        if (hasEnd && !validISO(o.endDate)) e.endDate = 'Select a valid end date';
        else if (hasEnd && validISO(o.startDate) && o.endDate < o.startDate) e.endDate = 'End date must be on/after the start date';
        const day = toInt(o.dueDay), mon = toInt(o.dueMonth);
        if (o.frequency === 'One-Time') { if (!hasEnd) e.endDate = e.endDate || 'Due date is required'; }
        else {
            if (day === null || day < 1 || day > 31) e.dueDay = 'Select a due day (1-31)';
            if (o.frequency !== 'Monthly') {
                if (mon === null || mon < 1 || mon > 12) e.dueMonth = 'Select a month';
                else if (day !== null && day > daysInMonth(2024, mon)) e.dueDay = 'This month has fewer days';
            }
        }
        if (!e.endDate && !e.startDate && !e.dueDay && !e.dueMonth && o.frequency !== 'One-Time' && validISO(o.startDate) && hasEnd && !occurrencesOf(o, o.startDate, o.endDate).length) e.endDate = 'No due date falls between start and end';
        return e;
    }
    function validateLog(o, commitments = []) {
        const e = {};
        if (!validISO(o.actualDate)) e.actualDate = 'Select a valid actual date';
        const hasCd = !(o.commitmentDate === '' || o.commitmentDate === null || o.commitmentDate === undefined);
        if (hasCd && !validISO(o.commitmentDate)) e.commitmentDate = 'Select a valid commitment date';
        const cid = toInt(o.commitmentId);
        if (cid) {
            const c = commitments.find(x => Number(x.id) === cid);
            if (!c) e.commitmentId = 'Linked commitment no longer exists';
            else if (!hasCd) e.commitmentDate = 'Commitment date is required when linked';
            else if (!e.commitmentDate && !occurrencesOf(c, o.commitmentDate, o.commitmentDate).length) e.commitmentDate = 'Not a due date of the linked commitment';
        } else if (hasCd && !e.commitmentDate) { /* planned date without a link is allowed */ }
        if (!String(o.item || '').trim()) e.item = 'Description is required';
        if (!money(o.amount) || Number(o.amount) <= 0) e.amount = 'Amount must be a number above 0';
        return e;
    }
    function validateEvent(o) {
        const e = {};
        if (!String(o.title || '').trim()) e.title = 'Title is required';
        if (!ENUMS.kind.includes(o.kind)) e.kind = 'Choose Event or Task';
        if (!validISO(o.eventDate)) e.eventDate = 'Select a valid date';
        if (!ENUMS.repeat.includes(o.repeat)) e.repeat = 'Invalid repeat';
        if (o.budget !== '' && o.budget != null && (!Number.isFinite(Number(o.budget)) || Number(o.budget) < 0)) e.budget = 'Budget must be 0 or more';
        return e;
    }

    root.Core = {
        SCHEMA_VERSION, SCHEMA, ENUMS, DEFAULTS, MONTH_NAMES, SORT_COLS, SETTINGS, BREAKDOWN_MODES,
        toInt, toMoney, addTo, pad2, isLeap, daysInMonth, iso, isISO, isMonthKey, ymd, validISO, todayISO, monthKey, monthStart, monthEnd, clampDay, addMonths, addDays, daysBetween, fmtDate,
        occurrencesOf, occKey, buildPaidIndex, pauseActive, isArchived, statusOf, payTarget, makeWindow, previousWindow, shiftSelection, sanitizeSelection, analyze, trend, breakdownMode, moneyBreakdown, nextEventDate, eventState,
        buildLogQuery, queryAll, rowsOf, listTables, getVersion, createSchema, INS, UPSERT, dbValues, inTx, ensureSchema, readSettings, writeSetting,
        validateCommitment, validateLog, validateEvent
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
