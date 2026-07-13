(() => {
  'use strict';

  const host = document.getElementById('connected-wallet-overview');
  if (!host || typeof window.ethers === 'undefined') return;

  const CACHE_KEY = 'cultConnectedWalletOverview:v1';
  const PORTFOLIO_CACHE_KEY = 'cultFundsPortfolioCacheV1';
  const FRESH_MS = 2 * 60 * 1000;
  const ASSET_THRESHOLD_LEVELS = [0, .01, .1, 1, 10, 100, 1000, 10000, 100000];
  const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
  const CULT = '0xf0f9d895aca5c8678f706fb8216fa22957685a13';
  const DCULT = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
  const SAFE_ABI = ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'];
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';
  const PENCIL_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M96 216H48a8 8 0 0 1-8-8v-44.69a8 8 0 0 1 2.34-5.65L165.66 34.34a8 8 0 0 1 11.31 0L221.66 79a8 8 0 0 1 0 11.31Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M216 216H96M136 64l56 56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>';
  const TAG_ICON = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M42.34 138.34A8 8 0 0 1 40 132.69V40h92.69a8 8 0 0 1 5.65 2.34l99.32 99.32a8 8 0 0 1 0 11.31L153 237.66a8 8 0 0 1-11.31 0Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="84" cy="84" r="12" fill="currentColor"/></svg>';
  const CHAINS = {
    ethereum: {
      name: 'Ethereum', native: 'ETH', priceId: 'ethereum', indexer: 'https://eth.blockscout.com', explorer: 'https://etherscan.io/address/',
      rpc: ['https://ethereum.publicnode.com', 'https://cloudflare-eth.com'],
    },
    base: {
      name: 'Base', native: 'ETH', priceId: 'ethereum', indexer: 'https://base.blockscout.com', explorer: 'https://basescan.org/address/',
      rpc: ['https://mainnet.base.org', 'https://base.publicnode.com'],
    },
    polygon: {
      name: 'Polygon', native: 'POL', priceId: 'matic-network', indexer: 'https://polygon.blockscout.com', explorer: 'https://polygonscan.com/address/',
      rpc: ['https://polygon.blockscout.com/api/eth-rpc', 'https://polygon-bor-rpc.publicnode.com'],
    },
  };

  let activeAddress = '';
  let snapshot = null;
  let statusText = 'Waiting for wallet data';
  let scanVersion = 0;

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const short = address => `${address.slice(0, 6)}...${address.slice(-4)}`;
  const readJson = (key, fallback = null) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  };
  const selectedCurrency = () => document.getElementById('currency-selector-btn')?.dataset.currency
    || localStorage.getItem('cultHubCurrency:v1')
    || localStorage.getItem('fundsCurrency')
    || 'usd';
  const sessionAddress = () => {
    const shared = window.CultWalletSession?.read?.();
    if (shared?.connected && ADDRESS_PATTERN.test(shared.address || '')) return ethers.utils.getAddress(shared.address.toLowerCase());
    const stored = readJson('cultHubWalletSession:v1');
    return stored?.connected && ADDRESS_PATTERN.test(stored.address || '') ? ethers.utils.getAddress(stored.address.toLowerCase()) : '';
  };
  const parseDisplayNumber = (value) => {
    let text = String(value || '').replace(/[^0-9,.-]/g, '');
    if (text.includes(',') && text.includes('.')) {
      text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (text.includes(',')) {
      const fraction = text.split(',').pop();
      text = fraction.length <= 3 ? text.replace(',', '.') : text.replace(/,/g, '');
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  };
  const formatAmount = (value, digits = 4) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
  const formatMoney = (value, currency = selectedCurrency()) => {
    const amount = Number(value) || 0;
    const crypto = { btc: ['BTC', 8], eth: ['ETH', 6], xau: ['XAU', 6], xag: ['XAG', 4] }[currency];
    if (crypto) return `${amount.toLocaleString(undefined, { maximumFractionDigits: crypto[1] })} ${crypto[0]}`;
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount); }
    catch { return `${formatAmount(amount, 2)} ${String(currency).toUpperCase()}`; }
  };
  const unitValue = asset => asset?.priced && Number(asset.amount) > 0 ? Number(asset.value) / Number(asset.amount) : 0;
  const assetKey = asset => asset.positionTokenId
    ? `${asset.chain}:univ3:${asset.positionTokenId}`
    : `${asset.chain}:${String(asset.address || asset.symbol).toLowerCase()}`;
  const isCultProtocolAsset = asset => asset?.chain === 'ethereum' && [CULT, DCULT].includes(String(asset.address || '').toLowerCase());
  const hiddenAssetKeys = () => new Set(readJson('cultFundsHiddenAssets', []));
  const assetValueThreshold = () => {
    const index = Math.max(0, Math.min(ASSET_THRESHOLD_LEVELS.length - 1, Number(localStorage.getItem('cultFundsAssetThresholdIndex') ?? 3)));
    return ASSET_THRESHOLD_LEVELS[index] || 0;
  };
  const walletValueThreshold = () => Number(localStorage.getItem('cultFundsWalletThreshold') ?? 0) || 0;
  const displayName = asset => asset.name || asset.symbol || 'Unknown asset';
  const assetIconUrl = asset => {
    if (assetKey(asset) === `ethereum:${DCULT}`) return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${ethers.utils.getAddress(CULT)}/logo.png`;
    if (/^https?:\/\//i.test(asset.icon || '')) return asset.icon;
    const chainFolder = { ethereum: 'ethereum', base: 'base', polygon: 'polygon' }[asset.chain];
    if (asset.type === 'Native') return chainFolder ? `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainFolder}/info/logo.png` : '';
    if (!chainFolder || !ADDRESS_PATTERN.test(asset.address || '')) return '';
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainFolder}/assets/${ethers.utils.getAddress(asset.address)}/logo.png`;
  };
  const assetIconMarkup = asset => {
    const fallback = String(asset.symbol || displayName(asset) || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
    const url = assetIconUrl(asset);
    return `<span class="connected-wallet-token-icon" aria-hidden="true"><span>${escapeHtml(fallback)}</span>${url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  };

  const identityFor = (address) => window.CultAddressIdentity?.get?.(address) || null;
  const labelFor = address => identityFor(address)?.name || short(address);
  const hubProtocol = () => {
    const readinessNode = document.getElementById('voting-readiness');
    return {
      delegation: document.getElementById('delegation-status')?.textContent?.trim() || 'Checking delegation',
      readiness: readinessNode?.textContent?.trim() || 'Checking readiness',
      readinessClass: readinessNode?.classList.contains('readiness-ready') ? 'is-ready'
        : readinessNode?.classList.contains('readiness-guardian') ? 'is-guardian'
          : readinessNode?.classList.contains('readiness-needs-delegation') ? 'is-warning' : '',
      rights: document.getElementById('proposal-rights')?.textContent?.trim() || 'Checking rights',
      guardianThreshold: document.getElementById('top50staker')?.textContent?.trim() || '...',
      cult: parseDisplayNumber(document.getElementById('cult-balance')?.textContent),
      dcult: parseDisplayNumber(document.getElementById('dcult-balance')?.textContent),
      combined: parseDisplayNumber(document.getElementById('total-cult-holdings')?.textContent),
    };
  };

  const portfolioSnapshot = (address, currency) => {
    const store = readJson(PORTFOLIO_CACHE_KEY, {});
    const candidates = Object.values(store || {}).filter(entry => entry?.currency === currency && Array.isArray(entry.rows)).sort((a, b) => Number(b.savedAt) - Number(a.savedAt));
    for (const entry of candidates) {
      const rows = entry.rows.filter(([key]) => String(key).toLowerCase().startsWith(`${address.toLowerCase()}:`)).map(([, row]) => row);
      if (!rows.length) continue;
      return {
        address,
        currency,
        updatedAt: Number(entry.savedAt) || 0,
        source: 'Portfolio cache',
        rows,
        assets: rows.flatMap(row => row.assets || []),
      };
    }
    return null;
  };

  const ownCachedSnapshot = (address, currency) => {
    const store = readJson(CACHE_KEY, {});
    const cached = store?.[`${address.toLowerCase()}:${currency}`];
    if (cached?.address?.toLowerCase() !== address.toLowerCase()) return null;
    return { ...cached, assets: Array.isArray(cached.assets) && cached.assets.length ? cached.assets : (cached.rows || []).flatMap(row => row.assets || []) };
  };
  const saveSnapshot = (value) => {
    try {
      const store = readJson(CACHE_KEY, {});
      store[`${value.address.toLowerCase()}:${value.currency}`] = value;
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch { /* The live card remains usable when local cache storage is full. */ }
  };

  const mergedAssets = (includeHidden = false) => {
    const protocol = hubProtocol();
    const assets = (snapshot?.assets || []).map(asset => ({ ...asset }));
    const mergeProtocolAsset = (address, symbol, name, amount) => {
      const index = assets.findIndex(asset => asset.chain === 'ethereum' && String(asset.address || '').toLowerCase() === address);
      if (index >= 0) {
        const rate = unitValue(assets[index]);
        assets[index].amount = amount;
        if (rate > 0) assets[index].value = amount * rate;
      } else if (amount > 0) {
        assets.push({ chain: 'ethereum', address, symbol, name, amount, value: 0, type: 'Token', priced: false });
      }
    };
    mergeProtocolAsset(CULT, 'CULT', 'Cult DAO', protocol.cult);
    mergeProtocolAsset(DCULT, 'dCULT', 'dCULT - Staked CULT', protocol.dcult);
    const deduplicated = new Map();
    const hidden = hiddenAssetKeys();
    assets.forEach(asset => {
      if (!(Number(asset.amount) > 0)) return;
      const key = assetKey(asset);
      if (!includeHidden && hidden.has(key) && !isCultProtocolAsset(asset)) return;
      const current = deduplicated.get(key);
      if (!current || Number(asset.value) > Number(current.value)) deduplicated.set(key, asset);
    });
    return [...deduplicated.values()].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  };

  const safeRows = () => (snapshot?.rows || []).filter(row => row.safe?.owners?.length);
  const render = () => {
    if (!activeAddress) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    const identity = identityFor(activeAddress);
    const discoveredAssets = mergedAssets();
    const threshold = assetValueThreshold();
    const assets = discoveredAssets.filter(asset => isCultProtocolAsset(asset) || !(asset.priced && Number(asset.value || 0) < threshold));
    const discoveredAssetCount = discoveredAssets.length;
    const safes = safeRows();
    window.CultWalletStructuralState?.primeSafe?.(activeAddress, safes.map(row => row.safe));
    const structuralLabels = window.CultWalletStructuralState?.get?.(activeAddress)?.labels || [];
    const total = discoveredAssets.reduce((sum, asset) => sum + (Number(asset.value) || 0), 0);
    const allNetworksLoaded = (snapshot?.rows || []).length >= Object.keys(CHAINS).length;
    if (allNetworksLoaded && total < walletValueThreshold()) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const chains = [...new Set((snapshot?.rows || []).filter(row => row.assets?.length || row.safe).map(row => CHAINS[row.chain]?.name).filter(Boolean))];
    const networkSummary = window.CultNetworkSummary?.summarize(chains) || null;
    const identityTooltipData = window.CultIdentityPresentation?.get?.(activeAddress, identity?.name || '') || { address: activeAddress, name: identity?.name || '', ens: /\.eth$/i.test(identity?.name || '') ? identity.name : '', roles: [], localLabels: identity?.localLabels || [], description: identity?.localDescription || '', sources: [] };
    const identityTooltipValue = escapeHtml(JSON.stringify(identityTooltipData));
    const identityLabelTitle = [identityTooltipData.name || short(activeAddress), activeAddress, identityTooltipData.roles?.length ? `Roles: ${identityTooltipData.roles.join(', ')}` : '', identityTooltipData.localLabels?.length ? `My labels: ${identityTooltipData.localLabels.join(', ')}` : '', identityTooltipData.description].filter(Boolean).join('\n');
    const cardOpen = host.querySelector('.connected-wallet-card')?.open ?? false;
    const hiddenCount = hiddenAssetKeys().size;
    const assetRows = assets.map(asset => {
      const chain = CHAINS[asset.chain]?.name || asset.chain || 'Unknown network';
      const unit = unitValue(asset);
      return `<div class="connected-wallet-asset-row">
        <span class="connected-wallet-asset-identity">${assetIconMarkup(asset)}<span class="connected-wallet-asset-copy"><strong>${escapeHtml(displayName(asset))}</strong><small>${escapeHtml(asset.symbol || '')} · ${escapeHtml(asset.type || 'Token')} · ${escapeHtml(chain)}</small></span></span>
        <span class="connected-wallet-asset-number">${unit > 0 ? formatMoney(unit, snapshot?.currency) : '—'}</span>
        <span class="connected-wallet-asset-number">${formatAmount(asset.amount)}</span>
        <span class="connected-wallet-asset-number">${asset.priced ? formatMoney(asset.value, snapshot?.currency) : 'Unpriced'}</span>
        ${isCultProtocolAsset(asset) ? '<span aria-hidden="true"></span>' : `<button class="connected-wallet-hide-asset" type="button" data-connected-wallet-hide="${escapeHtml(assetKey(asset))}" title="Hide ${escapeHtml(displayName(asset))} everywhere" aria-label="Hide ${escapeHtml(displayName(asset))} everywhere">×</button>`}
      </div>`;
    }).join('');
    const safeMarkup = safes.map(row => `<div class="connected-wallet-asset-row connected-wallet-safe-row">
      <span class="connected-wallet-asset-identity"><strong>Safe owners · threshold ${Number(row.safe.threshold)}/${row.safe.owners.length}</strong></span>
      <span class="connected-wallet-safe-owners">${row.safe.owners.map(owner => `<span class="connected-wallet-owner-line"><a href="${CHAINS[row.chain]?.explorer || CHAINS.ethereum.explorer}${escapeHtml(owner)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(owner)}">${escapeHtml(labelFor(owner))}</a><button class="connected-wallet-icon-button" type="button" data-connected-wallet-copy-address="${escapeHtml(owner)}" title="Copy owner address" aria-label="Copy owner address ${escapeHtml(owner)}">${COPY_ICON}</button></span>`).join('')}</span>
    </div>`).join('');
    const totalDisplay = total > 0 ? formatMoney(total, snapshot?.currency) : document.getElementById('total-cult-value')?.textContent?.trim() || '—';
    host.innerHTML = `<details class="connected-wallet-card" ${cardOpen ? 'open' : ''}><summary class="connected-wallet-head">
      <div class="connected-wallet-identity">
        <span class="connected-wallet-title-line" data-identity-tooltip="${identityTooltipValue}"><strong>My wallet</strong></span>
        <span class="connected-wallet-address-line"><a class="connected-wallet-address" data-hub-identity-address="${activeAddress.toLowerCase()}" data-identity-tooltip="${identityTooltipValue}" href="${CHAINS.ethereum.explorer}${activeAddress}" target="_blank" rel="noopener noreferrer">${short(activeAddress)}</a><button class="connected-wallet-icon-button" type="button" data-connected-wallet-copy title="Copy address" aria-label="Copy connected wallet address">${COPY_ICON}</button><button class="hub-identity-edit" type="button" data-address="${activeAddress}" data-fallback-name="${escapeHtml(identity?.name || '')}" title="Edit wallet details" aria-label="Edit wallet details for ${activeAddress}">${PENCIL_ICON}</button>${identityTooltipData.localLabels?.length || identityTooltipData.roles?.length || structuralLabels.length ? `<span class="hub-identity-label-indicator${identityTooltipData.localLabels?.length ? ' has-local-labels' : identityTooltipData.roles?.length ? ' has-curated-labels' : ' has-dynamic-labels'}" data-address="${activeAddress.toLowerCase()}" data-identity-tooltip="${identityTooltipValue}" aria-label="${escapeHtml(identityLabelTitle)}">${TAG_ICON}</span>` : ''}</span>
        ${identity?.localDescription ? `<p class="connected-wallet-description">${escapeHtml(identity.localDescription)}</p>` : ''}
      </div>
      <div class="connected-wallet-pills">
        ${safes.map(row => `<span class="connected-wallet-pill is-safe">Safe ${Number(row.safe.threshold)}/${row.safe.owners.length}</span>`).join('')}
        ${networkSummary ? `<span class="connected-wallet-pill network-summary" tabindex="0" data-network-tooltip="${escapeHtml(networkSummary.tooltip)}" aria-label="${escapeHtml(`${networkSummary.label}. ${networkSummary.tooltip}`)}">${escapeHtml(networkSummary.label)}</span>` : ''}
      </div>
      <div class="connected-wallet-value"><strong>${escapeHtml(totalDisplay)}</strong></div>
      <button class="connected-wallet-collapse" type="button" data-connected-wallet-toggle title="Expand wallet assets" aria-label="Expand connected wallet assets" aria-expanded="${String(cardOpen)}"><span>▼</span></button>
    </summary>
    <div class="connected-wallet-assets"><div class="connected-wallet-asset-count">${assets.length} / ${discoveredAssetCount} assets</div><div class="connected-wallet-assets-list">${assetRows}${safeMarkup || ''}${!assetRows && !safeMarkup ? '<p class="connected-wallet-empty">Connected wallet assets are loading.</p>' : ''}</div></div></details>`;
    const restoreHint = document.getElementById('restore-hidden-assets-shared-hint');
    if (restoreHint) restoreHint.textContent = hiddenCount ? `${hiddenCount} asset${hiddenCount === 1 ? '' : 's'} hidden globally.` : 'No manually hidden assets.';
    host.querySelectorAll('.connected-wallet-token-icon img').forEach(image => {
      image.addEventListener('load', () => image.parentElement?.classList.add('has-image'), { once: true });
      image.addEventListener('error', () => image.remove(), { once: true });
    });
  };

  const withTimeout = (promise, milliseconds, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds))]);
  const fetchJson = async (url, milliseconds = 8000) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), milliseconds);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  };
  const providerFor = async chain => {
    for (const url of CHAINS[chain].rpc) {
      try {
        const provider = new ethers.providers.JsonRpcProvider(url);
        await withTimeout(provider.getBlockNumber(), 6000, `${chain} RPC`);
        return provider;
      } catch { /* Try the next shared Portfolio RPC. */ }
    }
    throw new Error(`No ${chain} RPC available`);
  };
  const fetchRates = async currency => {
    const ids = 'ethereum,matic-network,cult-dao';
    const quotes = currency === 'usd' ? 'usd' : `usd,${currency}`;
    const payload = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${quotes}`);
    const selectedPerUsd = currency === 'usd' ? 1 : Number(payload.ethereum?.[currency]) / Number(payload.ethereum?.usd);
    return {
      fx: Number.isFinite(selectedPerUsd) && selectedPerUsd > 0 ? selectedPerUsd : 1,
      ethereum: Number(payload.ethereum?.[currency] ?? payload.ethereum?.usd) || 0,
      'matic-network': Number(payload['matic-network']?.[currency] ?? payload['matic-network']?.usd) || 0,
      cult: Number(payload['cult-dao']?.[currency] ?? payload['cult-dao']?.usd) || 0,
    };
  };
  const scanChain = async (chain, address, rates) => {
    const config = CHAINS[chain];
    const row = { chain, assets: [], safe: null, error: null };
    const providerPromise = providerFor(chain).catch(error => { row.error = error.message; return null; });
    const indexedPromise = fetchJson(`${config.indexer}/api/v2/addresses/${address}/token-balances`).catch(error => { row.error ||= error.message; return []; });
    const [provider, indexed] = await Promise.all([providerPromise, indexedPromise]);
    const fx = rates.fx || 1;
    (Array.isArray(indexed) ? indexed : indexed?.items || []).forEach(item => {
      const token = item.token || {};
      const type = token.type || 'ERC-20';
      if (type === 'ERC-721' || type === 'ERC-1155') return;
      const decimals = Number(token.decimals || 0);
      const amount = Number(ethers.utils.formatUnits(item.value || '0', decimals));
      if (!(amount > 0)) return;
      const tokenAddress = String(token.address_hash || '').toLowerCase();
      const symbol = tokenAddress === DCULT ? 'dCULT' : token.symbol || token.name || 'Unknown';
      const indexedRate = Number(token.exchange_rate || 0) * fx;
      const specialRate = tokenAddress === CULT || tokenAddress === DCULT ? rates.cult : 0;
      const rate = indexedRate > 0 ? indexedRate : specialRate;
      if (!(rate > 0) && ![CULT, DCULT].includes(tokenAddress)) return;
      row.assets.push({ chain, address: tokenAddress, name: tokenAddress === DCULT ? 'dCULT - Staked CULT' : token.name || symbol, symbol, icon: token.icon_url || null, amount, value: amount * rate, type: 'Token', priced: rate > 0 });
    });
    if (provider) {
      const [nativeRaw, code] = await Promise.all([
        withTimeout(provider.getBalance(address), 7000, `${chain} native balance`).catch(() => null),
        withTimeout(provider.getCode(address), 7000, `${chain} contract code`).catch(() => null),
      ]);
      if (nativeRaw) {
        const amount = Number(ethers.utils.formatEther(nativeRaw));
        const rate = rates[config.priceId] || 0;
        if (amount > 0) row.assets.unshift({ chain, address: '', name: config.native, symbol: config.native, amount, value: amount * rate, type: 'Native', priced: rate > 0 });
      }
      if (code && code !== '0x') {
        try {
          const safe = new ethers.Contract(address, SAFE_ABI, provider);
          const [owners, threshold] = await Promise.all([withTimeout(safe.getOwners(), 7000, 'Safe owners'), withTimeout(safe.getThreshold(), 7000, 'Safe threshold')]);
          row.safe = { owners, threshold: Number(threshold) };
        } catch { /* A contract wallet does not have to be a Safe. */ }
      }
    }
    return row;
  };

  const refresh = async (force = false) => {
    if (!activeAddress) return;
    const version = ++scanVersion;
    const currency = selectedCurrency();
    if (!force && snapshot && Date.now() - Number(snapshot.updatedAt) < FRESH_MS && snapshot.currency === currency) return;
    statusText = snapshot ? 'Cached data · refreshing…' : 'Scanning wallet…';
    render();
    try {
      const rates = await fetchRates(currency).catch(() => ({ fx: 1, ethereum: 0, 'matic-network': 0, cult: 0 }));
      const results = await Promise.allSettled(Object.keys(CHAINS).map(chain => scanChain(chain, activeAddress, rates)));
      if (version !== scanVersion) return;
      const rows = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      snapshot = { address: activeAddress, currency, updatedAt: Date.now(), source: 'Connected wallet scan', rows, assets: rows.flatMap(row => row.assets || []) };
      saveSnapshot(snapshot);
      const available = rows.filter(row => !row.error || row.assets.length || row.safe).length;
      statusText = `Updated · ${available}/${Object.keys(CHAINS).length} networks`;
    } catch (error) {
      statusText = snapshot ? 'Cached data shown' : 'Wallet scan unavailable';
      console.warn('Connected wallet overview scan failed', error);
    }
    render();
  };

  const activate = (address = sessionAddress()) => {
    if (!ADDRESS_PATTERN.test(address || '')) {
      activeAddress = '';
      snapshot = null;
      render();
      return;
    }
    const normalized = ethers.utils.getAddress(address);
    const currency = selectedCurrency();
    if (activeAddress.toLowerCase() !== normalized.toLowerCase()) scanVersion += 1;
    activeAddress = normalized;
    snapshot = ownCachedSnapshot(normalized, currency) || portfolioSnapshot(normalized, currency);
    statusText = snapshot ? `${snapshot.source || 'Cached data'} · ${new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Loading connected wallet';
    render();
    refresh(false);
  };

  host.addEventListener('click', event => {
    const toggle = event.target.closest('[data-connected-wallet-toggle]');
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const card = toggle.closest('.connected-wallet-card');
      if (card) card.open = !card.open;
      toggle.setAttribute('aria-expanded', String(Boolean(card?.open)));
      toggle.title = card?.open ? 'Collapse wallet assets' : 'Expand wallet assets';
      toggle.setAttribute('aria-label', toggle.title);
      return;
    }
    const copy = event.target.closest('[data-connected-wallet-copy]');
    if (copy) {
      event.preventDefault();
      navigator.clipboard?.writeText(activeAddress).then(() => { copy.title = 'Copied'; setTimeout(() => { copy.title = 'Copy address'; }, 1100); }).catch(() => {});
      return;
    }
    const ownerCopy = event.target.closest('[data-connected-wallet-copy-address]');
    if (ownerCopy) {
      event.preventDefault();
      event.stopPropagation();
      navigator.clipboard?.writeText(ownerCopy.dataset.connectedWalletCopyAddress).then(() => { ownerCopy.title = 'Copied'; setTimeout(() => { ownerCopy.title = 'Copy owner address'; }, 1100); }).catch(() => {});
      return;
    }
    const hide = event.target.closest('[data-connected-wallet-hide]');
    if (hide) {
      event.preventDefault();
      const hidden = hiddenAssetKeys();
      hidden.add(hide.dataset.connectedWalletHide);
      localStorage.setItem('cultFundsHiddenAssets', JSON.stringify([...hidden]));
      render();
      return;
    }
  });
  host.addEventListener('toggle', event => {
    if (!event.target.matches?.('.connected-wallet-card')) return;
    const toggle = event.target.querySelector('[data-connected-wallet-toggle]');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', String(event.target.open));
    toggle.title = event.target.open ? 'Collapse wallet assets' : 'Expand wallet assets';
    toggle.setAttribute('aria-label', toggle.title);
  }, true);
  document.getElementById('restore-hidden-assets-shared')?.addEventListener('click', () => {
    localStorage.removeItem('cultFundsHiddenAssets');
    render();
  });
  window.addEventListener('cult-hub-wallet-session', event => activate(event.detail?.connected ? event.detail.address : ''));
  window.addEventListener('storage', event => {
    if (['cultHubWalletSession:v1', 'cultHubCurrency:v1', 'fundsCurrency'].includes(event.key)) activate();
    if (['cultFundsHiddenAssets', 'cultFundsAssetThresholdIndex', 'cultFundsWalletThreshold'].includes(event.key)) render();
  });
  const protocolDetails = document.getElementById('protocol-hub');
  if (protocolDetails) new MutationObserver(render).observe(protocolDetails, { childList: true, characterData: true, subtree: true });
  const currencyButton = document.getElementById('currency-selector-btn');
  if (currencyButton) new MutationObserver(() => activate(activeAddress)).observe(currencyButton, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-currency'] });
  window.CultAddressIdentity?.subscribe?.(() => render());
  activate();
})();
