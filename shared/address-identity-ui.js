(() => {
  'use strict';

  const identity = window.CultAddressIdentity;
  if (!identity) return;

  const ADDRESS_IN_TEXT = /0x[a-fA-F0-9]{40}/;
  const ADDRESS_IN_PATH = /\/address\/(0x[a-fA-F0-9]{40})(?:[/?#]|$)/i;
  const PENCIL_ICON_SVG = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M96 216H48a8 8 0 0 1-8-8v-44.69a8 8 0 0 1 2.34-5.65L165.66 34.34a8 8 0 0 1 11.31 0L221.66 79a8 8 0 0 1 0 11.31Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M216 216H96M136 64l56 56" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>';
  const TAG_ICON_SVG = '<svg viewBox="0 0 256 256" aria-hidden="true"><path d="M42.34 138.34A8 8 0 0 1 40 132.69V40h92.69a8 8 0 0 1 5.65 2.34l99.32 99.32a8 8 0 0 1 0 11.31L153 237.66a8 8 0 0 1-11.31 0Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><circle cx="84" cy="84" r="12" fill="currentColor"/></svg>';
  let activeAddress = '';
  const portfolioPrivacy = () => window.CultPortfolioPrivacy;
  const privateCollectionActive = () => Boolean(portfolioPrivacy()?.isActive?.());
  const privateLocalIdentity = (address) => privateCollectionActive() ? portfolioPrivacy()?.getLocal?.(address) || null : null;

  const saveLocalIdentity = (fields) => {
    if (!activeAddress) return null;
    const privacy = portfolioPrivacy();
    const savedPrivately = Boolean(privacy?.isActive?.() && privacy?.save?.(activeAddress, fields));
    const result = savedPrivately ? privacy.getLocal?.(activeAddress) : identity.set(activeAddress, fields);
    window.dispatchEvent(new CustomEvent('cult-address-identity-saved', {
      detail: { address: activeAddress, local: savedPrivately ? privacy.getLocal?.(activeAddress) || null : identity.getLocal?.(activeAddress) || null, private: savedPrivately },
    }));
    return result;
  };

  const addressFromLink = (link) => {
    const anchored = String(link.dataset.walletAnchor || '').replace(/^wallet-/i, '');
    const anchoredAddress = identity.normalizeAddress(anchored);
    if (anchoredAddress) return anchoredAddress;
    const match = String(link.getAttribute('href') || '').match(ADDRESS_IN_PATH);
    return match ? identity.normalizeAddress(match[1]) : '';
  };

  const createEditor = () => {
    if (document.getElementById('hub-identity-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'hub-identity-dialog';
    dialog.className = 'hub-identity-dialog';
    dialog.innerHTML = `
      <form id="hub-identity-form">
        <h2>Edit wallet</h2>
        <p id="hub-identity-address" class="dialog-wallet-address"></p>
        <label>Name<input id="hub-identity-name" maxlength="60" autocomplete="off" placeholder="Optional local wallet name"></label>
        <label>Labels<input id="hub-identity-labels" maxlength="320" autocomplete="off" placeholder="Comma-separated local labels"></label>
        <div id="hub-identity-curated" class="hub-identity-curated" hidden><span>Permanent labels</span><div id="hub-identity-curated-labels" class="hub-identity-label-list"></div><p id="hub-identity-curated-source" class="dialog-help"></p></div>
        <label>Description<textarea id="hub-identity-description" maxlength="240" placeholder="Optional description shown on the wallet card"></textarea></label>
        <div class="dialog-actions"><button id="hub-identity-clear" class="hub-identity-clear danger-button" type="button">Clear local details</button><button id="hub-identity-cancel" type="button">Cancel</button><button type="submit">Save</button></div>
      </form>`;
    document.body.append(dialog);

    dialog.querySelector('#hub-identity-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!activeAddress) return;
      saveLocalIdentity({
        name: dialog.querySelector('#hub-identity-name').value,
        labels: dialog.querySelector('#hub-identity-labels').value,
        description: dialog.querySelector('#hub-identity-description').value,
      });
      dialog.close();
    });
    dialog.querySelector('#hub-identity-clear').addEventListener('click', () => {
      if (!activeAddress) return;
      saveLocalIdentity({ name: '', labels: [], description: '' });
      dialog.close();
    });
    dialog.querySelector('#hub-identity-cancel').addEventListener('click', () => dialog.close());
  };

  const openEditor = (address, fallbackName = '', focusField = 'name') => {
    const key = identity.normalizeAddress(address);
    if (!key) return;
    createEditor();
    activeAddress = key;
    const record = identity.get(key);
    const local = privateCollectionActive() ? privateLocalIdentity(key) : identity.getLocal?.(key);
    const curated = identity.getCurated?.(key);
    const dialog = document.getElementById('hub-identity-dialog');
    dialog.querySelector('#hub-identity-address').textContent = key;
    const name = dialog.querySelector('#hub-identity-name');
    name.value = local?.name || '';
    name.placeholder = curated?.name ? `Permanent: ${curated.name}` : (privateCollectionActive() && record?.name ? `Shared: ${record.name}` : (fallbackName ? `Current: ${fallbackName}` : 'Optional local wallet name'));
    dialog.querySelector('#hub-identity-labels').value = (local?.labels || []).join(', ');
    dialog.querySelector('#hub-identity-description').value = local?.description || '';
    dialog.querySelector('#hub-identity-clear').hidden = !local?.name && !local?.description && !local?.labels?.length;
    const curatedBox = dialog.querySelector('#hub-identity-curated');
    const permanentLabels = curated?.labels || [];
    curatedBox.hidden = !curated?.name && !permanentLabels.length && !curated?.description;
    dialog.querySelector('#hub-identity-curated-labels').innerHTML = permanentLabels.map(label => `<span>${label.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])}</span>`).join('');
    dialog.querySelector('#hub-identity-curated-source').textContent = [curated?.description, ...(curated?.sources || [])].filter(Boolean).join(' · ');
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector(focusField === 'labels' ? '#hub-identity-labels' : '#hub-identity-name').focus());
  };

  const INTERNAL_LABELS = new Set(['Known wallet', 'Dune hardcoded row', 'Medium', 'Guardian list', 'System', 'DAO', 'Governance', 'Contract', 'Token', 'Burn', 'Liquidity', 'Locker', 'Staking', 'Uniswap', 'Unicrypt', 'UNCX', 'Vesting', 'Launch', 'Deployer', 'Vesting recipient', 'UNCX vesting recipient', 'Vesting allocation holder', 'UNCX vesting lock owner']);
  const orderedRoles = (labels) => {
    const roles = [...new Set((labels || []).filter(label => !INTERNAL_LABELS.has(label)))];
    if (roles.includes('UNCX vesting recipient')) roles.splice(roles.indexOf('Vesting recipient'), 1);
    if (roles.includes('UNCX vesting lock owner')) roles.splice(roles.indexOf('Vesting allocation holder'), 1);
    const dev = roles.find(label => /^Dev \d+$/.test(label));
    if (dev && roles.includes('Dev allocation')) {
      roles.splice(roles.indexOf('Dev allocation'), 1);
      roles.splice(roles.indexOf(dev), 1, `Dev allocation ${dev.replace('Dev ', '')}`);
    }
    const priority = label => /^(Founder|Co-founder)$/.test(label) ? 0 : label === 'Pre-appointed Guardian' ? 1 : /^Dev allocation/.test(label) ? 2 : /vesting/i.test(label) ? 3 : label === 'Red flag' ? 4 : 5;
    return roles.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  };
  const identityPresentation = (address, fallbackEns = '') => {
    const key = identity.normalizeAddress(address);
    const record = identity.get(key);
    const sharedLocal = identity.getLocal?.(key);
    const privateLocal = privateLocalIdentity(key);
    const curated = identity.getCurated?.(key);
    const roles = orderedRoles(curated?.labels || []);
    const localLabels = [...new Set([...(sharedLocal?.labels || []), ...(privateLocal?.labels || [])])];
    const hasConfirmedRoleDescription = roles.some(label => label === 'Founder' || label === 'Co-founder');
    const name = privateLocal?.name || record?.name || '';
    const ens = [privateLocal?.name, record?.localName, record?.canonicalName, fallbackEns].find(value => /\.eth$/i.test(String(value || '').trim())) || '';
    return {
      address: key,
      name,
      ens,
      roles,
      localLabels,
      description: privateLocal?.description || sharedLocal?.description || (hasConfirmedRoleDescription ? curated?.description || '' : ''),
      sources: [],
    };
  };
  const labelTitle = (address) => {
    const data = identityPresentation(address);
    const labels = [...data.roles, ...data.localLabels];
    return [data.name, data.ens && data.ens !== data.name ? `ENS: ${data.ens}` : '', data.address, labels.length ? `Labels: ${labels.join(', ')}` : '', data.description, ...data.sources].filter(Boolean).join('\n');
  };
  const contextualEns = (node) => {
    const container = node?.closest?.('.wallet-address-line, .owner-address-line, .holder-address-line, .empty-address-line, .connected-wallet-address-line, .connected-wallet-owner-line, .copyable-address');
    const values = [node?.textContent, container?.querySelector('a.has-ens, .ens-name, a')?.textContent];
    return values.map(value => String(value || '').trim()).find(value => /\.eth$/i.test(value)) || '';
  };
  const applyIdentityTooltip = (node, address) => {
    if (!node) return;
    const data = identityPresentation(address, contextualEns(node));
    node.dataset.identityTooltip = JSON.stringify(data);
    node.removeAttribute('title');
    return data;
  };
  window.CultIdentityPresentation = Object.freeze({ get: identityPresentation, applyTooltip: applyIdentityTooltip });

  let identityTooltip = null;
  let identityTooltipTimer = null;
  let identityTooltipTrigger = null;
  const ensureIdentityTooltip = () => {
    if (identityTooltip) return identityTooltip;
    identityTooltip = document.createElement('div');
    identityTooltip.id = 'hub-identity-tooltip';
    identityTooltip.className = 'hub-identity-tooltip';
    identityTooltip.setAttribute('role', 'tooltip');
    identityTooltip.hidden = true;
    document.body.append(identityTooltip);
    return identityTooltip;
  };
  const readTooltipData = (trigger) => {
    try { return JSON.parse(trigger?.dataset.identityTooltip || 'null'); } catch { return null; }
  };
  const renderIdentityTooltip = (trigger) => {
    const data = readTooltipData(trigger);
    if (!data?.address) return;
    const box = ensureIdentityTooltip();
    identityTooltipTrigger = trigger;
    box.replaceChildren();
    const header = document.createElement('div');
    header.className = 'hub-identity-tooltip-header';
    const name = document.createElement('strong');
    name.textContent = data.name || 'Wallet';
    const address = document.createElement('code');
    address.textContent = data.address;
    header.append(name);
    if (data.ens && data.ens !== data.name) { const ens = document.createElement('span'); ens.className = 'hub-identity-tooltip-ens'; ens.textContent = data.ens; header.append(ens); }
    header.append(address);
    box.append(header);
    const addLabels = (labels, className) => {
      if (!labels?.length) return;
      const group = document.createElement('div');
      group.className = 'hub-identity-tooltip-group';
      const label = document.createElement('span');
      label.className = 'hub-identity-tooltip-group-title';
      const icon = document.createElement('i');
      icon.innerHTML = TAG_ICON_SVG;
      const labelText = document.createElement('span');
      labelText.textContent = 'Labels';
      labelText.className = 'hub-identity-tooltip-group-label';
      label.append(icon, labelText);
      const values = document.createElement('div');
      values.className = `hub-identity-tooltip-labels ${className}`;
      labels.forEach(value => {
        const chip = document.createElement('b');
        chip.textContent = typeof value === 'string' ? value : value.label;
        if (typeof value === 'object' && value.tone) chip.dataset.tone = value.tone;
        values.append(chip);
      });
      group.append(label, values);
      box.append(group);
    };
    const structural = window.CultWalletStructuralState?.get?.(data.address);
    const liveApi = window.CultGovernanceLiveState;
    const live = liveApi?.get?.(data.address);
    const labels = [
      ...(data.roles || []).map(label => ({ label, tone: 'role' })),
      ...(data.localLabels || []).map(label => ({ label, tone: 'local' })),
      ...(structural?.labels || []),
      ...(live?.labels || []),
    ];
    addLabels(labels, 'is-combined');
    if (data.description) { const description = document.createElement('p'); description.textContent = data.description; box.append(description); }
    box.hidden = false;
    trigger.setAttribute('aria-describedby', box.id);
    const anchor = trigger.getBoundingClientRect();
    const bounds = box.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - bounds.width / 2, window.innerWidth - bounds.width - 8));
    const below = anchor.bottom + 9;
    const top = below + bounds.height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - bounds.height - 9);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    if (!live?.complete && liveApi?.ensure) liveApi.ensure(data.address).then(() => {
      if (identityTooltipTrigger === trigger) renderIdentityTooltip(trigger);
    });
  };
  const scheduleIdentityTooltip = (trigger) => {
    clearTimeout(identityTooltipTimer);
    identityTooltipTimer = setTimeout(() => renderIdentityTooltip(trigger), 320);
  };
  const hideIdentityTooltip = () => {
    clearTimeout(identityTooltipTimer);
    identityTooltipTrigger?.removeAttribute('aria-describedby');
    identityTooltipTrigger = null;
    if (identityTooltip) identityTooltip.hidden = true;
  };
  document.addEventListener('pointerover', event => { const trigger = event.target.closest('[data-identity-tooltip]'); if (trigger) scheduleIdentityTooltip(trigger); });
  document.addEventListener('pointerout', event => { const trigger = event.target.closest('[data-identity-tooltip]'); if (trigger && !trigger.contains(event.relatedTarget)) hideIdentityTooltip(); });
  document.addEventListener('focusin', event => { const trigger = event.target.closest('[data-identity-tooltip]'); if (trigger) scheduleIdentityTooltip(trigger); });
  document.addEventListener('focusout', event => { if (event.target.closest('[data-identity-tooltip]')) hideIdentityTooltip(); });
  window.addEventListener('scroll', hideIdentityTooltip, { passive: true });
  window.addEventListener('resize', hideIdentityTooltip);

  const applyLabelIndicator = (indicator, address) => {
    if (!indicator) return;
    const data = identityPresentation(address);
    const hasDynamicLabels = Boolean(window.CultWalletStructuralState?.get?.(address)?.labels?.length || window.CultGovernanceLiveState?.get?.(address)?.labels?.length);
    indicator.hidden = !data.localLabels.length && !data.roles.length && !hasDynamicLabels;
    indicator.classList.toggle('has-local-labels', Boolean(data.localLabels.length));
    indicator.classList.toggle('has-curated-labels', !data.localLabels.length && Boolean(data.roles.length));
    indicator.classList.toggle('has-dynamic-labels', !data.localLabels.length && !data.roles.length && hasDynamicLabels);
    applyIdentityTooltip(indicator, address);
    indicator.setAttribute('aria-label', labelTitle(address) || 'Wallet labels');
  };

  const createLabelIndicator = (address) => {
    const indicator = document.createElement('span');
    indicator.className = 'hub-identity-label-indicator';
    indicator.dataset.address = address;
    indicator.innerHTML = TAG_ICON_SVG;
    applyLabelIndicator(indicator, address);
    return indicator;
  };

  const normalizeWalletIconOrder = (root = document) => {
    const selector = '.wallet-address-line, .owner-address-line, .holder-address-line, .empty-address-line, .connected-wallet-address-line, .connected-wallet-owner-line, .copyable-address, .address-actions';
    const containers = [...(root.matches?.(selector) ? [root] : []), ...(root.querySelectorAll?.(selector) || [])];
    containers.forEach((container) => {
      const copy = container.querySelector(':scope > .inline-copy, :scope > .address-copy, :scope > .copy-action, :scope > [data-connected-wallet-copy], :scope > [data-connected-wallet-copy-address]');
      const edit = container.querySelector(':scope > .hub-identity-edit, :scope > .owner-label');
      const indicator = container.querySelector(':scope > .hub-identity-label-indicator');
      const desired = [copy, edit, indicator].filter(Boolean);
      const current = [...container.children].filter(child => desired.includes(child));
      if (desired.length && desired.some((control, index) => current[index] !== control)) desired.forEach(control => container.append(control));
    });
  };

  const applyPortfolioHeading = (link, address) => {
    const heading = link.closest('.wallet-title')?.querySelector('h3');
    if (!heading) return false;
    let label = heading.querySelector('.hub-identity-heading-label');
    if (!label) {
      const textNodes = [...heading.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      const base = textNodes.map((node) => node.textContent).join('').trim();
      label = document.createElement('span');
      label.className = 'hub-identity-heading-label';
      label.textContent = base;
      heading.dataset.hubIdentityBase = base;
      textNodes.forEach((node) => node.remove());
      heading.prepend(label);
    }
    const record = identityPresentation(address);
    const suffix = /\s·\sLP$/.test(heading.dataset.hubIdentityBase) ? ' · LP' : '';
    label.textContent = record?.name ? `${record.name}${suffix}` : heading.dataset.hubIdentityBase;
    applyIdentityTooltip(label, address);
    const edit = heading.querySelector('.inline-pencil, .hub-identity-edit');
    if (edit) {
      edit.classList.add('hub-identity-edit');
      edit.dataset.address = address;
      edit.dataset.fallbackName = heading.dataset.hubIdentityBase;
      edit.title = 'Edit wallet details';
      edit.setAttribute('aria-label', `Edit wallet details for ${address}`);
      edit.onclick = null;
    }
    heading.querySelector('.hub-identity-tags')?.remove();
    const controlLine = link.closest('.wallet-title')?.querySelector('.wallet-address-line') || link.parentElement;
    let indicator = heading.querySelector('.hub-identity-label-indicator') || controlLine?.querySelector('.hub-identity-label-indicator');
    if (!indicator) {
      indicator = createLabelIndicator(address);
    }
    applyLabelIndicator(indicator, address);
    if (controlLine) {
      if (edit) controlLine.append(edit);
      controlLine.append(indicator);
      normalizeWalletIconOrder(controlLine);
    }
    return true;
  };

  const applyMenuIdentity = (wrapper, address) => {
    const record = identityPresentation(address);
    const title = wrapper.querySelector('.hub-identity-menu-title');
    const edit = wrapper.querySelector('.hub-identity-edit');
    const indicator = wrapper.querySelector('.hub-identity-label-indicator');
    if (title) title.textContent = record?.name || wrapper.dataset.hubIdentityBase;
    if (edit) edit.title = record?.description || `Edit wallet details for ${address}`;
    applyLabelIndicator(indicator, address);
  };

  const decorateMenuLink = (link, address) => {
    const label = link.querySelector('.menu-label');
    if (!label) return false;
    const hint = link.querySelector('.menu-hint');
    const base = label.textContent.trim();
    const wrapper = document.createElement('div');
    wrapper.className = 'menu-item hub-identity-menu-item';
    wrapper.dataset.hubIdentityAddress = address;
    wrapper.dataset.hubIdentityBase = base;

    const titleRow = document.createElement('div');
    titleRow.className = 'hub-identity-menu-title-row';
    const titleLink = document.createElement('a');
    titleLink.className = 'menu-label hub-identity-menu-title';
    const hintLink = document.createElement('a');
    hintLink.className = 'menu-hint hub-identity-menu-hint';
    for (const anchor of [titleLink, hintLink]) {
      anchor.href = link.href;
      anchor.target = link.target;
      anchor.rel = link.rel;
      anchor.title = link.title;
      anchor.dataset.hubIdentityAddress = address;
    }
    titleLink.textContent = base;
    hintLink.textContent = hint?.textContent.trim() || '';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'hub-identity-edit';
    edit.dataset.address = address;
    edit.dataset.fallbackName = base;
    edit.setAttribute('aria-label', `Edit wallet details for ${base}`);
    edit.innerHTML = PENCIL_ICON_SVG;
    const indicator = createLabelIndicator(address);
    titleRow.append(titleLink, edit, indicator);
    wrapper.append(titleRow);
    if (hintLink.textContent) wrapper.append(hintLink);
    link.replaceWith(wrapper);
    applyMenuIdentity(wrapper, address);
    return true;
  };

  const updateAdornment = (link, address) => {
    const record = identityPresentation(address);
    const token = link.dataset.hubIdentityToken;
    const name = document.querySelector(`.hub-identity-name[data-hub-identity-token="${token}"]`);
    const edit = document.querySelector(`.hub-identity-edit[data-hub-identity-token="${token}"]`);
    const indicator = document.querySelector(`.hub-identity-label-indicator[data-hub-identity-token="${token}"]`);
    if (name) {
      name.textContent = record?.name || '';
      name.hidden = !record?.name;
      name.title = record?.description || address;
    }
    if (edit) edit.title = record?.description || `Edit wallet details for ${address}`;
    applyLabelIndicator(indicator, address);
  };

  const isDelegateeContext = (link) => {
    if (link.closest('[data-governance-role="delegatee"], .delegate-heatmap-label, .reliability-row, .delegatee-power-row, .delegate-duty-row')) return true;

    const proofRow = link.closest('.checker-proof-row');
    if (proofRow) {
      const fieldLabel = link.closest('.wallet-detail')?.querySelector(':scope > .wallet-detail-label')?.textContent || '';
      if (/delegatee|fallback/i.test(fieldLabel)) return true;
    }

    const checkerRow = link.closest('.checker-row');
    if (!checkerRow) return false;
    if (link.closest('.checker-status-cell .event-meta')?.textContent?.includes('delegated to')) return true;
    return Boolean(link.closest('.checker-wallet') && [...checkerRow.querySelectorAll('.status-flag')].some(flag => /delegatee wallet/i.test(flag.textContent || '')));
  };

  const ensureAddressActions = (link) => {
    const wrapper = link.parentElement?.matches('.address-link') ? link.parentElement : null;
    if (!wrapper) return null;
    let primary = wrapper.querySelector(':scope > .address-primary');
    if (!primary) {
      primary = document.createElement('span');
      primary.className = 'address-primary';
      const name = link.previousElementSibling?.matches('.hub-identity-name') ? link.previousElementSibling : null;
      wrapper.prepend(primary);
      if (name) primary.append(name);
      primary.append(link);
    }
    let actions = wrapper.querySelector(':scope > .address-actions');
    if (!actions) {
      actions = document.createElement('span');
      actions.className = 'address-actions';
      const copy = wrapper.querySelector(':scope > .copy-action');
      primary.after(actions);
      if (copy) actions.append(copy);
    }
    return actions;
  };

  const normalizeDelegationOverflow = (root = document) => {
    const selector = '.checker-proof-details';
    const details = [...new Set([
      ...(root.matches?.(selector) ? [root] : []),
      ...(root.closest?.(selector) ? [root.closest(selector)] : []),
      ...(root.querySelectorAll?.(selector) || []),
    ])];
    details.forEach((detail) => {
      if (!/^Delegated-power duty/i.test(detail.querySelector(':scope > summary')?.textContent?.trim() || '')) return;
      const list = detail.querySelector(':scope > .checker-proof-list');
      if (!list) return;
      const itemCount = list.querySelectorAll(':scope > .checker-proof-item').length;
      list.classList.add('checker-duty-proof-list');
      list.classList.toggle('is-scrollable', itemCount > 8);
    });
  };

  const normalizeDelegationLabels = (root = document) => {
    const selectors = '.status-flag';
    const flags = [
      ...(root.matches?.(selectors) ? [root] : []),
      ...(root.querySelectorAll?.(selectors) || []),
    ];
    flags.forEach((flag) => {
      const label = flag.textContent.trim();
      if (label === 'Delegated Elsewhere' || label === 'Delegator Wallet') flag.textContent = 'Delegator';
      if (label === 'Delegatee Wallet') flag.textContent = 'Delegatee';
    });

    const groups = [
      ...(root.matches?.('.checker-status-flags') ? [root] : []),
      ...(root.querySelectorAll?.('.checker-status-flags') || []),
    ];
    groups.forEach((group) => {
      const seen = new Set();
      group.querySelectorAll(':scope > .status-flag').forEach((flag) => {
        const label = flag.textContent.trim().toLowerCase();
        if (seen.has(label)) flag.remove();
        else seen.add(label);
      });
    });
  };

  let nextToken = 1;
  const decorateLink = (link) => {
    if (!(link instanceof HTMLAnchorElement) || link.dataset.hubIdentityAddress) return;
    if (link.matches('.tx-icon-link')) return;
    const address = addressFromLink(link);
    if (!address || link.closest('#hub-identity-dialog')) return;
    if (link.closest('.menu, .utility-menu, .wallet-dropdown')) {
      if (decorateMenuLink(link, address)) return;
      return;
    }
    link.dataset.hubIdentityAddress = address;
    if (isDelegateeContext(link)) window.CultGovernanceLiveState?.primeDelegatee?.(address);
    applyIdentityTooltip(link, address);

    if (applyPortfolioHeading(link, address)) return;
    if (link.matches('.owner-address-line .address')) {
      const indicator = link.closest('.owner-address-line')?.querySelector('.hub-identity-label-indicator');
      if (indicator) {
        indicator.dataset.address = address;
        applyLabelIndicator(indicator, address);
      }
      return;
    }

    const token = `identity-${nextToken++}`;
    link.dataset.hubIdentityToken = token;
    const name = document.createElement('span');
    name.className = 'hub-identity-name';
    name.dataset.hubIdentityToken = token;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'hub-identity-edit';
    edit.dataset.hubIdentityToken = token;
    edit.dataset.address = address;
    edit.setAttribute('aria-label', `Edit wallet details for ${address}`);
    edit.innerHTML = PENCIL_ICON_SVG;
    const indicator = createLabelIndicator(address);
    indicator.dataset.hubIdentityToken = token;
    if (!link.closest('.holder-address-line')) link.before(name);
    const addressActions = ensureAddressActions(link);
    if (addressActions) {
      addressActions.append(edit, indicator);
      normalizeWalletIconOrder(addressActions);
    } else {
      link.after(edit, indicator);
    }
    updateAdornment(link, address);
    normalizeWalletIconOrder(link.closest('.wallet-address-line, .owner-address-line, .holder-address-line, .empty-address-line, .connected-wallet-address-line, .connected-wallet-owner-line, .copyable-address') || link.parentElement);
  };

  const decorate = (root = document) => {
    normalizeDelegationLabels(root);
    if (root instanceof HTMLAnchorElement) decorateLink(root);
    root.querySelectorAll?.('a[href*="/address/0x"], a[href*="/address/0X"]').forEach(decorateLink);
    normalizeWalletIconOrder(root);
    normalizeDelegationOverflow(root);
  };

  const refresh = (address = '') => {
    document.querySelectorAll('.hub-identity-menu-item[data-hub-identity-address]').forEach((wrapper) => {
      const itemAddress = wrapper.dataset.hubIdentityAddress;
      if (!address || itemAddress === address) applyMenuIdentity(wrapper, itemAddress);
    });
    document.querySelectorAll('a[data-hub-identity-address]').forEach((link) => {
      if (link.closest('.hub-identity-menu-item')) return;
      if (address && link.dataset.hubIdentityAddress !== address) return;
      applyIdentityTooltip(link, link.dataset.hubIdentityAddress);
      applyPortfolioHeading(link, link.dataset.hubIdentityAddress);
      updateAdornment(link, link.dataset.hubIdentityAddress);
    });
    document.querySelectorAll('.hub-identity-label-indicator[data-address]').forEach((indicator) => {
      const itemAddress = identity.normalizeAddress(indicator.dataset.address);
      if (address && itemAddress !== address) return;
      applyLabelIndicator(indicator, itemAddress);
    });
    normalizeWalletIconOrder();
    normalizeDelegationLabels();
  };

  const savePortfolioForm = (form) => {
    if (privateCollectionActive()) return;
    if (form.id === 'wallet-edit-form') {
      const address = document.getElementById('wallet-edit-address')?.textContent.match(ADDRESS_IN_TEXT)?.[0];
      if (address) identity.set(address, {
        name: document.getElementById('edit-wallet-label')?.value || '',
        description: document.getElementById('edit-wallet-note')?.value || '',
      }, { syncPortfolio: false });
    }
    if (form.id === 'owner-label-form') {
      const address = document.getElementById('owner-label-address')?.textContent.match(ADDRESS_IN_TEXT)?.[0];
      if (address) identity.set(address, { name: document.getElementById('owner-label-input')?.value || '' }, { syncPortfolio: false });
    }
    if (form.id === 'wallet-form') {
      const address = document.getElementById('new-address')?.value || '';
      if (identity.normalizeAddress(address)) identity.set(address, {
        name: document.getElementById('new-label')?.value || '',
        description: document.getElementById('new-note')?.value || '',
      }, { syncPortfolio: false });
    }
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('.hub-identity-label-indicator')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const control = event.target.closest('.hub-identity-edit');
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    openEditor(control.dataset.address, control.dataset.fallbackName || '', 'name');
  });
  document.addEventListener('submit', (event) => savePortfolioForm(event.target), true);

  createEditor();
  decorate();
  identity.subscribe(refresh);
  window.addEventListener('cult-wallet-structural-state', event => refresh(identity.normalizeAddress(event.detail?.address)));
  window.addEventListener('cult-governance-live-state', event => refresh(identity.normalizeAddress(event.detail?.address)));
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) decorate(node);
  }))).observe(document.body, { childList: true, subtree: true });
})();
