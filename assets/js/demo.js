/* demo.js - sample data for the demo (first visit, ?demo=1, or Settings > Demo).
 * Everything is generated relative to today, so the demo always shows a mix of paid, pending, overdue, paused,
 * "not required" and upcoming payments. The data is invented: no real person, account or amount.
 * It is only ever loaded into an in-memory database - see wantDemo() / seedDemo() in app.js. */
(function (root) {
    'use strict';
    function build(C, today) {
        const [y, m] = C.ymd(today);
        const mk = C.monthKey(today);
        const firstOf = n => { const [yy, mm] = C.addMonths(y, m, n); return C.iso(yy, mm, 1); };          // 1st of the month n months away
        const lastOf = n => { const [yy, mm] = C.addMonths(y, m, n); return C.monthEnd(yy, mm); };
        const monthOf = n => C.addMonths(y, m, n)[1];
        let seed = 20240607;                                                                             // fixed seed: the demo looks the same on every device
        const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
        const between = (a, b) => Math.round(a + rnd() * (b - a));
        const pick = a => a[Math.floor(rnd() * a.length)];

        /* ---- commitments ---- */
        const commitments = [];
        const add = o => { const c = Object.assign({ id: commitments.length + 1, category: '', currency: 'AED', frequency: 'Monthly', every: 1, dueDay: '', dueMonth: '', startDate: firstOf(-13), endDate: '', method: 'Card', notes: '', pausedMonth: '', archived: 0 }, o); commitments.push(c); return c; };
        add({ name: 'Apartment rent', category: 'Rent', amount: 5500, dueDay: 1, method: 'Bank Transfer', notes: 'Paid to the landlord by transfer. Contract renews every March.' });
        add({ name: 'Electricity & water', category: 'Utilities', amount: 620, dueDay: 12, method: 'Auto-debit', vary: 0.18 });
        add({ name: 'Home internet', category: 'Utilities', amount: 389, dueDay: 18 });
        const mobile = add({ name: 'Mobile plan', category: 'Utilities', amount: 150, dueDay: 22 });
        add({ name: 'Car loan EMI', category: 'EMI / Loan', amount: 1850, dueDay: 5, startDate: firstOf(-20), endDate: lastOf(15), method: 'Auto-debit', notes: '36 instalments in total.' });
        const card = add({ name: 'Credit card bill', category: 'Credit card', amount: 2400, dueDay: 25, method: 'Bank Transfer', vary: 0.25 });
        const gym = add({ name: 'Gym membership', category: 'Health', amount: 249, dueDay: 3, pausedMonth: mk, notes: 'Paused this month while travelling.' });
        add({ name: 'Video streaming', category: 'Subscriptions', amount: 39, dueDay: 9 });
        const music = add({ name: 'Music streaming', category: 'Subscriptions', amount: 21.99, dueDay: 14 });
        const help = add({ name: 'Home cleaning service', category: 'Household', amount: 600, dueDay: 28, method: 'Cash' });
        add({ name: 'Laptop instalment', category: 'EMI / Loan', amount: 650, dueDay: 16, startDate: firstOf(-4), endDate: lastOf(1), notes: '6 interest-free instalments.' });
        add({ name: 'Car insurance', category: 'Insurance', amount: 2300, frequency: 'Yearly', dueDay: 15, dueMonth: monthOf(1), startDate: firstOf(-23) });
        add({ name: 'Health insurance', category: 'Insurance', amount: 3100, frequency: 'Yearly', dueDay: 10, dueMonth: monthOf(4), startDate: firstOf(-20) });
        const school = add({ name: 'School fees', category: 'Education', amount: 4200, every: 2, dueDay: 8, dueMonth: monthOf(-1), startDate: firstOf(-13), method: 'Bank Transfer' });
        add({ name: 'Visa renewal', category: 'Other', amount: 1150, frequency: 'One-Time', startDate: C.addDays(today, -20), endDate: C.addDays(today, 18) });
        add({ name: 'Home loan EMI', category: 'EMI / Loan', amount: 38500, currency: 'INR', dueDay: 7, startDate: firstOf(-24), endDate: lastOf(35), method: 'Auto-debit', notes: '60 instalments.' });
        add({ name: 'Mutual fund SIP', category: 'Savings', amount: 15000, currency: 'INR', dueDay: 10, method: 'Auto-debit' });
        add({ name: 'Family support', category: 'Family', amount: 20000, currency: 'INR', dueDay: 2, method: 'Bank Transfer' });
        add({ name: 'Life insurance premium', category: 'Insurance', amount: 24000, currency: 'INR', frequency: 'Yearly', dueDay: 20, dueMonth: monthOf(-2), startDate: firstOf(-26), method: 'UPI' });
        add({ name: 'Antivirus licence', category: 'Subscriptions', amount: 180, frequency: 'Yearly', every: 2, dueDay: 12, dueMonth: monthOf(2), startDate: firstOf(-22), notes: 'Renews every 2 years.' });
        add({ name: 'Domain name renewal', category: 'Subscriptions', amount: 55, currency: 'USD', frequency: 'Yearly', every: 5, dueDay: 3, dueMonth: monthOf(7), startDate: firstOf(-30), notes: 'Paid for 5 years at a time.' });
        add({ name: 'Water filter service', category: 'Household', amount: 220, every: 6, dueDay: 20, dueMonth: monthOf(1), startDate: firstOf(-11), method: 'Cash', notes: 'Every 6 months.' });
        add({ name: 'Cloud storage plan', category: 'Subscriptions', amount: 9.99, currency: 'USD', dueDay: 20 });
        add({ name: 'Parking permit (old flat)', category: 'Other', amount: 300, dueDay: 4, startDate: firstOf(-18), endDate: lastOf(-7), archived: 1, notes: 'Moved out - kept for the history.' });

        /* ---- payment history: every due date up to today is paid, except the ones that tell a story ---- */
        const prevKey = C.monthKey(firstOf(-1)), logs = [], skips = [];
        const log = o => logs.push(Object.assign({ id: logs.length + 1, commitmentDate: '', commitmentId: '', category: '', currency: 'AED', method: 'Card', notes: '' }, o));
        commitments.forEach(c => {
            const vary = c.vary || 0; delete c.vary;
            C.occurrencesOf(c, c.startDate, today).forEach(d => {
                const k = C.monthKey(d);
                if (c === card && (k === prevKey || k === mk)) return;                      // last month's bill is still unpaid -> Overdue
                if (c === mobile && k === mk) return;                                       // this month's is still open
                if (c === gym && k === mk) return;                                          // paused this month
                if (c === help && k === mk) { skips.push({ commitmentId: c.id, commitmentDate: d }); return; }
                if (c === music && k === C.monthKey(firstOf(-2))) { skips.push({ commitmentId: c.id, commitmentDate: d }); return; }      // free month
                if (c.archived && d > c.endDate) return;
                let paidOn = C.addDays(d, between(-1, 2)); if (paidOn > today) paidOn = today;
                log({ actualDate: paidOn, commitmentDate: d, commitmentId: c.id, category: c.category || 'General', item: c.name, amount: vary ? C.toMoney(c.amount * (1 + (rnd() * 2 - 1) * vary)) : c.amount, currency: c.currency, method: c.method, notes: 'Payment for due date ' + d });
            });
        });
        if (C.occurrencesOf(help, firstOf(0), lastOf(0)).length && !skips.some(k => k.commitmentId === help.id && C.monthKey(k.commitmentDate) === mk))
            skips.push({ commitmentId: help.id, commitmentDate: C.occurrencesOf(help, firstOf(0), lastOf(0))[0] });      // "not required this month" even before its due day
        // a payment made early, before its due date
        const nextSchool = C.occurrencesOf(school, today, lastOf(2))[0];
        if (nextSchool && C.daysBetween(today, nextSchool) <= 20) log({ actualDate: today, commitmentDate: nextSchool, commitmentId: school.id, category: 'Education', item: school.name, amount: school.amount, method: school.method, notes: 'Paid early' });

        /* ---- everyday spending (not linked to a commitment) for the last 6 months ---- */
        const shops = [['Groceries', 'Groceries', 140, 420, 'Card'], ['Fuel', 'Travel', 110, 190, 'Card'], ['Dinner out', 'Dining', 70, 260, 'Credit card'], ['Coffee & snacks', 'Dining', 18, 60, 'Cash'], ['Pharmacy', 'Health', 35, 180, 'Card'], ['Taxi / metro', 'Travel', 20, 90, 'Card'], ['Clothes', 'Shopping', 120, 650, 'Credit card'], ['Household items', 'Household', 60, 320, 'Card']];
        for (let d = C.addDays(today, -182); d <= today; d = C.addDays(d, 1)) {
            const n = rnd() < 0.55 ? 1 : rnd() < 0.25 ? 2 : 0;
            for (let i = 0; i < n; i++) { const s = pick(shops); log({ actualDate: d, category: s[1], item: s[0], amount: between(s[2], s[3]), method: s[4] }); }
        }
        for (let n = -5; n <= 0; n++) {
            const day = d => { const x = C.addDays(firstOf(n), d); return x > today ? today : x; };
            log({ actualDate: day(between(3, 24)), category: 'Family', item: 'Gift sent home', amount: between(2500, 8000), currency: 'INR', method: 'UPI' });
            log({ actualDate: day(between(5, 26)), category: 'Shopping', item: 'Online order (India)', amount: between(900, 4200), currency: 'INR', method: 'UPI' });
            log({ actualDate: day(between(2, 27)), category: 'Subscriptions', item: 'App purchase', amount: between(3, 25), currency: 'USD', method: 'Credit card' });
        }
        log({ actualDate: C.addDays(today, -47), category: 'Travel', item: 'Flight tickets home', amount: 42500, currency: 'INR', method: 'Credit card', notes: 'Return tickets for the holidays.' });
        log({ actualDate: C.addDays(today, -75), category: 'Health', item: 'Dental check-up', amount: 480, method: 'Card' });

        /* ---- events & tasks: days to remember, and things to tick off (once, or every day / week / month) ---- */
        const events = [];
        const ev = o => events.push(Object.assign({ id: events.length + 1, kind: 'Event', repeatUnit: 'None', repeatEvery: 1, doneDate: '', notes: '' }, o));
        const ago = n => C.addDays(today, -n), yearsAgo = (yrs, plusDays) => { const [yy, mm, dd] = C.ymd(C.addDays(today, plusDays)); return C.iso(yy - yrs, mm, C.clampDay(yy - yrs, mm, dd)); };
        ev({ title: 'Learn Spanish - 20 minutes', kind: 'Task', eventDate: ago(40), repeatUnit: 'Day', notes: 'Lesson, then 10 new words.' });
        ev({ title: 'Evening walk', kind: 'Task', eventDate: ago(25), repeatUnit: 'Day', doneDate: today });
        ev({ title: 'Call parents', kind: 'Task', eventDate: ago(30), repeatUnit: 'Week' });
        ev({ title: 'Water the plants', kind: 'Task', eventDate: ago(21), repeatUnit: 'Day', repeatEvery: 3 });
        ev({ title: 'Review monthly budget', kind: 'Task', eventDate: C.addDays(firstOf(-3), 27), repeatUnit: 'Month' });
        ev({ title: 'Dentist appointment', kind: 'Task', eventDate: today });
        ev({ title: 'Renew passport', kind: 'Task', eventDate: ago(3), notes: 'Photos and the old passport are needed.' });
        ev({ title: 'Car service', kind: 'Task', eventDate: C.addDays(today, 5), repeatUnit: 'Month', repeatEvery: 6 });
        ev({ title: 'Mom’s birthday', eventDate: yearsAgo(58, 9), repeatUnit: 'Year' });
        ev({ title: 'Wedding anniversary', eventDate: yearsAgo(7, 24), repeatUnit: 'Year' });
        ev({ title: 'Best friend’s birthday', eventDate: yearsAgo(33, -12), repeatUnit: 'Year' });
        ev({ title: 'Festival day', eventDate: C.addDays(today, 38) });
        ev({ title: 'Friend’s wedding trip', eventDate: C.addDays(today, 64), notes: 'Flights are booked.' });
        ev({ title: 'File the yearly tax return', kind: 'Task', eventDate: ago(30), doneDate: ago(30) });

        return { commitments, logs, events, skips };
    }
    root.TrackerDemo = { build };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.TrackerDemo;
})(typeof window !== 'undefined' ? window : globalThis);
