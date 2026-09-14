// FOMO Pocket — side panel page
// Only does: host the iframe, show whether it loaded, display the cookie / diagnostics log.

const frame = document.getElementById('frame');
const dot = document.getElementById('dot');
const log = document.getElementById('log');
const soundGate = document.getElementById('soundGate');

// Version comes from the manifest so the header never drifts from it.
const AUTHOR = 'by @0xDJACK';
document.getElementById('version').textContent = `${chrome.runtime.getManifest().version} - ${AUTHOR}`;

function say(line) {
  log.textContent += `${new Date().toLocaleTimeString()} ${line}\n`;
  log.scrollTop = log.scrollHeight;
}

// The load event fires even when the frame is blocked (Chrome error page),
// so "green" here only means "a response arrived". Auth is checked visually.
frame.addEventListener('load', () => {
  dot.className = 'dot green';
  dot.title = 'Frame loaded (auth: check visually)';
  say('frame: load');
  // Sound overlay: disappears on the first click inside the frame (user gesture → autoplay unlocked).
  soundGate.hidden = false;
});

// A click inside a cross-origin iframe does not bubble up to the parent; we detect the
// parent document losing focus to the frame as the "first interaction".
window.addEventListener('blur', () => {
  if (document.activeElement === frame && !soundGate.hidden) {
    soundGate.hidden = true;
    say('interaction: user gesture received, autoplay unlocked');
  }
});

const FOMO_URL = 'https://fomo.family/';

// Mandatory sequence: unregister the site's service worker, THEN navigate.
// Otherwise it serves the page with the original frame-ancestors CSP and the frame is refused.
// The service worker also picks the entry URL.
async function loadFrame() {
  dot.className = 'dot';
  const r = await chrome.runtime.sendMessage({ type: 'prepare-frame' }).catch((e) => ({ ok: false, error: e.message }));
  say(r.ok ? 'site sw: unregistered, loading the frame' : `site sw: failed (${r.error}), trying anyway`);
  frame.src = r.url || FOMO_URL;
}

function reloadFrame() {
  say('frame: reload');
  loadFrame();
}

document.getElementById('reload').onclick = reloadFrame;

// Log hidden by default; click the version number to show it.
document.getElementById('version').onclick = () => {
  log.hidden = !log.hidden;
  if (!log.hidden) {
    log.scrollTop = log.scrollHeight;
    frame.contentWindow?.postMessage({ source: 'fomo-pocket', type: 'get-report' }, FOMO_URL);
  }
};

// "Raw site" kill-switch: removes/restores html.fomo-pocket inside the frame via postMessage
// (the content script checks the sender's chrome-extension:// origin).
let condensed = true;
const rawBtn = document.getElementById('raw');
rawBtn.onclick = () => {
  condensed = !condensed;
  rawBtn.style.opacity = condensed ? '' : '.5';
  frame.contentWindow?.postMessage({ source: 'fomo-pocket', type: 'set-condense', on: condensed }, FOMO_URL);
  say(`css: ${condensed ? 'FOMO Pocket profile active' : 'raw site'}`);
};

document.getElementById('cookies').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: 'relax-cookies' });
  say(`cookies: ${r.inspected} inspected, ${r.rewritten} rewritten${r.error ? ' — ' + r.error : ''}`);
  await showCookieLog();
  reloadFrame();
};

document.getElementById('tab').onclick = () => {
  chrome.runtime.sendMessage({ type: 'open-fomo-tab' });
};

async function showCookieLog() {
  const { cookieLog = [] } = await chrome.storage.session.get('cookieLog');
  for (const e of cookieLog) say(`cookie rewritten: ${e.name} (${e.domain}) ${e.from} → ${e.to}`);
  if (!cookieLog.length) say('cookies: no rewrite logged');
}

// Selector report sent by frame/inject.js: green = everything found, amber = some missing.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'fp-report') return;
  const total = msg.matched.length + msg.unmatched.length;
  if (msg.unmatched.length) {
    dot.className = 'dot amber';
    dot.title = `${msg.unmatched.length}/${total} selectors not found: ${msg.unmatched.join(', ')} — fix frame/selectors.js`;
    say(`selectors: ${msg.unmatched.length}/${total} missing (${msg.unmatched.join(', ')}) on ${msg.route}`);
  } else {
    dot.className = 'dot green';
    dot.title = `Frame OK · ${total} selectors found · view ${msg.view} · ${msg.route}`;
  }
});

// DNR + network diagnostics: active rulesets, dynamic rules, match test,
// and what webRequest saw go through for the frame.
async function showDnrStatus() {
  const s = await chrome.runtime.sendMessage({ type: 'dnr-status' });
  say(`dnr: rulesets=${JSON.stringify(s.enabledRulesets)} dynamic=${JSON.stringify(s.dynamicRules)} testMatch=${JSON.stringify(s.testMatch)} testMatchPrivy=${JSON.stringify(s.testMatchPrivy)}`);
  for (const l of s.diagLog) say(l);
  if (!s.diagLog.length) say('net: no webRequest sub_frame event seen (response served by a site service worker?)');
}
document.getElementById('dnr').onclick = showDnrStatus;

// Startup: cookies → unregister the site's SW → frame → diagnostics.
chrome.runtime.sendMessage({ type: 'clear-diag' })
  .then(() => chrome.runtime.sendMessage({ type: 'relax-cookies' }))
  .then((r) => { say(`cookies: ${r.inspected} inspected, ${r.rewritten} rewritten`); return showCookieLog(); })
  .catch((e) => say(`sw: unreachable (${e.message})`))
  .then(loadFrame);
frame.addEventListener('load', () => setTimeout(showDnrStatus, 800), { once: true });
