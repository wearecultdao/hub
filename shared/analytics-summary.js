(() => {
  'use strict';

  const save = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new CustomEvent('cult-section-summary'));
    } catch { /* Analytics remains usable without summary storage. */ }
  };

  const read = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
  };

  const publish = () => {
    const states = [...document.querySelectorAll('#proposal-list .proposal-state')]
      .map((node) => node.textContent.trim().toLowerCase())
      .filter(Boolean);
    const countText = document.getElementById('proposal-count')?.textContent?.trim() || '';
    const renderedCount = Number(countText.replace(/[^0-9]/g, '')) || states.length;

    if (renderedCount > 0) {
      save('cultHubAnalyticsSummary:v1', { proposalCount: renderedCount, updatedAt: Date.now() });
    }
    if (states.length) {
      const activeCount = states.filter((state) => state === 'active' || state === 'pending').length;
      save('cultHubProposalSummary:v1', { ...read('cultHubProposalSummary:v1'), activeCount, updatedAt: Date.now() });
    }
  };

  const targets = [document.getElementById('proposal-list'), document.getElementById('proposal-count')].filter(Boolean);
  const observer = new MutationObserver(publish);
  targets.forEach((target) => observer.observe(target, { childList: true, characterData: true, subtree: true }));
  publish();
})();
