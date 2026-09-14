# NOTES — FOMO Pocket

Design log: spike results, selectors, breakage after FOMO deploys.
What remains to be done is in **`BACKLOG.md`** (v0.1.7 written but never tested).

## M0 — feasibility spike (2026-09-06)

### HTTP probe done outside the browser (curl, unauthenticated)

| Point | Finding | Consequence |
|---|---|---|
| `X-Frame-Options` | `DENY` | To be removed via DNR (`rules/frame.json`). |
| CSP `frame-ancestors` | `'self'` | Same. The CSP carries a **per-response nonce** (`script-src 'nonce-…'`), so it is impossible to *rewrite* it statically in DNR: we **remove it entirely** for `sub_frame`. Acceptable (personal extension, single origin). |
| CSP in `<meta http-equiv>` | Absent | No content script needed to remove it. |
| JS frame-bust (`window.top !== self`) | None in `entry.client`, `root`, `middleware`, `urls`, `privy` | Still to be confirmed at runtime (lazy chunks not inspected). |
| Cloudflare cookie `__cf_bm` | Already `SameSite=None; Secure` | Nothing to report. |
| Auth | **Privy** (`auth.privy.io`, chunk `privy-v2-*.js`) | Privy stores its token in `localStorage` by default (`privy:token`…), sometimes in a `privy-token` cookie. To check while logged in: `Application → Storage` in a fomo.family tab. |
| Stack | Remix / React Router, Vite, Cloudflare Workers | App routes: `/` (terminal?), `/token`, `/tokens/:chain/:tokenAddress`, `/coin`, `/perp`, `/prices`, `/profile/:handle`, `/clans`. |
| `Cross-Origin-Opener-Policy` | `same-origin` | No effect on an iframe. |

### Risk #1 to check in the browser: storage partitioning

Chrome partitions `localStorage`/IndexedDB/cookies of third-party iframes by top-level site.
A `fomo.family` iframe inside `chrome-extension://…` **should** be exempt from partitioning
and from third-party cookie blocking **because the extension has `host_permissions` on `fomo.family`**
(Chromium exemption for frames in extension pages). If that is not the case in Brave:

- cookies: the `SameSite=None` rewrite in `background/sw.js` will not be enough;
- `localStorage` (Privy token): the frame will see empty storage → login screen.

Short plan B before full Path B: `document_start` content script in the frame that receives
the Privy `localStorage` copied from a real tab (via the SW), then reloads. Only to be done if measured.

### Results under real conditions (Brave, logged in)

**v0.0.1** — frame refused ("refused to connect"). Panel console:
`Framing 'https://fomo.family/' violates the following Content Security Policy directive: "frame-ancestors 'self'"`.

**v0.0.2** — diagnosis:
- active DNR rulesets: `frame` (static) + `1001` (dynamic); `testMatchOutcome` on the frame URL as `sub_frame` matches both. The rules are therefore correct.
- **no `webRequest` `sub_frame` event** for fomo.family. The frame navigation does not go through the network as seen by the extension.
- Cause: the site registers a **Workbox service worker (`/sw.js`)** from the logged-in tab. Its `mode === "navigate"` route uses a network strategy (`NetworkOnly` + fallback `/pwa/offline.html`): the SW performs the `fetch` itself, that request escapes DNR/webRequest, and the response keeps `frame-ancestors 'self'`. The SW is shared with our frame (registration at the origin, not partitioned thanks to `host_permissions`).
- Cookies: the Privy session is in **cookies** `privy-session` and `privy-token`, `SameSite=Strict`. Rewritten to `None` by the extension's SW (logged). Nothing to copy from `localStorage`.

**v0.0.3** — workaround: `chrome.browsingData.remove({origins:['https://fomo.family']}, {serviceWorkers:true})` before each frame load, + `frame/no-sw.main.js` (MAIN world, only if the ancestor is `chrome-extension://`) which makes `navigator.serviceWorker.register` fail in our frame, + `frame/inject.js` which unregisters whatever remains. The normal tab re-registers its SW on its next full load; we remove it again each time the panel is opened. Effect on the normal tab: loss of PWA offline mode, nothing else.

**Observed desktop layout** (user screenshot, ~2000 px): left column = tabs `Alerts | Tokens | Leaderboard | Feed`, `Traders` row + sound icon, `Filters` + `>$1K` chip, alert list, `Split bottom | Split right` buttons at the bottom of the column. Center: token header + TradingView chart + `Holders` / `Swaps`. Right: `Buy/Sell`, `About`, `Your positions`. Bottom: ticker bar. The alert feed is indeed the left column.

