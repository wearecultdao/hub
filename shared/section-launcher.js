(() => {
  'use strict';

  if (document.querySelector('.hub-entry-grid')) return;
  const header = document.querySelector('body > .container > .header');
  const main = document.querySelector('body > .container > main');
  if (!header || !main) return;

  const path = window.location.pathname;
  const current = path.includes('/portfolio/')
    ? 'portfolio'
    : path.includes('/delegation/')
      ? 'delegation'
      : path.includes('/governance/')
        ? 'analytics'
        : path.includes('/burn/')
          ? 'burn'
          : window.location.hash.includes('proposal')
            ? 'proposals'
            : 'stake';
  main.id ||= 'section-content';
  const sections = [
    { key: 'stake', title: 'Staking & Returns', fallback: 'Connect', href: '../?section=stake' },
    { key: 'portfolio', title: 'Portfolio', fallback: 'Load' },
    { key: 'proposals', title: 'Proposals', fallback: 'Open', href: '../?section=proposals' },
    { key: 'delegation', title: 'Delegation', fallback: 'Check' },
    { key: 'analytics', title: 'Analytics', fallback: 'Open dashboard', href: '../governance/' },
    { key: 'burn', title: 'Burns & Contributions', fallback: 'Load' },
  ];
  const secondaryLineIds = Object.freeze({
    stake: 'entry-stake-returns',
    proposals: 'entry-proposals-deadline',
    delegation: 'entry-delegation-context',
    burn: 'entry-burn-percent',
  });
  const portfolioCollectionControl = `<div id="entry-portfolio-collections" class="entry-portfolio-collections" hidden>
    <label for="entry-portfolio-collection-select" title="Switch wallet collection"><svg viewBox="0 0 256 256" aria-hidden="true"><line x1="88" y1="64" x2="216" y2="64"></line><line x1="88" y1="128" x2="216" y2="128"></line><line x1="88" y1="192" x2="216" y2="192"></line><circle cx="44" cy="64" r="12"></circle><circle cx="44" cy="128" r="12"></circle><circle cx="44" cy="192" r="12"></circle></svg><select id="entry-portfolio-collection-select" aria-label="Wallet collection"></select></label>
  </div>`;

  const launcher = document.createElement('section');
  launcher.className = 'hub-entry hub-entry-secondary';
  launcher.setAttribute('aria-label', 'Choose a CULT DAO section');
  launcher.innerHTML = `<div class="hub-entry-grid">${sections.map((section) => {
    const href = section.key === current ? './' : section.href || `../${section.key}/`;
    const secondaryLineId = secondaryLineIds[section.key];
    if (section.key === 'portfolio') {
      const currentAttribute = section.key === current ? ' aria-current="page"' : '';
      return `<div class="hub-entry-card" data-section="portfolio"${currentAttribute}>
        <a class="entry-card-link" href="${href}" aria-label="Open Portfolio"${currentAttribute}></a>
        <div class="entry-card-copy"><h3>${section.title}</h3></div>
        <div class="entry-card-summary">${portfolioCollectionControl}<span class="entry-metric"><strong id="entry-portfolio-metric">${section.fallback}</strong></span></div>
      </div>`;
    }
    return `<a class="hub-entry-card" data-section="${section.key}" href="${href}"${section.key === current ? ' aria-current="page"' : ''}>
      <div class="entry-card-copy"><h3>${section.title}</h3></div>
      <div class="entry-card-summary"><span class="entry-metric">${secondaryLineId ? `<small id="${secondaryLineId}" hidden></small>` : ''}<strong id="entry-${section.key}-metric">${section.fallback}</strong></span></div>
    </a>`;
  }).join('')}</div>`;
  header.after(launcher);
  launcher.addEventListener('click', (event) => {
    if (event.target.closest('.entry-portfolio-collections')) return;
    const currentCard = event.target.closest('.hub-entry-card[aria-current="page"]');
    if (!currentCard) return;
    event.preventDefault();
    main.querySelector('details:not([hidden])')?.setAttribute('open', '');
  });
})();
