(() => {
  'use strict';

  const ETHEREUM_CHAIN_ID = '0x1';
  const WALLET_SESSION_KEY = 'cultHubWalletSession:v1';
  const NETWORK_NAMES = Object.freeze({
    '0x1': 'Ethereum',
    '0xa': 'Optimism',
    '0x38': 'BNB Smart Chain',
    '0x89': 'Polygon',
    '0x2105': 'Base',
    '0xa4b1': 'Arbitrum One',
    '0xaa36a7': 'Sepolia',
  });

  let state = {
    connected: false,
    chainId: '',
    status: 'disconnected',
    switching: false,
    error: '',
  };
  let notice = null;
  let observer = null;
  let initialized = false;
  let providerListenersAttached = false;
  let lastEventSignature = '';

  const normalizeChainId = (value) => {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return `0x${value.toString(16)}`;
    if (typeof value === 'bigint' && value >= 0n) return `0x${value.toString(16)}`;
    const input = String(value ?? '').trim().toLowerCase();
    if (!input) return '';
    try {
      return input.startsWith('0x')
        ? `0x${BigInt(input).toString(16)}`
        : `0x${BigInt(input).toString(16)}`;
    } catch {
      return '';
    }
  };

  const readConnectedSession = () => {
    try {
      const session = JSON.parse(localStorage.getItem(WALLET_SESSION_KEY) || 'null');
      return Boolean(session?.connected && /^0x[a-fA-F0-9]{40}$/.test(session.address || ''));
    } catch {
      return false;
    }
  };

  const networkName = chainId => NETWORK_NAMES[normalizeChainId(chainId)] || `network ${normalizeChainId(chainId) || 'unknown'}`;
  const isMainnet = chainId => normalizeChainId(chainId) === ETHEREUM_CHAIN_ID;
  const snapshot = () => Object.freeze({ ...state, isMainnet: state.status === 'mainnet' });

  const ensureNotice = () => {
    if (notice?.isConnected) return notice;
    notice = document.getElementById('ethereum-network-notice');
    if (!notice) {
      const host = document.getElementById('hub-wallet-notices') || document.querySelector('main.dapp-content, main');
      if (!host) return null;
      notice = document.createElement('section');
      notice.id = 'ethereum-network-notice';
      notice.className = 'ethereum-network-notice hub-main-banner hub-main-banner--orange';
      notice.hidden = true;
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.innerHTML = `
        <div class="ethereum-network-notice-copy">
          <strong data-ethereum-network-title>Ethereum network required</strong>
          <span data-ethereum-network-message></span>
        </div>
        <button type="button" data-switch-to-ethereum>Switch to Ethereum</button>`;
      host.prepend(notice);
    }
    notice.classList.add('ethereum-network-notice', 'hub-main-banner', 'hub-main-banner--orange');
    const button = notice.querySelector('[data-switch-to-ethereum]');
    if (button && !button.dataset.networkListener) {
      button.dataset.networkListener = 'true';
      button.addEventListener('click', switchToEthereum);
    }
    return notice;
  };

  const transactionsBlocked = () => state.connected && state.status !== 'mainnet';

  const applyTransactionState = () => {
    const blocked = transactionsBlocked();
    document.querySelectorAll('[data-requires-ethereum]').forEach((element) => {
      if (blocked) {
        element.dataset.ethereumGuardBlocked = 'true';
        element.setAttribute('aria-disabled', 'true');
        element.title ||= 'Switch to Ethereum to continue';
      } else if (element.dataset.ethereumGuardBlocked === 'true') {
        delete element.dataset.ethereumGuardBlocked;
        element.removeAttribute('aria-disabled');
        if (element.title === 'Switch to Ethereum to continue') element.removeAttribute('title');
      }
    });
  };

  const render = () => {
    document.documentElement.dataset.ethereumNetwork = state.connected ? state.status : 'disconnected';
    applyTransactionState();

    const node = ensureNotice();
    if (!node) return;
    const title = node.querySelector('[data-ethereum-network-title]');
    const message = node.querySelector('[data-ethereum-network-message]');
    const button = node.querySelector('[data-switch-to-ethereum]');
    const visible = state.connected && ['wrong', 'switching', 'error'].includes(state.status);
    node.hidden = !visible;
    node.classList.toggle('is-visible', visible);
    if (!visible) return;

    if (state.status === 'switching') {
      title.textContent = 'Switching to Ethereum';
      message.textContent = 'Confirm the network change in your wallet.';
      button.textContent = 'Switching…';
      button.disabled = true;
      return;
    }

    title.textContent = 'Ethereum network required';
    message.textContent = state.error || `Your wallet is on ${networkName(state.chainId)}. Switch to Ethereum to use wallet actions safely.`;
    button.textContent = state.status === 'error' ? 'Check network' : 'Switch to Ethereum';
    button.disabled = false;
  };

  const emit = () => {
    const detail = snapshot();
    const signature = JSON.stringify(detail);
    if (signature === lastEventSignature) return;
    lastEventSignature = signature;
    window.dispatchEvent(new CustomEvent('cult-ethereum-network-change', { detail }));
  };

  const commit = (patch) => {
    state = { ...state, ...patch };
    render();
    emit();
    return snapshot();
  };

  const handleChainChanged = (chainId) => {
    const normalized = normalizeChainId(chainId);
    const connected = readConnectedSession();
    commit({
      connected,
      chainId: connected ? normalized : '',
      status: connected ? (isMainnet(normalized) ? 'mainnet' : 'wrong') : 'disconnected',
      switching: false,
      error: '',
    });
  };

  const attachProviderListeners = () => {
    if (providerListenersAttached || !window.ethereum?.on) return;
    providerListenersAttached = true;
    window.ethereum.on('chainChanged', handleChainChanged);
  };

  async function refresh(options = {}) {
    attachProviderListeners();
    const connected = options.connected ?? readConnectedSession();
    if (!connected) {
      return commit({ connected: false, chainId: '', status: 'disconnected', switching: false, error: '' });
    }
    if (!window.ethereum?.request) {
      return commit({ connected: true, chainId: '', status: 'error', switching: false, error: 'The connected wallet is unavailable in this browser.' });
    }

    commit({ connected: true, status: 'checking', switching: false, error: '' });
    try {
      const chainId = normalizeChainId(await window.ethereum.request({ method: 'eth_chainId' }));
      return commit({ connected: true, chainId, status: isMainnet(chainId) ? 'mainnet' : 'wrong', switching: false, error: '' });
    } catch (error) {
      return commit({ connected: true, status: 'error', switching: false, error: error?.message || 'The wallet network could not be checked.' });
    }
  }

  async function switchToEthereum() {
    if (state.status === 'error' && !state.chainId) return refresh();
    if (!window.ethereum?.request) return refresh({ connected: true });

    commit({ connected: true, status: 'switching', switching: true, error: '' });
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ETHEREUM_CHAIN_ID }],
      });
    } catch (error) {
      if (Number(error?.code) === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ETHEREUM_CHAIN_ID,
              chainName: 'Ethereum Mainnet',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://ethereum.publicnode.com'],
              blockExplorerUrls: ['https://etherscan.io'],
            }],
          });
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: ETHEREUM_CHAIN_ID }],
          });
          return refresh({ connected: true });
        } catch (addError) {
          error = addError;
        }
      }

      if (Number(error?.code) === 4001) {
        return commit({ connected: true, status: 'wrong', switching: false, error: 'The network change was declined. You can switch to Ethereum in your wallet.' });
      }
      return commit({ connected: true, status: 'wrong', switching: false, error: error?.message || 'Switch to Ethereum in your wallet, then try again.' });
    }
    return refresh({ connected: true });
  }

  async function requireMainnet(options = {}) {
    const current = await refresh({ connected: options.connected ?? true });
    if (current.isMainnet) return true;
    if (options.focus !== false) {
      ensureNotice()?.querySelector('[data-switch-to-ethereum]')?.focus();
    }
    return false;
  }

  const handleBlockedTransactionClick = (event) => {
    const action = event.target.closest?.('[data-requires-ethereum]');
    if (!action || !transactionsBlocked()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requireMainnet();
  };

  const initialize = () => {
    if (initialized) return;
    initialized = true;
    ensureNotice();
    attachProviderListeners();
    document.addEventListener('click', handleBlockedTransactionClick, true);
    observer = new MutationObserver(applyTransactionState);
    observer.observe(document.body, { childList: true, subtree: true });
    refresh();
  };

  window.CultEthereumNetwork = Object.freeze({
    chainId: ETHEREUM_CHAIN_ID,
    getState: snapshot,
    isMainnet,
    networkName,
    normalizeChainId,
    refresh,
    requireMainnet,
    switchToEthereum,
  });

  window.addEventListener('cult-hub-wallet-session', event => refresh({ connected: Boolean(event.detail?.connected) }));
  window.addEventListener('storage', (event) => {
    if (event.key === WALLET_SESSION_KEY) refresh();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
