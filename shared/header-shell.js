(() => {
  'use strict';

  const CURRENCIES = Object.freeze({
    usd: 'USD', eur: 'EUR', gbp: 'GBP', jpy: 'JPY', aud: 'AUD', cad: 'CAD',
    chf: 'CHF', btc: 'BTC', eth: 'ETH', xau: 'Gold', xag: 'Silver',
  });
  const SHARED_KEY = 'cultHubCurrency:v1';
  const WALLET_KEY = 'cultHubWalletSession:v1';
  const CONNECTED_WALLET_ICON = '<svg class="connected-wallet-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"><rect width="256" height="256" fill="none"/><path d="M216,64H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,56V184a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm-36,80a12,12,0,1,1,12-12A12,12,0,0,1,180,144Z"/></svg>';
  const renderConnectedWalletButton = (button, address, title = address) => {
    if (!button || !/^0x[a-fA-F0-9]{40}$/.test(address || '')) return false;
    button.classList.add('is-wallet-connected');
    button.innerHTML = CONNECTED_WALLET_ICON;
    button.title = title || address;
    button.setAttribute('aria-label', `Connected wallet ${address}`);
    return true;
  };

  const renderDisconnectedWalletButton = (button, label = 'Connect Wallet', title = 'Connect wallet') => {
    if (!button) return;
    button.classList.remove('is-wallet-connected');
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', label);
  };

  window.CultWalletButton = Object.freeze({
    renderConnected: renderConnectedWalletButton,
    renderDisconnected: renderDisconnectedWalletButton,
  });

  const readWalletSession = () => {
    try {
      const value = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null');
      return value?.connected && /^0x[a-fA-F0-9]{40}$/.test(value.address || '')
        ? { connected: true, address: value.address, updatedAt: Number(value.updatedAt) || 0 }
        : { connected: false, address: '', updatedAt: Number(value?.updatedAt) || 0 };
    } catch {
      return { connected: false, address: '', updatedAt: 0 };
    }
  };

  const writeWalletSession = (connected, address = '') => {
    const session = {
      connected: Boolean(connected && /^0x[a-fA-F0-9]{40}$/.test(address)),
      address: connected && /^0x[a-fA-F0-9]{40}$/.test(address) ? address : '',
      updatedAt: Date.now(),
    };
    localStorage.setItem(WALLET_KEY, JSON.stringify(session));
    window.dispatchEvent(new CustomEvent('cult-hub-wallet-session', { detail: session }));
    return session;
  };

  window.CultWalletSession = Object.freeze({
    storageKey: WALLET_KEY,
    read: readWalletSession,
    connect: address => writeWalletSession(true, address),
    disconnect: () => writeWalletSession(false),
  });

  const normalize = value => Object.hasOwn(CURRENCIES, String(value || '').toLowerCase())
    ? String(value).toLowerCase()
    : '';

  const initialCurrency = () => normalize(localStorage.getItem('fundsCurrency'))
    || normalize(localStorage.getItem(SHARED_KEY))
    || normalize(localStorage.getItem('preferredCurrency'))
    || 'usd';

  const saveCurrency = (currency) => {
    const normalized = normalize(currency) || 'usd';
    localStorage.setItem(SHARED_KEY, normalized);
    localStorage.setItem('fundsCurrency', normalized);
    localStorage.setItem('preferredCurrency', normalized);
    return normalized;
  };

  const init = () => {
    const actions = document.querySelector('body > .container > .header .header-actions');
    const widget = document.getElementById('currency-widget');
    const button = document.getElementById('currency-selector-btn');
    const dropdown = document.getElementById('currency-dropdown');
    if (!actions || !widget || !button || !dropdown) return;

    widget.classList.add('global-currency-widget');
    button.classList.add('global-currency-button');
    dropdown.classList.add('global-header-dropdown', 'global-currency-menu');
    const nativeSelect = document.getElementById('currency');
    if (nativeSelect) nativeSelect.hidden = true;
    const moduleMenuToggle = document.getElementById('menu-toggle');
    const moduleMenu = document.getElementById('menu') || document.getElementById('utility-menu');
    const closeModuleMenu = () => {
      moduleMenu?.classList.remove('open', 'show');
      moduleMenuToggle?.setAttribute('aria-expanded', 'false');
    };

    const render = (currency) => {
      const normalized = normalize(currency) || 'usd';
      button.textContent = CURRENCIES[normalized];
      button.dataset.currency = normalized;
      dropdown.querySelectorAll('[data-currency]').forEach((item) => {
        item.setAttribute('aria-current', item.dataset.currency === normalized ? 'true' : 'false');
      });
    };

    dropdown.innerHTML = Object.entries(CURRENCIES).map(([currency, label]) =>
      `<button class="dropdown-item" type="button" data-currency="${currency}">${label}</button>`).join('');

    const selected = saveCurrency(initialCurrency());
    render(selected);

    if (widget.dataset.currencyOwner !== 'hub') {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        closeModuleMenu();
        actions.querySelector('.wallet-dropdown.show')?.classList.remove('show');
        document.querySelectorAll('.global-header-dropdown.show').forEach((menu) => {
          if (menu !== dropdown) menu.classList.remove('show');
        });
        dropdown.classList.toggle('show');
        button.setAttribute('aria-expanded', String(dropdown.classList.contains('show')));
      });
    }

    dropdown.addEventListener('click', (event) => {
      const item = event.target.closest('[data-currency]');
      if (!item) return;
      const currency = saveCurrency(item.dataset.currency);
      render(currency);
      if (nativeSelect && nativeSelect.value !== currency) {
        nativeSelect.value = currency;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => {
          const applied = normalize(nativeSelect.value) || currency;
          saveCurrency(applied);
          render(applied);
        }, 1800);
      }
      dropdown.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (event) => {
      if (widget.contains(event.target)) return;
      dropdown.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
    });

    window.addEventListener('storage', (event) => {
      if (![SHARED_KEY, 'fundsCurrency', 'preferredCurrency'].includes(event.key)) return;
      render(initialCurrency());
    });

    const walletWidget = actions.querySelector('.wallet-widget');
    const walletButton = walletWidget?.querySelector('#connect-wallet-btn');
    const walletMenu = walletWidget?.querySelector('.wallet-dropdown');
    const walletCopy = walletWidget?.querySelector('[data-shared-wallet-copy]');
    const walletExplorer = walletWidget?.querySelector('[data-shared-wallet-explorer]');
    const walletDisconnect = walletWidget?.querySelector('[data-shared-wallet-disconnect]');
    const renderWallet = (session = readWalletSession()) => {
      if (!walletWidget || !walletButton) return;
      if (session.connected) renderConnectedWalletButton(walletButton, session.address);
      else renderDisconnectedWalletButton(walletButton);
      if (walletExplorer) walletExplorer.href = session.connected ? `https://etherscan.io/address/${session.address}` : '#';
      if (!session.connected) walletMenu?.classList.remove('show');
    };
    renderWallet();
    if (walletButton) {
      let restoringConnectedMarkup = false;
      new MutationObserver(() => {
        if (restoringConnectedMarkup || walletButton.querySelector('.connected-wallet-icon')) return;
        const text = walletButton.textContent.trim();
        const session = readWalletSession();
        if (!session.connected || ['Connect Wallet', 'Copied'].includes(text)) return;
        restoringConnectedMarkup = true;
        renderConnectedWalletButton(walletButton, session.address, walletButton.title || session.address);
        restoringConnectedMarkup = false;
      }).observe(walletButton, { childList: true, characterData: true, subtree: true });
    }

    moduleMenuToggle?.addEventListener('click', () => {
      dropdown.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
      walletMenu?.classList.remove('show');
    });
    walletButton?.addEventListener('click', () => {
      dropdown.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
      closeModuleMenu();
    });

    document.addEventListener('click', (event) => {
      if (moduleMenu && !moduleMenu.contains(event.target) && !moduleMenuToggle?.contains(event.target)) closeModuleMenu();
      if (walletWidget && !walletWidget.contains(event.target)) walletMenu?.classList.remove('show');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      dropdown.classList.remove('show');
      button.setAttribute('aria-expanded', 'false');
      closeModuleMenu();
      walletMenu?.classList.remove('show');
      moduleMenuToggle?.focus();
    });

    if (walletWidget?.dataset.walletOwner === 'shared' && walletButton && walletMenu) {
      walletButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        const session = readWalletSession();
        if (session.connected) {
          walletMenu.classList.toggle('show');
          return;
        }
        if (!window.ethereum) {
          window.alert('Please install MetaMask or another Ethereum wallet.');
          return;
        }
        try {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          const address = Array.isArray(accounts) ? accounts[0] : '';
          renderWallet(writeWalletSession(true, address));
        } catch (error) {
          console.warn('Wallet connection was not completed.', error);
        }
      });
      walletCopy?.addEventListener('click', async () => {
        const session = readWalletSession();
        if (session.connected) await navigator.clipboard.writeText(session.address);
        walletMenu.classList.remove('show');
      });
      walletDisconnect?.addEventListener('click', () => {
        renderWallet(writeWalletSession(false));
        walletMenu.classList.remove('show');
      });
      document.addEventListener('click', (event) => {
        if (walletWidget.contains(event.target)) return;
        walletMenu.classList.remove('show');
      });
    }

    window.addEventListener('cult-hub-wallet-session', event => renderWallet(event.detail));
    window.addEventListener('storage', (event) => {
      if (event.key !== WALLET_KEY) return;
      const wasConnected = walletButton && walletButton.textContent !== 'Connect Wallet';
      const session = readWalletSession();
      renderWallet(session);
      const owner = walletWidget?.dataset.walletOwner;
      if (!['hub', 'governance'].includes(owner)) return;
      if (!session.connected && wasConnected) {
        if (owner === 'hub') window.location.reload();
        else walletWidget.querySelector('#disconnect-btn')?.click();
      } else if (session.connected && !wasConnected) {
        walletButton?.click();
      }
    });

    const sharedMenuToggle = document.querySelector('[data-shared-menu-toggle]');
    const sharedMenu = document.querySelector('[data-shared-menu]');
    if (sharedMenuToggle && sharedMenu) {
      sharedMenuToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = sharedMenu.classList.toggle('show');
        sharedMenuToggle.setAttribute('aria-expanded', String(isOpen));
      });
      document.addEventListener('click', (event) => {
        if (sharedMenu.contains(event.target) || sharedMenuToggle.contains(event.target)) return;
        sharedMenu.classList.remove('show');
        sharedMenuToggle.setAttribute('aria-expanded', 'false');
      });
    }

    const exportLabelsButton = document.getElementById('export-address-labels');
    const importLabelsButton = document.getElementById('import-address-labels');
    const importLabelsFile = document.getElementById('import-address-labels-file');
    const exportCollectionsButton = document.getElementById('export-wallet-collections');
    const importCollectionsButton = document.getElementById('import-wallet-collections');
    const importCollectionsFile = document.getElementById('import-wallet-collections-file');
    let pendingLabelImport = null;
    const closeSharedMenu = () => {
      sharedMenu?.classList.remove('show');
      sharedMenuToggle?.setAttribute('aria-expanded', 'false');
    };
    const downloadJson = (payload, filename) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const importDialog = () => {
      let dialog = document.getElementById('hub-identity-import-dialog');
      if (dialog) return dialog;
      dialog = document.createElement('dialog');
      dialog.id = 'hub-identity-import-dialog';
      dialog.className = 'hub-identity-dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <h2>Import address labels</h2>
          <p class="dialog-help" data-import-summary></p>
          <label data-import-mode-label>How should existing labels be handled?
            <select data-import-mode>
              <option value="keep">Keep local labels</option>
              <option value="newer">Merge newer records</option>
              <option value="replace">Replace label book</option>
            </select>
          </label>
          <p class="dialog-help" data-import-help></p>
          <div class="dialog-actions">
            <button type="button" data-import-cancel>Cancel</button>
            <button type="submit" data-import-confirm>Import</button>
          </div>
        </form>`;
      document.body.append(dialog);
      const form = dialog.querySelector('form');
      const mode = dialog.querySelector('[data-import-mode]');
      const modeLabel = dialog.querySelector('[data-import-mode-label]');
      const help = dialog.querySelector('[data-import-help]');
      const cancel = dialog.querySelector('[data-import-cancel]');
      const confirm = dialog.querySelector('[data-import-confirm]');
      const helpText = {
        keep: 'Adds labels that are missing here. Your existing labels are never overwritten.',
        newer: 'Uses the most recently edited record when the same address exists in both books.',
        replace: 'Replaces this browser’s complete label book. Labels absent from the file are removed.',
      };
      const renderHelp = () => { help.textContent = helpText[mode.value]; };
      mode.addEventListener('change', renderHelp);
      renderHelp();
      cancel.addEventListener('click', () => dialog.close());
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (form.dataset.complete === 'true') {
          dialog.close();
          return;
        }
        if (!pendingLabelImport || !window.CultAddressIdentity) return;
        const result = window.CultAddressIdentity.importData(pendingLabelImport, { mode: mode.value });
        dialog.querySelector('[data-import-summary]').textContent = `Import complete: ${result.added} added, ${result.updated} updated, ${result.kept} kept, ${result.removed} removed.`;
        modeLabel.hidden = true;
        help.hidden = true;
        cancel.hidden = true;
        confirm.textContent = 'Done';
        form.dataset.complete = 'true';
      });
      return dialog;
    };
    const openImportDialog = (payload, preview) => {
      const dialog = importDialog();
      const form = dialog.querySelector('form');
      const mode = dialog.querySelector('[data-import-mode]');
      const modeLabel = dialog.querySelector('[data-import-mode-label]');
      const help = dialog.querySelector('[data-import-help]');
      const cancel = dialog.querySelector('[data-import-cancel]');
      const confirm = dialog.querySelector('[data-import-confirm]');
      pendingLabelImport = payload;
      form.dataset.complete = 'false';
      mode.value = 'keep';
      modeLabel.hidden = false;
      help.hidden = false;
      help.textContent = 'Adds labels that are missing here. Your existing labels are never overwritten.';
      cancel.hidden = false;
      confirm.textContent = 'Import';
      dialog.querySelector('[data-import-summary]').textContent = `${preview.count} valid labels found: ${preview.newCount} new and ${preview.conflictCount} already present.`;
      dialog.showModal();
    };

    exportLabelsButton?.addEventListener('click', () => {
      closeSharedMenu();
      if (!window.CultAddressIdentity) return;
      downloadJson(window.CultAddressIdentity.exportData(), `cult-hub-address-labels-${new Date().toISOString().slice(0, 10)}.json`);
    });
    importLabelsButton?.addEventListener('click', () => {
      closeSharedMenu();
      importLabelsFile?.click();
    });
    importLabelsFile?.addEventListener('change', async () => {
      const file = importLabelsFile.files?.[0];
      importLabelsFile.value = '';
      if (!file || !window.CultAddressIdentity) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('The selected file is larger than 2 MB');
        const payload = JSON.parse(await file.text());
        openImportDialog(payload, window.CultAddressIdentity.previewImport(payload));
      } catch (error) {
        const dialog = importDialog();
        const form = dialog.querySelector('form');
        form.dataset.complete = 'true';
        dialog.querySelector('[data-import-summary]').textContent = error?.message || 'This label file could not be read.';
        dialog.querySelector('[data-import-mode-label]').hidden = true;
        dialog.querySelector('[data-import-help]').hidden = true;
        dialog.querySelector('[data-import-cancel]').hidden = true;
        const confirm = dialog.querySelector('[data-import-confirm]');
        confirm.textContent = 'Done';
        dialog.showModal();
      }
    });

    let pendingCollectionImport = null;
    const normalizePortfolioAddress = (value) => {
      const address = String(value || '').trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return '';
      try { return window.ethers?.utils?.getAddress ? window.ethers.utils.getAddress(address) : address; }
      catch { return ''; }
    };
    const normalizeIdentityLabels = (labels) => [...new Set((Array.isArray(labels) ? labels : String(labels || '').split(','))
      .map(label => String(label || '').trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
    const normalizePrivateIdentities = (value) => {
      const identities = {};
      if (!value || typeof value !== 'object') return identities;
      Object.entries(value).forEach(([address, fields]) => {
        const key = normalizePortfolioAddress(address).toLowerCase();
        if (!key) return;
        const record = {
          name: String(fields?.name || '').trim().slice(0, 60),
          description: String(fields?.description || '').trim().slice(0, 240),
          labels: normalizeIdentityLabels(fields?.labels),
          updatedAt: Number(fields?.updatedAt) || Date.now(),
        };
        if (record.name || record.description || record.labels.length) identities[key] = record;
      });
      return identities;
    };
    const normalizePortfolioWallets = (wallets) => {
      if (!Array.isArray(wallets)) return [];
      const seen = new Set();
      return wallets.flatMap((wallet) => {
        const address = normalizePortfolioAddress(wallet?.address);
        const key = address.toLowerCase();
        if (!address || seen.has(key)) return [];
        seen.add(key);
        const normalized = {
          address,
          label: String(wallet?.label || '').slice(0, 60),
          note: String(wallet?.note || '').slice(0, 240),
        };
        const labels = normalizeIdentityLabels(wallet?.labels);
        if (labels.length) normalized.labels = labels;
        return [normalized];
      });
    };
    const normalizeCollectionPayload = (value) => {
      if (!value || !Array.isArray(value.walletSets) || !value.walletSets.length) {
        throw new Error('This file does not contain wallet collections');
      }
      const sets = value.walletSets.map((set, index) => {
        const id = String(set?.id || `set-${index + 1}`);
        const normalizedSet = {
          id,
          name: id === 'dao-funds' ? 'CULTDAO Funds' : String(set?.name || `Wallet Collection ${index + 1}`).slice(0, 40),
          wallets: normalizePortfolioWallets(set?.wallets),
          showTreasury: typeof set?.showTreasury === 'boolean' ? set.showTreasury : id === 'dao-funds',
          private: id === 'dao-funds' ? false : Boolean(set?.private),
        };
        const privateIdentities = id === 'dao-funds' ? {} : normalizePrivateIdentities(set?.privateIdentities);
        if (Object.keys(privateIdentities).length) normalizedSet.privateIdentities = privateIdentities;
        if (id === 'dao-funds') {
          normalizedSet.presetVersion = String(set?.presetVersion || '');
          normalizedSet.presetSnapshotDate = String(set?.presetSnapshotDate || '');
          normalizedSet.presetAddresses = normalizePortfolioWallets((set?.presetAddresses || []).map(address => ({ address }))).map(wallet => wallet.address);
          normalizedSet.presetWallets = normalizePortfolioWallets(set?.presetWallets);
        }
        return normalizedSet;
      });
      const requested = String(value.activeWalletSetId || '');
      const activeId = sets.some(set => set.id === requested) ? requested : sets[0].id;
      const ownerAliases = {};
      if (value.ownerAliases && typeof value.ownerAliases === 'object') {
        Object.entries(value.ownerAliases).forEach(([address, label]) => {
          const normalizedAddress = normalizePortfolioAddress(address);
          const normalizedLabel = String(label || '').trim().slice(0, 60);
          if (normalizedAddress && normalizedLabel) ownerAliases[normalizedAddress.toLowerCase()] = normalizedLabel;
        });
      }
      const hiddenAssets = Array.isArray(value.hiddenAssets)
        ? [...new Set(value.hiddenAssets.map(item => String(item || '').trim().toLowerCase()).filter(item => /^(ethereum|base|polygon):[^\s:]+$/.test(item)).slice(0, 500))]
        : null;
      return {
        sets,
        activeId,
        ownerAliases,
        hiddenAssets,
        currency: normalize(value.currency),
        walletCount: sets.reduce((sum, set) => sum + set.wallets.length, 0),
      };
    };
    const currentCollectionExport = () => {
      let store;
      try { store = JSON.parse(localStorage.getItem('cultFundsWalletSets') || 'null'); }
      catch { throw new Error('The stored wallet collections could not be read'); }
      const shareableSets = Array.isArray(store?.sets) ? store.sets.filter((set) => !set?.private) : [];
      if (!shareableSets.length) throw new Error('There are no non-private wallet collections to export');
      const normalized = normalizeCollectionPayload({
        walletSets: shareableSets,
        activeWalletSetId: store?.activeId || localStorage.getItem('cultFundsActiveWalletSet'),
      });
      let hiddenAssets = [];
      let ownerAliases = {};
      try {
        const hidden = JSON.parse(localStorage.getItem('cultFundsHiddenAssets') || '[]');
        if (Array.isArray(hidden)) hiddenAssets = hidden;
        const aliases = JSON.parse(localStorage.getItem('cultFundsOwnerAliases') || '{}');
        if (aliases && typeof aliases === 'object') ownerAliases = aliases;
      } catch { /* Invalid optional metadata is omitted from the export. */ }
      return {
        app: 'portfolio-tracker',
        version: 4,
        exportedAt: new Date().toISOString(),
        activeWalletSetId: normalized.activeId,
        walletSets: normalized.sets,
        hiddenAssets,
        ownerAliases,
        currency: normalize(localStorage.getItem('fundsCurrency')) || initialCurrency(),
      };
    };
    const applyCollectionImport = (imported) => {
      localStorage.setItem('cultFundsWalletSets', JSON.stringify({ version: 2, activeId: imported.activeId, sets: imported.sets }));
      localStorage.setItem('cultFundsActiveWalletSet', imported.activeId);
      localStorage.setItem('cultFundsOwnerAliases', JSON.stringify(imported.ownerAliases));
      if (imported.hiddenAssets) {
        if (imported.hiddenAssets.length) localStorage.setItem('cultFundsHiddenAssets', JSON.stringify(imported.hiddenAssets));
        else localStorage.removeItem('cultFundsHiddenAssets');
      }
      if (imported.currency) {
        saveCurrency(imported.currency);
        render(imported.currency);
      }
      localStorage.removeItem('cultFundsPortfolioCacheV1');
      const active = imported.sets.find(set => set.id === imported.activeId);
      if (active?.id === 'dao-funds') localStorage.setItem('cultFundsWallets', JSON.stringify(active.wallets));
      imported.sets.filter(set => !set.private).forEach(set => set.wallets.forEach((wallet) => {
        if (!window.CultAddressIdentity || window.CultAddressIdentity.get(wallet.address) || (!wallet.label && !wallet.note)) return;
        window.CultAddressIdentity.set(wallet.address, { name: wallet.label, description: wallet.note }, { syncPortfolio: false });
      }));
      window.dispatchEvent(new CustomEvent('cult-hub-portfolio-collections', { detail: { activeId: imported.activeId } }));
      return { collections: imported.sets.length, wallets: imported.walletCount };
    };
    const collectionDialog = () => {
      let dialog = document.getElementById('hub-collections-import-dialog');
      if (dialog) return dialog;
      dialog = document.createElement('dialog');
      dialog.id = 'hub-collections-import-dialog';
      dialog.className = 'hub-identity-dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <h2 data-collections-title>Import wallet collections</h2>
          <p class="dialog-help" data-collections-summary></p>
          <p class="dialog-help" data-collections-help>This uses Portfolio Tracker’s version 4 dataset format and replaces the local wallet collections and collection labels in this browser.</p>
          <div class="dialog-actions">
            <button type="button" data-collections-cancel>Cancel</button>
            <button type="submit" data-collections-confirm>Import</button>
          </div>
        </form>`;
      document.body.append(dialog);
      const form = dialog.querySelector('form');
      const cancel = dialog.querySelector('[data-collections-cancel]');
      const confirm = dialog.querySelector('[data-collections-confirm]');
      cancel.addEventListener('click', () => dialog.close());
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (form.dataset.complete === 'true') {
          dialog.close();
          return;
        }
        if (!pendingCollectionImport) return;
        const result = applyCollectionImport(pendingCollectionImport);
        dialog.querySelector('[data-collections-summary]').textContent = `Import complete: ${result.collections} collection${result.collections === 1 ? '' : 's'} and ${result.wallets} wallet${result.wallets === 1 ? '' : 's'} loaded.`;
        dialog.querySelector('[data-collections-help]').hidden = true;
        cancel.hidden = true;
        confirm.textContent = 'Done';
        form.dataset.complete = 'true';
      });
      return dialog;
    };
    const showCollectionDialog = (title, summary, imported = null) => {
      const dialog = collectionDialog();
      const form = dialog.querySelector('form');
      const help = dialog.querySelector('[data-collections-help]');
      const cancel = dialog.querySelector('[data-collections-cancel]');
      const confirm = dialog.querySelector('[data-collections-confirm]');
      pendingCollectionImport = imported;
      dialog.querySelector('[data-collections-title]').textContent = title;
      dialog.querySelector('[data-collections-summary]').textContent = summary;
      form.dataset.complete = String(!imported);
      help.hidden = !imported;
      cancel.hidden = !imported;
      confirm.textContent = imported ? 'Import' : 'Done';
      dialog.showModal();
    };

    exportCollectionsButton?.addEventListener('click', () => {
      closeSharedMenu();
      try { downloadJson(currentCollectionExport(), 'portfolio-tracker-wallet-collections.json'); }
      catch (error) { showCollectionDialog('Export wallet collections', error?.message || 'The collection dataset could not be exported.'); }
    });
    importCollectionsButton?.addEventListener('click', () => {
      closeSharedMenu();
      importCollectionsFile?.click();
    });
    importCollectionsFile?.addEventListener('change', async () => {
      const file = importCollectionsFile.files?.[0];
      importCollectionsFile.value = '';
      if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('The selected file is larger than 2 MB');
        const imported = normalizeCollectionPayload(JSON.parse(await file.text()));
        showCollectionDialog('Import wallet collections', `${imported.sets.length} collection${imported.sets.length === 1 ? '' : 's'} containing ${imported.walletCount} wallet${imported.walletCount === 1 ? '' : 's'} found.`, imported);
      } catch (error) {
        showCollectionDialog('Import wallet collections', error instanceof SyntaxError ? 'Invalid JSON file' : error?.message || 'The collection dataset could not be read.');
      }
    });
  };

  const start = () => setTimeout(init, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
