(function installCultDelegationStatus(global) {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

  function normalizeAddress(value) {
    return String(value || '').toLowerCase();
  }

  function hasPositiveBalance(value) {
    try {
      return BigInt(String(value || '0')) > 0n;
    } catch {
      return false;
    }
  }

  function classify({ address, balance, delegatee, isGuardian = false }) {
    const wallet = normalizeAddress(address);
    const delegate = normalizeAddress(delegatee) || ZERO_ADDRESS;
    const hasDcult = hasPositiveBalance(balance);
    const isSelfDelegated = Boolean(wallet) && delegate === wallet;
    const hasNoDelegate = delegate === ZERO_ADDRESS;

    if (isGuardian) {
      return {
        key: 'guardian',
        label: 'Guardian · Proposal Rights',
        compactLabel: 'Guardian',
        eligible: false,
        ready: false,
        hasDcult,
        isGuardian: true,
        isSelfDelegated,
        delegatee: delegate,
        currentState: 'Guardian rights are protocol-special',
        nextStep: 'No delegation action is required for Guardian proposal rights',
      };
    }

    if (!hasDcult) {
      return {
        key: 'not-eligible',
        label: 'Not Eligible · No dCULT',
        compactLabel: 'Not Eligible',
        eligible: false,
        ready: false,
        hasDcult: false,
        isGuardian: false,
        isSelfDelegated,
        delegatee: delegate,
        currentState: isSelfDelegated ? 'Self-delegated, but no dCULT' : 'No dCULT voting rights',
        nextStep: 'Stake CULT to receive dCULT voting rights',
      };
    }

    if (isSelfDelegated) {
      return {
        key: 'ready',
        label: 'Ready & Eligible',
        compactLabel: 'Ready',
        eligible: true,
        ready: true,
        hasDcult: true,
        isGuardian: false,
        isSelfDelegated: true,
        delegatee: delegate,
        currentState: 'dCULT is self-delegated',
        nextStep: 'No action needed',
      };
    }

    if (hasNoDelegate) {
      return {
        key: 'needs-delegation',
        label: 'Eligible · Needs Delegation',
        compactLabel: 'Needs Delegation',
        eligible: true,
        ready: false,
        hasDcult: true,
        isGuardian: false,
        isSelfDelegated: false,
        delegatee: delegate,
        currentState: 'No delegate is set',
        nextStep: 'Delegate this wallet to itself before voting directly',
      };
    }

    return {
      key: 'delegated-elsewhere',
      label: 'Eligible · Delegator',
      compactLabel: 'Delegator',
      eligible: true,
      ready: false,
      hasDcult: true,
      isGuardian: false,
      isSelfDelegated: false,
      delegatee: delegate,
      currentState: 'Voting power is assigned to another delegatee',
      nextStep: 'Delegate to self before voting directly, or make sure the delegatee votes',
    };
  }

  global.CultDelegationStatus = Object.freeze({ ZERO_ADDRESS, classify });
})(globalThis);
