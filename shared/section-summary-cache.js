(() => {
  'use strict';

  const saveJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent('cult-section-summary'));
    } catch { /* Sections remain usable without storage. */ }
  };

  const totalBurned = document.getElementById('total-burned');
  if (totalBurned) {
    const burnPercent = document.getElementById('burn-percent');
    const totalSupply = document.getElementById('total-supply');
    const saveBurn = () => {
      const text = totalBurned.textContent.trim();
      if (!text || text === '...' || !/CULT$/i.test(text)) return;
      const percent = burnPercent?.textContent?.trim() || '';
      const supplyText = totalSupply?.textContent?.trim() || '';
      saveJson('cultHubBurnSummary:v1', {
        text,
        percent: /^\d[\d.,]*\s*%$/.test(percent) ? percent.replace(/\s/g, '') : '',
        totalSupply: /CULT$/i.test(supplyText) ? supplyText : '',
        updatedAt: Date.now(),
      });
    };
    new MutationObserver(saveBurn).observe(totalBurned, { childList: true, characterData: true, subtree: true });
    if (burnPercent) new MutationObserver(saveBurn).observe(burnPercent, { childList: true, characterData: true, subtree: true });
    if (totalSupply) new MutationObserver(saveBurn).observe(totalSupply, { childList: true, characterData: true, subtree: true });
    saveBurn();
  }

  const portfolioTotal = document.getElementById('total-value');
  if (portfolioTotal) {
    const parseLocalizedNumber = (text) => {
      const parts = new Intl.NumberFormat().formatToParts(12345.6);
      const group = parts.find((part) => part.type === 'group')?.value || ',';
      const decimal = parts.find((part) => part.type === 'decimal')?.value || '.';
      let normalized = String(text || '').replace(new RegExp(`\\${group}`, 'g'), '').replace(decimal, '.');
      normalized = normalized.replace(/[^0-9.-]/g, '');
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    };
    const savePortfolio = () => {
      const text = portfolioTotal.title || portfolioTotal.textContent.trim();
      const value = parseLocalizedNumber(text);
      if (!(value > 0)) return;
      let walletStore = null;
      try { walletStore = JSON.parse(localStorage.getItem('cultFundsWalletSets') || 'null'); } catch { /* no-op */ }
      const activeId = localStorage.getItem('cultFundsActiveWalletSet') || walletStore?.activeId || '';
      const activeSet = Array.isArray(walletStore?.sets) ? walletStore.sets.find((set) => String(set?.id) === String(activeId)) : null;
      if (activeSet?.private) {
        if (localStorage.getItem('cultHubPortfolioSummary:v1')) localStorage.removeItem('cultHubPortfolioSummary:v1');
        window.dispatchEvent(new CustomEvent('cult-section-summary'));
        return;
      }
      const statusText = document.getElementById('status')?.textContent?.trim() || '';
      saveJson('cultHubPortfolioSummary:v1', {
        activeId,
        currency: localStorage.getItem('fundsCurrency') || 'usd',
        value,
        complete: /^(Updated|Currency applied|Cached data shown)/i.test(statusText),
        updatedAt: Date.now(),
      });
    };
    const observer = new MutationObserver(savePortfolio);
    observer.observe(portfolioTotal, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    const status = document.getElementById('status');
    if (status) observer.observe(status, { childList: true, characterData: true, subtree: true });
    savePortfolio();
  }
})();
