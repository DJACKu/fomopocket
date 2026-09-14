// FOMO Pocket — extension service worker
// Roles: panel behaviour, keyboard shortcut, SameSite rewrite of fomo.family cookies,
// unregistering the site's own service worker, DNR / network diagnostics.
// The SW is killed when idle: no important state is kept in memory.

const FOMO_DOMAIN = 'fomo.family';
const FOMO_URL = 'https://fomo.family/';

// --- Panel: clicking the toolbar icon opens/closes it ------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(logError);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(logError);
});

// Keyboard shortcut: chrome.sidePanel.open requires a user activation,
// which the command handler provides.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  try {
    const win = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (e) { logError(e); }
});

// --- Cookies: SameSite=None on fomo.family only -----------------------------
// A fomo.family iframe inside a chrome-extension:// page is a cross-site
// context: Lax/Strict cookies are not sent → the frame is logged out.
// We re-set the identical cookie with sameSite=no_restriction + secure.
// Every rewrite is logged to storage.session (debug view).

async function relaxCookie(cookie) {
  if (cookie.sameSite === 'no_restriction') return false;
  const details = {
    url: FOMO_URL,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: true,
    httpOnly: cookie.httpOnly,
    sameSite: 'no_restriction',
    storeId: cookie.storeId,
  };
  // "hostOnly" cookie: do not pass domain, otherwise Chrome turns it into a domain cookie.
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate;
  await chrome.cookies.set(details);
  await appendLog({
    t: Date.now(),
    name: cookie.name,
    domain: cookie.domain,
    from: cookie.sameSite,
    to: 'no_restriction',
  });
  return true;
}

async function relaxAllFomoCookies() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: FOMO_DOMAIN });
    let n = 0;
    for (const c of cookies) if (await relaxCookie(c)) n++;
    console.log(`[FOMO Pocket] cookies inspected: ${cookies.length}, rewritten: ${n}`);
    return { inspected: cookies.length, rewritten: n };
  } catch (e) { logError(e); return { inspected: 0, rewritten: 0, error: String(e) }; }
}

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (removed) return;
  if (!cookie.domain.endsWith(FOMO_DOMAIN)) return;
  // 'overwrite'/'explicit' is also emitted by our own set; relaxCookie
  // does nothing when sameSite is already no_restriction → no loop.
  relaxCookie(cookie).catch(logError);
});

chrome.runtime.onInstalled.addListener(relaxAllFomoCookies);
chrome.runtime.onStartup.addListener(relaxAllFomoCookies);

// --- Entry URL -----------------------------------------------------------------
// A browser that already holds a fomo.family session lands on the plain URL.
// Without a session it lands on the onboarding URL instead.
const ONBOARDING_URL = 'https://fomo.family/?r=djack';

async function hasFomoSession() {
  try {
    const cookies = await chrome.cookies.getAll({ domain: FOMO_DOMAIN });
    return cookies.some((c) => c.name === 'privy-token' || c.name === 'privy-session');
  } catch (e) { logError(e); return true; }
}

async function entryUrl() {
  return (await hasFomoSession()) ? FOMO_URL : ONBOARDING_URL;
}

// The panel can request a manual pass (🍪 button) or open a normal tab.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'relax-cookies') {
    relaxAllFomoCookies().then(sendResponse);
    return true;
  }
  if (msg?.type === 'open-fomo-tab') {
    entryUrl().then((url) => chrome.tabs.create({ url })).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// --- DNR / network diagnostics ----------------------------------------------
// Dynamic rule identical to the static ruleset: if the static one did not load
// (parse error, Brave limitation…), the dynamic one takes over.
const FRAME_RULE = {
  id: 1001,
  priority: 2,
  action: {
    type: 'modifyHeaders',
    responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' },
      { header: 'content-security-policy-report-only', operation: 'remove' },
    ],
  },
  condition: { requestDomains: ['fomo.family'], resourceTypes: ['sub_frame'] },
};

async function ensureDynamicRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [FRAME_RULE.id],
      addRules: [FRAME_RULE],
    });
  } catch (e) { logError(e); }
}
chrome.runtime.onInstalled.addListener(ensureDynamicRule);
chrome.runtime.onStartup.addListener(ensureDynamicRule);

// Only available to unpacked extensions: fine for a dev-loaded extension.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  appendDiag(`DNR match: rule ${info.rule.ruleId} (${info.rule.rulesetId}) on ${info.request.type} ${info.request.url}`);
});

