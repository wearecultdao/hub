(() => {
  'use strict';

  if (window.CultGovernanceLiveState || typeof window.ethers === 'undefined') return;
  const DCULT = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
  const ZERO = '0x0000000000000000000000000000000000000000';
  const FRESH_MS = 2 * 60 * 1000;
  const ABI = Object.freeze([
    'function balanceOf(address account) view returns (uint256)',
    'function delegates(address account) view returns (address)',
    'function checkHighestStaker(uint256 index,address account) view returns (bool)',
    'function getVotes(address account) view returns (uint256)',
  ]);
  const RPCS = Object.freeze(['https://ethereum.publicnode.com', 'https://1rpc.io/eth', 'https://eth.drpc.org', 'https://cloudflare-eth.com']);
  const cache = new Map();
  const pending = new Map();
  const knownDelegatees = new Set();

  const normalize = value => /^0x[a-fA-F0-9]{40}$/.test(value || '') ? value.toLowerCase() : '';
  const positive = value => { try { return BigInt(String(value || 0)) > 0n; } catch { return false; } };
  const greaterThan = (left, right) => { try { return BigInt(String(left || 0)) > BigInt(String(right || 0)); } catch { return false; } };
  const withTimeout = (promise, milliseconds = 8000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Live governance read timed out.')), milliseconds))]);

  const makeState = (address, values = {}) => {
    const key = normalize(address);
    if (!key) return null;
    const balance = String(values.balance || '0');
    const delegatee = normalize(values.delegatee) || ZERO;
    const votes = String(values.votes || '0');
    const isGuardian = Boolean(values.isGuardian);
    const hasDcult = positive(balance);
    const selfDelegated = delegatee === key;
    const labels = [];
    if (isGuardian) {
      // Guardian proposal rights are protocol-special and do not depend on delegation.
      labels.push({ label: 'Guardian', tone: 'positive' });
    } else {
      if (!hasDcult) {
        // An absence of voting power remains available to the live check, but is
        // not promoted to an identity label or label-indicator state.
      } else if (selfDelegated) labels.push({ label: 'Ready to vote', tone: 'positive' });
      else if (delegatee === ZERO) labels.push({ label: 'Needs delegation', tone: 'warning' });
      else labels.push({ label: 'Delegated elsewhere', tone: 'informational' });
      if (delegatee !== ZERO && !selfDelegated) labels.push({ label: 'Delegator', tone: 'informational' });
      const ownVotes = selfDelegated ? balance : '0';
      if (knownDelegatees.has(key) || greaterThan(votes, ownVotes)) labels.push({ label: 'Delegatee', tone: 'informational' });
    }
    if (knownDelegatees.has(key) && !labels.some(item => item.label === 'Delegatee')) labels.push({ label: 'Delegatee', tone: 'informational' });
    return { address: key, balance, delegatee, votes, isGuardian, labels, complete: Boolean(values.complete), updatedAt: Date.now() };
  };
  const save = (address, values) => {
    const state = makeState(address, values);
    if (!state) return null;
    cache.set(state.address, state);
    window.dispatchEvent(new CustomEvent('cult-governance-live-state', { detail: state }));
    return state;
  };
  const get = address => {
    const state = cache.get(normalize(address));
    return state && Date.now() - state.updatedAt < FRESH_MS ? state : null;
  };
  const prime = (address, values = {}) => {
    const key = normalize(address);
    const previous = cache.get(key);
    const nextBalance = String(values.balance || '0');
    const nextDelegatee = normalize(values.delegatee) || ZERO;
    const nextGuardian = Boolean(values.isGuardian);
    const sameAsCompleteRead = Boolean(previous?.complete)
      && previous.balance === nextBalance
      && previous.delegatee === nextDelegatee
      && previous.isGuardian === nextGuardian
      && Date.now() - previous.updatedAt < FRESH_MS;
    return save(key, { votes: previous?.votes || '0', ...values, complete: sameAsCompleteRead });
  };
  const read = async (address, rpc) => {
    const provider = new ethers.providers.StaticJsonRpcProvider(rpc, { chainId: 1, name: 'homestead' });
    const contract = new ethers.Contract(DCULT, ABI, provider);
    const [balance, delegatee, isGuardian, votes] = await withTimeout(Promise.all([
      contract.balanceOf(address),
      contract.delegates(address),
      contract.checkHighestStaker(0, address).catch(() => false),
      contract.getVotes(address).catch(() => ethers.BigNumber.from(0)),
    ]));
    return { balance: balance.toString(), delegatee, isGuardian, votes: votes.toString() };
  };
  const ensure = async address => {
    const key = normalize(address);
    if (!key) return null;
    const cached = get(key);
    if (cached?.complete) return cached;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      let lastError = null;
      for (const rpc of RPCS) {
        try { return save(key, { ...await read(key, rpc), complete: true }); } catch (error) { lastError = error; }
      }
      console.warn('Live governance state is temporarily unavailable.', lastError);
      return null;
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
  const primeDelegatee = address => {
    const key = normalize(address);
    if (!key) return null;
    const previous = cache.get(key);
    if (knownDelegatees.has(key) && previous) return previous;
    knownDelegatees.add(key);
    const cached = previous || {};
    return save(key, {
      balance: cached.balance || '0',
      delegatee: cached.delegatee || ZERO,
      votes: cached.votes || '0',
      isGuardian: cached.isGuardian || false,
      complete: Boolean(cached.complete),
    });
  };
  const primeDelegatees = addresses => (addresses || []).map(primeDelegatee).filter(Boolean);
  const invalidate = address => address ? cache.delete(normalize(address)) : cache.clear();

  window.CultGovernanceLiveState = Object.freeze({ get, prime, primeDelegatee, primeDelegatees, ensure, invalidate });
})();
