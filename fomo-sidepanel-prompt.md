# Build "FOMO Pocket" — a personal Brave/Chromium MV3 side-panel extension

## 0. The core idea — read this before anything else

You are building a **personal-use, locally-loaded (unpacked) MV3 extension** for Brave. It will never be published. No backend, no accounts, no telemetry, no build pipeline.

`fomo.family` is a crypto trading/social platform the user is logged into. Its left-hand **alert feed** is the thing they care about — it streams live trades from the traders they follow and **plays a sound on each new alert**. Today they keep a browser window awkwardly tiled on their desktop just to keep that column visible.

**This extension is not a reimplementation of FOMO. It is a condensed re-hosting of the real site inside the browser side panel.**

That distinction drives every decision below. Do **not** rebuild the feed UI, do **not** bundle your own notification sounds, do **not** call DexScreener, do **not** write a token search. The site already has all of it, already authenticated, already correct, already updating in real time. Your job is to get the real FOMO running inside a ~400px-wide side panel, hide everything that doesn't fit, and rearrange what's left. Every feature you reimplement is a feature that will silently break the next time FOMO ships a deploy.

Think of it as a **viewport + layout skin over the live site**, not an app.

---

## 1. Milestone 0 — the feasibility spike (do this FIRST, before designing anything)

The entire project hinges on one question: **can `fomo.family` render, authenticated and interactive, inside an iframe on a `chrome-extension://` page?**

Answer that before writing another line. Build the smallest possible extension:

- `manifest.json` with `sidePanel`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `cookies`, `scripting`, `tabs` permissions and `host_permissions: ["https://fomo.family/*"]`
- a side panel page containing nothing but `<iframe src="https://fomo.family/..." allow="autoplay" style="width:100%;height:100%;border:0">`
- a DNR ruleset that strips frame-blocking headers (see §2.1)

Load it, open the panel, and report to the user exactly what you see, in this order:

