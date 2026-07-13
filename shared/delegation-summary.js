(() => {
  'use strict';

  const answer = document.getElementById('readiness-answer');
  if (!answer) return;

  const publish = () => {
    const status = answer.querySelector('.status-flag')?.textContent?.trim() || '';
    if (!status) return;
    const label = answer.classList.contains('is-ready')
      ? 'Ready'
      : answer.classList.contains('is-attention')
        ? 'Needs action'
        : /no vote power/i.test(status)
          ? 'No vote power'
          : status;
    try {
      localStorage.setItem('cultHubDelegationSummary:v1', JSON.stringify({ source: 'checker', label, status, updatedAt: Date.now() }));
      window.dispatchEvent(new CustomEvent('cult-section-summary'));
    } catch { /* The checker remains fully usable without summary storage. */ }
  };

  new MutationObserver(publish).observe(answer, { attributes: true, childList: true, characterData: true, subtree: true });
  publish();
})();
