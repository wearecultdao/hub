(() => {
  'use strict';

  const SUPPORTED = Object.freeze(['Ethereum', 'Base', 'Polygon']);
  const uniqueNames = values => [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
  const summarize = (values) => {
    const found = uniqueNames(values);
    const names = [...SUPPORTED.filter(name => found.includes(name)), ...found.filter(name => !SUPPORTED.includes(name))];
    if (!names.length) return null;
    const allNetworks = names.length === SUPPORTED.length && SUPPORTED.every(name => names.includes(name));
    return {
      label: names.length === 1 ? names[0] : allNetworks ? 'All networks' : `${names.length} networks`,
      tooltip: `Networks: ${names.join(' · ')}`,
    };
  };

  let tooltip = null;
  let activeTrigger = null;
  const ensureTooltip = () => {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'cult-network-tooltip';
    tooltip.id = 'cult-network-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);
    return tooltip;
  };
  const show = (trigger) => {
    const text = trigger?.dataset.networkTooltip;
    if (!text) return;
    const box = ensureTooltip();
    activeTrigger = trigger;
    box.textContent = text;
    box.hidden = false;
    trigger.setAttribute('aria-describedby', box.id);
    const anchor = trigger.getBoundingClientRect();
    const tooltipBox = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - tooltipBox.width / 2, window.innerWidth - tooltipBox.width - 8));
    const below = anchor.bottom + 8;
    const top = below + tooltipBox.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - tooltipBox.height - 8);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  };
  const hide = (trigger) => {
    if (!tooltip || (trigger && activeTrigger !== trigger)) return;
    activeTrigger?.removeAttribute('aria-describedby');
    activeTrigger = null;
    tooltip.hidden = true;
  };

  document.addEventListener('pointerover', (event) => show(event.target.closest('[data-network-tooltip]')));
  document.addEventListener('pointerout', (event) => {
    const trigger = event.target.closest('[data-network-tooltip]');
    if (trigger && !trigger.contains(event.relatedTarget)) hide(trigger);
  });
  document.addEventListener('focusin', (event) => show(event.target.closest('[data-network-tooltip]')));
  document.addEventListener('focusout', (event) => hide(event.target.closest('[data-network-tooltip]')));
  window.addEventListener('scroll', () => hide(), { passive: true });
  window.addEventListener('resize', () => hide());

  window.CultNetworkSummary = Object.freeze({ summarize });
})();
