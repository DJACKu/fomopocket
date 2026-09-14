// FOMO Pocket — ALL fomo.family selectors, in one place.
// Loaded before frame/inject.js in the same isolated world (global FP_SELECTORS).
//
// Principle: inject.js sets data-fp="<key>" on the matched element, and frame/condense.css
// ONLY targets [data-fp=...]. After a FOMO deploy breaks the layout, this is the file
// to fix, never the CSS.
//
// The site uses Tailwind v4: class names are literal (no hash), but a redesign can
// change them. Prefer hierarchy and "role" classes (.desktop-content, footer.fixed,
// [style*=height]) over purely cosmetic classes.
//
// Structure observed on 2026-09-06 (authenticated-v2 / token-v2 chunks):
//   div.desktop-content
//     div.pt-2.pl-4.w-dvw...flex.flex-col                  app
//       div.pr-4 > div.flex.justify-between.px-1           header (logo | search | balances)
//       div.flex.gap-3.flex-1.min-h-0                      body
//         div.flex.shrink-0.transition-[width].w-70        sidebar (alerts column)
//         <Outlet> → div.flex.gap-3.items-start.overflow-y-auto   main (token page)
//            div.flex.flex-col.flex-1.min-w-0               center
//              [token header] [div style=height > chart] [handle] [div Holders/Swaps]
//            div.flex.flex-col.gap-4.w-82.shrink-0.pr-4      right
//              [Buy/Sell] [position card?] [closed trades?] [About] [div > Your positions]
//     footer.fixed.inset-x-0.bottom-0                       ticker
//
// Fields: sel (CSS), what (description), scope ('app' always expected, 'token' expected
// only when main is found), filter (optional function to narrow the candidates),
// all (tag every match instead of the first), optional (never reported as missing).

var FP_SELECTORS = (() => {
  const APP = '.desktop-content > div.flex.flex-col';
  const HEADER = `${APP} > div.pr-4`;
  const BODY = `${APP} > div.flex.gap-3.flex-1.min-h-0`;
  const SIDEBAR = `${BODY} > div.shrink-0`;
  const MAIN = `${BODY} > div.overflow-y-auto`;
  const CENTER = `${MAIN} > div.flex-col.flex-1`;
  const RIGHT = `${MAIN} > div.flex-col.shrink-0`;
  const POSITIONS = `${RIGHT} > :last-child`;

  return {
    app:          { sel: APP, scope: 'app', what: 'App container: header + body' },
    header:       { sel: HEADER, scope: 'app', what: 'Top bar (logo, search, balances)' },
    'header-logo': { sel: `${HEADER} a[href="/token"]`, scope: 'app', what: 'fomo logo (/token link)' },
    'header-right': { sel: `${HEADER} div.justify-end`, scope: 'app', what: 'Balances + account menu' },
    body:         { sel: BODY, scope: 'app', what: 'Sidebar + content row' },
    sidebar:      { sel: SIDEBAR, scope: 'app', what: 'Alerts column (Alerts/Tokens/Leaderboard/Feed)' },
    'sidebar-split': { sel: `${SIDEBAR} div.mx-2.mt-1.flex.items-center.gap-2`, scope: 'app', what: 'Split bottom / Split right buttons' },
    ticker:       { sel: 'footer.fixed.bottom-0', scope: 'app', what: 'Bottom ticker bar (BTC/ETH/SOL…)' },

    main:         { sel: MAIN, scope: 'token', what: 'Token page: root' },
    center:       { sel: CENTER, scope: 'token', what: 'Center column (token header, chart, holders)' },
    'token-header': { sel: `${CENTER} > :first-child`, scope: 'token', what: 'Token header (name, mcap, price…)' },
    'token-header-row': { sel: `${CENTER} > :first-child div.flex.gap-3.items-center.w-full`, scope: 'token', all: true, what: 'Token header rows (name + stats): switched to flex-wrap' },
    chart:        { sel: `${CENTER} > div.flex-col[style*="height"]`, scope: 'token', what: 'Chart container (inline height)' },
    'chart-overlays': { sel: `${CENTER} > div.flex-col[style*="height"] > div > div.px-1.py-1.text-xs`, scope: 'token', what: '"Chart overlays / My swaps / Thesis / Min size" row (hidden)' },
    'chart-handle': { sel: `${CENTER} > div.flex-col[style*="height"] + *`, scope: 'token', what: 'Chart height handle' },
    holders:      { sel: `${CENTER} > div.flex.gap-3:last-child`, scope: 'token', what: 'Holders / Swaps / Thesis block' },
    // The Holders block measures its own width: hidden (Chart view) it renders two panels side
    // by side (Holders + Swaps/Thesis); visible at ~400 px it renders a single tabbed panel. The
    // two selectors below cover each case, so each is "optional" (absent in the other case).
    'holders-tab-extra': { sel: `${CENTER} > div.flex.gap-3:last-child div.overflow-x-auto.no-scrollbar > div:not(:first-child)`, scope: 'token', all: true, optional: true, what: 'Swaps and Thesis tabs of the compact panel (hidden)' },
    'swaps-panel': { sel: `${CENTER} > div.flex.gap-3:last-child > :nth-child(2)`, scope: 'token', optional: true, what: 'Separate Swaps/Thesis panel, rendered when the block is wide (hidden)' },
    right:        { sel: RIGHT, scope: 'token', what: 'Right column (Buy/Sell, About, positions)' },
    buy:          { sel: `${RIGHT} > :first-child`, scope: 'token', what: 'Buy / Sell panel' },
    about:        { sel: `${RIGHT} > div`, scope: 'token', what: 'About <token> block',
                    filter: (el) => /^About\b/.test(el.textContent.trim()) },
    'closed-trades': { sel: `${RIGHT} > div.rounded-xl.border`, scope: 'token', optional: true, what: 'Closed trades accordion (hidden)' },
    positions:    { sel: POSITIONS, scope: 'token', what: 'Your positions' },
    'positions-tabs': { sel: `${POSITIONS} div.border.rounded-lg.cursor-pointer.select-none`, scope: 'token', what: 'Open / Closed toggle (hidden, Open forced)' },
    // Dialogs (call details…) are targeted directly in CSS via [role="dialog"]
    // (Radix Dialog, stable semantic anchor): nothing to tag here.
  };
})();
