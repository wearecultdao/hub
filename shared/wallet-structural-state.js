(() => {
  'use strict';

  if (window.CultWalletStructuralState) return;
  const cache = new Map();
  const STORAGE_KEYS = Object.freeze(['cultConnectedWalletOverview:v1', 'cultFundsPortfolioCacheV1']);
  const normalize = value => /^0x[a-fA-F0-9]{40}$/.test(value || '') ? value.toLowerCase() : '';
  const safeRatio = safe => {
    const threshold = Number(safe?.threshold || 0);
    const owners = Array.isArray(safe?.owners) ? safe.owners.length : Number(safe?.ownersCount || 0);
    return threshold > 0 && owners >= threshold ? `${threshold}/${owners}` : '';
  };
  const cachedSafes = address => {
    const safes = [];
    for (const storageKey of STORAGE_KEYS) {
      try {
        const store = JSON.parse(localStorage.getItem(storageKey) || 'null');
        for (const snapshot of Object.values(store || {})) {
          for (const entry of snapshot?.rows || []) {
            const [rowKey, row] = Array.isArray(entry) ? entry : ['', entry];
            if (rowKey) {
              if (!String(rowKey).toLowerCase().startsWith(`${address}:`)) continue;
            } else if (normalize(snapshot?.address) !== address) continue;
            if (row?.safe) safes.push(row.safe);
          }
        }
      } catch { /* Structural labels remain live-only if a cache is unavailable. */ }
    }
    return safes;
  };
  const primeSafe = (address, input = []) => {
    const key = normalize(address);
    if (!key) return null;
    const safes = (Array.isArray(input) ? input : [input]).filter(Boolean);
    const ratios = [...new Set(safes.map(safeRatio).filter(Boolean))];
    if (!ratios.length) {
      if (cache.delete(key)) window.dispatchEvent(new CustomEvent('cult-wallet-structural-state', { detail: { address: key, labels: [] } }));
      return null;
    }
    const signature = ratios.join('|');
    const previous = cache.get(key);
    if (previous?.signature === signature) return previous;
    const state = {
      address: key,
      signature,
      safeRatios: ratios,
      labels: ratios.map(ratio => ({ label: `Safe ${ratio}`, tone: 'positive', kind: 'safe' })),
      updatedAt: Date.now(),
    };
    cache.set(key, state);
    window.dispatchEvent(new CustomEvent('cult-wallet-structural-state', { detail: state }));
    return state;
  };
  const get = address => {
    const key = normalize(address);
    if (!key) return null;
    return cache.get(key) || primeSafe(key, cachedSafes(key));
  };
  const clear = address => primeSafe(address, []);

  window.CultWalletStructuralState = Object.freeze({ get, primeSafe, clear });
})();
