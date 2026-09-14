// FOMO Pocket — MAIN world, document_start, only when fomo.family is framed by an
// extension page (our side panel). In a normal tab: does nothing.
//
// Why: the site's Workbox service worker intercepts navigations and performs the
// fetch itself. That internal request bypasses declarativeNetRequest, so the
// `frame-ancestors 'self'` CSP arrives intact and the frame is refused. We prevent
// the site from (re)registering its SW from inside our frame; the already-present SW
// is unregistered on the extension side (background/sw.js, "prepare-frame" message).
(() => {
  try {
    const ancestor = location.ancestorOrigins?.[0] || '';
    if (!ancestor.startsWith('chrome-extension://')) return;
    const sw = navigator.serviceWorker;
    if (!sw) return;
    Object.defineProperty(sw, 'register', {
      configurable: true,
      value: () => Promise.reject(new Error('[FOMO Pocket] service worker disabled inside the side panel')),
    });
  } catch (e) {
    console.warn('[FOMO Pocket] no-sw:', e);
  }
})();
