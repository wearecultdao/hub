(() => {
  'use strict';

  const currentScript = document.currentScript;
  const hubRoot = currentScript?.src ? new URL('../', currentScript.src) : new URL('./', window.location.href);
  const DATA_MANIFEST_URL = new URL('shared/historical-data-manifest.json', hubRoot);
  const PORTFOLIO_PRESET_URL = new URL('portfolio/dao-funds-presets.json', hubRoot);
  const GOVERNANCE_DATA_URL = new URL('governance/historical-cult-governance-data.json', hubRoot);
  const GOVERNANCE_CACHE_KEYS = Object.freeze([
    'cultWastedVotes:v6',
    'cultWastedVotes:v5',
    'cultWastedVotes:v4',
    'cultWastedVotes:v3',
    'cultWastedVotes:v2',
    'cultWastedVotes:v1',
  ]);
  const GOVERNANCE_CACHE_KEY = GOVERNANCE_CACHE_KEYS[0];
  const GOVERNANCE_DB_NAME = 'cultWastedVotesCache';
  const GOVERNANCE_DB_VERSION = 1;
  const GOVERNANCE_DB_STORE = 'caches';
  const LOCAL_STORAGE_CACHE_LIMIT = 4_500_000;
  const PORTFOLIO_DISMISSED_KEY = 'cultFundsDaoPresetDismissedVersion';
  const GOVERNANCE_DISMISSED_KEY = 'cultHubGovernanceHistoryDismissedVersion:v1';

  let pendingCases = [];
  let activeCase = null;
  let retryTimer = null;

  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  };

  const openGovernanceDb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = window.indexedDB.open(GOVERNANCE_DB_NAME, GOVERNANCE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GOVERNANCE_DB_STORE)) {
        request.result.createObjectStore(GOVERNANCE_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => reject(new Error('IndexedDB is busy in another tab'));
  });

  const readAllGovernanceCaches = async () => {
    const db = await openGovernanceDb();
    return new Promise((resolve, reject) => {
      const entries = [];
      const transaction = db.transaction(GOVERNANCE_DB_STORE, 'readonly');
      const request = transaction.objectStore(GOVERNANCE_DB_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        entries.push({ key: String(cursor.key), value: cursor.value });
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
      transaction.oncomplete = () => { db.close(); resolve(entries); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('IndexedDB read failed')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('IndexedDB read aborted')); };
    });
  };

  const writeGovernanceCache = async (value) => {
    const db = await openGovernanceDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(GOVERNANCE_DB_STORE, 'readwrite');
      transaction.objectStore(GOVERNANCE_DB_STORE).put(value, GOVERNANCE_CACHE_KEY);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('IndexedDB write failed')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('IndexedDB write aborted')); };
    });
  };

  const localStorageSnapshot = () => {
    const values = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null) values[key] = localStorage.getItem(key);
    }
    return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
  };

  const downloadJson = (value, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  async function backupAllJson(options = {}) {
    const reason = typeof options === 'string' ? options : String(options.reason || 'historical-data-update');
    const errors = [];
    let governanceCaches = [];
    let indexedDbError = null;
    try {
      governanceCaches = await readAllGovernanceCaches();
    } catch (error) {
      indexedDbError = error;
      errors.push(`Governance IndexedDB: ${error?.message || 'unavailable'}`);
    }

    const exportedAt = new Date();
    const payload = {
      app: 'cult-dao-hub',
      type: 'pre-update-browser-backup',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      reason,
      origin: window.location.origin,
      localStorage: localStorageSnapshot(),
      indexedDb: {
        [GOVERNANCE_DB_NAME]: {
          [GOVERNANCE_DB_STORE]: governanceCaches,
        },
      },
      errors,
    };
    const stamp = exportedAt.toISOString().replace(/[:.]/g, '-');
    const filename = `cult-hub-pre-update-backup-${stamp}.json`;
    downloadJson(payload, filename);
    if (indexedDbError) {
      throw new Error('The backup downloaded, but Governance browser storage could not be read; the update was stopped');
    }
    return { filename, payload };
  }

  const normalizeWallets = (wallets) => {
    if (!Array.isArray(wallets)) return [];
    const seen = new Set();
    return wallets.flatMap((wallet) => {
      const address = String(wallet?.address || '').trim();
      const key = address.toLowerCase();
      if (!/^0x[a-fA-F0-9]{40}$/.test(address) || seen.has(key)) return [];
      seen.add(key);
      return [{
        address,
        label: String(wallet?.label || '').slice(0, 60),
        note: String(wallet?.note || '').slice(0, 240),
      }];
    });
  };

  const normalizeHiddenAssets = (values) => Array.isArray(values)
    ? [...new Set(values.map(value => String(value || '').trim().toLowerCase()).filter(value => /^(ethereum|base|polygon):[^\s:]+$/.test(value)).slice(0, 500))]
    : [];

  const normalizePortfolioPreset = (value) => {
    if (!value || typeof value !== 'object') return null;
    let source = value;
    let version = String(value.version || '').trim();
    let snapshotDate = String(value.snapshotDate || '');
    if (Array.isArray(value.walletSets) && value.walletSets.length) {
      source = value.walletSets.find(set => String(set?.id) === 'dao-funds')
        || value.walletSets.find(set => String(set?.id) === String(value.activeWalletSetId || ''))
        || value.walletSets[0];
      const exportedAt = String(value.exportedAt || '').trim();
      version = exportedAt ? `export:${exportedAt}` : String(source?.presetVersion || value.version || '').trim();
      snapshotDate = (exportedAt.match(/^\d{4}-\d{2}-\d{2}/) || [])[0] || String(source?.presetSnapshotDate || '');
    }
    const wallets = normalizeWallets(source?.wallets);
    if (!version || !wallets.length) return null;
    return {
      version,
      snapshotDate,
      name: 'CULTDAO Funds',
      showTreasury: source?.showTreasury !== false,
      wallets,
      hiddenAssets: normalizeHiddenAssets(Array.isArray(source?.hiddenAssets) ? source.hiddenAssets : value.hiddenAssets),
    };
  };

  const formatDate = (value) => {
    if (!value) return 'an unknown date';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00Z`) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  };

  const applyPortfolioPreset = (preset) => {
    const store = readJson('cultFundsWalletSets');
    if (!store || !Array.isArray(store.sets)) throw new Error('The local wallet collections could not be read');
    const dao = store.sets.find(set => String(set?.id) === 'dao-funds');
    if (!dao) throw new Error('The local CULTDAO Funds collection is missing');

    const currentWallets = normalizeWallets(dao.wallets);
    const currentByAddress = new Map(currentWallets.map(wallet => [wallet.address.toLowerCase(), wallet]));
    const previousOfficial = normalizeWallets(dao.presetWallets);
    const previousByAddress = new Map(previousOfficial.map(wallet => [wallet.address.toLowerCase(), wallet]));
    const previousAddresses = new Set(
      (Array.isArray(dao.presetAddresses) && dao.presetAddresses.length ? dao.presetAddresses : previousOfficial.map(wallet => wallet.address))
        .map(address => String(address).toLowerCase()),
    );
    const nextAddresses = new Set(preset.wallets.map(wallet => wallet.address.toLowerCase()));
    const mergedOfficial = preset.wallets.map((wallet) => {
      const existing = currentByAddress.get(wallet.address.toLowerCase());
      const previous = previousByAddress.get(wallet.address.toLowerCase());
      if (!existing) return { ...wallet };
      return {
        ...wallet,
        label: !previous || existing.label !== previous.label ? existing.label : wallet.label,
        note: !previous || existing.note !== previous.note ? existing.note : wallet.note,
      };
    });
    const localAdditions = currentWallets.filter(wallet => (
      !previousAddresses.has(wallet.address.toLowerCase()) && !nextAddresses.has(wallet.address.toLowerCase())
    ));

    dao.name = preset.name;
    dao.showTreasury = preset.showTreasury;
    dao.wallets = normalizeWallets([...mergedOfficial, ...localAdditions]);
    dao.presetVersion = preset.version;
    dao.presetSnapshotDate = preset.snapshotDate;
    dao.presetAddresses = preset.wallets.map(wallet => wallet.address);
    dao.presetWallets = preset.wallets.map(wallet => ({ ...wallet }));
    localStorage.setItem('cultFundsWalletSets', JSON.stringify({ ...store, version: 2, sets: store.sets }));
    localStorage.setItem('cultFundsWallets', JSON.stringify(dao.wallets));
    if (preset.hiddenAssets.length) localStorage.setItem('cultFundsHiddenAssets', JSON.stringify(preset.hiddenAssets));
    else localStorage.removeItem('cultFundsHiddenAssets');
    localStorage.removeItem('cultFundsPortfolioCacheV1');
    localStorage.removeItem(PORTFOLIO_DISMISSED_KEY);
  };

  const hasUsefulDelegateDuty = (proposal) => {
    const duty = proposal?.delegateDuty;
    if (!duty || typeof duty !== 'object') return false;
    return proposal.delegateDutyIndexed === true
      || Number(duty.activeDelegateCount || 0) > 0
      || (Array.isArray(duty.absentDelegates) && duty.absentDelegates.length > 0)
      || (Array.isArray(duty.votedDelegates) && duty.votedDelegates.length > 0);
  };

  const hasHolderMetrics = (proposal) => [
    'snapshotHolderCount',
    'snapshotReadyHolderCount',
    'snapshotReadyDcultSupply',
    'snapshotGuardianHolderCount',
    'snapshotGuardianReadyHolderCount',
    'snapshotGuardianDcultSupply',
    'snapshotGuardianReadyDcultSupply',
  ].every(key => proposal && proposal[key] !== undefined);

  const hasDelegateOwnPower = (proposal) => {
    const duty = proposal?.delegateDuty;
    if (!duty || typeof duty !== 'object') return false;
    const rows = []
      .concat(Array.isArray(duty.absentDelegates) ? duty.absentDelegates : [])
      .concat(Array.isArray(duty.votedDelegates) ? duty.votedDelegates : []);
    return rows.every(row => row?.ownBalance !== undefined && row?.ownVotingPower !== undefined && row?.combinedVotingPower !== undefined);
  };

  const governanceScore = (cache) => {
    let score = Object.values(cache?.proposals || {}).reduce((total, proposal) => {
      let proposalScore = 1;
      if (Array.isArray(proposal?.zeroWallets)) proposalScore += 2;
      if (hasUsefulDelegateDuty(proposal)) proposalScore += 20;
      if (hasHolderMetrics(proposal)) proposalScore += 5;
      if (hasDelegateOwnPower(proposal)) proposalScore += 2;
      return total + proposalScore;
    }, 0);
    if (Array.isArray(cache?.guardianOverview?.rows) && cache.guardianOverview.rows.length) score += 15;
    return score;
  };

  const governanceCandidate = (cache, source) => {
    if (!cache?.proposals || typeof cache.proposals !== 'object') return null;
    const proposalCount = Object.keys(cache.proposals).length;
    if (!proposalCount) return null;
    return {
      cache,
      source,
      score: governanceScore(cache),
      proposalCount,
      updatedAt: Number(cache.updatedAt || 0),
      version: Number(cache.version || 0),
    };
  };

  const compareGovernanceCandidates = (left, right) => (
    (right.score - left.score)
    || (right.proposalCount - left.proposalCount)
    || (right.updatedAt - left.updatedAt)
  );

  const bestLocalGovernanceCandidate = async () => {
    const candidates = [];
    let indexedEntries = [];
    try { indexedEntries = await readAllGovernanceCaches(); } catch { /* Local storage remains available. */ }
    const indexedByKey = new Map(indexedEntries.map(entry => [entry.key, entry.value]));
    GOVERNANCE_CACHE_KEYS.forEach((key) => {
      const indexed = governanceCandidate(indexedByKey.get(key), 'indexed');
      if (indexed) candidates.push(indexed);
      const local = governanceCandidate(readJson(key), 'local');
      if (local) candidates.push(local);
    });
    candidates.sort(compareGovernanceCandidates);
    return candidates[0] || null;
  };

  const applyGovernanceHistory = async (publishedCache) => {
    let indexedSaved = false;
    let localSaved = false;
    try {
      await writeGovernanceCache(publishedCache);
      indexedSaved = true;
    } catch {
      // The local-storage fallback below is sufficient for smaller datasets.
    }
    const serialized = JSON.stringify(publishedCache);
    try {
      if (serialized.length <= LOCAL_STORAGE_CACHE_LIMIT) {
        localStorage.setItem(GOVERNANCE_CACHE_KEY, serialized);
        localSaved = true;
      } else {
        localStorage.removeItem(GOVERNANCE_CACHE_KEY);
      }
    } catch {
      // IndexedDB remains the primary cache for the large historical dataset.
    }
    if (!indexedSaved && !localSaved) throw new Error('The updated Governance dataset could not be saved');
    localStorage.removeItem(GOVERNANCE_DISMISSED_KEY);
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
  };

  const checkPortfolioUpdate = async (manifest) => {
    if (document.getElementById('dao-preset-update-dialog')) return null;
    const store = readJson('cultFundsWalletSets');
    const dao = Array.isArray(store?.sets) ? store.sets.find(set => String(set?.id) === 'dao-funds') : null;
    if (!dao?.presetVersion) return null;
    const published = manifest?.datasets?.portfolioPreset;
    const publishedVersion = String(published?.version || '');
    if (!publishedVersion || String(dao.presetVersion) === publishedVersion) return null;
    if (localStorage.getItem(PORTFOLIO_DISMISSED_KEY) === publishedVersion) return null;
    return {
      id: 'portfolio-preset',
      title: 'CULTDAO Funds update available',
      copy: `A newer published wallet snapshot from ${formatDate(published.snapshotDate)} is available. Local wallet names, notes, Safe-owner labels, and manually added wallets will be kept.`,
      signature: publishedVersion,
      dismissedKey: PORTFOLIO_DISMISSED_KEY,
      apply: async () => {
        const preset = normalizePortfolioPreset(await fetchJson(PORTFOLIO_PRESET_URL));
        if (!preset || preset.version !== publishedVersion) throw new Error('The Portfolio update manifest is out of sync');
        applyPortfolioPreset(preset);
      },
    };
  };

  const checkGovernanceUpdate = async (manifest) => {
    const installed = await bestLocalGovernanceCandidate();
    if (!installed) return null;
    const publishedMetadata = manifest?.datasets?.governanceHistory;
    const published = {
      version: Number(publishedMetadata?.version || 0),
      updatedAt: Number(publishedMetadata?.updatedAt || 0),
      proposalCount: Number(publishedMetadata?.proposalCount || 0),
      score: Number(publishedMetadata?.score || 0),
    };
    if (!published.version || !published.proposalCount || !published.score) return null;
    const isNewerVersion = published.version > installed.version;
    const isMoreUseful = compareGovernanceCandidates(published, installed) < 0;
    if (!isNewerVersion && !isMoreUseful) return null;
    const signature = [published.version, Number(publishedMetadata.exportedAt || published.updatedAt), published.proposalCount, published.score].join(':');
    if (localStorage.getItem(GOVERNANCE_DISMISSED_KEY) === signature) return null;
    return {
      id: 'governance-history',
      title: 'Governance history update available',
      copy: `A newer bundled Governance dataset is available with ${published.proposalCount.toLocaleString()} historical proposals and refreshed analytics.`,
      signature,
      dismissedKey: GOVERNANCE_DISMISSED_KEY,
      apply: async () => {
        const payload = await fetchJson(GOVERNANCE_DATA_URL);
        const publishedCache = payload?.cache || payload;
        const verified = governanceCandidate(publishedCache, 'static');
        if (!verified
          || verified.version !== published.version
          || verified.updatedAt !== published.updatedAt
          || verified.proposalCount !== published.proposalCount
          || verified.score !== published.score) {
          throw new Error('The Governance update manifest is out of sync');
        }
        await applyGovernanceHistory(publishedCache);
      },
    };
  };

  const updateDialog = () => {
    let dialog = document.getElementById('hub-historical-data-update-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'hub-historical-data-update-dialog';
    dialog.className = 'hub-identity-dialog';
    dialog.innerHTML = `
      <form>
        <h2 data-update-title>Historical data update</h2>
        <p class="dialog-help" data-update-copy></p>
        <p class="dialog-help"><strong>Safety first:</strong> before changing anything, the Hub will download one timestamped JSON backup containing all browser-local Hub data and every Governance cache entry.</p>
        <p class="dialog-help" data-update-status role="status" aria-live="polite"></p>
        <div class="dialog-actions">
          <button type="button" data-update-dismiss>Not now</button>
          <button type="submit" data-update-confirm>Back up &amp; update</button>
        </div>
      </form>`;
    document.body.append(dialog);
    const form = dialog.querySelector('form');
    const dismiss = dialog.querySelector('[data-update-dismiss]');
    const confirm = dialog.querySelector('[data-update-confirm]');
    const status = dialog.querySelector('[data-update-status]');
    dismiss.addEventListener('click', () => {
      if (activeCase) localStorage.setItem(activeCase.dismissedKey, activeCase.signature);
      activeCase = null;
      dialog.close();
      window.setTimeout(showNextUpdate, 0);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dismiss.click();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!activeCase) return;
      dismiss.disabled = true;
      confirm.disabled = true;
      status.textContent = 'Creating the complete JSON backup…';
      try {
        await backupAllJson({ reason: activeCase.id });
        status.textContent = 'Backup download started. Installing the update…';
        await activeCase.apply();
        status.textContent = 'Update installed. Reloading…';
        window.location.reload();
      } catch (error) {
        status.textContent = `${error?.message || 'The update could not finish'}. Review the downloaded backup before trying again.`;
        dismiss.disabled = false;
        confirm.disabled = false;
      }
    });
    return dialog;
  };

  const hasBlockingUi = () => {
    if (document.querySelector('dialog[open]:not(#hub-historical-data-update-dialog)')) return true;
    const disclaimer = document.getElementById('disclaimer-overlay');
    if (disclaimer && getComputedStyle(disclaimer).display !== 'none') return true;
    return [...document.querySelectorAll('[aria-modal="true"]')].some(element => (
      element.getAttribute('aria-hidden') !== 'true' && getComputedStyle(element).display !== 'none'
    ));
  };

  function showNextUpdate() {
    window.clearTimeout(retryTimer);
    if (activeCase || !pendingCases.length) return;
    if (hasBlockingUi()) {
      retryTimer = window.setTimeout(showNextUpdate, 500);
      return;
    }
    activeCase = pendingCases.shift();
    const dialog = updateDialog();
    dialog.querySelector('[data-update-title]').textContent = activeCase.title;
    dialog.querySelector('[data-update-copy]').textContent = activeCase.copy;
    dialog.querySelector('[data-update-status]').textContent = '';
    dialog.querySelector('[data-update-dismiss]').disabled = false;
    dialog.querySelector('[data-update-confirm]').disabled = false;
    dialog.showModal();
  }

  async function checkForUpdates() {
    if (window.location.protocol === 'file:') return [];
    const manifest = await fetchJson(DATA_MANIFEST_URL);
    if (Number(manifest?.version || 0) !== 1) return [];
    const results = await Promise.allSettled([checkPortfolioUpdate(manifest), checkGovernanceUpdate(manifest)]);
    pendingCases = results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    const discovered = pendingCases.map(update => update.id);
    showNextUpdate();
    return discovered;
  }

  window.CultHistoricalDataUpdates = Object.freeze({
    backupAllJson,
    checkForUpdates,
  });

  const start = () => window.setTimeout(() => { checkForUpdates().catch(() => {}); }, 900);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