1. **Does the frame load at all**, or is it blocked? (Check `brave://extensions` service worker console + the panel's own DevTools — right-click inside the panel → Inspect.)
2. **Is it logged in?** This is the likely failure point (see §2.2). If it renders the login screen, that's the cookie `SameSite` problem, not a bug.
3. **Does the app actually run** — does the feed populate, does the WebSocket connect? (Some SPAs frame-bust with `if (window.top !== window.self)`.)
4. **Does the alert sound fire** after you click once inside the frame?
5. **What does the layout look like at ~400px wide?** Does the site have a responsive/mobile layout, and does that layout still show the alert feed?

Timebox this to one focused pass. Report findings before proceeding. If all five are green, Path A (§2) is the whole project and it will be a small, robust extension. If 2 or 3 are red, fall back to Path B (§3) and tell the user why.

Keep a `NOTES.md` in the repo recording what you found. It's the design record.

---

## 2. Path A — Re-host the real site (preferred)

### 2.1 Get past frame blocking

Use `declarativeNetRequest` with a static ruleset that, for `resourceTypes: ["sub_frame"]` on `fomo.family`, **removes** the `X-Frame-Options` header and **removes or rewrites** `Content-Security-Policy` to drop its `frame-ancestors` directive. Removing CSP wholesale is acceptable here (personal extension, single trusted origin) but prefer surgical removal of just `frame-ancestors` if you can express it.

If the site also sets CSP via a `<meta http-equiv>` tag, DNR can't touch it — add a `document_start` content script with `all_frames: true` that deletes that meta element before the parser acts on it.

If the SPA frame-busts in JS, a `document_start` MAIN-world script can neutralise it (e.g. define `window.top` to return `window.self` on the frame, or stub the specific check once you've found it in their bundle). Only do this if step 3 of the spike showed it's needed.

### 2.2 Get the session into the frame

An iframe inside a `chrome-extension://` page is a **cross-site** context. A session cookie set with `SameSite=Lax` or `Strict` will **not** be attached, and the frame renders logged out. This is the single most likely blocker.

Fix it with the `chrome.cookies` API (extensions can read `httpOnly` cookies and `chrome.cookies.set` accepts `httpOnly`, `secure` and `sameSite`):

- On SW startup and on `chrome.cookies.onChanged` for `fomo.family`, read the session cookie(s), and if `sameSite !== 'no_restriction'`, re-set the identical cookie with `sameSite: 'no_restriction', secure: true`, preserving name, value, domain, path, expiry and `httpOnly`.
- Do this **only** for `fomo.family`, never broadly. Log every rewrite to the debug view (§4.6) so the user knows what the extension touched.
- Warn the user in the README, in French, that this relaxes CSRF protection for that one origin, and that it's the price of the iframe approach.

If the session lives in `localStorage` instead of a cookie, it's origin-scoped and the iframe shares it automatically — nothing to do. Confirm which during the spike.

### 2.3 Condense the layout

Once the real site renders, inject a stylesheet into the frame (`content_scripts` with `all_frames: true`, or `chrome.scripting.insertCSS` targeting the frame) that turns the full trading terminal into a narrow column:

- Hide: top nav, the ticker bar at the bottom, the Buy/Sell order panel, the "About" token block, the Holders and Swaps tables, the leaderboard tabs — everything except the alert feed and (when open) the chart.
- Promote the alert feed to full width of the panel, collapse its own internal sidebar/collapse controls.
- Tighten row padding and font sizes for the narrow viewport.
- Preserve every interactive element the user actually uses: the `>$1K` size filter, the Alerts/Tokens/Leaderboard tabs, the search input, the sound toggle.

**Selector strategy matters more than the CSS itself.** The site is almost certainly built with hashed/utility class names that change on every deploy. Do not hard-code brittle selectors inline. Instead:

- Put every selector in a single `frame/selectors.js` map with a comment describing what each targets, so one file needs updating after a FOMO deploy.
- Prefer structural and semantic anchors (ARIA roles, stable `data-*` attributes, text content, element hierarchy) over generated class names wherever one exists.
- Make the CSS **additive and reversible**: a `.fomo-pocket` class on `<html>` gates every rule, and a kill-switch in settings removes it so the user can see the raw site inside the panel to re-find a selector when something breaks.
- If a selector fails to match anything, don't fail silently — surface it in the debug view as "3 of 11 selectors unmatched".

**Two ways to condense — try both during the spike and keep whichever looks better:**

1. **Reflow** (preferred): CSS-only, let the site lay out at the panel's real width and hide/restack elements. Crisp text, native behaviour.
2. **Scale-crop**: force the frame to a wider logical viewport (e.g. `width: 1200px`) and apply `transform: scale(0.4); transform-origin: top left` so a desktop layout is shrunk into the panel, with the wrapper cropping to the feed column. Ugly text but immune to responsive breakpoints that might hide the feed entirely. Keep it as a toggle in settings if reflow is fragile.

Also check whether the site's own **"Split bottom" / "Split right"** controls (visible in the user's screenshots) already produce a layout close to what's wanted — if so, drive those instead of fighting the CSS.

### 2.4 Sound — do nothing

The site plays its own alert sound. Inside the iframe it will keep doing so. Your only jobs:

- Put `allow="autoplay"` on the iframe element.
- The frame needs a user gesture before audio unlocks. The first click anywhere inside the panel provides it. Show a small one-time overlay — "Cliquer pour activer le son" — that disappears after the first interaction, so the user isn't confused by initial silence.
- Verify the sound still fires when the panel is open but the browser is focused on another tab. It should; if it doesn't, report it rather than working around it.

**Do not bundle sound files. Do not build an offscreen audio document. Do not implement debouncing.** The site owns this.

One caveat to state plainly to the user: **a closed side panel is unloaded by the browser**, so the iframe dies and the sound stops. FOMO Pocket only makes noise while the panel is open. That's a real limitation of the re-hosting approach and it is an acceptable trade — the whole point is that the panel stays open. Do not add a background-tab audio hack unless the user asks for it after seeing this behaviour.

### 2.5 Search and chart — reuse the site's own

The user's request: contract search, and the selected token's **chart only** opening in a compact pane at the bottom of the panel (the red zone they circled).

Because it's the same SPA instance, this is a **navigation + CSS problem**, not a feature to build:

- Keep the site's own search input visible at the top of the condensed layout. It already resolves tickers, names and contract addresses, and it's already authenticated. Don't build a second one.
- When the user selects a token, the SPA navigates to the token page. Apply a **second CSS profile** for token-page routes: hide the order panel, About block, Holders, Swaps, and the alerts sidebar, leaving only the chart. Detect the route from the URL path inside the frame and swap the profile via a class on `<html>`.
- Layout the result as: **feed on top (scrolling), chart docked at the bottom**, split by a draggable divider. Persist the divider position and the collapsed/expanded state.
  - If a single frame can't show both simultaneously (SPA renders one route at a time), use **two iframes** — one pinned to the alerts route, one to the token route — stacked vertically. This costs a second app instance and a second WebSocket; measure the memory and CPU hit before committing, and only do it if the single-frame approach can't work. Report the trade-off to the user rather than deciding alone.
- The chart pane collapses to zero height, restoring the feed to full panel height.

### 2.6 Small extension-level conveniences

These are the only things worth implementing yourself, because the site can't:

- Toolbar icon and a keyboard shortcut (`chrome.commands`) to open/close the panel. Call `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in the SW. Note `chrome.sidePanel.open()` requires user activation — valid from an action click or a command handler, not from arbitrary async code.
- A thin extension-owned header strip above the frame: connection/logged-in indicator, a reload-frame button, a "raw site" kill-switch toggle, a settings gear.
- Remember the last route the frame was on, and restore it when the panel reopens.
- Optional: `chrome.storage.local` for divider position, layout mode (reflow vs scale), and the CSS kill-switch. Keep settings genuinely minimal — every setting is a thing that can be wrong.

---

## 3. Path B — Fallback, only if the spike fails

If the frame can't be authenticated or the SPA refuses to run framed, fall back to a **companion-tab mirror**, and tell the user clearly that this is the degraded path:

- The user keeps one real FOMO tab open — it can be **pinned and in the background**, which already solves their tiling problem, and **the site's own sound keeps playing from that tab** (background tabs are not muted; audio is unaffected by timer throttling). Sound is still free.
- A content script on `fomo.family` observes new alerts and relays them to the side panel. Prefer a MAIN-world `WebSocket` monkey-patch (wrap `window.WebSocket`, forward incoming message payloads via `window.postMessage`, never modify or delay the page's own traffic, wrap in try/catch so a failure can never break the site) over DOM scraping; keep a `MutationObserver` on the alert list as a secondary source and dedupe by a stable id.
- The panel renders a compact read-only list. Clicking a row focuses the companion tab and navigates it to that token, rather than trying to mirror the chart.
- Show an explicit "Onglet FOMO fermé" state with a button that opens one.

Design the panel so that its data source sits behind one small interface, so switching between framed and mirrored modes doesn't mean rewriting the UI.

---

## 4. Technical requirements

### 4.1 Stack — deliberately minimal

- **No build step.** Plain HTML, CSS and ES modules loaded directly. The user edits a file, hits reload in `brave://extensions`, sees the change. No Vite, no bundler, no TypeScript compilation, no React, no Tailwind, no npm dependencies. If Path A works, the total JS here is a few hundred lines — a build pipeline would be more code than the extension.
- Modern Chromium-only JS: ES modules, `async/await`, optional chaining. No polyfills, no transpilation.
- CSS custom properties. Dark theme matching FOMO's near-black + green/red palette.

### 4.2 Manifest V3

```
manifest_version: 3
permissions: ["sidePanel", "storage", "scripting", "cookies", "tabs",
              "declarativeNetRequest", "declarativeNetRequestWithHostAccess"]
host_permissions: ["https://fomo.family/*"]
side_panel: { default_path: "sidepanel/index.html" }
action: { default_title: "FOMO Pocket" }
background: { service_worker: "background/sw.js", type: "module" }
commands: { toggle panel }
declarative_net_request: { rule_resources: [rules/frame.json] }
```

The service worker is killed when idle — hold no important state in its memory. In Path A there's barely any state to hold, which is another argument for that path.

### 4.3 Repo layout (Path A)

```
fomo-pocket/
  manifest.json
  NOTES.md                  # spike findings, selector notes, deploy-breakage log
  README.md                 # install + dev loop + cookie caveat, in French
  rules/frame.json          # DNR: strip X-Frame-Options / CSP frame-ancestors
  background/sw.js          # panel behaviour, cookie SameSite rewrite, commands
  sidepanel/
    index.html              # header strip + iframe + divider + settings
    index.js
    layout.js               # divider, collapse, route memory
    settings.js
    styles.css
  frame/
    selectors.js            # ALL site selectors, one file, heavily commented
    condense.css            # feed-route profile
    token.css               # token-route profile (chart only)
    inject.js               # applies profiles, watches route, reports unmatched selectors
```

### 4.4 Fragility — plan for FOMO deploys

This extension depends on someone else's DOM. It **will** break. Design for fast repair, not for prevention:

- One file holds every selector.
- The kill-switch toggle shows the raw unstyled site inside the panel, so the user can right-click → Inspect and grab a new selector without leaving the panel.
- Unmatched selectors are counted and surfaced, never silent.
- No feature depends on more than one selector where one would do.

### 4.5 Robustness

- Every layer degrades visibly. A status dot in the extension header: green (frame loaded and authenticated), amber (loaded but selectors unmatched / styling degraded), red (frame blocked or logged out) — with a tooltip saying what to do.
- Detect the logged-out state inside the frame and show an actionable message with a button that opens fomo.family in a normal tab to re-auth.
- Never break the real site. Every injection is wrapped in try/catch.

### 4.6 Debug view

Behind a triple-click on the version number: the frame's current URL, which CSS profile is active, the selector match report, the cookie rewrites performed, and DNR rule status. This is how the user diagnoses a FOMO deploy without opening DevTools.

---

## 5. Build order

Show something working early; don't build the whole thing before the user sees it.

1. **M0** — the spike (§1). Report findings, get a go/no-go on Path A.
2. **M1** — real FOMO rendering, authenticated and interactive, in the side panel at full site layout. Ugly is fine.
3. **M2** — feed-route CSS profile: condensed, readable, sound confirmed working.
4. **M3** — token-route profile + bottom chart pane + draggable divider.
5. **M4** — header strip, kill-switch, keyboard shortcut, route memory, debug view.
6. **M5** — README in French, selector documentation, polish.

After each milestone tell the user exactly what to reload and what to click to verify.

---

## 6. Acceptance criteria

- Loads unpacked in Brave (`brave://extensions` → Developer mode → Load unpacked), zero console errors.
- Panel opens from the toolbar icon and a keyboard shortcut, stays open across tab switches.
- The alert feed inside the panel is **live and authenticated**, updating identically to the real site.
- **The site's own alert sound plays** from the panel after the first click.
- Searching a contract or ticker in the site's own search opens that token's chart in the bottom pane, feed still visible above.
- The kill-switch restores the raw site inside the panel.
- Nothing the extension does breaks fomo.family in a normal tab.

## 7. Out of scope

No store packaging, no Firefox/Safari, no trade execution or wallet interaction (strictly read-only — never place an order or sign anything), no analytics, no reimplemented feed/search/chart/sound, no automated tests.

---

## 8. Language

This brief is in English for precision. **From your first reply onward, respond in French** — explanations, questions, commit messages, code comments and the README all in French. Keep code identifiers in English. The user is a French-speaking web developer (Next.js / React / Node / Python) who wants direct, concise answers and fast iteration over long planning. Skip the preamble and start with the Milestone 0 spike.
