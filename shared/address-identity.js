(() => {
  'use strict';

  if (window.CultAddressIdentity) return;

  const STORAGE_KEY = 'cultHubAddressIdentity:v1';
  const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
  const listeners = new Set();
  let curated = {};

  const normalizeAddress = (address) => {
    const value = String(address || '').trim();
    return ADDRESS_PATTERN.test(value) ? value.toLowerCase() : '';
  };

  const normalizeLabels = (labels) => [...new Set((Array.isArray(labels) ? labels : String(labels || '').split(','))
    .map(label => String(label || '').trim().slice(0, 60))
    .filter(Boolean))].slice(0, 30);

  const normalizeRecord = (address, value = {}) => {
    const key = normalizeAddress(address);
    if (!key) return null;
    return {
      address: key,
      name: String(value.name ?? value.label ?? '').trim().slice(0, 60),
      description: String(value.description ?? value.note ?? '').trim().slice(0, 240),
      labels: normalizeLabels(value.labels ?? value.tags),
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  };

  const load = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const identities = {};
      if (parsed?.identities && typeof parsed.identities === 'object') {
        Object.entries(parsed.identities).forEach(([address, value]) => {
          const record = normalizeRecord(address, value);
          if (record) identities[record.address] = record;
        });
      }
      return { version: 2, identities };
    } catch {
      return { version: 2, identities: {} };
    }
  };

  let state = load();

  const persist = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Identities remain usable for this page. */ }
  };

  const notify = (address = '') => listeners.forEach((listener) => listener(address));

  const normalizeCuratedData = (value) => {
    const records = {};
    const ensure = (address) => {
      const key = normalizeAddress(address);
      if (!key) return null;
      if (!records[key]) records[key] = { address: key, name: '', description: '', labels: [], sources: [] };
      return records[key];
    };
    if (value?.identities && typeof value.identities === 'object') Object.entries(value.identities).forEach(([address, fields]) => {
      const record = ensure(address);
      if (!record) return;
      record.name = String(fields?.name ?? fields?.label ?? '').trim().slice(0, 60);
      record.description = String(fields?.description ?? fields?.note ?? '').trim().slice(0, 240);
      record.labels = normalizeLabels(fields?.labels ?? fields?.tags);
      if (fields?.source) record.sources.push(String(fields.source).trim().slice(0, 240));
    });
    if (Array.isArray(value?.labelSets)) value.labelSets.forEach((set) => {
      const labels = normalizeLabels(set?.labels ?? set?.tags);
      (set?.addresses || []).forEach((address) => {
        const record = ensure(address);
        if (!record) return;
        record.labels = normalizeLabels([...record.labels, ...labels]);
        if (!record.description && set?.description) record.description = String(set.description).trim().slice(0, 240);
        if (set?.source) record.sources.push(String(set.source).trim().slice(0, 240));
      });
    });
    Object.values(records).forEach(record => { record.sources = [...new Set(record.sources.filter(Boolean))]; });
    return records;
  };

  const mergedRecord = (address) => {
    const key = normalizeAddress(address);
    if (!key) return null;
    const local = state.identities[key];
    const permanent = curated[key];
    if (!local && !permanent) return null;
    const localLabels = local?.labels || [];
    const curatedLabels = permanent?.labels || [];
    return {
      address: key,
      name: local?.name || permanent?.name || '',
      description: local?.description || permanent?.description || '',
      labels: normalizeLabels([...curatedLabels, ...localLabels]),
      updatedAt: local?.updatedAt || 0,
      localName: local?.name || '',
      canonicalName: permanent?.name || '',
      localDescription: local?.description || '',
      canonicalDescription: permanent?.description || '',
      localLabels: [...localLabels],
      curatedLabels: [...curatedLabels],
      sources: [...(permanent?.sources || [])],
    };
  };

  const syncPortfolioStores = (record) => {
    try {
      const walletStore = JSON.parse(localStorage.getItem('cultFundsWalletSets') || 'null');
      let changed = false;
      if (Array.isArray(walletStore?.sets)) {
        walletStore.sets.filter((set) => !set.private).forEach((set) => (set.wallets || []).forEach((wallet) => {
          if (normalizeAddress(wallet.address) !== record.address) return;
          if (wallet.label !== record.name || wallet.note !== record.description) changed = true;
          wallet.label = record.name;
          wallet.note = record.description;
        }));
      }
      if (changed) localStorage.setItem('cultFundsWalletSets', JSON.stringify(walletStore));

      const aliases = JSON.parse(localStorage.getItem('cultFundsOwnerAliases') || '{}');
      if (aliases && typeof aliases === 'object' && Object.prototype.hasOwnProperty.call(aliases, record.address)) {
        if (record.name) aliases[record.address] = record.name;
        else delete aliases[record.address];
        localStorage.setItem('cultFundsOwnerAliases', JSON.stringify(aliases));
      }
    } catch {
      // Portfolio's module-owned stores remain untouched if their local payload is unavailable.
    }
  };

  const set = (address, fields = {}, options = {}) => {
    const key = normalizeAddress(address);
    if (!key) throw new Error('Invalid Ethereum address');
    const current = state.identities[key] || { address: key, name: '', description: '', labels: [], updatedAt: 0 };
    const record = normalizeRecord(key, {
      name: fields.name ?? current.name,
      description: fields.description ?? current.description,
      labels: fields.labels ?? fields.tags ?? current.labels,
      updatedAt: Date.now(),
    });
    if (record.name || record.description || record.labels.length) state.identities[key] = record;
    else delete state.identities[key];
    persist();
    if (options.syncPortfolio !== false) syncPortfolioStores(record);
    notify(key);
    return mergedRecord(key);
  };

  const normalizeImport = (value) => {
    if (!value || typeof value !== 'object') throw new Error('This file does not contain address labels');
    const entries = Array.isArray(value.identities)
      ? value.identities.map(record => [record?.address, record])
      : value.identities && typeof value.identities === 'object'
        ? Object.entries(value.identities)
        : [];
    if (!entries.length) throw new Error('This file does not contain address labels');
    if (entries.length > 5000) throw new Error('This label file is too large');
    const identities = {};
    entries.forEach(([address, fields]) => {
      const record = normalizeRecord(address, fields);
      if (!record) return;
      const current = identities[record.address];
      if (!current || record.updatedAt >= current.updatedAt) identities[record.address] = record;
    });
    if (!Object.keys(identities).length) throw new Error('No valid Ethereum address labels were found');
    return identities;
  };

  const previewImport = (value) => {
    const identities = normalizeImport(value);
    const records = Object.values(identities);
    return {
      count: records.length,
      newCount: records.filter(record => !state.identities[record.address]).length,
      conflictCount: records.filter(record => state.identities[record.address]).length,
    };
  };

  const importData = (value, options = {}) => {
    const incoming = normalizeImport(value);
    const mode = ['keep', 'newer', 'replace'].includes(options.mode) ? options.mode : 'keep';
    const previous = state.identities;
    const next = mode === 'replace' ? {} : { ...previous };
    let added = 0;
    let updated = 0;
    let kept = 0;

    Object.values(incoming).forEach((record) => {
      const current = previous[record.address];
      if (!current) {
        next[record.address] = record;
        added += 1;
        return;
      }
      if (mode === 'keep') {
        kept += 1;
        return;
      }
      if (mode === 'newer' && record.updatedAt <= current.updatedAt) {
        kept += 1;
        return;
      }
      next[record.address] = record;
      updated += 1;
    });

    const removed = mode === 'replace' ? Object.keys(previous).filter(address => !incoming[address]) : [];
    state = { version: 2, identities: next };
    persist();
    removed.forEach(address => syncPortfolioStores({ address, name: '', description: '' }));
    Object.values(next).forEach(record => {
      if (!previous[record.address] || previous[record.address] !== record) syncPortfolioStores(record);
    });
    notify();
    return { mode, added, updated, kept, removed: removed.length, total: Object.keys(next).length };
  };

  const exportData = () => ({
    app: 'cult-hub-address-identity',
    version: 2,
    exportedAt: new Date().toISOString(),
    identities: Object.values(state.identities)
      .map(record => ({ ...record, labels: [...record.labels] }))
      .sort((a, b) => a.address.localeCompare(b.address)),
  });

  const seedPortfolio = () => {
    let changed = false;
    try {
      const walletStore = JSON.parse(localStorage.getItem('cultFundsWalletSets') || 'null');
      const activeId = localStorage.getItem('cultFundsActiveWalletSet') || walletStore?.activeId;
      const sets = Array.isArray(walletStore?.sets) ? [...walletStore.sets] : [];
      sets.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
      sets.filter((set) => !set.private).forEach((set) => (set.wallets || []).forEach((wallet) => {
        const key = normalizeAddress(wallet.address);
        if (!key || Object.prototype.hasOwnProperty.call(state.identities, key) || (!wallet.label && !wallet.note)) return;
        state.identities[key] = normalizeRecord(key, wallet);
        changed = true;
      }));

      const aliases = JSON.parse(localStorage.getItem('cultFundsOwnerAliases') || '{}');
      if (aliases && typeof aliases === 'object') Object.entries(aliases).forEach(([address, name]) => {
        const key = normalizeAddress(address);
        if (!key || Object.prototype.hasOwnProperty.call(state.identities, key) || !String(name || '').trim()) return;
        state.identities[key] = normalizeRecord(key, { name });
        changed = true;
      });
    } catch {
      // Seeding is additive and optional.
    }
    if (changed) persist();
  };

  seedPortfolio();

  const scriptSource = typeof document !== 'undefined' ? document.currentScript?.src : '';
  const ready = typeof fetch === 'function' && scriptSource
    ? fetch(new URL('curated-addresses.json', scriptSource), { cache: 'no-cache' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`Curated address request failed (${response.status})`)))
      .then(value => { curated = normalizeCuratedData(value); notify(); return Object.keys(curated).length; })
      .catch(error => { console.warn('Curated address labels unavailable', error); return 0; })
    : Promise.resolve(0);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = load();
    notify();
  });

  window.CultAddressIdentity = Object.freeze({
    storageKey: STORAGE_KEY,
    ready,
    normalizeAddress,
    get: mergedRecord,
    getLocal(address) {
      const record = state.identities[normalizeAddress(address)];
      return record ? { ...record, labels: [...record.labels] } : null;
    },
    getCurated(address) {
      const record = curated[normalizeAddress(address)];
      return record ? { ...record, labels: [...record.labels], sources: [...record.sources] } : null;
    },
    list() {
      const addresses = new Set([...Object.keys(curated), ...Object.keys(state.identities)]);
      return [...addresses].map(mergedRecord).filter(Boolean);
    },
    set,
    previewImport,
    importData,
    exportData,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
})();
