(() => {
  'use strict';

  const SHARED_KEY = 'cultHubSharedTheme:v1';
  const MODULE_KEYS = Object.freeze([
    'cultDaoThemeSettings',
    'cultDaoFundsTheme:v1',
    'cultWastedVotesTheme:v2',
  ]);
  const path = window.location.pathname;
  const moduleKey = path.includes('/portfolio/')
    ? MODULE_KEYS[1]
    : path.includes('/governance/') || path.includes('/delegation/')
      ? MODULE_KEYS[2]
      : MODULE_KEYS[0];

  const normalize = (raw) => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed?.type === 'standard' && ['default', 'publish'].includes(parsed.name)) {
        return { type: 'standard', name: parsed.name };
      }
      if (parsed?.type === 'random' && parsed.colors) {
        const colors = ['color1', 'color2', 'btnColor'].reduce((result, key) => {
          const value = String(parsed.colors[key] || '');
          if (/^#[0-9a-f]{6}$/i.test(value)) result[key] = value;
          return result;
        }, {});
        if (Object.keys(colors).length === 3) return { type: 'random', colors };
      }
    } catch { /* Ignore malformed older theme state. */ }
    return null;
  };

  const writeEverywhere = (theme) => {
    const serialized = JSON.stringify(theme);
    try {
      localStorage.setItem(SHARED_KEY, serialized);
      MODULE_KEYS.forEach((key) => localStorage.setItem(key, serialized));
    } catch { /* Each app keeps its in-memory theme when storage is unavailable. */ }
  };

  const initial = normalize(localStorage.getItem(SHARED_KEY))
    || normalize(localStorage.getItem(moduleKey))
    || { type: 'standard', name: 'default' };
  writeEverywhere(initial);

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#theme-toggle, #theme, #shuffle-theme-btn')) return;
    setTimeout(() => {
      const selected = normalize(localStorage.getItem(moduleKey));
      if (selected) writeEverywhere(selected);
    }, 0);
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== SHARED_KEY) return;
    const selected = normalize(event.newValue);
    if (selected) writeEverywhere(selected);
  });
})();
