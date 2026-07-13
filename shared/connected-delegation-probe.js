(() => {
  'use strict';

  const SUMMARY_KEY = 'cultHubDelegationSummary:v1';
  const STAKE_SUMMARY_KEY = 'cultHubStakeSummary:v1';
  const FRESH_MS = 2 * 60 * 1000;
  const DCULT_ADDRESS = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
  const DCULT_ABI = Object.freeze([
    'function balanceOf(address account) view returns (uint256)',
    'function delegates(address account) view returns (address)',
    'function checkHighestStaker(uint256 index,address account) view returns (bool)',
    'function pendingCULT(uint256 pid,address user) view returns (uint256)',
  ]);
  const RPCS = Object.freeze([
    'https://ethereum.publicnode.com',
    'https://1rpc.io/eth',
    'https://eth.drpc.org',
    'https://cloudflare-eth.com',
  ]);

  // The Hub transaction page already performs these reads with its active signer.
  if (document.querySelector('.wallet-widget[data-wallet-owner="hub"]')) return;

  let requestVersion = 0;
  let activePromise = null;

  const readJson = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
  };
  const session = () => window.CultWalletSession?.read?.() || readJson('cultHubWalletSession:v1') || { connected: false };
  const validAddress = value => /^0x[a-fA-F0-9]{40}$/.test(value || '');
  const dispatch = () => window.dispatchEvent(new CustomEvent('cult-section-summary'));

  const publish = (address, readiness, balance, delegatee, isGuardian, pendingRewards) => {
    const value = {
      source: 'connected-wallet',
      address,
      key: readiness.key,
      label: readiness.compactLabel || readiness.label,
      status: readiness.label,
      currentState: readiness.currentState,
      nextStep: readiness.nextStep,
      balance: balance.toString(),
      delegatee,
      isGuardian: Boolean(isGuardian),
      updatedAt: Date.now(),
    };
    window.CultGovernanceLiveState?.prime?.(address, {
      balance: balance.toString(),
      delegatee,
      isGuardian: Boolean(isGuardian),
    });
    try { localStorage.setItem(SUMMARY_KEY, JSON.stringify(value)); } catch { /* Best-effort shared status. */ }
    try {
      localStorage.setItem(STAKE_SUMMARY_KEY, JSON.stringify({
        address: address.toLowerCase(),
        dCult: Number(ethers.utils.formatUnits(balance, 18)),
        rewards: Number(ethers.utils.formatUnits(pendingRewards, 18)),
        updatedAt: Date.now(),
      }));
    } catch { /* Best-effort shared staking summary. */ }
    dispatch();
    return value;
  };

  const readWithRpc = async (address, rpc) => {
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc, { chainId: 1, name: 'homestead' });
    const contract = new ethers.Contract(DCULT_ADDRESS, DCULT_ABI, provider);
    const reads = Promise.all([
      contract.balanceOf(address),
      contract.delegates(address),
      contract.checkHighestStaker(0, address).catch(() => false),
      contract.pendingCULT(0, address),
    ]);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Delegation read timed out.')), 8000));
    const [balance, delegatee, isGuardian, pendingRewards] = await Promise.race([reads, timeout]);
    return { balance, delegatee, isGuardian, pendingRewards };
  };

  const refresh = async ({ force = false } = {}) => {
    const current = session();
    if (!current?.connected || !validAddress(current.address)) {
      dispatch();
      return null;
    }
    const address = typeof window.ethers === 'undefined'
      ? current.address
      : ethers.utils.getAddress(current.address.toLowerCase());
    const cached = readJson(SUMMARY_KEY);
    const cachedStake = readJson(STAKE_SUMMARY_KEY);
    const stakeIsFresh = String(cachedStake?.address || '').toLowerCase() === address.toLowerCase()
      && Date.now() - Number(cachedStake?.updatedAt || 0) < FRESH_MS;
    if (!force
      && cached?.source === 'connected-wallet'
      && String(cached.address || '').toLowerCase() === address.toLowerCase()
      && stakeIsFresh
      && Date.now() - Number(cached.updatedAt || 0) < FRESH_MS) {
      window.CultGovernanceLiveState?.prime?.(address, {
        balance: cached.balance || '0',
        delegatee: cached.delegatee,
        isGuardian: Boolean(cached.isGuardian),
      });
      dispatch();
      return cached;
    }
    if (typeof window.ethers === 'undefined' || !window.CultDelegationStatus) return null;
    if (activePromise) return activePromise;

    const version = ++requestVersion;
    activePromise = (async () => {
      let lastError = null;
      for (const rpc of RPCS) {
        try {
          const result = await readWithRpc(address, rpc);
          const latest = session();
          if (version !== requestVersion || !latest?.connected || String(latest.address).toLowerCase() !== address.toLowerCase()) return null;
          const readiness = CultDelegationStatus.classify({ address, balance: result.balance.toString(), delegatee: result.delegatee, isGuardian: result.isGuardian });
          return publish(address, readiness, result.balance, result.delegatee, result.isGuardian, result.pendingRewards);
        } catch (error) {
          lastError = error;
        }
      }
      console.warn('Connected-wallet delegation check is temporarily unavailable.', lastError);
      return null;
    })().finally(() => { activePromise = null; });
    return activePromise;
  };

  window.CultConnectedDelegationProbe = Object.freeze({ refresh });
  window.addEventListener('cult-hub-wallet-session', (event) => {
    requestVersion += 1;
    if (event.detail?.connected) refresh({ force: true });
    else dispatch();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'cultHubWalletSession:v1') refresh();
  });
  refresh();
})();