### Checklist to fill in after loading in Brave

1. Does the frame load? (SW console in `brave://extensions` + right-click in the panel → Inspect)
2. Is it logged in?
3. Does the feed fill up, does the WebSocket (`wss://*.fomo.family`) connect?
4. Does sound play after a first click in the frame?
5. What does the layout look like at ~400 px? Does the feed stay visible?

Results (v0.0.3, Brave):

- [x] 1. Frame loaded. `/` responds 302 → `/token` once logged in; `X-Frame-Options: DENY` and `frame-ancestors 'self'` properly removed by DNR as soon as the site's SW is gone.
- [x] 2. Logged in (balance, positions visible).
- [x] 3. Alert feed filled and live.
- [ ] 4. Sound: to be confirmed after first click.
- [x] 5. At ~400 px the site shows "Download the app"; at ~900 px, the 3-column desktop layout. **Cause: pure CSS**, `root-v2-*.css`: `.mobile-blocker{display:none}` / `@media(max-width:799px){.mobile-blocker{display:block}.desktop-content{display:none}}`. Both blocks are always rendered by React (`authenticated-v2-*.js`, component `$3`), no `innerWidth` test for the barrier (the only `innerWidth>=W` is in `referral-v2-*.js`, unrelated). → v0.0.4: `frame/condense.css` forces `.mobile-blocker{display:none}` and `.desktop-content{display:block}` under `html.fomo-pocket`.

**Go Path A.** Observed cost: unregistering the site's SW on every open, Privy cookies set to `SameSite=None`.

### Reference points for M2 (Tailwind v4, breakpoints in rem)

Media queries present: `min-width` 40/48/50/64/80/87.5/96/125 rem, `max-width: calc(48rem - 1px)`, plus occasional 500/1000/1200 px. At 400 px, only the base variants apply (no `sm:`/`md:`). Desktop container: `div.desktop-content > div.pt-2.pl-4.w-dvw.min-h-svh.h-svh.flex.flex-col.gap-3.max-h-svh.overflow-hidden.pb-6`.

## M2 + M3 — condensation (v0.1.0, 2026-09-06)

Choice: **CSS reflow, single frame**. The token page already renders the alerts column and the
token content at the same time, so no need for a second iframe: we turn the
`sidebar | main` row into a column (`sidebar` on top, `main` at the bottom), draggable divider between the two.

Layout requested by the user: alert feed with priority at the top; at the bottom, the token
header + **one view of choice** among Chart / Buy / Holders / Positions (injected button bar,
fixed at the bottom of the frame). Permanently hidden: About, Swaps and Thesis tabs, closed trades,
Open/Closed toggle (Open forced), logo, balances, Split buttons, ticker bar.

Mechanics:
- `frame/selectors.js`: single map of selectors → `inject.js` sets `data-fp="key"` (MutationObserver);
- `frame/condense.css`: only targets `[data-fp=…]`, guarded by `html.fomo-pocket`; views via `html.fp-view-<view>`; collapse via `html.fp-collapsed`;
- settings persisted in `chrome.storage.local`: `fpView`, `fpFeedH` (px), `fpCollapsed`;
- `fp-report` report (matched / missing) sent to the panel: amber dot + list in the log.

Known limits:
- **Buying/selling in the panel: untested and out of scope** (read only). The frame displayed
  "Wallet connection failed": the Privy iframe (`auth.privy.io`) nested inside our frame is
  probably partitioned. The Buy view is for reading the panel, not for trading.
- The `token-header` (`:first-child`) and `about` (`:nth-last-child`, filtered on the text "About") selectors
  are the most fragile: first to check after a FOMO deploy.

### Modals (v0.1.2 → v0.1.3)

Radix Dialog: `[role="dialog"].fixed.top-[50%].left-[50%]…` > `button[data-slot=dialog-close]` + content
`div.rounded-3xl…h-[84svh].max-h-200.w-248` (992 × 800). "Position" modal (click on a call):
`div.flex.flex-1.min-h-0 > [div.flex-3 (token header, chart, theses)] [div.w-px.mx-4] [div.flex-2 (Buy/Sell, position card, transactions)]`.
In the panel: dialog anchored at the bottom full width, stacked columns, the modal's Buy/Sell hidden.
Anchor `[role="dialog"]` + classes `flex-3` / `flex-2` (to be re-checked after deploy).

