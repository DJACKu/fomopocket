# FOMO Pocket

**The real [fomo.family](https://fomo.family) alert feed, live and authenticated, inside your browser's side panel.**

FOMO Pocket is a small Manifest V3 extension for Brave / Chrome. It does **not** reimplement FOMO. It loads the actual site in an iframe inside the side panel, strips the headers that would block framing, and applies a CSS "condensation" profile so the desktop terminal fits in a ~400 px column: alert feed on top, token header + one view (Chart / Buy / Holders / Positions) at the bottom, draggable divider between the two.

Because it is the real site, everything already works: your login, the live WebSocket feed, the alert sound, search, the chart, positions. Nothing is scraped, proxied or stored by the extension.

> **Status: personal-use, unpacked extension.** Not on any store, not affiliated with fomo.family or Privy. It depends on the site's DOM and *will* need small repairs when FOMO ships a redesign. Read [Security trade-offs](#security-trade-offs) before installing. Buy/Sell is active inside the panel: a broken layout is still clickable with real money.

---

## Requirements

- A Chromium browser with the Side Panel API: **Brave**, **Chrome 114+**, Edge, etc. Nothing in the extension is Brave-specific (standard Chrome extension APIs only), but it has so far only been tested on Brave. Reports from Chrome welcome.
- A fomo.family account you are already logged into in that browser.
- No build tools. Plain HTML/CSS/JS, no dependencies.

## Install

1. Download this repository (`Code → Download ZIP`, then unzip) or `git clone` it.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the `fomopocket` folder (the one containing `manifest.json`).
5. Pin the FOMO Pocket icon to the toolbar.
6. Click the icon, or press **Alt+Shift+F**, to open the panel. The first open is a bit slower: the extension rewrites the fomo.family cookies, unregisters the site's service worker, then loads the frame.
7. Click once inside the frame to unlock the alert sound (a "Click to enable sound" banner reminds you).

If the frame shows the login screen, log in on fomo.family in a normal tab first (the **↗** button opens one), then press **↻** in the panel.

## Using the panel

### Header strip

| Control | What it does |
|---|---|
| ● status dot | Grey: loading. Green: frame loaded and every selector matched. Amber: frame loaded but some selectors are missing (layout degraded, hover for the list). |
| `0.1.10 - by @0xDJACK` | Click the version to show / hide the diagnostics log (read-only: cookie rewrites, selector report, DNR status, network events). |
| 💀 | Kill-switch: shows the raw, unstyled site inside the panel. Click again to re-apply the condensed layout. Harmless and reversible; handy to find a new selector after a FOMO deploy. |
| ↻ | Reload the frame (re-unregisters the site's service worker first). |
| 🍪 | Force a pass of the cookie rewrite (SameSite=None), then reload. Use it if the frame is suddenly logged out. |
| 🔍 | Print DNR ruleset status and recent network events to the log. |
| ↗ | Open fomo.family in a normal tab. |

### Inside the frame

- **Alert feed** on top. Its own tabs (Alerts / Tokens / Leaderboard / Feed), filters and sound toggle work as on the site.
- **Divider**: drag to resize the feed, double-click to collapse the bottom area. The height is remembered.
- **View bar** at the very bottom: **Chart**, **Buy**, **Holders**, **Positions**, plus **⇅** to collapse / expand the bottom area. Only one view is visible at a time; the choice is remembered.
- **Search** in the site's header still works: picking a token loads its page in the bottom area, the feed stays on top.
- Modals (call details, positions) and hover cards are re-anchored to the bottom of the panel as full-width sheets.

Hidden on purpose: logo, balances, ticker bar, Split buttons, About block, Swaps / Thesis tabs, closed trades, Open/Closed toggle.

**Language.** The extension's own UI is English. Everything inside the frame is fomo.family itself, which picks its language from your browser unless you chose one in the site's settings. To change it, open fomo.family in a normal tab (↗), account menu → settings → language. The choice is stored by the site and the panel follows it.

### Limitations

- **Sound only plays while the panel is open.** The browser unloads a closed side panel, so the frame dies with it. That is the whole point of a panel that stays open.
- The panel is per window. Opening it in a second window loads a second copy of the site.
- `Alt+Shift+F` opens the panel but cannot close it (Chrome does not expose that). Use the icon or the panel's own close button.

---

## How it works

```
sidepanel/index.html           extension page: header strip + <iframe src="https://fomo.family/">
background/sw.js               cookie SameSite rewrite, site-SW unregistration, diagnostics, shortcut
rules/frame.json               declarativeNetRequest: strip X-Frame-Options / CSP on sub_frames
frame/no-sw.main.js            MAIN world: blocks the site's service-worker registration inside our frame
frame/selectors.js             the ONE file listing every fomo.family selector
frame/inject.js                tags matched elements with data-fp="…", injects view bar + divider, reports
frame/condense.css             the layout, targeting only [data-fp=…]
frame/privy-ancestors.main.js  MAIN world inside the Privy iframe: hides our origin from ancestorOrigins
```

Getting fomo.family to render inside a `chrome-extension://` page takes four moves, each of which is logged in the panel:

1. **Frame blocking.** The site sends `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'self'`. A `declarativeNetRequest` rule removes those headers on `sub_frame` responses from `fomo.family`.
2. **The site's service worker.** fomo.family registers a Workbox service worker that performs navigations itself, bypassing DNR. Before each load the extension unregisters it (`chrome.browsingData.remove`), and a MAIN-world script inside our frame makes `navigator.serviceWorker.register` fail. A normal fomo.family tab re-registers it on its next full load; the only visible effect there is the loss of the PWA offline page.
3. **Session cookies.** An iframe inside an extension page is a cross-site context, so `SameSite=Strict/Lax` cookies are not sent. The extension re-sets the fomo.family cookies (Privy session) with `SameSite=None; Secure`, preserving everything else, and logs each rewrite.
4. **Wallet (Buy/Sell).** The Privy embedded-wallet iframe checks the whole `location.ancestorOrigins` chain against an allow-list that will never contain our extension. A second DNR rule strips its `frame-ancestors`, and a MAIN-world script patches `DOMStringList.prototype` so that the iframe simply does not see the `chrome-extension://` ancestor. Details in [`NOTES.md`](NOTES.md).

Every content script exits immediately when fomo.family is **not** framed by the extension, so a normal tab is left untouched except for the two side effects listed below.

## Security trade-offs

Be aware of what the extension changes in your browser. All of it is scoped to fomo.family and Privy, nothing else.

- **CSP and X-Frame-Options are removed** on `sub_frame` responses from `fomo.family`, `privy.io` and `privy.systems`. DNR cannot condition on who the parent frame is, so this also applies when those pages are framed by any other site. This weakens the site's own clickjacking protection outside the panel.
- **fomo.family cookies are rewritten to `SameSite=None`**, which relaxes CSRF protection for that origin.
- **The site's service worker is unregistered** every time the panel opens.
- The extension asks for `cookies`, `browsingData`, `webRequest` (read-only, diagnostics) and host permissions on fomo.family / privy.io only. It has no backend, no analytics, and never sends anything anywhere.

If that is not acceptable to you, do not install it.

## When FOMO ships a deploy

The extension depends on someone else's DOM, so it is built for fast repair rather than prevention:

1. The status dot turns **amber** and the log lists the unmatched selectors (`selectors: 2/24 missing (chart, holders) on /tokens/…`).
2. Click **💀** to see the raw site, right-click → **Inspect** inside the panel, find the new structure.
3. Fix the selector in **`frame/selectors.js`** (every selector lives there, each with a description). Do not touch `condense.css` unless the layout itself must change.
4. Reload the extension from `brave://extensions` (↻ on the card) and reopen the panel.
5. Log what broke and how you fixed it in the "Breakage after FOMO deploys" section of `NOTES.md`.

The most fragile selectors are listed in [`BACKLOG.md`](BACKLOG.md) §5.

## Development

No build step: edit a file, hit ↻ on the extension card in `brave://extensions`, reopen the panel. Changes to the manifest or to the background service worker need that full reload; changes to `frame/*` only need a frame reload (↻ in the panel).

Syntax check:

```powershell
node --check background/sw.js frame/inject.js frame/selectors.js frame/no-sw.main.js frame/privy-ancestors.main.js sidepanel/index.js
```

Debugging:

- Panel page: right-click inside the panel → Inspect.
- Extension service worker: `brave://extensions` → FOMO Pocket → "service worker".
- Frame: the same DevTools as the panel, pick the `fomo.family` frame in the context selector.
- Everything the extension does (cookie rewrites, DNR matches, network events on the frame, Privy iframe requests) is also written to the in-panel log.

Documents:

- [`NOTES.md`](NOTES.md): design log, spike results, why each workaround exists, DOM reference.
- [`BACKLOG.md`](BACKLOG.md): what remains to be tested or built, accepted debts.
- [`fomo-sidepanel-prompt.md`](fomo-sidepanel-prompt.md): the original design brief (historical; some points such as "read-only" no longer apply).

## License

[MIT](LICENSE) — FOMOPocket by @0xDJACK. FOMO Pocket is an independent hobby project and is not affiliated with, endorsed by, or supported by fomo.family or Privy.
