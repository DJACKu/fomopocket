// FOMO Pocket — MAIN world, document_start, inside the Privy iframe (auth.privy.io).
// Only activates when an ancestor is an extension page (our side panel).
// In a normal fomo.family tab: does nothing.
//
// Why: `embedded-wallets-*.js` filters every `privy:*` message with
//
//   [...location.ancestorOrigins].every(o => allowedOrigins.includes(o))
//
// `allowedDomains` comes from the FOMO app (fomo.family, privy.fomo.family, …) and
// will never contain our `chrome-extension://…`. Actual ancestor chain inside the
// panel: ["https://fomo.family", "chrome-extension://<id>"] → the test fails and the
// iframe answers "Frame ancestor is not allowed" to every wallet call. The parent
// SDK eventually gives up: "Wallet connection failed", Buy/Sell unusable.
//
// `location` and `location.ancestorOrigins` are [LegacyUnforgeable]: own,
// non-configurable properties, impossible to redefine. The returned list, however,
// is a DOMStringList, whose prototype is configurable like any WebIDL interface.
// We hide the `chrome-extension://` entries there: `length`, `item`, `contains` and
// the iterator (used by the `[...]` spread) see an ancestor chain reduced to
// fomo.family, the one Privy accepts.
//
// Patch scope: DOMStringList is also used by IndexedDB (`objectStoreNames`,
// `indexNames`). The filter only removes `chrome-extension://` strings, never a
// store name — no effect there.
(() => {
  const HIDDEN = /^chrome-extension:\/\//;
  try {
    const ancestors = location.ancestorOrigins;
    if (!ancestors || typeof DOMStringList === 'undefined') return;

    let framedByExtension = false;
    for (let i = 0; i < ancestors.length; i += 1) {
      if (HIDDEN.test(String(ancestors[i]))) { framedByExtension = true; break; }
    }
    if (!framedByExtension) return;

    const proto = DOMStringList.prototype;
    const lengthDesc = Object.getOwnPropertyDescriptor(proto, 'length');
    const rawLength = lengthDesc && lengthDesc.get;
    const rawItem = proto.item;
    if (typeof rawLength !== 'function' || typeof rawItem !== 'function') return;

    // Filtered view of a DOMStringList; [] if `this` is not one
    // (e.g. direct read on the prototype).
    const view = (list) => {
      let n;
      try { n = rawLength.call(list); } catch { return []; }
      const out = [];
      for (let i = 0; i < n; i += 1) {
        const value = rawItem.call(list, i);
        if (typeof value === 'string' && HIDDEN.test(value)) continue;
        out.push(value);
      }
      return out;
    };

    Object.defineProperty(proto, 'length', {
      configurable: true,
      enumerable: lengthDesc.enumerable,
      get() { return view(this).length; },
    });
    const method = (value) => ({ configurable: true, writable: true, enumerable: true, value });
    Object.defineProperty(proto, 'item', method(function item(index) {
      const value = view(this)[index];
      return value === undefined ? null : value;
    }));
    Object.defineProperty(proto, 'contains', method(function contains(needle) {
      return view(this).indexOf(String(needle)) !== -1;
    }));
    Object.defineProperty(proto, Symbol.iterator, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function values() { return view(this)[Symbol.iterator](); },
    });
  } catch (e) {
    console.warn('[FOMO Pocket] privy-ancestors:', e);
  }
})();
