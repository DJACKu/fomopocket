// FOMO Pocket — content script (isolated world), document_start, all_frames.
// Only active when fomo.family is framed by our side panel.
//
// - sets html.fomo-pocket (enables frame/condense.css) and html.fp-view-<view>;
// - tags the site's blocks with data-fp="…" according to FP_SELECTORS (frame/selectors.js);
// - injects the view bar (Chart / Buy / Holders / Positions) and the feed/bottom divider;
// - reports matched / missing selectors to the panel;
// - unregisters any service worker still active;
// - listens to the panel (postMessage) for the "raw site" kill-switch.
(() => {
  try {
    const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
    const ancestor = location.ancestorOrigins?.[0] || '';
    if (ancestor !== EXT_ORIGIN) return;

    const html = document.documentElement;
    const VIEWS = ['chart', 'buy', 'holders', 'positions'];
    const VIEW_LABELS = { chart: 'Chart', buy: 'Buy', holders: 'Holders', positions: 'Positions' };
    const state = { view: 'chart', feedH: null, collapsed: false, condensed: true };

    html.classList.add('fomo-pocket');
    setView('chart');

    // --- Site service worker: never inside our frame ------------------------
    navigator.serviceWorker?.getRegistrations?.().then((regs) => {
      for (const r of regs) r.unregister().catch(() => {});
    }).catch(() => {});

    // --- Persisted settings ---------------------------------------------------
    chrome.storage.local.get(['fpView', 'fpFeedH', 'fpCollapsed']).then((s) => {
      if (VIEWS.includes(s.fpView)) setView(s.fpView);
      if (typeof s.fpFeedH === 'number') setFeedH(s.fpFeedH);
      if (s.fpCollapsed) setCollapsed(true);
    }).catch(() => {});

    function setView(v) {
      state.view = v;
      for (const x of VIEWS) html.classList.toggle(`fp-view-${x}`, x === v);
      document.querySelectorAll('[data-fp="toolbar"] button[data-view]').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === v);
      });
    }
    function setFeedH(px) {
      state.feedH = px;
      html.style.setProperty('--fp-feed-h', `${px}px`);
    }
    function setCollapsed(on) {
      state.collapsed = on;
      html.classList.toggle('fp-collapsed', on);
    }

    // --- Tagging the site's blocks -------------------------------------------
    let report = { matched: [], unmatched: [], expected: 0 };
    function applyTags() {
      const matched = [], unmatched = [];
      let tokenPage = false;
      for (const [key, def] of Object.entries(FP_SELECTORS)) {
        let els;
        try { els = Array.from(document.querySelectorAll(def.sel)); } catch { els = []; }
        if (def.filter) els = els.filter(def.filter);
        if (!def.all) els = els.slice(0, 1);
        if (els.length) {
          for (const el of els) if (el.dataset.fp !== key) el.dataset.fp = key;
          matched.push(key);
          if (key === 'main') tokenPage = true;
        } else if (def.scope === 'app' || (def.scope === 'token' && tokenPage && !def.optional)) {
          unmatched.push(key);
        }
      }
      report = { matched, unmatched, tokenPage, route: location.pathname, view: state.view };
      mountToolbar();
      mountDivider();
      scheduleReport();
    }

    let raf = 0;
    function scheduleApply() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; applyTags(); });
    }
    let reportTimer = 0;
    let lastReportKey = '';
    function scheduleReport(force) {
      clearTimeout(reportTimer);
      reportTimer = setTimeout(() => {
        // Only send when something changed (otherwise the panel log fills up).
        const key = JSON.stringify(report);
        if (!force && key === lastReportKey) return;
        lastReportKey = key;
        chrome.runtime.sendMessage({ type: 'fp-report', ...report }).catch(() => {});
      }, 600);
    }

    // --- View bar (fixed at the bottom of the frame, outside the React tree) --
    function mountToolbar() {
      if (!document.body || document.querySelector('[data-fp="toolbar"]')) return;
      const bar = document.createElement('div');
      bar.dataset.fp = 'toolbar';
      for (const v of VIEWS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.view = v;
        b.textContent = VIEW_LABELS[v];
        b.classList.toggle('active', v === state.view);
        b.addEventListener('click', () => {
          setView(v);
          if (state.collapsed) setCollapsed(false);
          chrome.storage.local.set({ fpView: v, fpCollapsed: false }).catch(() => {});
          scheduleReport();
        });
        bar.appendChild(b);
      }
      const col = document.createElement('button');
      col.type = 'button';
      col.dataset.action = 'collapse';
      col.title = 'Collapse / expand the bottom area';
      col.textContent = '⇅';
      col.addEventListener('click', () => {
        setCollapsed(!state.collapsed);
        chrome.storage.local.set({ fpCollapsed: state.collapsed }).catch(() => {});
      });
      bar.appendChild(col);
      document.body.appendChild(bar);
    }

    // --- Feed / bottom area divider (in body, between sidebar and main) ------
    function mountDivider() {
      const body = document.querySelector('[data-fp="body"]');
      const sidebar = document.querySelector('[data-fp="sidebar"]');
      if (!body || !sidebar) return;
      let div = body.querySelector(':scope > [data-fp="divider"]');
      if (div && div.previousElementSibling === sidebar) return;
      if (!div) {
        div = document.createElement('div');
        div.dataset.fp = 'divider';
        div.title = 'Drag to resize · double-click to collapse the bottom area';
        div.addEventListener('pointerdown', onDragStart);
        div.addEventListener('dblclick', () => {
          setCollapsed(!state.collapsed);
          chrome.storage.local.set({ fpCollapsed: state.collapsed }).catch(() => {});
        });
      }
      sidebar.after(div);
    }
    function onDragStart(e) {
      const sidebar = document.querySelector('[data-fp="sidebar"]');
      const body = document.querySelector('[data-fp="body"]');
      if (!sidebar || !body) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = sidebar.getBoundingClientRect().height;
      const max = body.getBoundingClientRect().height - 120;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const move = (ev) => setFeedH(Math.round(Math.min(max, Math.max(80, startH + ev.clientY - startY))));
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        chrome.storage.local.set({ fpFeedH: state.feedH }).catch(() => {});
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    }

    // --- Startup ----------------------------------------------------------------
    const start = () => {
      applyTags();
      new MutationObserver(scheduleApply).observe(document.body, { childList: true, subtree: true });
      // The router changes the URL without reloading: re-tag + report.
      let lastPath = location.pathname;
      setInterval(() => {
        if (location.pathname !== lastPath) { lastPath = location.pathname; scheduleApply(); }
      }, 500);
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });

    // --- Messages from the panel ------------------------------------------------
    window.addEventListener('message', (ev) => {
      if (ev.origin !== EXT_ORIGIN || !ev.data || ev.data.source !== 'fomo-pocket') return;
      if (ev.data.type === 'set-condense') {
        state.condensed = !!ev.data.on;
        html.classList.toggle('fomo-pocket', state.condensed);
      }
      if (ev.data.type === 'get-report') scheduleReport(true);
    });

    chrome.runtime.sendMessage({
      type: 'frame-hello',
      url: location.href,
      controlled: !!navigator.serviceWorker?.controller,
    }).catch(() => {});
  } catch (e) {
    console.warn('[FOMO Pocket] inject:', e);
  }
})();
