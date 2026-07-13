(() => {
  'use strict';

  const THEME_KEY = 'cultWastedVotesTheme:v2';
  const readTheme = () => {
    try { return JSON.parse(localStorage.getItem('cultHubSharedTheme:v1') || localStorage.getItem(THEME_KEY) || 'null'); } catch { return null; }
  };
  const applyTheme = (theme, persist = false) => {
    const root = document.documentElement;
    if (theme?.type === 'random' && theme.colors) {
      root.style.setProperty('--background-image', `radial-gradient(circle, ${theme.colors.color1}, ${theme.colors.color2})`);
      root.style.setProperty('--btn-bg', theme.colors.btnColor);
      root.style.setProperty('--menu-bg', '#050505');
      root.dataset.theme = 'random';
    } else {
      const name = theme?.name === 'publish' ? 'publish' : 'default';
      root.style.setProperty('--background-image', name === 'publish' ? 'radial-gradient(circle, #ff5252, black)' : 'radial-gradient(circle, #222222, black)');
      root.style.setProperty('--btn-bg', name === 'publish' ? '#333333' : '#ff5252');
      root.style.setProperty('--menu-bg', name === 'publish' ? '#050505' : '#ff5252');
      root.dataset.theme = name;
      theme = { type: 'standard', name };
    }
    if (persist) {
      try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { /* Keep the in-memory theme. */ }
    }
  };
  const randomColor = () => `#${Array.from({ length: 6 }, () => '0123456789ABCDEF'[Math.floor(Math.random() * 16)]).join('')}`;

  applyTheme(readTheme());
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'publish' ? 'default' : 'publish';
    applyTheme({ type: 'standard', name: next }, true);
  });
  document.getElementById('shuffle-theme-btn')?.addEventListener('click', () => {
    applyTheme({ type: 'random', colors: { color1: randomColor(), color2: randomColor(), btnColor: randomColor() } }, true);
  });

  const frame = document.querySelector('.checker-embed-frame');
  if (!frame) return;

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    if (event.data?.type === 'cult-checker-embed-height') {
      const height = Math.max(220, Math.min(2400, Number(event.data.height) || 0));
      frame.style.height = `${height}px`;
    }
  });
})();
