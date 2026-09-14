# BACKLOG — FOMO Pocket

Status as of **2026-09-07**, updated **2026-09-14**. Last functional change: **v0.1.7** (wallet fix),
**never loaded or tested**. v0.1.8 (2026-09-14) only switched every user-facing string, comment and
document to English for the public GitHub repo; no behaviour change.
The technical "why" is in `NOTES.md`; here, only what remains to be done.

---

## 1. Blocking — test v0.1.7 (wallet / buy-sell fix)

The fix is written but has never run. Reload the extension **entirely**
(`brave://extensions` → ↻ on the FOMO Pocket card): the manifest changed, a ↻ of the frame is not enough.

Then: open the panel → **Buy** view → read the log (click on the version in the banner).

Three possible outcomes, to distinguish before touching the code:

| What we see | Interpretation | Next step |
|---|---|---|
| Balance displayed, Buy button active | Both locks are down | Make a tiny purchase to confirm end-to-end signing |
| Still "Wallet connection failed" | One of the two locks still holds | Privy iframe console: `frame-ancestors` violation = DNR rule 2 does not match; "Frame ancestor is not allowed" = the `DOMStringList` patch did not take |
| Privy responds but reports a wallet / share not found | **New** problem: storage partitioning | Check the `host_permissions` exemption; this is the hypothesis that was ruled out yesterday, it would become valid again |

Log checkpoints: `privy:` lines (`*.privy.io` requests) and `testMatchPrivy` in
`dnrStatus` — the `frame#2` rule must match `auth.privy.io/.../embedded-wallets` as `sub_frame`.

## 2. ~~Blocking — `frame/privy-ancestors.main.js` has never been syntax-checked~~ — done

Resolved 2026-09-14: `node --check` passes (exit 0) on all six JS files, including
`frame/privy-ancestors.main.js`, after the v0.1.8 English pass. The runtime test in §1 still
has to be done.

---

## 3. Acceptance checks never done

Taken from `fomo-sidepanel-prompt.md` §6 and the M0 checklist in `NOTES.md`. None has been checked off.

- [ ] **Sound** — does the site's audio alert fire after a first click in the frame? (M0 checklist item 4, never filled in)
- [ ] **Search → chart** — searching a ticker / an address in the site's search does open the token in the bottom pane, feed still visible above
- [ ] **Kill-switch 💀** — actually restores the raw site in the frame
- [ ] **Panel persistence** — stays open when switching tabs
- [ ] **Zero console errors** — panel *and* frame
- [ ] **Normal-tab non-regression** — fomo.family in an ordinary tab must remain intact. High priority now: v0.1.7 adds two side effects that affect the normal tab (see §5)
---

## 4. Spec not implemented

- **Remember the last route and restore it on reopen** (`fomo-sidepanel-prompt.md` §2.6).
  Not done: no storage key for it (`fpView`, `fpFeedH`, `fpCollapsed` only). `frame/inject.js`
  already knows `location.pathname` and sends it in `fp-report` — half the work is there.
- **Settings gear** in the banner (§2.6, marked "optional"). The banner currently has
  status dot / 💀 / ↻ / 🍪 / 🔍 / ↗. To be decided: probably useless, the settings already fit in the existing gestures.

---

## 5. Debts and accepted side effects

- **DNR rule 2** strips the CSP from the Privy iframe **also in a normal fomo.family tab** (DNR cannot
  condition on the ancestor chain). Accepted for a personal, unpublished extension, but
  it is a real weakening of the site's security outside the panel.
- **Site service worker unregistered** on every panel open → the normal tab loses its
  PWA offline mode until its next full load. Known since v0.0.3.
- **Fragile selectors**, to check first after a FOMO deployment:
  `token-header` (`:first-child`), `about` (`> div` filtered on the text "About"), `holders` /
  `swaps-panel` (`:last-child` / `:nth-child`). The `fp-report` report (amber dot + list in the
  log) is there to detect them — but you still have to look at the log.
- **`NOTES.md` § "Breakages after FOMO deployment" is empty.** To be filled in at the first breaking deployment;
  it is the history that will make the selectors quick to repair.

---

## 6. Scope change to be formalized

`fomo-sidepanel-prompt.md` §7 still says, in black and white:

> no trade execution or wallet interaction (strictly read-only — never place an order or sign anything)

The wallet work (§1) directly contradicts this point. It is an explicit and repeated choice,
but the reference document has not followed: **update §7**, otherwise the next cold restart
will work against an outdated spec.

Practical consequence of this change, to keep in mind: as long as the panel was read-only,
a selector broken after a FOMO deployment was a display defect. Now that Buy/Sell is
active, a badly recomposed panel gets clicked with real money. The `fp-report` report goes from a
debugging convenience to a safeguard — hence the point of looking at it before trading from the panel.
