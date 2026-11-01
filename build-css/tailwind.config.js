/* Light / dark theme without touching the markup.
 * Every colour family used by the app is a CSS variable ("R G B"), so classes such as bg-slate-900/60 keep working with
 * opacity. The markup is written for the dark theme; :root[data-theme="light"] swaps the values:
 *  - slate (neutrals) is mirrored: dark backgrounds become light ones and light text becomes dark text;
 *  - accents keep their solid button shades (500-700), their pale text shades (200-400) become deep ones and their deep
 *    tint shades (800-950) become pale tints, so badges and alerts stay readable on white.
 * `onaccent` is a fixed white for text on solid accent buttons (text-white is themed: it is near-black in light mode). */
const colors = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const ACCENTS = ['sky', 'emerald', 'amber', 'red', 'teal', 'purple'];
const rgb = hex => { const h = hex.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(' '); };
const v = name => `rgb(var(--${name}) / <alpha-value>)`;
const scale = fam => Object.fromEntries(SHADES.map(s => [s, v(`${fam}-${s}`)]));

// dark-theme shade -> colour used in the light theme
const LIGHT_SLATE = { 50: '950', 100: '900', 200: '800', 300: '700', 400: '600', 500: '500', 600: '400', 700: '300', 800: '200', 900: '#ffffff', 950: '100' };
const LIGHT_ACCENT = { 50: 950, 100: 900, 200: 900, 300: 800, 400: 700, 500: 500, 600: 600, 700: 700, 800: 200, 900: 100, 950: 50 };

const pick = (fam, s) => (String(s).startsWith('#') ? s : colors[fam][s]);
const dark = { '--white': rgb('#ffffff') }, light = { '--white': rgb(colors.slate[900]) };
['slate', ...ACCENTS].forEach(fam => SHADES.forEach(s => {
    dark[`--${fam}-${s}`] = rgb(colors[fam][s]);
    light[`--${fam}-${s}`] = rgb(pick(fam, fam === 'slate' ? LIGHT_SLATE[s] : LIGHT_ACCENT[s]));
}));

module.exports = {
    content: ['../index.html', '../assets/js/app.js'],
    future: { hoverOnlyWhenSupported: true },          // no "sticky" hover colours after a tap on phones / tablets
    theme: {
        extend: {
            colors: { white: v('white'), onaccent: '#ffffff', ...Object.fromEntries(['slate', ...ACCENTS].map(f => [f, scale(f)])) }
        }
    },
    plugins: [plugin(({ addBase }) => addBase({
        ':root': { ...dark, 'color-scheme': 'dark' },
        ':root[data-theme="light"]': { ...light, 'color-scheme': 'light' }
    }))]
};
