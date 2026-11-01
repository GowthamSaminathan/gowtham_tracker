/* core.js - pure logic (no DOM). Works in the browser (window.Core) and in Node (require) so it can be unit-tested.
 *  - date helpers (local calendar dates as ISO "YYYY-MM-DD" strings, never timezone math)
 *  - occurrence generation + derived status for payment commitments (based on startDate / endDate)
 *  - dashboard time windows + analytics
 *  - SQL builder for the Expense Log (filter / multi-column sort / pagination)
 *  - schema v4 + safe migration from every older version
 *  - validation
 */
(function (root) {
    'use strict';
    const SCHEMA_VERSION = 4;

    /* ------------------------------------------------------------------ schema */
    const SCHEMA = {
        commitments:  { name: 'TEXT', region: 'TEXT', category: 'TEXT', amount: 'REAL', currency: 'TEXT', frequency: 'TEXT', dueDay: 'INTEGER', dueMonth: 'INTEGER', startDate: 'TEXT', endDate: 'TEXT', method: 'TEXT', notes: 'TEXT' },
        expense_logs: { actualDate: 'TEXT', commitmentDate: 'TEXT', commitmentId: 'INTEGER', region: 'TEXT', category: 'TEXT', item: 'TEXT', amount: 'REAL', currency: 'TEXT', method: 'TEXT', notes: 'TEXT' },
        events:       { title: 'TEXT', kind: 'TEXT', eventDate: 'TEXT', repeat: 'TEXT', budget: 'REAL', currency: 'TEXT', done: 'INTEGER', notes: 'TEXT' }
    };
    const NULLABLE = new Set(['dueDay', 'dueMonth', 'endDate', 'commitmentDate', 'commitmentId']);
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
    const parseDayMon = s => {       // legacy text such as "15-Nov"
        const m = /^(\d{1,2})[-\/ ]([A-Za-z]{3})/.exec(String(s || '').trim());
        if (!m) return null;
        const mi = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[2].toLowerCase()), d = +m[1];
        return (mi < 0 || d < 1 || d > 31) ? null : { d, m: mi + 1 };
    };

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

    /* Derived status - never stored.
     *  Upcoming  : today < startDate
     *  Overdue   : at least one due date before today (inside start..end) has no linked payment
     *  Completed : has an endDate and EVERY due date in start..end is paid (or the range has no due dates and has ended)
     *  Paid      : nothing overdue and this month's due date(s) are all paid (cycle settled)
     *  Pending   : everything else (active, something still to pay now or later)                                      */
    function statusOf(c, paid, today) {
        const base = { status: 'Pending', missed: [], next: '', paidCount: 0, total: 0, invalid: false };
        if (!validISO(c.startDate) || (c.endDate && (!validISO(c.endDate) || c.endDate < c.startDate))) return { ...base, invalid: true };
        const finite = validISO(c.endDate);
        const horizon = finite ? c.endDate : addDays(today, 400);
        const occ = occurrencesOf(c, c.startDate, horizon);
        const isPaid = d => paid.has(occKey(c.id, d));
        const missed = occ.filter(d => d < today && !isPaid(d));
        const nextUnpaid = occ.find(d => d >= today && !isPaid(d)) || '';
        const thisMonth = occ.filter(d => monthKey(d) === monthKey(today));
        const r = { ...base, missed, next: missed[0] || nextUnpaid, paidCount: occ.filter(isPaid).length, total: finite ? occ.length : 0 };
        if (today < c.startDate) return { ...r, status: 'Upcoming', next: occ[0] || '' };
        if (missed.length) return { ...r, status: 'Overdue' };
        if (finite && ((occ.length && occ.every(isPaid)) || (!occ.length && c.endDate < today))) return { ...r, status: 'Completed' };
        if (thisMonth.length && thisMonth.every(isPaid)) return { ...r, status: 'Paid' };
        return r;
    }
    // Which due date should "Mark paid" settle? oldest missed one, else this month's, else the next upcoming one.
    function payTarget(c, paid, today) {
        const s = statusOf(c, paid, today);
        if (s.invalid) return '';
        return s.missed[0] || s.next || '';
    }

    /* ------------------------------------------------------------------ dashboard windows */
    function makeWindow(sel, today) {
        const [ty, tm] = ymd(today), months = [];
        const push = (y, m) => months.push({ key: `${y}-${pad2(m)}`, y, m, label: `${MONTH_NAMES[m - 1]} ${y}`, start: monthStart(y, m), end: monthEnd(y, m) });
        let label = '', error = '';
        const mode = sel.mode || 'this';
        if (mode === 'this' || mode === 'next' || mode === 'last') {
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

    /* ------------------------------------------------------------------ analytics */
    function analyze(commitments, logs, win, today) {
        const paid = buildPaidIndex(logs), occ = [];
        commitments.forEach(c => occurrencesOf(c, win.start, win.end).forEach(date => {
            const log = paid.get(occKey(c.id, date)) || null;
            occ.push({ c, id: c.id, date, paid: !!log, log, overdue: !log && date < today, currency: c.currency || 'AED', amount: toMoney(c.amount), month: monthKey(date) });
        }));
        occ.sort((a, b) => a.date.localeCompare(b.date) || String(a.c.name).localeCompare(String(b.c.name)));
        const required = {}, paidBy = {}, outstanding = {}, overdue = {}, actual = {}, category = {};
        occ.forEach(o => { addTo(required, o.currency, o.amount); if (o.paid) addTo(paidBy, o.currency, o.amount); else addTo(outstanding, o.currency, o.amount); if (o.overdue) addTo(overdue, o.currency, o.amount); });
        const inWin = logs.filter(l => validISO(l.actualDate) && l.actualDate >= win.start && l.actualDate <= win.end);
        inWin.forEach(l => { addTo(actual, l.currency || 'AED', toMoney(l.amount)); const k = l.category || 'Uncategorized'; (category[k] = category[k] || {}); addTo(category[k], l.currency || 'AED', toMoney(l.amount)); });
        const perMonth = win.months.map(m => {
            const r = {}, a = {};
            occ.filter(o => o.month === m.key).forEach(o => addTo(r, o.currency, o.amount));
            inWin.filter(l => monthKey(l.actualDate) === m.key).forEach(l => addTo(a, l.currency || 'AED', toMoney(l.amount)));
            return { key: m.key, label: m.label, required: r, actual: a };
        });
        return { occ, required, paid: paidBy, outstanding, overdue, actual, category, perMonth, logCount: inWin.length, paidCount: occ.filter(o => o.paid).length, overdueCount: occ.filter(o => o.overdue).length };
    }
    // Spend of one currency: window vs the equally long previous window (daily cumulative for one month, monthly for longer windows)
    function trend(logs, win, prev, cur, today) {
        const sum = (w, pred) => logs.filter(l => (l.currency || 'AED') === cur && validISO(l.actualDate) && l.actualDate >= w.start && l.actualDate <= w.end && pred(l)).reduce((s, l) => s + toMoney(l.amount), 0);
        let labels = [], a = [], b = [];
        if (win.months.length === 1) {
            const m = win.months[0], pm = prev.months[0], n = Math.max(daysInMonth(m.y, m.m), daysInMonth(pm.y, pm.m));
            let ca = 0, cb = 0;
            for (let d = 1; d <= n; d++) {
                labels.push(String(d));
                const da = iso(m.y, m.m, Math.min(d, daysInMonth(m.y, m.m))), db = iso(pm.y, pm.m, Math.min(d, daysInMonth(pm.y, pm.m)));
                if (d <= daysInMonth(m.y, m.m)) ca += logs.filter(l => (l.currency || 'AED') === cur && l.actualDate === da).reduce((s, l) => s + toMoney(l.amount), 0);
                if (d <= daysInMonth(pm.y, pm.m)) cb += logs.filter(l => (l.currency || 'AED') === cur && l.actualDate === db).reduce((s, l) => s + toMoney(l.amount), 0);
                a.push(da > today ? null : Math.round(ca * 100) / 100);       // do not draw the future of the running month
                b.push(d <= daysInMonth(pm.y, pm.m) ? Math.round(cb * 100) / 100 : null);
            }
        } else {
            win.months.forEach((m, i) => {
                labels.push(m.label + (prev.months[i] ? '' : ''));
                a.push(Math.round(sum({ start: m.start, end: m.end }, () => true) * 100) / 100);
                b.push(prev.months[i] ? Math.round(sum({ start: prev.months[i].start, end: prev.months[i].end }, () => true) * 100) / 100 : null);
            });
        }
        const curTotal = sum(win, () => true), prevTotal = sum(prev, () => true);
        return { labels, current: a, previous: b, curTotal, prevTotal, delta: curTotal - prevTotal, pct: prevTotal ? ((curTotal - prevTotal) / prevTotal) * 100 : null };
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

    /* ------------------------------------------------------------------ DB: schema + migration */
    const rowsOf = (db, sql) => { const r = db.exec(sql); return r.length ? r[0].values.map(v => Object.fromEntries(r[0].columns.map((c, i) => [c, v[i]]))) : []; };
    const listTables = db => rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);
    const getVersion = db => Number(rowsOf(db, 'PRAGMA user_version')[0].user_version) || 0;
    const colDDL = (c, ty) => `${c} ${ty}` + (NULLABLE.has(c) ? '' : ` NOT NULL DEFAULT ${ty === 'TEXT' ? `'${DEFAULTS[c] ?? ''}'` : 0}`);
    function createSchema(db) {
        for (const [t, cols] of Object.entries(SCHEMA)) db.run(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${Object.entries(cols).map(([c, ty]) => colDDL(c, ty)).join(', ')})`);
        INDEXES.forEach(s => db.run(s));
    }
    const INS = t => `INSERT INTO ${t} (id, ${Object.keys(SCHEMA[t]).join(', ')}) VALUES (${['?'].concat(Object.keys(SCHEMA[t]).map(() => '?')).join(', ')})`;
    // Turns an in-memory row into safe DB values (never throws, so a half-edited row can always be saved)
    function dbValues(table, r) {
        const vals = [toInt(r.id)];
        for (const [c, ty] of Object.entries(SCHEMA[table])) {
            let v = r[c];
            if (ty === 'REAL') v = Math.max(0, toMoney(v));
            else if (ty === 'INTEGER') {
                v = c === 'done' ? (v ? 1 : 0) : toInt(v);
                if (c === 'dueDay' && !(v >= 1 && v <= 31)) v = null;
                if (c === 'dueMonth' && !(v >= 1 && v <= 12)) v = null;
                if (c === 'commitmentId' && !(v > 0)) v = null;
            } else {
                v = (v === null || v === undefined) ? '' : String(v);
                if (ENUMS[c] && !ENUMS[c].includes(v)) v = DEFAULTS[c];
                if (NULLABLE.has(c) && v === '') v = null;
                else if (v === '' && DEFAULTS[c] && c !== 'category') v = DEFAULTS[c];
            }
            vals.push(v);
        }
        return vals;
    }
    function inTx(db, fn) { db.run('BEGIN'); try { const r = fn(); db.run('COMMIT'); return r; } catch (e) { try { db.run('ROLLBACK'); } catch (_) { } throw e; } }

    const norm = s => String(s || '').trim().toLowerCase();
    /* Migration v1..v3 -> v4. Reads the old rows into memory, validates the mapping, then (single transaction)
       drops the old tables, creates the v4 schema, inserts, verifies row counts and stamps user_version = 4.
       Any error rolls everything back, leaving the original database untouched. */
    function migrateToV4(db, today) {
        const tables = listTables(db), fromVersion = getVersion(db), [ty, tm] = ymd(today);
        if (tables.includes('events')) throw new Error('Unexpected table "events" in an older database.');
        const read = t => tables.includes(t) ? rowsOf(db, `SELECT * FROM ${t} ORDER BY rowid`) : [];
        const oldC = read('commitments'), oldL = read('expense_logs'), oldE = read('events_list');
        let nextId = oldC.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
        [['uae_payments', 'UAE', 'AED'], ['india_payments', 'India', 'INR']].forEach(([t, region, currency]) => read(t).forEach(r => oldC.push({ ...r, id: ++nextId, region, currency, status: 'Pending' })));
        const rep = { fromVersion, toVersion: SCHEMA_VERSION, counts: { commitments: oldC.length, expenseLogs: oldL.length, events: oldE.length }, linkedPayments: 0, paidWithoutLog: 0, notes: [] };
        const curKey = monthKey(today);

        const logs = oldL.map(r => ({
            id: toInt(r.id), actualDate: validISO(r.actualDate) ? r.actualDate : String(r.date ?? r.actualDate ?? ''), commitmentDate: '', commitmentId: null,
            region: r.region || 'UAE', category: r.category || '', item: r.item || '', amount: toMoney(r.amount), currency: r.currency || 'AED', method: r.method || '', notes: r.notes || ''
        }));
        const claimed = new Set();
        const commitments = oldC.map(r => {
            const frequency = ENUMS.frequency.includes(r.frequency) ? r.frequency : 'Monthly';
            let dueDay = toInt(r.dueDay), dueMonth = toInt(r.dueMonth);
            const legacyDate = String(r.dueDate ?? ''), wasPaid = r.status === 'Paid';
            const pm = /^\d{4}-\d{2}$/.test(r.paidMonth || '') ? r.paidMonth : curKey;
            let startDate, endDate = null;
            if (frequency === 'One-Time') {
                const d = validISO(legacyDate) ? legacyDate : today; startDate = d; endDate = d; dueDay = null; dueMonth = null;
            } else {
                if (frequency !== 'Monthly' && !dueMonth) { const p = parseDayMon(legacyDate); if (p) { dueMonth = p.m; dueDay = dueDay || p.d; } }
                if (frequency === 'Monthly') dueMonth = null;
                const basis = wasPaid && pm < curKey ? pm : curKey;        // so a payment made in an earlier cycle still maps to a due date
                startDate = basis + '-01';
            }
            const c = { id: toInt(r.id), name: r.name || '', region: r.region || 'UAE', category: r.category || '', amount: toMoney(r.amount), currency: r.currency || 'AED', frequency, dueDay, dueMonth, startDate, endDate, method: r.method || '', notes: r.notes || '' };
            if (wasPaid) {          // old "Paid" flag -> link the matching expense-log row to the due date it settled
                const [py, pmn] = ymd(pm + '-01');
                let due;
                if (frequency === 'One-Time') due = endDate;
                else {      // the due date in the paid month; if none (e.g. paid early), the first one within the following cycle
                    const [ey, em] = addMonths(py, pmn, { 'Monthly': 0, 'Bi-Monthly': 2, 'Yearly': 12 }[frequency]);
                    due = occurrencesOf(c, monthStart(py, pmn), monthEnd(py, pmn))[0] || occurrencesOf(c, monthStart(py, pmn), monthEnd(ey, em))[0];
                }
                const cand = logs.filter(l => !claimed.has(l.id) && l.commitmentId === null && norm(l.item) === norm(c.name) && (frequency === 'One-Time' || l.actualDate.startsWith(pm)));
                const hit = cand.find(l => l.amount === c.amount) || cand[0];
                if (due && hit) { hit.commitmentId = c.id; hit.commitmentDate = due; claimed.add(hit.id); rep.linkedPayments++; }
                else { rep.paidWithoutLog++; rep.notes.push(`"${c.name}" was marked Paid but no matching expense row was found - it shows as unpaid; mark it paid again if needed.`); }
            }
            return c;
        });
        const events = oldE.map(r => {
            let m = toInt(r.eventMonth), d = toInt(r.eventDay);
            if (!m || !d) { const p = parseDayMon(r.date); if (p) { m = p.m; d = p.d; } }
            const has = m >= 1 && m <= 12 && d >= 1 && d <= 31;
            return { id: toInt(r.id), title: r.name || r.title || '', kind: 'Event', eventDate: has ? iso(ty, m, clampDay(ty, m, d)) : '', repeat: has ? 'Yearly' : 'None', budget: toMoney(r.budget), currency: r.currency || 'AED', done: 0, notes: [r.relation ? `Relation: ${r.relation}` : '', r.notes || ''].filter(Boolean).join(' · ') };
        });
        inTx(db, () => {
            ['commitments', 'expense_logs', 'events_list', 'uae_payments', 'india_payments'].forEach(t => db.run(`DROP TABLE IF EXISTS ${t}`));
            createSchema(db);
            commitments.forEach(r => db.run(INS('commitments'), dbValues('commitments', r)));
            logs.forEach(r => db.run(INS('expense_logs'), dbValues('expense_logs', r)));
            events.forEach(r => db.run(INS('events'), dbValues('events', r)));
            const n = t => rowsOf(db, `SELECT COUNT(*) AS n FROM ${t}`)[0].n;
            if (n('commitments') !== oldC.length || n('expense_logs') !== oldL.length || n('events') !== oldE.length) throw new Error('Migration verification failed: row counts differ.');
            db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        });
        rep.migrated = true;
        return rep;
    }
    function ensureLatest(db, today) {
        const ver = getVersion(db), tables = listTables(db);
        if (ver > SCHEMA_VERSION) throw new Error(`This database was created by a newer app version (schema ${ver}).`);
        const known = ['commitments', 'expense_logs', 'events_list', 'events', 'uae_payments', 'india_payments'];
        if (ver === SCHEMA_VERSION) { createSchema(db); return { migrated: false, fromVersion: ver, toVersion: ver }; }
        if (!tables.some(t => known.includes(t))) { inTx(db, () => { createSchema(db); db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`); }); return { migrated: false, fresh: true, fromVersion: ver, toVersion: SCHEMA_VERSION }; }
        return migrateToV4(db, today);
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
        SCHEMA_VERSION, SCHEMA, ENUMS, DEFAULTS, MONTH_NAMES, SORT_COLS,
        toInt, toMoney, addTo, pad2, isLeap, daysInMonth, iso, isISO, ymd, validISO, todayISO, monthKey, monthStart, monthEnd, clampDay, addMonths, addDays, daysBetween, fmtDate, parseDayMon,
        occurrencesOf, occKey, buildPaidIndex, statusOf, payTarget, makeWindow, previousWindow, analyze, trend, nextEventDate, eventState,
        buildLogQuery, queryAll, rowsOf, listTables, getVersion, createSchema, INS, dbValues, inTx, migrateToV4, ensureLatest,
        validateCommitment, validateLog, validateEvent
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.Core;
})(typeof window !== 'undefined' ? window : globalThis);