### Hover cards (v0.1.5)

Radix HoverCard (`tradeSettings-v2-*.js`, wrapper `bo`): content `[data-slot="hover-card-content"].hover-card-content.w-70`
inside `[data-radix-popper-content-wrapper]`, `side` provided by the caller. No side fits at 400 px, floating-ui
only shifts along the main axis → out of frame. Choice: ignore the placement and display the card as a sheet anchored
at the bottom of the frame (`:has(> [data-slot="hover-card-content"])`). Tailwind v4: remember `translate: none` in addition to
`transform: none` (the translate-* utilities use the `translate` property).

### Privy wallet "connection failed" (diagnosed v0.1.7)

`body > iframe[src^="https://auth.privy.io/apps/cm6h485o300n3zj9yl6vpedq7/embedded-wallets"]` (0 × 0).
The "partitioned storage" hypothesis was wrong. Sources read directly (`auth.privy.io`, build
`oiK8Ie8wgTRaxrheY_vQ8`): **two** independent locks, both on the ancestor chain.

**1. Network CSP.** The iframe's response carries
`content-security-policy: … frame-ancestors 'self' https://fomo-web-app.fomo-labs.workers.dev … https://fomo.family https://privy.fomo.family https://auth.privy.io`.
`frame-ancestors` is checked against the **whole** chain, not just the direct parent: our
`chrome-extension://…` is not in it → Chrome refuses the Privy frame. DNR rule 1 only covered
`fomo.family`. → **DNR rule 2**: same header removals on `requestDomains` `privy.io` /
`privy.systems`, `sub_frame`. Accepted side effect: the Privy iframe also loses its CSP in a normal
fomo.family tab (personal extension, unpublished).

**2. JS check internal to the iframe.** `embedded-wallets-c7e43cdfce74a65f.js`, `message` handler:

```js
allowedDomains.length === 0
  ? !(location.ancestorOrigins !== undefined && location.ancestorOrigins.length > 1)
  : location.ancestorOrigins === undefined
    || !(location.ancestorOrigins.length > 0)
    || [...location.ancestorOrigins].every(o => allowed({allowedOrigins: allowedDomains, url: o}))
// otherwise: ef(…, new D_("Frame ancestor is not allowed"))
```

`allowedDomains` (in `__NEXT_DATA__`, set by the FOMO app) will never contain our origin, so
`every()` fails, every wallet call is rejected, and the parent's polling loop (10 attempts on
`signMessage` / `getEthereumProvider`) concludes "Wallet connection failed". The *sender* check
(`l.origin`) does pass, though: it is indeed `https://fomo.family` that posts.

→ **`frame/privy-ancestors.main.js`** (MAIN world, `document_start`, `https://*.privy.io/*`). `location`
and `location.ancestorOrigins` are `[LegacyUnforgeable]` (non-configurable own properties) and therefore
irreplaceable; on the other hand the returned value is a `DOMStringList`, an ordinary, configurable
WebIDL prototype. There we mask the `chrome-extension://` entries (`length`, `item`, `contains`, `@@iterator`
— the iterator is what the `[...]` spread consumes). The iframe then sees `["https://fomo.family"]`.
Guard: the patch only applies if an ancestor really is an extension page. `DOMStringList` is
also used by IndexedDB (`objectStoreNames`, `indexNames`) — the filter only removes
`chrome-extension://` strings, with no effect there.

Diagnostics added: `background/sw.js` logs `*.privy.io` / `*.privy.systems` requests
(`sub_frame`, `websocket`, failed XHR) and `dnrStatus` exposes `testMatchPrivy` (rule 2 must
match `auth.privy.io/.../embedded-wallets` as `sub_frame`).

Still to be verified under real conditions: if the wallet responds but reports a missing share, then
*that* is storage partitioning, and the fallback is the `host_permissions` exemption already in place.

### v0.1.8 — English pass for the public repo (2026-09-14)

No functional change. Every user-facing string (manifest description, command label, header
tooltips, sound banner, panel log lines, injected toolbar/divider tooltips, MAIN-world error
message), every code comment and both documents were switched from French to English. The
extension has no locale mechanism: strings are hard-coded, so it does not follow the browser or
OS language. `sidepanel/index.html` now declares `lang="en"`. `node --check` passes on all JS files.

## Selectors

See `frame/selectors.js` (commented). Reference DOM tree at the top of that file.

## Breakage after FOMO deploys

(empty)
