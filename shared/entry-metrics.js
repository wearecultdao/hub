(() => {
  'use strict';

  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  };

  const saveJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Metrics remain best-effort. */ }
  };

  const MAIN_BANNERS_KEY = 'cultHubMainBanners:v1';
  const MAIN_BANNERS_DISMISSED_KEY = 'cultHubMainBannersDismissed:v1';

  const saveMainBanners = (items) => saveJson(MAIN_BANNERS_KEY, { items, updatedAt: Date.now() });
  const rememberDismissedBanner = (item) => {
    if (!item?.id || !item?.message) return;
    const dismissed = readJson(MAIN_BANNERS_DISMISSED_KEY) || {};
    dismissed[item.id] = item.message;
    saveJson(MAIN_BANNERS_DISMISSED_KEY, dismissed);
  };

  const captureRootMainBanners = () => {
    const stack = document.getElementById('hub-wallet-notices');
    if (!stack) return;
    const dismissed = readJson(MAIN_BANNERS_DISMISSED_KEY) || {};
    const items = [...stack.children].filter((node) => node.classList.contains('is-visible')).map((node) => {
      const content = node.querySelector(':scope > span, :scope > p');
      const tone = node.classList.contains('limeNotice') ? 'green' : 'orange';
      const message = content?.textContent?.trim() || '';
      if (dismissed[node.id] === message) {
        node.classList.remove('is-visible');
        node.style.display = 'none';
        return null;
      }
      return {
        id: node.id,
        tone,
        message,
        messageHtml: content?.innerHTML || '',
        expiresAt: null,
      };
    }).filter((item) => item?.message);
    saveMainBanners(items);
  };

  const appendSafeBannerContent = (target, item) => {
    const template = document.createElement('template');
    template.innerHTML = item.messageHtml || item.message || '';
    const appendNode = (source, destination) => {
      if (source.nodeType === Node.TEXT_NODE) {
        destination.append(document.createTextNode(source.textContent || ''));
        return;
      }
      if (source.nodeType !== Node.ELEMENT_NODE) return;
      if (source.tagName === 'A') {
        try {
          const href = new URL(source.getAttribute('href') || '', window.location.href);
          if (href.protocol === 'https:' && href.hostname === 'app.uniswap.org') {
            const link = document.createElement('a');
            link.href = href.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = source.textContent || href.hostname;
            destination.append(link);
            return;
          }
        } catch { /* Render an untrusted or malformed link as text. */ }
      }
      [...source.childNodes].forEach((child) => appendNode(child, destination));
    };
    [...template.content.childNodes].forEach((node) => appendNode(node, target));
    if (!target.textContent.trim()) target.textContent = item.message || '';
  };

  const renderSharedMainBanners = () => {
    if (document.getElementById('hub-wallet-notices')) return;
    const main = document.querySelector('body > .container > main');
    const launcher = document.querySelector('.hub-entry-secondary');
    if (!main || !launcher) return;
    let stack = document.getElementById('hub-shared-wallet-notices');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'hub-shared-wallet-notices';
      stack.className = 'hub-notice-stack hub-notice-stack-shared';
      stack.setAttribute('aria-label', 'Wallet notices');
      stack.setAttribute('aria-live', 'polite');
      main.before(stack);
    }
    const stored = readJson(MAIN_BANNERS_KEY)?.items || [];
    const dismissed = readJson(MAIN_BANNERS_DISMISSED_KEY) || {};
    const items = stored.filter((item) => dismissed[item.id] !== item.message);
    stack.replaceChildren();
    items.forEach((item) => {
      const banner = document.createElement('div');
      banner.className = `hub-main-banner hub-main-banner--${item.tone === 'green' ? 'green' : 'orange'} is-visible`;
      banner.dataset.bannerId = item.id;
      const message = document.createElement('span');
      appendSafeBannerContent(message, item);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'hub-main-banner-close';
      close.setAttribute('aria-label', 'Dismiss notice');
      close.textContent = '×';
      close.addEventListener('click', () => {
        rememberDismissedBanner(item);
        const next = (readJson(MAIN_BANNERS_KEY)?.items || []).filter((entry) => entry.id !== item.id);
        saveMainBanners(next);
        renderSharedMainBanners();
      });
      banner.append(message, close);
      stack.append(banner);
    });
  };

  const rootBannerStack = document.getElementById('hub-wallet-notices');
  if (rootBannerStack) {
    rootBannerStack.addEventListener('click', (event) => {
      if (!event.target.closest('.notice-close-btn, .batch-api-close-btn')) return;
      const banner = event.target.closest('#hub-wallet-notices > *');
      const content = banner?.querySelector(':scope > span, :scope > p');
      rememberDismissedBanner({ id: banner?.id, message: content?.textContent?.trim() || '' });
    });
    new MutationObserver(captureRootMainBanners).observe(rootBannerStack, { attributes: true, attributeFilter: ['class', 'style'], childList: true, characterData: true, subtree: true });
    captureRootMainBanners();
  } else {
    renderSharedMainBanners();
  }

  const setMetric = (section, value, meta) => {
    const valueNode = document.getElementById(`entry-${section}-metric`);
    const metaNode = document.getElementById(`entry-${section}-meta`);
    if (valueNode) valueNode.textContent = value;
    if (metaNode) metaNode.textContent = meta;
  };

  const setSecondaryLine = (id, text = '') => {
    const node = document.getElementById(id);
    if (!node) return;
    node.textContent = text;
    node.hidden = !text;
  };

  const compactNumber = (value, maximumFractionDigits = 1) => {
    const absolute = Math.abs(value);
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const unit = units.find(([threshold]) => absolute >= threshold);
    const scaled = unit ? value / unit[0] : value;
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(scaled);
    return `${number}${unit ? ` ${unit[1]}` : ''}`;
  };

  const parseWholeTokenAmount = (text) => {
    const digits = String(text || '').match(/\d/g)?.join('') || '';
    const value = digits ? Number(digits) : NaN;
    return Number.isFinite(value) ? value : NaN;
  };

  const compactMoney = (value, currency) => {
    if (!Number.isFinite(value)) return null;
    const prefix = { usd: '$', eur: '€', gbp: '£', jpy: '¥', aud: 'A$', cad: 'C$' }[currency];
    if (prefix) return `${prefix}${compactNumber(value)}`;
    if (currency === 'chf') return `${compactNumber(value)} CHF`;
    return `${compactNumber(value, value < 1 ? 3 : 1)} ${String(currency || '').toUpperCase()}`;
  };

  const activatePortfolioCollection = (targetId) => {
    const latestStore = readJson('cultFundsWalletSets');
    const latestSets = Array.isArray(latestStore?.sets) ? latestStore.sets : [];
    if (!latestSets.some((set) => String(set.id) === targetId)) return;
    if (window.CultPortfolioCollections?.activate) {
      Promise.resolve(window.CultPortfolioCollections.activate(targetId)).catch((error) => console.warn('Could not switch wallet collection.', error));
    } else {
      saveJson('cultFundsWalletSets', { ...latestStore, version: Number(latestStore?.version) || 2, activeId: targetId, sets: latestSets });
      localStorage.setItem('cultFundsActiveWalletSet', targetId);
      window.dispatchEvent(new CustomEvent('cult-hub-portfolio-collections', { detail: { activeId: targetId } }));
    }
    renderPortfolio();
  };

  const renderPortfolioCollectionControl = (store, sets, active) => {
    const control = document.getElementById('entry-portfolio-collections');
    const select = document.getElementById('entry-portfolio-collection-select');
    const summary = control?.closest('.entry-card-summary');
    const visible = Boolean(control && select && active && sets.length > 1);
    if (control) control.hidden = !visible;
    summary?.classList.toggle('has-collection-switcher', visible);
    if (!visible) return;

    select.replaceChildren(...sets.map((set) => {
      const option = document.createElement('option');
      option.value = String(set.id);
      option.textContent = set.name || 'Wallet collection';
      return option;
    }));
    select.value = String(active.id);
    select.title = `Switch wallet collection · ${active.name || 'Current collection'}`;
    select.setAttribute('aria-label', `Wallet collection. Current: ${active.name || 'Current collection'}`);
    if (control.dataset.collectionSwitcherBound === '1') return;
    control.dataset.collectionSwitcherBound = '1';
    select.addEventListener('change', (event) => {
      activatePortfolioCollection(event.currentTarget.value);
    });
  };

  const renderPortfolio = () => {
    const store = readJson('cultFundsWalletSets');
    const sets = Array.isArray(store?.sets) ? store.sets : [];
    const shareableSets = sets.filter((set) => !set.private);
    const requestedId = localStorage.getItem('cultFundsActiveWalletSet') || store?.activeId;
    const active = sets.find((set) => set.id === requestedId) || sets[0];
    if (active?.private) {
      renderPortfolioCollectionControl(store, shareableSets, null);
      setMetric('portfolio', 'Open Portfolio', 'Private collection · local only');
      return;
    }
    renderPortfolioCollectionControl(store, shareableSets, active);
    if (!active) return;

    const walletCount = Array.isArray(active.wallets) ? active.wallets.length : 0;
    const cacheStore = readJson('cultFundsPortfolioCacheV1');
    const cached = cacheStore?.[active.id];
    const rows = Array.isArray(cached?.rows) ? cached.rows : [];
    const total = rows.reduce((sum, entry) => {
      const assets = Array.isArray(entry?.[1]?.assets) ? entry[1].assets : [];
      return sum + assets.reduce((assetSum, asset) => assetSum + (Number(asset?.value) || 0), 0);
    }, 0);
    const selectedCurrency = localStorage.getItem('fundsCurrency') || cached?.currency || 'usd';
    const summary = readJson('cultHubPortfolioSummary:v1');
    const summaryValue = summary?.activeId === active.id && summary?.currency === selectedCurrency && Number.isFinite(Number(summary?.value))
      ? Number(summary.value)
      : null;
    const value = summaryValue != null
      ? compactMoney(summaryValue, selectedCurrency)
      : rows.length
        ? compactMoney(total, cached.currency || selectedCurrency)
        : null;
    const valueMeta = summaryValue != null && summary?.complete === false
      ? ` · scanning · ${walletCount} wallets`
      : ` · ${walletCount} wallets`;
    setMetric('portfolio', value || `${walletCount} wallet${walletCount === 1 ? '' : 's'}`, `${active.name || 'Tracked collection'}${value ? valueMeta : ' · open for value'}`);
  };

  const renderAnalytics = () => {
    setMetric('analytics', 'Open dashboard', 'DAO and governance analysis');
  };

  const renderDelegation = () => {
    const summary = readJson('cultHubDelegationSummary:v1');
    const session = readJson('cultHubWalletSession:v1');
    const connectedAddress = session?.connected ? String(session.address || '').toLowerCase() : '';
    const automaticForConnectedWallet = summary?.source === 'connected-wallet'
      && connectedAddress
      && String(summary.address || '').toLowerCase() === connectedAddress;
    const checkerUsed = localStorage.getItem('cultDelegationCheckerUsed:v1') === '1';
    const manualCheckerSummary = summary && summary.source !== 'connected-wallet' ? summary : null;
    if (automaticForConnectedWallet) {
      const presentation = {
        ready: { context: 'You are', label: 'Ready' },
        guardian: { context: 'You are a', label: 'Guardian' },
        'not-eligible': { context: 'You are', label: 'Not Eligible' },
        'needs-delegation': { context: 'You need', label: 'Delegation' },
        'delegated-elsewhere': { context: 'You are a', label: 'Delegator' },
      }[summary.key] || { context: 'You are', label: summary.label };
      setMetric('delegation', presentation.label, 'Wallet voting readiness');
      setSecondaryLine('entry-delegation-context', presentation.context);
      return;
    }
    if (connectedAddress) {
      setMetric('delegation', 'Checking', 'Wallet voting readiness');
      setSecondaryLine('entry-delegation-context', 'You are');
      return;
    }
    setMetric('delegation', manualCheckerSummary?.label || (checkerUsed ? 'Checked' : 'Check'), 'Wallet voting readiness');
    setSecondaryLine('entry-delegation-context', manualCheckerSummary || checkerUsed ? 'Wallet status' : 'Voting readiness');
  };

  const proposalDetailIds = ['details-active-proposals', 'details-submit-proposal', 'details-past-proposals'];
  let proposalDefaultTouched = false;
  let proposalDefaultLiveApplied = false;
  const proposalCountState = () => {
    const activeText = document.getElementById('metric-active-proposals')?.textContent?.trim() || '';
    const liveCount = /^\d+$/.test(activeText) ? Number(activeText) : null;
    const cached = readJson('cultHubProposalSummary:v1');
    return {
      liveCount,
      activeCount: liveCount != null ? liveCount : Number(cached?.activeCount) || 0,
      known: liveCount != null || Boolean(cached),
      nearestEndsAt: Number(cached?.nearestEndsAt) || 0,
    };
  };
  const compactDeadline = (endsAt) => {
    const remainingMinutes = Math.max(0, Math.ceil((Number(endsAt) - Date.now()) / 60000));
    if (!remainingMinutes) return '';
    if (remainingMinutes >= 2880) {
      const days = Math.floor(remainingMinutes / 1440);
      const hours = Math.floor((remainingMinutes % 1440) / 60);
      return `${days}d${hours ? ` ${hours}h` : ''}`;
    }
    if (remainingMinutes >= 60) {
      const hours = Math.floor(remainingMinutes / 60);
      const minutes = remainingMinutes % 60;
      return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
    }
    return `${remainingMinutes}m`;
  };
  const setProposalDeadline = (text = '') => {
    setSecondaryLine('entry-proposals-deadline', text);
  };
  const applyProposalDefaultState = (activeCount) => {
    proposalDetailIds.forEach((id) => {
      const details = document.getElementById(id);
      if (details) details.open = id === 'details-active-proposals' && activeCount > 0;
    });
  };

  const renderProposals = () => {
    const { liveCount, activeCount, known, nearestEndsAt } = proposalCountState();
    const previewActive = new URLSearchParams(window.location.search).get('preview') === 'active-proposal';
    const cardActiveCount = previewActive ? Math.max(1, activeCount) : activeCount;
    if (liveCount != null) {
      const cached = readJson('cultHubProposalSummary:v1') || {};
      saveJson('cultHubProposalSummary:v1', { ...cached, activeCount: liveCount, updatedAt: Date.now() });
    }
    setMetric('proposals', cardActiveCount ? `${cardActiveCount} ACTIVE` : known ? 'None active' : 'Open', 'Proposal centre');
    const remaining = previewActive ? '18h' : compactDeadline(nearestEndsAt);
    setProposalDeadline(cardActiveCount && remaining ? `${cardActiveCount > 1 ? 'Next ends in' : 'Ends in'} ${remaining}` : '');
    document.querySelectorAll('.hub-entry-card[data-section="proposals"]').forEach((card) => {
      if (cardActiveCount) card.dataset.attention = 'active';
      else delete card.dataset.attention;
    });
    if (document.getElementById('dapp-content')?.dataset.rootSection === 'proposals'
      && liveCount != null && !proposalDefaultLiveApplied && !proposalDefaultTouched) {
      applyProposalDefaultState(activeCount);
      proposalDefaultLiveApplied = true;
    }
  };

  const renderBurn = () => {
    const summary = readJson('cultHubBurnSummary:v1');
    const liveText = document.getElementById('metric-cult-burned')?.textContent?.trim() || '';
    const livePercent = document.getElementById('metric-cult-burned-percent')?.textContent?.trim() || '';
    const liveSupply = document.getElementById('metric-cult-supply')?.textContent?.trim() || '';
    const text = /\d/.test(liveText) ? `${liveText} CULT` : summary?.text?.trim() || '';
    const supplyText = /\d/.test(liveSupply) ? `${liveSupply} CULT` : summary?.totalSupply?.trim() || '';
    let percent = /^\d[\d.,]*\s*%$/.test(livePercent) ? livePercent.replace(/\s/g, '') : summary?.percent?.trim() || '';
    if (text) {
      const amount = parseWholeTokenAmount(text);
      const supply = parseWholeTokenAmount(supplyText);
      if (!percent && Number.isFinite(amount) && supply > 0) percent = `${(amount / supply * 100).toFixed(2)}%`;
      const supplyLabel = supply >= 1e12 ? `${(Math.floor(supply / 1e9) / 1000).toFixed(3).replace('.', ',')} T` : '';
      setSecondaryLine('entry-burn-percent', percent && supplyLabel ? `${percent} of ${supplyLabel}` : '');
      setMetric('burn', Number.isFinite(amount) ? `${compactNumber(amount)} CULT` : text, 'Latest loaded total');
      return;
    }

    const scan = readJson('cultBurnTracker:v3');
    const amounts = scan?.leaderboard && typeof scan.leaderboard === 'object' ? Object.values(scan.leaderboard) : [];
    if (!amounts.length) return;
    try {
      const raw = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
      const wholeCult = Number(raw / 1000000000000000000n);
      setSecondaryLine('entry-burn-percent');
      setMetric('burn', `${compactNumber(wholeCult)} CULT`, 'Indexed burn events');
    } catch {
      // Leave the explicit open-to-load fallback in place for malformed legacy cache data.
    }
  };

  const parseDisplayNumber = (text) => {
    const value = Number(String(text || '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(value) ? value : 0;
  };

  const renderStake = () => {
    const session = readJson('cultHubWalletSession:v1');
    const connected = session?.connected === true && /^0x[a-fA-F0-9]{40}$/.test(session?.address || '');
    if (!connected) {
      setMetric('stake', 'Connect', 'Stake, unstake, and claim');
      setSecondaryLine('entry-stake-returns');
      return;
    }
    const address = String(session.address).toLowerCase();
    const walletNode = document.getElementById('wallet-address');
    const dCultNode = document.getElementById('dcult-balance');
    const rewardsNode = document.getElementById('claimable-rewards');
    const dCult = parseDisplayNumber(dCultNode?.textContent);
    const rewards = parseDisplayNumber(rewardsNode?.textContent);
    const liveAddress = walletNode?.querySelector('.address-link')?.getAttribute('title')?.toLowerCase() || '';
    const hasLiveWalletData = liveAddress === address && dCultNode && rewardsNode;
    if (hasLiveWalletData) saveJson('cultHubStakeSummary:v1', { address, dCult, rewards, updatedAt: Date.now() });
    const cached = readJson('cultHubStakeSummary:v1');
    const summary = hasLiveWalletData
      ? { dCult, rewards }
      : String(cached?.address || '').toLowerCase() === address
        ? cached
        : null;
    setSecondaryLine('entry-stake-returns', Number(summary?.rewards) > 0 ? `${compactNumber(Number(summary.rewards))} CULT to claim` : '');
    if (Number(summary?.dCult) > 0) {
      setMetric('stake', `${compactNumber(Number(summary.dCult))} dCULT`, 'Currently staked');
      return;
    }
    setMetric('stake', 'Stake CULT', 'Wallet connected');
  };

  renderPortfolio();
  renderAnalytics();
  renderDelegation();
  renderProposals();
  renderBurn();
  renderStake();

  setInterval(renderProposals, 60_000);

  const stakeTargets = ['wallet-address', 'dcult-balance', 'claimable-rewards'].map((id) => document.getElementById(id)).filter(Boolean);
  const stakeObserver = new MutationObserver(renderStake);
  stakeTargets.forEach((node) => stakeObserver.observe(node, { childList: true, characterData: true, subtree: true }));
  const proposalTarget = document.getElementById('metric-active-proposals');
  if (proposalTarget) new MutationObserver(renderProposals).observe(proposalTarget, { childList: true, characterData: true, subtree: true });
  const burnTargets = ['metric-cult-burned', 'metric-cult-burned-percent'].map((id) => document.getElementById(id)).filter(Boolean);
  const burnObserver = new MutationObserver(renderBurn);
  burnTargets.forEach((node) => burnObserver.observe(node, { childList: true, characterData: true, subtree: true }));

  const applyRootSectionMode = (mode) => {
    if (!document.getElementById('protocol-hub')) return;
    const homeMode = mode === 'home';
    const proposalMode = mode === 'proposals';
    document.getElementById('details-staking')?.toggleAttribute('hidden', homeMode || proposalMode);
    for (const id of proposalDetailIds) {
      document.getElementById(id)?.toggleAttribute('hidden', homeMode || !proposalMode);
    }
    document.getElementById('dapp-content')?.setAttribute('data-root-section', mode);
  };

  const selectRootSection = (mode, updateUrl = false) => {
    document.querySelectorAll('.hub-entry-card[aria-current="page"]').forEach((card) => card.removeAttribute('aria-current'));
    if (mode !== 'home') document.querySelector(`.hub-entry-card[data-section="${mode}"]`)?.setAttribute('aria-current', 'page');
    applyRootSectionMode(mode);
    if (mode === 'proposals') {
      const proposalState = proposalCountState();
      proposalDefaultTouched = false;
      proposalDefaultLiveApplied = proposalState.liveCount != null;
      applyProposalDefaultState(proposalState.activeCount);
    } else {
      const stakingDetails = mode === 'stake' ? document.getElementById('details-staking') : null;
      if (stakingDetails) stakingDetails.open = true;
    }
    if (updateUrl && window.history?.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('section', mode);
      url.hash = '';
      window.history.replaceState(null, '', url);
    }
  };

  const syncRootCurrentCard = () => {
    if (!document.getElementById('protocol-hub')) return;
    const requested = new URLSearchParams(window.location.search).get('section');
    const current = requested === 'proposals' || window.location.hash.includes('proposal')
      ? 'proposals'
      : requested === 'stake'
        ? 'stake'
        : 'home';
    selectRootSection(current);
  };
  syncRootCurrentCard();
  window.addEventListener('hashchange', syncRootCurrentCard);

  const rootActionCards = document.querySelectorAll('.hub-entry-card[data-section="stake"], .hub-entry-card[data-section="proposals"]');
  const connectButton = document.getElementById('connect-wallet-btn');
  const hubContent = document.getElementById('dapp-content');
  if (hubContent) {
    proposalDetailIds.forEach((id) => document.querySelector(`#${id} > summary`)?.addEventListener('click', () => {
      if (hubContent.dataset.rootSection === 'proposals') proposalDefaultTouched = true;
    }));
    rootActionCards.forEach((card) => card.addEventListener('click', (event) => {
      event.preventDefault();
      selectRootSection(card.dataset.section, true);
      if (getComputedStyle(hubContent).display === 'none' && connectButton) connectButton.click();
    }));
  }

  window.addEventListener('storage', () => {
    renderPortfolio();
    renderAnalytics();
    renderDelegation();
    renderProposals();
    renderStake();
    renderBurn();
    renderSharedMainBanners();
  });
  window.addEventListener('cult-section-summary', () => {
    renderPortfolio();
    renderAnalytics();
    renderDelegation();
    renderProposals();
    renderStake();
    renderBurn();
  });
  window.addEventListener('cult-hub-portfolio-collections', renderPortfolio);
})();