// Passive observation (webRequest without "blocking") of the frame navigation.
const FRAME_FILTER = { urls: ['https://fomo.family/*', 'https://*.fomo.family/*'], types: ['sub_frame'] };
chrome.webRequest.onHeadersReceived.addListener((d) => {
  const h = (n) => d.responseHeaders?.find((x) => x.name.toLowerCase() === n)?.value ?? '∅';
  appendDiag(`net: ${d.statusCode} ${d.url} | XFO=${h('x-frame-options')} | CSP frame-ancestors=${(h('content-security-policy').match(/frame-ancestors[^;]*/) || ['∅'])[0]}`);
}, FRAME_FILTER, ['responseHeaders', 'extraHeaders']);
chrome.webRequest.onErrorOccurred.addListener((d) => {
  appendDiag(`net: ERROR ${d.error} on ${d.url}${d.fromCache ? ' (cache)' : ''}`);
}, FRAME_FILTER);
chrome.webRequest.onCompleted.addListener((d) => {
  appendDiag(`net: completed ${d.statusCode} ${d.url}${d.fromCache ? ' (cache)' : ''}`);
}, FRAME_FILTER);

// Wallet diagnostics: the Privy iframe (auth.privy.io/…/embedded-wallets) and its calls.
// Shows whether the iframe loads (200), is refused (4xx) or is never requested.
const PRIVY_FILTER = { urls: ['https://*.privy.io/*', 'https://*.privy.systems/*'] };
chrome.webRequest.onCompleted.addListener((d) => {
  if (!['sub_frame', 'xmlhttprequest', 'websocket'].includes(d.type)) return;
  if (d.type === 'xmlhttprequest' && d.statusCode < 400) return; // keep only failed XHRs
  appendDiag(`privy: ${d.type} ${d.statusCode} ${d.url.split('?')[0]}`);
}, PRIVY_FILTER);
chrome.webRequest.onErrorOccurred.addListener((d) => {
  appendDiag(`privy: ERROR ${d.error} ${d.type} ${d.url.split('?')[0]}`);
}, PRIVY_FILTER);

async function dnrStatus() {
  const out = {};
  try { out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets(); } catch (e) { out.enabledRulesets = String(e); }
  try { out.dynamicRules = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id); } catch (e) { out.dynamicRules = String(e); }
  try {
    const t = await chrome.declarativeNetRequest.testMatchOutcome({
      url: FOMO_URL, type: 'sub_frame', initiator: chrome.runtime.getURL(''),
    });
    out.testMatch = t.matchedRules.map((r) => `${r.rulesetId}#${r.ruleId}`);
  } catch (e) { out.testMatch = String(e); }
  // Rule 2: the nested Privy iframe must lose its `frame-ancestors`, otherwise
  // Chrome refuses the frame (our origin is in the ancestor chain).
  try {
    const t = await chrome.declarativeNetRequest.testMatchOutcome({
      url: 'https://auth.privy.io/apps/x/embedded-wallets', type: 'sub_frame', initiator: FOMO_URL,
    });
    out.testMatchPrivy = t.matchedRules.map((r) => `${r.rulesetId}#${r.ruleId}`);
  } catch (e) { out.testMatchPrivy = String(e); }
  const { diagLog = [] } = await chrome.storage.session.get('diagLog');
  out.diagLog = diagLog;
  return out;
}

// Unregisters the site's Workbox service worker (fomo.family origin) before the
// frame navigates, otherwise it serves the page with the original CSP. The site
// re-registers it on its next full load in a normal tab, so we do this again on
// every panel open/reload. No visible effect on the normal tab (the SW only
// serves offline/PWA).
async function dropSiteServiceWorker() {
  try {
    await chrome.browsingData.remove(
      { origins: ['https://fomo.family'] },
      { serviceWorkers: true },
    );
    await appendDiag('site sw: fomo.family service worker unregistered');
    return { ok: true };
  } catch (e) {
    logError(e);
    await appendDiag(`site sw: unregister failed (${e.message})`);
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'prepare-frame') {
    Promise.all([dropSiteServiceWorker(), entryUrl()]).then(([r, url]) => sendResponse({ ...r, url }));
    return true;
  }
  if (msg?.type === 'frame-hello') {
    appendDiag(`frame: content script active on ${msg.url}${msg.controlled ? ' (still controlled by a SW!)' : ''}`);
    return false;
  }
  if (msg?.type === 'dnr-status') {
    ensureDynamicRule().then(dnrStatus).then(sendResponse);
    return true;
  }
  if (msg?.type === 'clear-diag') {
    chrome.storage.session.set({ diagLog: [] }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// --- Logs (storage.session: cleared on every browser restart) ----------------
async function appendLog(entry) {
  const { cookieLog = [] } = await chrome.storage.session.get('cookieLog');
  cookieLog.push(entry);
  await chrome.storage.session.set({ cookieLog: cookieLog.slice(-100) });
}
async function appendDiag(line) {
  console.log('[FOMO Pocket]', line);
  const { diagLog = [] } = await chrome.storage.session.get('diagLog');
  diagLog.push(`${new Date().toLocaleTimeString()} ${line}`);
  await chrome.storage.session.set({ diagLog: diagLog.slice(-100) });
}

function logError(e) { console.error('[FOMO Pocket]', e); }
