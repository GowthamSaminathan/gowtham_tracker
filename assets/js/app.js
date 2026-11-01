/* app.js - Alpine component. All date/status/SQL/migration logic lives in core.js (window.Core). */
(function () {
    'use strict';
    const C = window.Core;
    const LS_KEY = 'sqlite_db_b64', LS_LEGACY = 'sqlite_db_binary', LS_BACKUP = 'sqlite_db_pre_v4_backup', LS_CORRUPT = 'sqlite_db_corrupt_backup';
    let db = null, SQLMod = null;
    const MEMO = {}, CH = {};                       // memo cache + Chart.js instances (kept OUT of Alpine's reactive proxies)

    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
        del(k) { try { localStorage.removeItem(k); } catch (e) { } }
    };
    const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
    const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
    const fmtNum = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtMoney = (v, c) => (c ? c + ' ' : '') + fmtNum(v);
    const clean = r => { for (const k in r) if (r[k] === null) r[k] = ''; return r; };
    const download = (blob, name) => {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    };
    async function getSQL() {
        if (SQLMod) return SQLMod;
        if (typeof window.initSqlJs !== 'function') throw new Error('SQL engine files not found. Keep the "assets" folder next to index.html.');
        const cfg = window.SQL_WASM_BASE64 ? { wasmBinary: fromB64(window.SQL_WASM_BASE64).buffer } : { locateFile: f => 'assets/js/' + f };
        try { SQLMod = await window.initSqlJs(cfg); } catch (e) { throw new Error('Could not start the SQL engine (' + (e.message || e) + ').'); }
        window.SQL_WASM_BASE64 = null;
        return SQLMod;
    }

    window.trackerApp = function () {
        const t0 = C.todayISO(), [y0, m0] = C.ymd(t0);
        return {
            tab: 'dashboard', monthNames: C.MONTH_NAMES, frequencies: C.ENUMS.frequency, regions: ['UAE', 'India', 'Global'],
            currencies: ['AED', 'INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SAR', 'QAR'],
            categories: ['Utilities', 'EMI / Loan', 'Savings', 'Subscriptions', 'Insurance', 'Rent', 'Groceries', 'Travel', 'Health', 'Other'],
            methods: ['Cash', 'Card', 'Credit card', 'Bank Transfer', 'Auto-debit', 'UPI'],
            commitments: [], expenseLogs: [], events: [], rev: 0, clock: Date.now(),
            selectedRowIds: [], cView: [], eView: [], lView: { ids: [], total: 0, totals: [] }, flashId: null,
            f: { search: '', region: 'All', frequency: 'All', currency: 'All', status: 'All', sortBy: 'due' },
            lf: { q: '', actualFrom: '', actualTo: '', commitFrom: '', commitTo: '', category: 'All', region: 'All', currency: 'All', method: 'All', link: 'any', minAmt: '', maxAmt: '' },
            ls: [{ col: 'actualDate', dir: 'desc' }, { col: 'amount', dir: 'desc' }, { col: '', dir: 'asc' }],
            sortCols: [['actualDate', 'Actual date'], ['commitmentDate', 'Commitment date'], ['item', 'Description'], ['category', 'Category'], ['region', 'Region'], ['amount', 'Amount'], ['currency', 'Currency'], ['method', 'Method'], ['linked', 'Linked']],
            lPage: 0, lPageSize: 25, lStale: false,
            ef: { kind: 'All', showDone: true },
            dash: { mode: 'this', fromM: m0, fromY: y0, toM: m0, toY: y0, year: y0 }, dashCur: '',
            modal: { show: false, kind: 'c', isNew: false, item: null, orig: null },
            toast: { show: false, message: '', type: 'success' }, migration: null,
            loading: true, loadError: '', saveState: 'saved', isDesktop: true,
            _saveTimer: null, _toastTimer: null, _logTimer: null,
            money: fmtMoney, fmtDate: C.fmtDate,

            /* ============================== boot ============================== */
            async initDB() {
                if (window.matchMedia) { const mq = window.matchMedia('(min-width: 1024px)'); this.isDesktop = mq.matches; mq.addEventListener('change', e => { this.isDesktop = e.matches; }); }
                document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.clock = Date.now(); this.rev++; } });
                window.addEventListener('beforeunload', () => { if (this.saveState === 'dirty' && db) this.persist({ toast: false }); });
                this.$watch('f', () => this.refreshView());
                this.$watch('ef', () => this.refreshEvents());
                const rerun = () => { this.lPage = 0; clearTimeout(this._logTimer); this._logTimer = setTimeout(() => this.runLogQuery(), 250); };
                this.$watch('lf', rerun); this.$watch('ls', rerun);
                this.$watch('lPageSize', rerun);
                this.$watch('lPage', () => { clearTimeout(this._logTimer); this._logTimer = setTimeout(() => this.runLogQuery(), 30); });
                this.$watch('chartKey', () => this.$nextTick(() => this.drawCharts()));
                try {
                    const SQL = await getSQL();
                    const b64 = store.get(LS_KEY), legacy = store.get(LS_LEGACY), raw = b64 || legacy;
                    let opened = false;
                    if (raw) {
                        try {
                            db = new SQL.Database(b64 ? fromB64(b64) : new Uint8Array(JSON.parse(legacy)));
                            this.upgradeCurrentDb();
                            opened = true;
                        } catch (e) {
                            console.error('Saved database unreadable:', e);
                            store.set(LS_CORRUPT, raw);
                            this.showToast('Saved data was unreadable. A backup copy was kept and a fresh database was started.', 'error');
                            db = null;
                        }
                    }
                    if (!opened) { db = new SQL.Database(); C.ensureLatest(db, C.todayISO()); }   // first run: completely empty
                    this.loadDataFromDB();
                    const saved = this.persist({ toast: false });
                    if (saved && !b64 && legacy) store.del(LS_LEGACY);
                    this.runLogQuery();
                } catch (e) { console.error(e); this.loadError = e.message || 'Failed to start the database.'; }
                finally { this.loading = false; }
            },
            // Upgrades the open database to the newest schema. A copy of the original is kept in localStorage first.
            upgradeCurrentDb() {
                let pre = null;
                try { if (C.getVersion(db) < C.SCHEMA_VERSION && C.listTables(db).length) pre = toB64(db.export()); } catch (e) { }
                const rep = C.ensureLatest(db, C.todayISO());
                if (rep.migrated) {
                    const kept = pre ? store.set(LS_BACKUP, pre) : false;
                    this.migration = { ...rep, backupKept: kept };
                }
                return rep;
            },
            downloadPreUpgradeBackup() {
                const b = store.get(LS_BACKUP);
                if (!b) { this.showToast('No pre-upgrade backup is stored in this browser.', 'info'); return; }
                download(new Blob([fromB64(b)], { type: 'application/x-sqlite3' }), 'tracker_before_upgrade_' + C.todayISO() + '.db');
            },
            loadDataFromDB() {
                const R = t => C.rowsOf(db, `SELECT * FROM ${t} ORDER BY id`).map(clean);
                this.commitments = R('commitments').map(r => ({ ...r, amount: C.toMoney(r.amount), dueDay: C.toInt(r.dueDay) ?? '', dueMonth: C.toInt(r.dueMonth) ?? '' }));
                this.expenseLogs = R('expense_logs').map(r => ({ ...r, amount: C.toMoney(r.amount), commitmentId: C.toInt(r.commitmentId) ?? '' }));
                this.events = R('events').map(r => ({ ...r, budget: C.toMoney(r.budget), done: r.done ? 1 : 0 }));
                this.selectedRowIds = [];
                this.rev++;
                this.refreshView(); this.refreshEvents();
            },

            /* ============================== persistence ============================== */
            persist(opts = {}) {
                const { toast = true } = opts;
                clearTimeout(this._saveTimer);
                if (!db) return false;
                try {
                    C.inTx(db, () => {
                        ['commitments', 'expense_logs', 'events'].forEach(t => db.run(`DELETE FROM ${t}`));
                        this.commitments.filter(r => !r._draft).forEach(r => db.run(C.INS('commitments'), C.dbValues('commitments', r)));
                        this.expenseLogs.filter(r => !r._draft).forEach(r => db.run(C.INS('expense_logs'), C.dbValues('expense_logs', r)));
                        this.events.filter(r => !r._draft).forEach(r => db.run(C.INS('events'), C.dbValues('events', r)));
                    });
                    if (!store.set(LS_KEY, toB64(db.export()))) { this.saveState = 'error'; this.showToast('Browser storage is full or blocked. Use "Export DB" to keep a backup.', 'error'); return false; }
                    this.saveState = 'saved';
                    if (toast) this.showToast('Database saved!');
                    return true;
                } catch (e) { console.error(e); this.saveState = 'error'; this.showToast('Save failed: ' + e.message, 'error'); return false; }
            },
            touch() { this.saveState = 'dirty'; clearTimeout(this._saveTimer); this._saveTimer = setTimeout(() => this.persist({ toast: false }), 800); },
            flush() { if (this.saveState === 'dirty') this.persist({ toast: false }); },
            // Typing in a row never re-sorts anything: it only autosaves and refreshes derived numbers.
            onEdit(e) {
                if (e.target.closest && e.target.closest('[data-nosave]')) return;
                this.rev++; this.touch(); if (this.tab === 'log') this.lStale = true;
            },
            get saveLabel() { return { saved: 'All changes saved', dirty: 'Unsaved changes…', error: 'Save failed – export a backup' }[this.saveState]; },
            // Manual "Save DB": validates drafts, saves, then (explicitly requested) applies sort/filter again.
            saveAll() {
                let bad = 0;
                [['c', this.commitments], ['l', this.expenseLogs], ['e', this.events]].forEach(([k, arr]) => arr.forEach(o => { if (!o._draft) return; if (this.errList(k, o).length) bad++; else delete o._draft; }));
                this.rev++;
                if (!this.persist({ toast: false })) return;
                this.refreshView(); this.refreshEvents(); this.runLogQuery();
                this.showToast(bad ? `Saved. ${bad} draft row(s) are incomplete and were not saved yet.` : 'Database saved!', bad ? 'info' : 'success');
            },
            showToast(message, type = 'success') {
                this.toast = { show: true, message, type };
                clearTimeout(this._toastTimer);
                this._toastTimer = setTimeout(() => { this.toast.show = false; }, type === 'error' ? 6000 : 3200);
            },

            /* ============================== memo / time ============================== */
            memo(key, sig, fn) {
                this.rev; this.clock;                                     // reactive dependencies: any edit / new day invalidates
                const m = MEMO[key];
                if (m && m.rev === this.rev && m.clock === this.clock && m.sig === sig) return m.v;
                const v = fn(); MEMO[key] = { rev: this.rev, clock: this.clock, sig, v }; return v;
            },
            get today() { this.clock; return C.todayISO(); },
            newId(list) { return list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1; },

            /* ============================== validation helpers ============================== */
            errs(k, o) { return k === 'c' ? C.validateCommitment(o) : k === 'l' ? C.validateLog(o, this.commitments) : C.validateEvent(o); },
            errList(k, o) { return Object.values(this.errs(k, o)); },
            bad(k, o, f) { return this.errs(k, o)[f] ? '!border-red-500 ring-1 ring-red-500' : ''; },
            dayList(m) { const n = C.toInt(m) ? C.daysInMonth(2024, C.toInt(m)) : 31; return Array.from({ length: n }, (_, i) => i + 1); },
            fixDay(o) { const m = C.toInt(o.dueMonth), d = C.toInt(o.dueDay); if (m && d && d > C.daysInMonth(2024, m)) o.dueDay = C.daysInMonth(2024, m); },
            onFreqChange(o) {
                const [, sm, sd] = C.validISO(o.startDate) ? C.ymd(o.startDate) : [0, '', ''];
                if (o.frequency === 'Monthly') { o.dueMonth = ''; if (C.toInt(o.dueDay) === null) o.dueDay = sd || 1; }
                else if (o.frequency === 'One-Time') { o.dueDay = ''; o.dueMonth = ''; if (!o.endDate) o.endDate = C.validISO(o.startDate) ? o.startDate : this.today; }
                else { if (o.endDate && o.endDate === o.startDate) o.endDate = ''; if (C.toInt(o.dueDay) === null) o.dueDay = sd || ''; if (C.toInt(o.dueMonth) === null) o.dueMonth = sm || ''; this.fixDay(o); }
            },

            /* ============================== option lists ============================== */
            union(base, extra) { return [...new Set([...base, ...extra].filter(Boolean))]; },
            get regionOptions() { return this.memo('ro', '', () => this.union(this.regions, [...this.commitments.map(c => c.region), ...this.expenseLogs.map(l => l.region)])); },
            get currencyOptions() { return this.memo('co', '', () => this.union(this.currencies, [...this.commitments.map(c => c.currency), ...this.expenseLogs.map(l => l.currency), ...this.events.map(e => e.currency)])); },
            get categoryOptions() { return this.memo('ca', '', () => this.union(this.categories, [...this.commitments.map(c => c.category), ...this.expenseLogs.map(l => l.category)])); },
            get methodOptions() { return this.memo('me', '', () => this.union(this.methods, [...this.commitments.map(c => c.method), ...this.expenseLogs.map(l => l.method)])); },
            onLinkChange(l) {
                if (l.commitmentId && !l.commitmentDate) l.commitmentDate = this.dueDatesOf(l.commitmentId).find(d => d >= C.addDays(this.today, -45)) || '';
                if (!l.commitmentId) l.commitmentDate = l.commitmentDate || '';
            },

            /* ============================== commitments: status + view ============================== */
            get stInfo() {
                return this.memo('st', '', () => {
                    const paid = C.buildPaidIndex(this.expenseLogs), map = {};
                    this.commitments.forEach(c => { map[c.id] = C.statusOf(c, paid, this.today); });
                    return { paid, map };
                });
            },
            st(c) { return this.stInfo.map[c.id] || { status: 'Pending', missed: [], next: '', paidCount: 0, total: 0, invalid: true }; },
            statusClass(c) {
                return { Overdue: 'bg-red-500/10 text-red-400', Paid: 'bg-emerald-500/10 text-emerald-400', Completed: 'bg-teal-500/10 text-teal-300', Upcoming: 'bg-slate-500/20 text-slate-300', Pending: 'bg-amber-500/10 text-amber-400' }[this.st(c).status];
            },
            statusSub(c) {
                const s = this.st(c);
                if (s.status === 'Overdue') return `${s.missed.length} missed · since ${C.fmtDate(s.missed[0])}`;
                if (s.status === 'Completed') return s.total ? `${s.paidCount}/${s.total} paid` : 'Ended';
                if (s.status === 'Upcoming') return s.next ? `first due ${C.fmtDate(s.next)}` : `starts ${C.fmtDate(c.startDate)}`;
                return s.next ? `next ${C.fmtDate(s.next)}` + (s.total ? ` · ${s.paidCount}/${s.total}` : '') : '';
            },
            scheduleText(c) {
                if (c.frequency === 'Monthly') return c.dueDay ? `Day ${c.dueDay} monthly` : 'Monthly';
                if (c.frequency === 'One-Time') return c.endDate ? 'Due ' + C.fmtDate(c.endDate) : 'One-Time';
                const d = c.dueDay && c.dueMonth ? `${c.dueDay} ${C.MONTH_NAMES[c.dueMonth - 1]}` : '';
                return (c.frequency === 'Yearly' ? 'Yearly ' : 'Every 2 mo from ') + d;
            },
            rangeText(c) { return c.frequency === 'One-Time' ? '' : `${C.fmtDate(c.startDate)} → ${c.endDate ? C.fmtDate(c.endDate) : 'ongoing'}`; },
            sortedCommitmentIds() {
                const f = this.f, q = f.search.toLowerCase().trim(), info = this.stInfo.map;
                const list = this.commitments.filter(c => !c._draft &&
                    (!q || [c.name, c.notes, c.category].map(x => x || '').join(' ').toLowerCase().includes(q)) &&
                    (f.region === 'All' || c.region === f.region) && (f.frequency === 'All' || c.frequency === f.frequency) &&
                    (f.currency === 'All' || c.currency === f.currency) && (f.status === 'All' || (info[c.id] && info[c.id].status === f.status)));
                const by = f.sortBy, nm = (a, b) => (a.name || '').localeCompare(b.name || '');
                list.sort((a, b) => {
                    if (by === 'amount') return (Number(b.amount) || 0) - (Number(a.amount) || 0) || nm(a, b);
                    if (by === 'name') return nm(a, b);
                    if (by === 'category') return (a.category || '').localeCompare(b.category || '') || nm(a, b);
                    if (by === 'start') return (a.startDate || '').localeCompare(b.startDate || '') || nm(a, b);
                    if (by === 'end') return (a.endDate || '9999').localeCompare(b.endDate || '9999') || nm(a, b);
                    const na = (info[a.id] && info[a.id].next) || '9999', nb = (info[b.id] && info[b.id].next) || '9999';      // "due": next unpaid date first
                    return na.localeCompare(nb) || nm(a, b);
                });
                return list.map(c => c.id);
            },
            refreshView() { this.rev++; const drafts = this.commitments.filter(c => c._draft).map(c => c.id).reverse(); this.cView = [...drafts, ...this.sortedCommitmentIds()]; },
            get cRows() { const m = new Map(this.commitments.map(c => [c.id, c])); return this.cView.map(id => m.get(id)).filter(Boolean); },
            get sortPending() {      // true when re-applying sort/filter would move rows (shown as a button, never done automatically)
                return this.memo('sp', JSON.stringify(this.f) + this.cView.join(), () => {
                    const keep = this.cView.filter(id => { const c = this.commitments.find(x => x.id === id); return c && !c._draft; });
                    return JSON.stringify(keep) !== JSON.stringify(this.sortedCommitmentIds());
                });
            },
            get selectedItems() { const s = new Set(this.selectedRowIds.map(Number)); return this.cRows.filter(c => s.has(Number(c.id))); },
            get allSelected() { const v = this.cRows; if (!v.length) return false; const s = new Set(this.selectedRowIds.map(Number)); return v.every(c => s.has(Number(c.id))); },
            toggleSelectAll(e) {
                const ids = this.cRows.map(c => Number(c.id)), cur = this.selectedRowIds.map(Number);
                this.selectedRowIds = e.target.checked ? [...new Set([...cur, ...ids])] : cur.filter(id => !ids.includes(id));
            },
            get selectedTotalsDisplay() { return this.fmtMap(this.sumBy(this.selectedItems)).replace(/\n/g, ' + '); },
            flash(id) { this.flashId = id; this.$nextTick(() => { const el = document.querySelector(`[data-row="${id}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); setTimeout(() => { if (this.flashId === id) this.flashId = null; }, 2200); },

            /* ============================== commitments: CRUD + payments ============================== */
            blank(k) {
                const t = this.today;
                return k === 'c' ? { name: '', region: 'UAE', category: '', amount: '', currency: 'AED', frequency: 'Monthly', dueDay: C.ymd(t)[2], dueMonth: '', startDate: t, endDate: '', method: '', notes: '' }
                    : k === 'l' ? { actualDate: t, commitmentDate: '', commitmentId: '', region: 'UAE', category: '', item: '', amount: '', currency: 'AED', method: '', notes: '' }
                        : { title: '', kind: 'Event', eventDate: t, repeat: 'None', budget: 0, currency: 'AED', done: 0, notes: '' };
            },
            arrOf(k) { return k === 'c' ? 'commitments' : k === 'l' ? 'expenseLogs' : 'events'; },
            // Desktop: inline draft pinned on top (never sorted). Mobile: full-screen form, row is created on Save.
            addRow(k) {
                if (k === 'c') this.f = { search: '', region: 'All', frequency: 'All', currency: 'All', status: 'All', sortBy: this.f.sortBy };
                if (!this.isDesktop) { this.openModal(k, this.blank(k), true); return; }
                const arr = this[this.arrOf(k)], o = { id: this.newId(arr), ...this.blank(k), _draft: true };
                arr.unshift(o);
                if (k === 'c') this.cView.unshift(o.id); else if (k === 'e') this.eView.unshift(o.id); else { this.lView.ids.unshift(o.id); }
                this.rev++;
                this.$nextTick(() => { const el = document.querySelector(`[data-row="${o.id}"] input:not([type=checkbox])`); if (el) el.focus(); });
            },
            // "Save row": validates, commits the draft and (since the user submitted) re-applies sort/filter and highlights the row.
            saveRow(k, o) {
                const e = this.errList(k, o);
                if (e.length) { this.showToast('Please fix: ' + e.join(', '), 'error'); return false; }
                delete o._draft; this.rev++;
                if (!this.persist({ toast: false })) return false;
                if (k === 'c') this.refreshView(); else if (k === 'e') this.refreshEvents(); else this.runLogQuery();
                this.flash(o.id); this.showToast('Saved.');
                return true;
            },
            discardDraft(k, o) {
                const key = this.arrOf(k); this[key] = this[key].filter(x => x.id !== o.id);
                if (k === 'c') this.cView = this.cView.filter(i => i !== o.id); else if (k === 'e') this.eView = this.eView.filter(i => i !== o.id); else this.lView.ids = this.lView.ids.filter(i => i !== o.id);
                this.rev++;
            },
            deleteRow(k, o) {
                if (o._draft) { this.discardDraft(k, o); return; }
                const label = k === 'c' ? o.name : k === 'l' ? o.item : o.title;
                const extra = k === 'c' && this.expenseLogs.some(l => Number(l.commitmentId) === Number(o.id)) ? '\nIts payment history in the Expense Log is kept (unlinked).' : '';
                if (!confirm(`Delete "${label || 'this row'}"?${extra}`)) return;
                if (k === 'c') { this.expenseLogs.forEach(l => { if (Number(l.commitmentId) === Number(o.id)) l.commitmentId = ''; }); this.selectedRowIds = this.selectedRowIds.filter(i => Number(i) !== Number(o.id)); }
                const key = this.arrOf(k); this[key] = this[key].filter(x => x.id !== o.id);
                this.rev++;
                if (this.persist({ toast: false })) { if (k === 'c') this.refreshView(); else if (k === 'e') this.refreshEvents(); else this.runLogQuery(); this.showToast('Deleted.'); }
            },
            // ----- modal (mobile + "Edit" on desktop) -----
            openModal(k, o, isNew = false) { this.modal = { show: true, kind: k, isNew, orig: isNew ? null : o, item: { ...o } }; },
            closeModal() { this.modal.show = false; },     // item/orig stay until the next open so the closing form never reads null
            scheduleChanged(a, b) { return ['frequency', 'dueDay', 'dueMonth', 'startDate', 'endDate'].some(f => String(a[f] ?? '') !== String(b[f] ?? '')); },
            saveModal(thenPay = false) {
                const { kind: k, isNew, orig, item } = this.modal;
                const e = this.errList(k, item);
                if (e.length) { this.showToast('Please fix: ' + e.join(', '), 'error'); return; }
                if (k === 'c' && !isNew && this.scheduleChanged(orig, item) && this.expenseLogs.some(l => Number(l.commitmentId) === Number(orig.id)) &&
                    !confirm('Changing the schedule or dates can leave earlier linked payments pointing at due dates that no longer exist (they stay in the log as history). Continue?')) return;
                let target = orig;
                if (isNew) { const arr = this[this.arrOf(k)]; target = { id: this.newId(arr), ...item }; arr.unshift(target); if (k === 'c') this.cView.unshift(target.id); else if (k === 'e') this.eView.unshift(target.id); else { this.lView.ids.unshift(target.id); this.lView.total++; } }
                else Object.assign(orig, item);
                this.closeModal(); this.rev++;
                if (thenPay && k === 'c') { this.markAsPaid(target); return; }
                if (this.persist({ toast: false })) this.showToast(isNew ? 'Added.' : 'Changes saved.');
            },
            payOccurrence(c, date) {
                if (C.buildPaidIndex(this.expenseLogs).has(C.occKey(c.id, date))) return false;
                this.expenseLogs.unshift({ id: this.newId(this.expenseLogs), actualDate: this.today, commitmentDate: date, commitmentId: c.id, region: c.region || 'UAE', category: c.category || 'General', item: c.name || 'Payment', amount: C.toMoney(c.amount), currency: c.currency || 'AED', method: c.method || '', notes: 'Payment for due date ' + date });
                this.lView.ids.unshift(this.expenseLogs[0].id); this.lView.total++;
                return true;
            },
            markAsPaid(c) {
                const e = this.errList('c', c);
                if (e.length) { this.showToast(`Fix "${c.name || 'this item'}" first: ${e.join(', ')}`, 'error'); return; }
                const target = C.payTarget(c, C.buildPaidIndex(this.expenseLogs), this.today);
                if (!target || this.st(c).status === 'Completed') { this.showToast(`"${c.name}" has nothing left to pay.`, 'info'); return; }
                this.payOccurrence(c, target); this.rev++;
                if (this.persist({ toast: false })) this.showToast(`Logged "${c.name}" for due date ${C.fmtDate(target)}.`);
            },
            markAsPending(c) {            // undo the latest payment of this commitment
                const logs = this.expenseLogs.filter(l => Number(l.commitmentId) === Number(c.id)).sort((a, b) => (b.actualDate || '').localeCompare(a.actualDate || '') || b.id - a.id);
                if (!logs.length) { this.showToast('No linked payment to undo.', 'info'); return; }
                const l = logs[0];
                if (!confirm(`Undo the payment of ${fmtMoney(l.amount, l.currency)} for due date ${C.fmtDate(l.commitmentDate)}?\nThis deletes that Expense Log row.`)) return;
                this.expenseLogs = this.expenseLogs.filter(x => x.id !== l.id); this.lView.ids = this.lView.ids.filter(i => i !== l.id); this.lView.total = Math.max(0, this.lView.total - 1); this.rev++;
                if (this.persist({ toast: false })) this.showToast('Payment removed; the due date is unpaid again.', 'info');
            },
            markSelectedAsPaid() {
                let n = 0, skipped = 0;
                this.selectedItems.forEach(c => {
                    if (this.errList('c', c).length) { skipped++; return; }
                    const t = C.payTarget(c, C.buildPaidIndex(this.expenseLogs), this.today);
                    if (t && this.st(c).status !== 'Completed' && this.payOccurrence(c, t)) n++;
                });
                this.selectedRowIds = []; this.rev++;
                if (!n) { this.showToast(skipped ? 'Selected items have invalid fields. Fix the red fields first.' : 'Nothing to pay in the selection.', skipped ? 'error' : 'info'); return; }
                if (this.persist({ toast: false })) this.showToast(`Logged ${n} payment(s).` + (skipped ? ` ${skipped} skipped (invalid).` : ''));
            },

            /* ============================== expense log: SQL-backed query ============================== */
            runLogQuery() {
                if (!db) return;
                this.flush();
                const size = Number(this.lPageSize) || 25, q = C.buildLogQuery(this.lf, this.ls, { size, offset: this.lPage * size });
                try {
                    const total = C.queryAll(db, q.countSql, q.filterParams)[0].n;
                    if (total > 0 && this.lPage * size >= total) { this.lPage = Math.max(0, Math.ceil(total / size) - 1); return; }
                    const ids = C.queryAll(db, q.sql, q.params).map(r => r.id);
                    this.lView = { ids, total, totals: C.queryAll(db, q.totalsSql, q.filterParams) };
                    this.lStale = false; this.rev++;
                } catch (e) { console.error(e); this.showToast('Query failed: ' + e.message, 'error'); }
            },
            get lRows() {
                const m = new Map(this.expenseLogs.map(l => [l.id, l]));
                const drafts = this.expenseLogs.filter(l => l._draft).map(l => l.id);
                const rest = this.lView.ids.filter(id => !drafts.includes(id));
                return [...drafts.reverse(), ...rest].map(id => m.get(id)).filter(Boolean);
            },
            get lDrafts() { return this.expenseLogs.filter(l => l._draft).length; },
            lNo(i) { return i < this.lDrafts ? '•' : this.lPage * (Number(this.lPageSize) || 25) + (i - this.lDrafts) + 1; },
            get lPages() { return Math.max(1, Math.ceil(this.lView.total / (Number(this.lPageSize) || 25))); },
            get logOptions() {
                return this.memo('lo', '', () => {
                    const d = k => [...new Set(this.expenseLogs.map(l => l[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
                    return { category: d('category'), method: d('method'), region: d('region'), currency: d('currency') };
                });
            },
            resetLogFilters() { this.lf = { q: '', actualFrom: '', actualTo: '', commitFrom: '', commitTo: '', category: 'All', region: 'All', currency: 'All', method: 'All', link: 'any', minAmt: '', maxAmt: '' }; this.ls = [{ col: 'actualDate', dir: 'desc' }, { col: 'amount', dir: 'desc' }, { col: '', dir: 'asc' }]; },
            get activeLogFilters() { const f = this.lf; return ['q', 'actualFrom', 'actualTo', 'commitFrom', 'commitTo', 'minAmt', 'maxAmt'].filter(k => f[k] !== '').length + ['category', 'region', 'currency', 'method'].filter(k => f[k] !== 'All').length + (f.link !== 'any' ? 1 : 0); },
            commitmentName(id) { const c = this.commitments.find(x => Number(x.id) === Number(id)); return c ? c.name : ''; },
            dueDatesOf(id) {       // due dates offered when linking a log to a commitment (around today)
                const c = this.commitments.find(x => Number(x.id) === Number(id)); if (!c) return [];
                return C.occurrencesOf(c, C.addDays(this.today, -400), C.addDays(this.today, 400));
            },

            /* ============================== events & tasks ============================== */
            evState(e) { return C.eventState(e, this.today); },
            evNext(e) { return C.nextEventDate(e, this.today); },
            evClass(e) { return { Overdue: 'bg-red-500/10 text-red-400', Done: 'bg-emerald-500/10 text-emerald-400', 'Due today': 'bg-amber-500/10 text-amber-400', Today: 'bg-amber-500/10 text-amber-400', Open: 'bg-sky-500/10 text-sky-300', Upcoming: 'bg-sky-500/10 text-sky-300', Past: 'bg-slate-500/20 text-slate-400' }[this.evState(e)] || 'bg-slate-500/20 text-slate-300'; },
            sortedEventIds() {
                const f = this.ef, t = this.today;
                return this.events.filter(e => !e._draft && (f.kind === 'All' || e.kind === f.kind) && (f.showDone || !e.done))
                    .sort((a, b) => (a.done - b.done) || ((C.nextEventDate(a, t) || '9999').localeCompare(C.nextEventDate(b, t) || '9999')) || (a.title || '').localeCompare(b.title || '')).map(e => e.id);
            },
            refreshEvents() { this.rev++; const drafts = this.events.filter(e => e._draft).map(e => e.id).reverse(); this.eView = [...drafts, ...this.sortedEventIds()]; },
            get eRows() { const m = new Map(this.events.map(e => [e.id, e])); return this.eView.map(id => m.get(id)).filter(Boolean); },
            toggleDone(e) { e.done = e.done ? 0 : 1; this.rev++; if (this.persist({ toast: false })) this.showToast(e.done ? 'Task marked done.' : 'Task re-opened.', 'info'); },
            get upcomingEvents() {
                return this.memo('ue', '', () => {
                    const t = this.today;
                    return this.events.filter(e => !e._draft && !e.done).map(e => {
                        const n = C.nextEventDate(e, t); if (!n) return null;
                        const days = C.daysBetween(t, n);
                        return days <= 45 && (days >= 0 || e.kind === 'Task') ? { id: e.id, title: e.title || 'Untitled', kind: e.kind, date: n, days, budget: e.budget, currency: e.currency } : null;
                    }).filter(Boolean).sort((a, b) => a.days - b.days);
                });
            },

            /* ============================== dashboard analytics ============================== */
            get win() { return this.memo('win', JSON.stringify(this.dash), () => C.makeWindow(this.dash, this.today)); },
            get prevWin() { return this.memo('pwin', JSON.stringify(this.dash), () => C.previousWindow(this.win)); },
            get an() { return this.memo('an', JSON.stringify(this.dash), () => C.analyze(this.commitments.filter(c => !c._draft), this.expenseLogs.filter(l => !l._draft), this.win, this.today)); },
            get prevAn() { return this.memo('pan', JSON.stringify(this.dash), () => C.analyze([], this.expenseLogs.filter(l => !l._draft), this.prevWin, this.today)); },
            get dashCurrencies() {
                return this.memo('dc', '', () => { const s = new Set(); [...this.commitments, ...this.expenseLogs, ...this.events].forEach(x => { if (x.currency) s.add(x.currency); }); return s.size ? [...s].sort() : ['AED']; });
            },
            get curSel() { return this.dashCurrencies.includes(this.dashCur) ? this.dashCur : this.dashCurrencies[0]; },
            get trendData() { return this.memo('tr', JSON.stringify(this.dash) + this.curSel, () => C.trend(this.expenseLogs.filter(l => !l._draft), this.win, this.prevWin, this.curSel, this.today)); },
            get yearOptions() { const y = C.ymd(this.today)[0]; return Array.from({ length: 10 }, (_, i) => y - 6 + i); },
            get overdueList() {
                return this.memo('od', '', () => this.commitments.filter(c => !c._draft && this.st(c).status === 'Overdue').map(c => ({ c, s: this.st(c) })));
            },
            get categoryRows() { return Object.entries(this.an.category).map(([cat, totals]) => ({ cat, totals })).sort((a, b) => a.cat.localeCompare(b.cat)); },
            sumBy(items) { const m = {}; items.forEach(i => C.addTo(m, i.currency || 'AED', Number(i.amount) || 0)); return m; },
            fmtMap(map, signed = false) {
                const e = Object.entries(map || {}); if (!e.length) return '—';
                return e.map(([c, v]) => (signed && v > 0.005 ? '+' : '') + fmtMoney(v, c)).join('\n');
            },
            get spendDelta() {
                const t = this.trendData;
                if (t.pct === null) return t.curTotal ? 'no previous spend to compare' : '';
                return `${t.pct >= 0 ? '▲' : '▼'} ${Math.abs(t.pct).toFixed(1)}% vs ${this.prevWin.label}`;
            },
            get chartKey() {
                if (this.tab !== 'dashboard' || this.loading) return '';
                return JSON.stringify([this.curSel, this.an.perMonth.map(m => [m.required[this.curSel] || 0, m.actual[this.curSel] || 0]), this.trendData.current, this.trendData.previous]);
            },
            drawCharts() {
                if (typeof Chart === 'undefined' || this.tab !== 'dashboard') return;
                const cur = this.curSel, pm = this.an.perMonth, tr = this.trendData;
                Chart.defaults.color = '#94a3b8'; Chart.defaults.borderColor = 'rgba(51,65,85,.55)'; Chart.defaults.font.size = 11;
                const opts = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { boxWidth: 12, usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${cur} ${fmtNum(c.parsed.y)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => fmtNum(v).replace('.00', '') } } } };
                const mk = (id, type, data, extra) => {
                    const el = document.getElementById(id); if (!el) return;
                    if (CH[id]) { CH[id].data = data; CH[id].update(); } else CH[id] = new Chart(el, { type, data, options: { ...opts, ...(extra || {}) } });
                };
                mk('chBar', 'bar', { labels: pm.map(m => m.label), datasets: [
                    { label: 'Upcoming obligations', data: pm.map(m => m.required[cur] || 0), backgroundColor: '#0ea5e9', borderRadius: 4 },
                    { label: 'Actual expenses', data: pm.map(m => m.actual[cur] || 0), backgroundColor: '#34d399', borderRadius: 4 }] });
                const pr = arr => { const n = arr.filter(v => v !== null).length; return n < 3 ? 4 : (tr.labels.length > 14 ? 0 : 3); };   // a lone point must still be visible
                mk('chTrend', 'line', { labels: tr.labels, datasets: [
                    { label: this.win.label + (this.win.months.length === 1 ? ' (cumulative)' : ''), data: tr.current, borderColor: '#38bdf8', backgroundColor: '#38bdf8', tension: .25, spanGaps: false, pointRadius: pr(tr.current) },
                    { label: this.prevWin.label, data: tr.previous, borderColor: '#94a3b8', backgroundColor: '#94a3b8', borderDash: [5, 4], tension: .25, spanGaps: false, pointRadius: pr(tr.previous) }] });
            },

            /* ============================== import / export ============================== */
            exportSQLite() {
                this.persist({ toast: false });
                download(new Blob([db.export()], { type: 'application/x-sqlite3' }), `gowtham_tracker_v${C.SCHEMA_VERSION}_${C.todayISO()}.db`);
            },
            exportCSV() {
                const cell = v => { if (v === null || v === undefined) return ''; let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
                const rows = [['Type', 'Name / Item', 'Region', 'Category', 'Amount', 'Currency', 'Frequency / Kind', 'Schedule', 'Start date', 'End date', 'Actual date', 'Commitment date', 'Linked commitment', 'Status', 'Method', 'Notes']];
                this.commitments.filter(c => !c._draft).forEach(c => rows.push(['Commitment', c.name, c.region, c.category, c.amount, c.currency, c.frequency, this.scheduleText(c), c.startDate, c.endDate, '', '', '', this.st(c).status, c.method, c.notes]));
                this.expenseLogs.filter(l => !l._draft).forEach(l => rows.push(['ExpenseLog', l.item, l.region, l.category, l.amount, l.currency, '', '', '', '', l.actualDate, l.commitmentDate, this.commitmentName(l.commitmentId), '', l.method, l.notes]));
                this.events.filter(e => !e._draft).forEach(e => rows.push([e.kind, e.title, '', '', e.budget, e.currency, e.repeat, '', e.eventDate, '', '', '', '', this.evState(e), '', e.notes]));
                download(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'gowtham_export_' + C.todayISO() + '.csv');
                this.showToast('CSV exported successfully!');
            },
            async importSQLite(event) {
                const input = event.target, file = input.files && input.files[0];
                if (!file) return;
                try {
                    if (!confirm('Importing replaces ALL current data in this browser. Older files are upgraded automatically (your file on disk is not changed). Continue?')) return;
                    const u8 = new Uint8Array(await file.arrayBuffer()), SQL = await getSQL();
                    const candidate = new SQL.Database(u8), prev = db;
                    try {
                        const names = C.listTables(candidate);                                  // throws on invalid files
                        if (!names.some(n => ['commitments', 'expense_logs', 'events', 'events_list', 'uae_payments', 'india_payments'].includes(n))) throw new Error('this file is not a tracker database');
                        db = candidate;
                        const rep = this.upgradeCurrentDb();
                        this.loadDataFromDB(); this.persist({ toast: false }); this.runLogQuery();
                        if (prev) prev.close();
                        this.showToast(rep.migrated ? `Imported and upgraded from schema v${rep.fromVersion} to v${rep.toVersion}.` : 'SQLite database loaded!');
                    } catch (err) {
                        db = prev; try { candidate.close(); } catch (_) { } try { if (db) this.loadDataFromDB(); } catch (_) { }
                        this.migration = null;
                        throw err;
                    }
                } catch (err) { console.error(err); this.showToast('Import failed: ' + (err.message || 'invalid file'), 'error'); }
                finally { input.value = ''; }
            },
            clearAllData() {
                if (!confirm('Delete ALL commitments, expense logs and events? This cannot be undone.\n\nTip: use "Export DB" first if you want a backup.')) return;
                this.commitments = []; this.expenseLogs = []; this.events = []; this.selectedRowIds = []; this.rev++;
                if (this.persist({ toast: false })) { this.refreshView(); this.refreshEvents(); this.runLogQuery(); this.showToast('All data cleared.'); }
            }
        };
    };
})();
