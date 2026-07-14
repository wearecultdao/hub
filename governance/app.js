const GOVERNOR_ADDRESS = '0x0831172b9b136813b0b35e7cc898b1398bb4d7e7';
const DCULT_ADDRESS = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
const BATCH_VOTE_ADDRESS = '0x4aD54f4bb255529396Bd9506233d9Fb916A38975';
const CULT_ADDRESS = '0xf0f9d895aca5c8678f706fb8216fa22957685a13';
const TREASURY_ADDRESS = '0x55ac81186e1a8454c79ad78c615c43f54f87403b';
const UNISWAP_PAIR_ADDRESS = '0x5281e311734869c64ca60ef047fd87759397efe6';
const CULT_BURN_WALLETS = Object.freeze([
    '0x000000000000000000000000000000000000dEaD',
    '0xdEAD000000000000000042069420694206942069',
]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DCULT_START_BLOCK = 14093760;
const CULT_START_BLOCK = 14093760;
const GUARDIAN_POOL_ID = 0;
const FALLBACK_GUARDIAN_COUNT = 50;
const GUARDIAN_OVERVIEW_SCHEMA = 'guardian-overview-v1';

const GOVERNOR_ABI = Object.freeze([
    'function proposalCount() view returns (uint256)',
    'function votingDelay() view returns (uint256)',
    'function state(uint256 proposalId) view returns (uint8)',
    'function proposals(uint256 proposalId) view returns (uint256 id,address proposer,uint256 eta,uint256 startBlock,uint256 endBlock,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,bool canceled,bool executed)',
    'event ProposalCreated(uint256 id,address proposer,address[] targets,uint256[] values,string[] signatures,bytes[] calldatas,uint256 startBlock,uint256 endBlock,string description)',
    'event VoteCast(address indexed voter,uint256 proposalId,uint8 support,uint256 votes,string reason)',
]);

const DCULT_ABI = Object.freeze([
    'function balanceOf(address account) view returns (uint256)',
    'function delegates(address account) view returns (address)',
    'function getPastTotalSupply(uint256 blockNumber) view returns (uint256)',
    'function highestStakerInPool(uint256 pid,uint256 index) view returns (uint256 deposited,address addr)',
    'function totalSupply() view returns (uint256)',
    'event Deposit(address indexed user,uint256 indexed pid,uint256 amount)',
    'event Transfer(address indexed from,address indexed to,uint256 value)',
    'event DelegateChanged(address indexed delegator,address indexed fromDelegate,address indexed toDelegate)',
]);

const VOTE_SOURCE_ABI = Object.freeze([
    'function castVote(uint256 proposalId,uint8 support)',
    'function castVoteBySig(uint256 proposalId,uint8 support,uint8 v,bytes32 r,bytes32 s)',
    'function castVoteWithReason(uint256 proposalId,uint8 support,string reason)',
    'function castVoteBySigs((uint256 proposalId,uint8 support,uint8 v,bytes32 r,bytes32 s)[] sigs)',
]);

const ERC20_VIEW_ABI = Object.freeze([
    'function balanceOf(address account) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
]);

const PROPOSAL_STATES = Object.freeze([
    'Pending',
    'Active',
    'Canceled',
    'Defeated',
    'Succeeded',
    'Queued',
    'Expired',
    'Executed',
]);

const READ_RPCS = Object.freeze([
    { label: 'MevBlocker', url: 'https://rpc.mevblocker.io' },
    { label: 'PublicNode', url: 'https://ethereum.publicnode.com' },
    { label: '1RPC', url: 'https://1rpc.io/eth' },
    { label: 'dRPC', url: 'https://eth.drpc.org' },
    { label: 'Cloudflare', url: 'https://cloudflare-eth.com' },
]);

const FINALITY_BLOCKS = 8;
const VOTE_LOG_CHUNK_SIZE = 80_000;
const HISTORY_LOG_CHUNK_SIZE = 600_000;
const CACHE_VERSION = 6;
const CACHE_KEY = `cultWastedVotes:v${CACHE_VERSION}`;
const CACHE_DB_NAME = 'cultWastedVotesCache';
const CACHE_DB_VERSION = 1;
const CACHE_DB_STORE = 'caches';
const STATIC_CACHE_URL = 'historical-cult-governance-data.json';
const LOCAL_STORAGE_CACHE_LIMIT = 4_500_000;
const THEME_STORAGE_KEY = 'cultWastedVotesTheme:v2';
const THEME_SEQUENCE = Object.freeze(['default', 'publish']);
const CHECKER_USED_STORAGE_KEY = 'cultDelegationCheckerUsed:v1';
const DELEGATION_CHECKER_GATE_ENABLED = false;
const GUARDIAN_VIEW_STORAGE_KEY = 'cultGuardianOverviewView:v1';
const ADDRESS_TOPIC_CHUNK_SIZE = 60;
const CALL_CONCURRENCY = 4;
const PROPOSAL_PAGE_SIZE = 10;
const CULT_SUPPLY_WEEK_BLOCK_STEP = 50_400;
const CULT_SUPPLY_SAMPLE_CONCURRENCY = 3;

const governorInterface = new ethers.utils.Interface(GOVERNOR_ABI);
const dcultInterface = new ethers.utils.Interface(DCULT_ABI);
const voteSourceInterface = new ethers.utils.Interface(VOTE_SOURCE_ABI);
const VOTE_CAST_TOPIC = governorInterface.getEventTopic('VoteCast');
const PROPOSAL_CREATED_TOPIC = governorInterface.getEventTopic('ProposalCreated');
const TRANSFER_TOPIC = dcultInterface.getEventTopic('Transfer');
const DELEGATE_CHANGED_TOPIC = dcultInterface.getEventTopic('DelegateChanged');
const DEPOSIT_TOPIC = dcultInterface.getEventTopic('Deposit');

let readProvider = null;
let providerInfo = null;
let providerMode = '';
let connectedAddress = '';
let walletListenersAttached = false;
let governorContract = null;
let dcultContract = null;
let cultContract = null;
let latestSafeBlock = DCULT_START_BLOCK;
let latestBlock = DCULT_START_BLOCK;
let cache = createEmptyCache();
let scanInFlight = false;
let cultSupplyIndexPromise = null;
let currentRows = [];
let delegationCheckerUsedThisSession = false;
let expandedProposalDetails = new Set();
let expandedProposals = new Set();
let expandedDelegatees = new Set();
let expandedPowerDelegatees = new Set();
let expandedReliabilityDelegatees = new Set();
let proposalVisibleLimit = PROPOSAL_PAGE_SIZE;
const proposalFilters = {
    executedOnly: false,
    defeatedOnly: false,
    hideCanceled: true,
    titleSearch: '',
};
const proposalDonutState = {
    voteSplit: 'token',
    tokenTurnout: 'ready',
    walletTurnout: 'percent',
    wastedWallets: 'total',
    delegateDuty: 'delegatees',
};
const governanceSnapshotState = {
    mode: 'average',
};
const sourceChartState = {
    mode: 'cumulative',
    visible: {
        directWasted: true,
        absentDuty: true,
        unclassified: true,
    },
};
const votingPowerChartState = {
    mode: 'proposal',
    visible: {
        properVotes: true,
        directWasted: true,
        absentDuty: true,
    },
};
const cultSupplyChartState = {
    visible: {
        treasuryBalance: true,
        restSupply: true,
        lpSupply: true,
        stakedSupply: true,
        burnedSupply: true,
    },
};
const proposalCompositionChartState = {
    mode: 'token',
    visible: {
        actualVotes: true,
        directWasted: true,
        absentDuty: true,
        readyEligibleSupply: false,
        eligibleSupply: false,
    },
};
const participationTrendChartState = {
    mode: 'token',
    visible: {
        participating: true,
        ready: true,
        eligible: false,
        totalStaked: false,
    },
};
const PARTICIPATION_SMOOTHING_WINDOW = 10;
const missedPowerSpikeChartState = {
    visible: {
        direct: true,
        absent: true,
    },
};
const delegateAbsenceHeatmapState = {
    scope: 'current',
};
const delegateeReliabilityState = {
    scope: 'current',
};
let delegateDutyIndexPromise = null;
let delegateDutyIndexToBlock = 0;
let holderSnapshotIndexPromise = null;
let holderSnapshotIndexToBlock = 0;
const guardianSnapshotCache = new Map();
let guardianOverviewPromise = null;
let guardianOverviewViewMode = 'simple';
const pendingBlockTimestampFetches = new Set();

const el = {
    connectWalletBtn: document.getElementById('connect-wallet-btn'),
    walletDropdown: document.getElementById('wallet-dropdown'),
    copyAddressBtn: document.getElementById('copy-address-btn'),
    checkerGateOverlay: document.getElementById('checker-gate-overlay'),
    checkerGateClose: document.getElementById('checker-gate-close'),
    checkerGateSkip: document.getElementById('checker-gate-skip'),
    etherscanLink: document.getElementById('etherscan-link'),
    disconnectBtn: document.getElementById('disconnect-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    resetCacheBtn: document.getElementById('reset-cache-btn'),
    exportCacheBtn: document.getElementById('export-cache-btn'),
    publicRpcBtn: document.getElementById('public-rpc-btn'),
    shuffleTheme: document.getElementById('shuffle-theme-btn'),
    themeToggle: document.getElementById('theme-toggle'),
    menuToggle: document.getElementById('menu-toggle'),
    utilityMenu: document.getElementById('utility-menu'),
    proposalScope: document.getElementById('proposal-scope'),
    statusLine: document.getElementById('status-line'),
    latestBlock: document.getElementById('latest-block'),
    totalWasted: document.getElementById('total-wasted'),
    governanceSnapshot: document.getElementById('governance-snapshot'),
    zeroWallets: document.getElementById('zero-wallets'),
    wastingWallets: document.getElementById('wasting-wallets'),
    repeatWastedWallets: document.getElementById('repeat-wasted-wallets'),
    wastedFor: document.getElementById('wasted-for'),
    wastedAgainst: document.getElementById('wasted-against'),
    wastedAbstain: document.getElementById('wasted-abstain'),
    cultSupplyChart: document.getElementById('cult-supply-chart'),
    votingPowerChart: document.getElementById('voting-power-chart'),
    wastedSourceChart: document.getElementById('wasted-source-chart'),
    proposalCompositionChart: document.getElementById('proposal-composition-chart'),
    proposalRiskChart: document.getElementById('proposal-risk-chart'),
    delegateeReliabilityScatter: document.getElementById('delegatee-reliability-scatter'),
    delegateeReliabilityChart: document.getElementById('delegatee-reliability-chart'),
    repeatFailureChart: document.getElementById('repeat-failure-chart'),
    participationTrendChart: document.getElementById('participation-trend-chart'),
    delegateAbsenceHeatmap: document.getElementById('delegate-absence-heatmap'),
    missedPowerSpikeChart: document.getElementById('missed-power-spike-chart'),
    alignedDelegated: document.getElementById('aligned-delegated'),
    misalignedDelegated: document.getElementById('misaligned-delegated'),
    noRightsWaste: document.getElementById('no-rights-waste'),
    delegateMissedWaste: document.getElementById('delegate-missed-waste'),
    delegateDutyWallets: document.getElementById('delegate-duty-wallets'),
    delegateDutyAbsentPower: document.getElementById('delegate-duty-absent-power'),
    delegateDutyImpact: document.getElementById('delegate-duty-impact'),
    actualVotes: document.getElementById('actual-votes'),
    snapshotDcultSupply: document.getElementById('snapshot-dcult-supply'),
    guardianDcultSupply: document.getElementById('guardian-dcult-supply'),
    voterTurnout: document.getElementById('voter-turnout'),
    walletTurnout: document.getElementById('wallet-turnout'),
    swingFlags: document.getElementById('swing-flags'),
    outcomeSwingFlags: document.getElementById('outcome-swing-flags'),
    proposalCount: document.getElementById('proposal-count'),
    avgForVotes: document.getElementById('avg-for-votes'),
    avgAgainstVotes: document.getElementById('avg-against-votes'),
    avgMargin: document.getElementById('avg-margin'),
    avgTotalVotes: document.getElementById('avg-total-votes'),
    avgSnapshotDcultSupply: document.getElementById('avg-snapshot-dcult-supply'),
    avgGuardianDcultSupply: document.getElementById('avg-guardian-dcult-supply'),
    avgTurnout: document.getElementById('avg-turnout'),
    avgVotingWallets: document.getElementById('avg-voting-wallets'),
    avgReadyHolderWallets: document.getElementById('avg-ready-holder-wallets'),
    avgHolderWallets: document.getElementById('avg-holder-wallets'),
    avgWalletTurnout: document.getElementById('avg-wallet-turnout'),
    avgVotingWalletsLast10: document.getElementById('avg-voting-wallets-last10'),
    avgWastingWallets: document.getElementById('avg-wasting-wallets'),
    avgWastedTotal: document.getElementById('avg-wasted-total'),
    avgMisalignedDelegated: document.getElementById('avg-misaligned-delegated'),
    avgNoRightsWaste: document.getElementById('avg-no-rights-waste'),
    avgDelegateMissedWaste: document.getElementById('avg-delegate-missed-waste'),
    avgDelegateDutyWallets: document.getElementById('avg-delegate-duty-wallets'),
    avgDelegateDutyAbsentPower: document.getElementById('avg-delegate-duty-absent-power'),
    avgWastedFor: document.getElementById('avg-wasted-for'),
    avgWastedAgainst: document.getElementById('avg-wasted-against'),
    delegateePowerStatus: document.getElementById('delegatee-power-status'),
    delegateePowerList: document.getElementById('delegatee-power-list'),
    filterExecutedOnly: document.getElementById('filter-executed-only'),
    filterDefeatedOnly: document.getElementById('filter-defeated-only'),
    filterHideCanceled: document.getElementById('filter-hide-canceled'),
    proposalTitleSearch: document.getElementById('proposal-title-search'),
    proposalList: document.getElementById('proposal-list'),
    proposalVisibleCount: document.getElementById('proposal-visible-count'),
    showMoreProposals: document.getElementById('show-more-proposals'),
    guardiansOverviewStatus: document.getElementById('guardians-overview-status'),
    guardiansOverview: document.getElementById('guardians-overview'),
    refreshGuardiansOverview: document.getElementById('refresh-guardians-overview'),
};

document.addEventListener('DOMContentLoaded', async () => {
    applySavedTheme();
    applySavedGuardianOverviewViewMode();
    cache = await loadCache();
    updateDelegationCheckerGate();

    el.connectWalletBtn.addEventListener('click', handleWalletButtonClick);
    el.checkerGateOverlay?.addEventListener('click', handleDelegationCheckerGateOverlayClick);
    el.checkerGateClose?.addEventListener('click', hideDelegationCheckerGateNotice);
    el.checkerGateSkip?.addEventListener('click', markDelegationCheckerUsed);
    el.copyAddressBtn.addEventListener('click', copyConnectedAddress);
    el.disconnectBtn.addEventListener('click', disconnectWallet);
    el.refreshBtn.addEventListener('click', () => initialize({ forceRefresh: true }));
    el.resetCacheBtn.addEventListener('click', async () => {
        closeUtilityMenu();
        try {
            const backup = window.CultHistoricalDataUpdates?.backupAllJson;
            if (!backup) throw new Error('Safety backup is unavailable');
            setStatus('Downloading a complete JSON backup before rebuilding...');
            await backup({ reason: 'governance-index-rebuild' });
        } catch (error) {
            setStatus(`${error?.message || 'Safety backup failed'}. The index was not changed.`, true);
            return;
        }
        cache = createEmptyCache();
        await saveCache(cache);
        initialize({ forceRefresh: true, rebuildIndex: true });
    });
    el.exportCacheBtn.addEventListener('click', exportStaticDataset);
    el.publicRpcBtn.addEventListener('click', () => {
        closeUtilityMenu();
        initializePublicRpc({ forceRefresh: true });
    });
    el.shuffleTheme.addEventListener('click', shuffleTheme);
    el.themeToggle.addEventListener('click', toggleTheme);
    el.menuToggle.addEventListener('click', toggleUtilityMenu);
    el.proposalScope.value = 'all';
    el.proposalScope.addEventListener('change', () => {
        closeUtilityMenu();
        proposalVisibleLimit = PROPOSAL_PAGE_SIZE;
        initialize();
    });
    el.filterExecutedOnly.addEventListener('change', handleProposalFilterChange);
    el.filterDefeatedOnly.addEventListener('change', handleProposalFilterChange);
    el.filterHideCanceled.addEventListener('change', handleProposalFilterChange);
    el.proposalTitleSearch.addEventListener('input', handleProposalFilterChange);
    el.showMoreProposals.addEventListener('click', showMoreProposals);
    el.guardiansOverview?.addEventListener('click', handleGuardianOverviewClick);
    el.refreshGuardiansOverview?.addEventListener('click', () => startGuardianOverviewRefresh({ force: true }));
    el.delegateePowerList.addEventListener('click', handleDelegateePowerListClick);
    el.delegateeReliabilityScatter.addEventListener('click', handleDelegateeReliabilityScatterClick);
    el.delegateeReliabilityScatter.addEventListener('mousemove', handleDelegateeReliabilityScatterPointerMove);
    el.delegateeReliabilityScatter.addEventListener('mouseleave', hideDelegateeReliabilityScatterTooltip);
    el.delegateeReliabilityChart.addEventListener('click', handleDelegateeReliabilityChartClick);
    if (el.governanceSnapshot) el.governanceSnapshot.addEventListener('click', handleGovernanceSnapshotClick);
    el.proposalList.addEventListener('click', handleProposalListClick);
    el.cultSupplyChart.addEventListener('click', handleCultSupplyChartClick);
    el.cultSupplyChart.addEventListener('mousemove', handleCultSupplyChartPointerMove);
    el.cultSupplyChart.addEventListener('mouseleave', hideCultSupplyChartTooltip);
    el.votingPowerChart.addEventListener('click', handleVotingPowerChartClick);
    el.votingPowerChart.addEventListener('mousemove', handleVotingPowerChartPointerMove);
    el.votingPowerChart.addEventListener('mouseleave', hideVotingPowerChartTooltip);
    el.wastedSourceChart.addEventListener('click', handleWastedSourceChartClick);
    el.wastedSourceChart.addEventListener('mousemove', handleWastedSourceChartPointerMove);
    el.wastedSourceChart.addEventListener('mouseleave', hideWastedSourceChartTooltip);
    el.proposalCompositionChart.addEventListener('click', handleProposalCompositionChartClick);
    el.proposalCompositionChart.addEventListener('mousemove', handleProposalCompositionChartPointerMove);
    el.proposalCompositionChart.addEventListener('mouseleave', hideProposalCompositionChartTooltip);
    el.participationTrendChart.addEventListener('click', handleParticipationTrendChartClick);
    el.participationTrendChart.addEventListener('mousemove', handleParticipationTrendChartPointerMove);
    el.participationTrendChart.addEventListener('mouseleave', hideParticipationTrendTooltip);
    if (el.missedPowerSpikeChart) {
        el.missedPowerSpikeChart.addEventListener('click', handleMissedPowerSpikeChartClick);
        el.missedPowerSpikeChart.addEventListener('mousemove', handleMissedPowerSpikeChartPointerMove);
        el.missedPowerSpikeChart.addEventListener('mouseleave', hideMissedPowerSpikeTooltip);
    }
    el.delegateAbsenceHeatmap.addEventListener('click', handleDelegateAbsenceHeatmapClick);
    document.addEventListener('click', handleLockedCheckerSectionClick, true);
    document.addEventListener('click', handleCopyActionClick);
    document.addEventListener('click', closeUtilityMenuOnOutsideClick);
    document.addEventListener('click', closeWalletDropdownOnOutsideClick);
    document.addEventListener('keydown', closeUtilityMenuOnEscape);
    document.addEventListener('keydown', closeWalletDropdownOnEscape);
    document.addEventListener('keydown', closeDelegationCheckerGateOnEscape);

    setupCheckerEmbedResize();
    setupWalletListeners();
    autoUseAuthorizedWallet();
});

function handleWalletButtonClick(event) {
    event.stopPropagation();
    if (providerMode === 'wallet' && connectedAddress) {
        toggleWalletDropdown();
        return;
    }

    connectWalletAndInitialize();
}

function setupCheckerEmbedResize() {
    const frame = document.querySelector('.checker-embed-frame');
    if (!frame) return;

    const resizeFromDocument = () => {
        try {
            const doc = frame.contentDocument;
            setCheckerEmbedHeight(frame, getCheckerEmbedContentHeight(doc));
        } catch {
            // Same-origin embeds can be measured. If unavailable, postMessage still handles it.
        }
    };

    frame.addEventListener('load', () => {
        resizeFromDocument();
        setTimeout(resizeFromDocument, 100);
    });

    window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return;
        if (event.data?.type === 'cult-checker-embed-height') {
            setCheckerEmbedHeight(frame, event.data.height);
            return;
        }
        if (event.data?.type === 'cult-delegation-checker-used') {
            markDelegationCheckerUsed();
        }
    });
}

function hasUsedDelegationChecker() {
    if (delegationCheckerUsedThisSession) return true;
    try {
        return localStorage.getItem(CHECKER_USED_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function markDelegationCheckerUsed() {
    delegationCheckerUsedThisSession = true;
    try {
        localStorage.setItem(CHECKER_USED_STORAGE_KEY, '1');
    } catch {
        // The gate is only a local UX nudge; storage failure should not break the app.
    }
    updateDelegationCheckerGate();
    hideDelegationCheckerGateNotice();
}

function updateDelegationCheckerGate() {
    const unlocked = !DELEGATION_CHECKER_GATE_ENABLED || hasUsedDelegationChecker();
    document.documentElement.classList.toggle('has-used-delegation-checker', unlocked);

    for (const section of document.querySelectorAll('.visuals-details, .proposals-tool-details, .guardians-tool-details')) {
        section.classList.toggle('is-checker-locked', !unlocked);
        section.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
        if (!unlocked) section.open = false;
    }
}

function handleLockedCheckerSectionClick(event) {
    const summary = event.target.closest('.tool-details.is-checker-locked > summary');
    if (!summary) return;

    event.preventDefault();
    event.stopPropagation();
    showDelegationCheckerGateNotice();
}

function showDelegationCheckerGateNotice() {
    if (!el.checkerGateOverlay) return;
    el.checkerGateOverlay.style.display = 'flex';
    el.checkerGateOverlay.setAttribute('aria-hidden', 'false');
    el.checkerGateClose?.focus();
}

function hideDelegationCheckerGateNotice() {
    if (!el.checkerGateOverlay) return;
    el.checkerGateOverlay.style.display = 'none';
    el.checkerGateOverlay.setAttribute('aria-hidden', 'true');
}

function handleDelegationCheckerGateOverlayClick(event) {
    if (event.target === el.checkerGateOverlay) hideDelegationCheckerGateNotice();
}

function closeDelegationCheckerGateOnEscape(event) {
    if (event.key === 'Escape') hideDelegationCheckerGateNotice();
}

function getCheckerEmbedContentHeight(doc) {
    const page = doc?.querySelector?.('.checker-embed-page');
    if (page) return page.getBoundingClientRect().height + 2;
    return Math.max(doc?.body?.scrollHeight || 0, doc?.documentElement?.scrollHeight || 0);
}

function setCheckerEmbedHeight(frame, height) {
    const nextHeight = Math.max(180, Math.min(3200, Math.ceil(Number(height || 0))));
    frame.style.height = `${nextHeight}px`;
}

async function initialize(options = {}) {
    if (scanInFlight) return;

    scanInFlight = true;
    setBusy(true);
    setStatus(readProvider ? `Connecting via ${providerInfo?.label || 'provider'}...` : 'Connect a wallet to scan with your wallet RPC.');
    setIndexStatus(readProvider ? 'Checking...' : 'Idle', '');

    try {
        if (!readProvider) {
            renderDisconnectedState();
            return;
        }

        if (providerMode === 'public' && options.forceRefresh) {
            const working = await getWorkingProvider();
            readProvider = working.provider;
            providerInfo = working.info;
        }

        governorContract = new ethers.Contract(GOVERNOR_ADDRESS, GOVERNOR_ABI, readProvider);
        dcultContract = new ethers.Contract(DCULT_ADDRESS, DCULT_ABI, readProvider);
        cultContract = new ethers.Contract(CULT_ADDRESS, ERC20_VIEW_ABI, readProvider);

        latestBlock = await withTimeout(readProvider.getBlockNumber(), 10_000, `${providerInfo.label} latest block`);
        latestSafeBlock = Math.max(DCULT_START_BLOCK, latestBlock - FINALITY_BLOCKS);
        setStatus(getProviderStatusText());

        if (options.rebuildIndex) {
            cache = createEmptyCache();
            await saveCache(cache);
        } else {
            cache = await loadCache();
        }
        setIndexStatus(Object.keys(cache.proposals || {}).length ? 'Checking...' : 'Indexing...', Object.keys(cache.proposals || {}).length ? '' : 'indexing');

        startCultSupplyTimelineIndex();
        await loadAndRenderProposalWindow();
        renderGuardianOverview();
    } catch (error) {
        console.error(error);
        setStatus(error?.message || 'Unable to load wasted-vote data.', true);
        setIndexStatus('Index failed', 'error');
    } finally {
        scanInFlight = false;
        setBusy(false);
    }
}

async function connectWalletAndInitialize() {
    try {
        if (!window.ethereum) {
            setStatus('No injected wallet found. Open this with MetaMask or another Ethereum wallet.', true);
            return;
        }

        setupWalletListeners();
        setBusy(true);
        setStatus('Connecting wallet...');
        await window.ethereum.request({ method: 'eth_requestAccounts' });
        await useInjectedWalletProvider();
        await initialize({ forceRefresh: true });
    } catch (error) {
        console.error(error);
        if (error?.code !== 'WRONG_NETWORK') setStatus(error?.message || 'Wallet connection failed.', true);
    } finally {
        setBusy(false);
    }
}

async function autoUseAuthorizedWallet() {
    if (!window.ethereum) {
        renderDisconnectedState();
        return;
    }

    if (!window.CultWalletSession?.read().connected) {
        renderDisconnectedState();
        return;
    }

    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (!Array.isArray(accounts) || !accounts.length) {
            renderDisconnectedState();
            return;
        }

        await useInjectedWalletProvider();
        await initialize({ forceRefresh: true });
    } catch (error) {
        if (error?.code !== 'WRONG_NETWORK') renderDisconnectedState();
    }
}

async function useInjectedWalletProvider() {
    const walletProvider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    const signer = walletProvider.getSigner();
    connectedAddress = await signer.getAddress().catch(() => '');
    if (connectedAddress) window.CultWalletSession?.connect(connectedAddress);

    const onMainnet = window.CultEthereumNetwork?.requireMainnet
        ? await window.CultEthereumNetwork.requireMainnet({ connected: true })
        : Number((await walletProvider.getNetwork()).chainId) === 1;
    if (!onMainnet) {
        readProvider = null;
        providerInfo = null;
        providerMode = 'wrong-network';
        renderDisconnectedState('Switch to Ethereum to use your wallet RPC. Public RPC remains available from the menu.');
        const error = new Error('Wallet is not on Ethereum mainnet.');
        error.code = 'WRONG_NETWORK';
        throw error;
    }

    readProvider = walletProvider;
    providerInfo = { label: 'Wallet RPC' };
    providerMode = 'wallet';
    updateConnectButton();
}

async function initializePublicRpc(options = {}) {
    if (scanInFlight) return;

    try {
        setBusy(true);
        setStatus('Connecting to public Ethereum RPC...');
        const working = await getWorkingProvider();
        readProvider = working.provider;
        providerInfo = working.info;
        providerMode = 'public';
        connectedAddress = '';
        updateConnectButton();
        await initialize({ ...options, forceRefresh: false });
    } catch (error) {
        console.error(error);
        setStatus(error?.message || 'Public RPC connection failed.', true);
    } finally {
        setBusy(false);
    }
}

function renderDisconnectedState(message = 'Connect a wallet to scan with your wallet RPC. Public RPC is available from the menu as a fallback.') {
    setStatus(message, message.startsWith('Switch'));
    setIndexStatus('Idle', '');
    currentRows = [];
    renderDashboard([]);
    closeWalletDropdown();
    updateConnectButton();
}

function setupWalletListeners() {
    if (walletListenersAttached || !window.ethereum?.on) return;
    walletListenersAttached = true;
    window.ethereum.on('accountsChanged', () => {
        readProvider = null;
        providerInfo = null;
        providerMode = '';
        connectedAddress = '';
        autoUseAuthorizedWallet();
    });
    window.ethereum.on('chainChanged', () => {
        readProvider = null;
        providerInfo = null;
        providerMode = '';
        connectedAddress = '';
        autoUseAuthorizedWallet();
    });
}

function getProviderStatusText() {
    if (providerMode === 'wallet') {
        return `Live via wallet RPC${connectedAddress ? ` (${shortAddress(connectedAddress)})` : ''}.`;
    }
    return `Live via ${providerInfo.label}. Public fallback mode.`;
}

function exportStaticDataset() {
    closeUtilityMenu();
    const proposalCount = Object.keys(cache?.proposals || {}).length;
    if (!proposalCount) {
        setStatus('No indexed proposal data to export yet.', true);
        return;
    }

    const dataset = {
        ...cache,
        version: CACHE_VERSION,
        governor: GOVERNOR_ADDRESS,
        dcult: DCULT_ADDRESS,
        exportedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = STATIC_CACHE_URL;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${formatInteger(proposalCount)} proposals to ${STATIC_CACHE_URL}.`);
}

async function loadAndRenderProposalWindow() {
    const latestProposalCount = await governorContract.proposalCount();
    const latestProposalId = latestProposalCount.toNumber();
    const votingDelayValue = await governorContract.votingDelay().catch(() => ethers.BigNumber.from(0));
    const votingDelay = votingDelayValue.toNumber();
    const scope = el.proposalScope.value;
    const targetValidCount = scope === 'all' ? latestProposalId : Math.min(latestProposalId, Number(scope) || 20);
    let rows = getCachedProposalRowsForScope(latestProposalId, targetValidCount);
    let rowsById = new Map(rows.map((row) => [Number(row.id), row]));

    if (rows.length) {
        currentRows = rows;
        renderDashboard(rows);
        setIndexStatus('Cached', 'indexed');
        setStatus(`${getProviderStatusText()} Showing cached data. Checking for updates...`);
    } else {
        renderDashboard(rows);
        setIndexStatus('Indexing...', 'indexing');
    }

    for (let proposalId = latestProposalId; proposalId > 0; proposalId -= 1) {
        if (scope !== 'all' && rowsById.size >= targetValidCount && proposalId < getLowestRowId(rowsById)) break;

        const cachedRow = rowsById.get(proposalId);
        if (cachedRow && isCachedProposalComplete(cachedRow)) continue;

        try {
            const row = await analyzeProposal(proposalId, votingDelay);
            if (row) rowsById.set(proposalId, row);
            rows = sortAndLimitRows(rowsById, targetValidCount);
            rowsById = new Map(rows.map((nextRow) => [Number(nextRow.id), nextRow]));
            currentRows = rows;
            renderDashboard(rows);
            await saveCache(cache);
        } catch (error) {
            console.warn(`Proposal ${proposalId} skipped`, error);
        }

        await sleep(20);
    }

    rows = sortAndLimitRows(rowsById, targetValidCount);

    if (rows.length) {
        try {
            const dutyRows = rows.filter((row) => !hasCachedDelegateDutyMetrics(row));
            if (dutyRows.length) {
                setStatus(`${getProviderStatusText()} Building delegatee duty metrics...`);
                setIndexStatus('Indexing...', 'indexing');
                await attachDelegateDutyMetrics(dutyRows);
            }

            const holderRows = rows.filter((row) => !hasCachedHolderSnapshotMetrics(row) || !hasCachedDelegateOwnPower(row));
            if (holderRows.length) {
                setStatus(`${getProviderStatusText()} Building holder turnout metrics...`);
                setIndexStatus('Indexing...', 'indexing');
                await attachHolderSnapshotMetrics(holderRows);
            }
            currentRows = rows;
            renderDashboard(rows);
            await saveCache(cache);
            setStatus(getProviderStatusText());
        } catch (error) {
            console.warn('Delegatee duty metrics unavailable', error);
            setStatus(`${getProviderStatusText()} Delegatee duty metrics paused: ${shortError(error)}`, true);
        }
    }

    setIndexStatus('Indexed', 'indexed');
    currentRows = rows;
    renderDashboard(rows);
}

function getCachedProposalRowsForScope(latestProposalId, targetValidCount) {
    const rows = Object.values(cache.proposals || {})
        .map(cachedProposalToRow)
        .filter((row) => row && Number(row.id) <= latestProposalId)
        .sort((a, b) => Number(b.id) - Number(a.id));

    return targetValidCount === latestProposalId ? rows : rows.slice(0, targetValidCount);
}

function cachedProposalToRow(cached) {
    try {
        if (!cached?.proposal) return null;
        const row = summarizeProposal({
            proposal: cached.proposal,
            title: cached.title || `Proposal #${cached.id || cached.proposal.id}`,
            voteEvents: Array.isArray(cached.voteEvents) ? cached.voteEvents : [],
            zeroWallets: Array.isArray(cached.zeroWallets) ? cached.zeroWallets : [],
            snapshotTotalSupply: cached.snapshotTotalSupply,
            snapshotHolderCount: cached.snapshotHolderCount,
            snapshotReadyHolderCount: cached.snapshotReadyHolderCount,
            snapshotReadyDcultSupply: cached.snapshotReadyDcultSupply,
            snapshotGuardianHolderCount: cached.snapshotGuardianHolderCount,
            snapshotGuardianReadyHolderCount: cached.snapshotGuardianReadyHolderCount,
            snapshotGuardianDcultSupply: cached.snapshotGuardianDcultSupply,
            snapshotGuardianReadyDcultSupply: cached.snapshotGuardianReadyDcultSupply,
            delegateDuty: cached.delegateDuty,
            scannedToBlock: cached.scannedToBlock,
            scanError: cached.scanError || '',
        });
        row.delegateDutyCachePresent = hasStoredDelegateDutyMetrics(cached);
        row.holderMetricsCachePresent = hasStoredHolderSnapshotMetrics(cached);
        row.delegateOwnPowerCachePresent = hasStoredDelegateOwnPower(cached.delegateDuty);
        row.delegateDutyIndexed = Boolean(cached.delegateDutyIndexed || row.delegateDutyCachePresent);
        row.holderMetricsIndexed = Boolean(cached.holderMetricsIndexed || row.holderMetricsCachePresent);
        return row;
    } catch (error) {
        console.warn('Cached proposal skipped', error);
        return null;
    }
}

function sortAndLimitRows(rowsById, targetValidCount) {
    return Array.from(rowsById.values())
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, targetValidCount);
}

function getLowestRowId(rowsById) {
    const ids = Array.from(rowsById.keys()).map(Number).filter(Number.isFinite);
    return ids.length ? Math.min(...ids) : 0;
}

function isCachedProposalComplete(row) {
    const endBlock = Number(row?.proposal?.endBlock || 0);
    const targetToBlock = Math.min(endBlock, latestSafeBlock);
    const scannedToBlock = Number(row?.scannedToBlock || 0);
    return scannedToBlock >= targetToBlock
        && hasCachedDelegateDutyMetrics(row)
        && hasCachedHolderSnapshotMetrics(row)
        && hasCachedDelegateOwnPower(row);
}

async function analyzeProposal(proposalId, votingDelay) {
    const proposal = await fetchProposal(proposalId);
    if (!proposal) return null;

    const idKey = String(proposalId);
    const cached = cache.proposals[idKey] || {};
    const title = cached.title || await findProposalTitle(proposal, votingDelay);
    const startBlock = Number(proposal.startBlock);
    const endBlock = Number(proposal.endBlock);
    const targetToBlock = Math.min(endBlock, latestSafeBlock);
    const previousEvents = Array.isArray(cached.voteEvents) ? cached.voteEvents : [];
    const previousScannedToBlock = Number(cached.scannedToBlock || startBlock - 1);
    let voteEvents = previousEvents;
    let scannedToBlock = previousScannedToBlock;
    let scanError = '';
    let voteScanAdvanced = false;

    if (startBlock <= targetToBlock && previousScannedToBlock < targetToBlock) {
        const fromBlock = Math.max(startBlock, previousScannedToBlock + 1);
        try {
            const voteLogs = await getVoteCastLogs(fromBlock, targetToBlock);
            const parsedEvents = parseVoteLogsForProposal(voteLogs, proposalId);
            voteEvents = mergeVoteEvents(previousEvents, parsedEvents);
            scannedToBlock = targetToBlock;
            voteScanAdvanced = true;
        } catch (error) {
            scanError = `Vote log scan paused: ${shortError(error)}`;
        }
    } else if (startBlock > targetToBlock) {
        scannedToBlock = startBlock - 1;
    }

    const zeroVoteEvents = voteEvents.filter((event) => ethers.BigNumber.from(event.votes || '0').isZero());
    const zeroWallets = await buildZeroWalletRows(proposal, zeroVoteEvents, cached.zeroWallets || []);
    const snapshotTotalSupply = typeof cached.snapshotTotalSupply === 'string' && cached.snapshotTotalSupply !== '0'
        ? cached.snapshotTotalSupply
        : await getSnapshotTotalSupply(startBlock);
    const row = summarizeProposal({
        proposal,
        title,
        voteEvents,
        zeroWallets,
        snapshotTotalSupply,
        snapshotHolderCount: cached.snapshotHolderCount,
        snapshotReadyHolderCount: cached.snapshotReadyHolderCount,
        snapshotReadyDcultSupply: cached.snapshotReadyDcultSupply,
        snapshotGuardianHolderCount: cached.snapshotGuardianHolderCount,
        snapshotGuardianReadyHolderCount: cached.snapshotGuardianReadyHolderCount,
        snapshotGuardianDcultSupply: cached.snapshotGuardianDcultSupply,
        snapshotGuardianReadyDcultSupply: cached.snapshotGuardianReadyDcultSupply,
        delegateDuty: cached.delegateDuty,
        scannedToBlock,
        scanError,
    });
    row.delegateDutyCachePresent = hasStoredDelegateDutyMetrics(cached);
    row.holderMetricsCachePresent = hasStoredHolderSnapshotMetrics(cached);
    row.delegateOwnPowerCachePresent = hasStoredDelegateOwnPower(cached.delegateDuty);
    row.delegateDutyIndexed = voteScanAdvanced ? false : Boolean(cached.delegateDutyIndexed || row.delegateDutyCachePresent);
    row.holderMetricsIndexed = Boolean(cached.holderMetricsIndexed || row.holderMetricsCachePresent);

    const cachedRecord = {
        id: proposalId,
        proposal,
        title,
        voteEvents,
        zeroWallets: row.zeroWallets,
        snapshotTotalSupply: row.snapshotTotalSupply.toString(),
        delegateDutyIndexed: row.delegateDutyIndexed,
        holderMetricsIndexed: row.holderMetricsIndexed,
        scannedToBlock,
        scanError,
        updatedAt: Date.now(),
    };

    if (row.delegateDutyIndexed || row.delegateDutyCachePresent) {
        cachedRecord.delegateDuty = row.delegateDuty;
    }

    if (row.holderMetricsIndexed || row.holderMetricsCachePresent) {
        cachedRecord.snapshotHolderCount = row.snapshotHolderCount;
        cachedRecord.snapshotReadyHolderCount = row.snapshotReadyHolderCount;
        cachedRecord.snapshotReadyDcultSupply = row.snapshotReadyDcultSupply.toString();
        cachedRecord.snapshotGuardianHolderCount = row.snapshotGuardianHolderCount;
        cachedRecord.snapshotGuardianReadyHolderCount = row.snapshotGuardianReadyHolderCount;
        cachedRecord.snapshotGuardianDcultSupply = row.snapshotGuardianDcultSupply.toString();
        cachedRecord.snapshotGuardianReadyDcultSupply = row.snapshotGuardianReadyDcultSupply.toString();
    }

    cache.proposals[idKey] = cachedRecord;

    return row;
}

async function getSnapshotTotalSupply(blockNumber) {
    if (!Number.isFinite(blockNumber) || blockNumber <= 0 || blockNumber > latestSafeBlock) {
        return '0';
    }

    try {
        const supply = await dcultContract.getPastTotalSupply(blockNumber);
        return supply.toString();
    } catch {
        try {
            const supply = await dcultContract.totalSupply({ blockTag: blockNumber });
            return supply.toString();
        } catch {
            return '0';
        }
    }
}

async function fetchProposal(proposalId) {
    try {
        const [data, state] = await Promise.all([
            governorContract.proposals(proposalId),
            governorContract.state(proposalId),
        ]);

        if (!data.proposer || data.proposer.toLowerCase() === ZERO_ADDRESS) return null;

        return {
            id: proposalId,
            proposer: data.proposer,
            eta: data.eta.toString(),
            startBlock: data.startBlock.toString(),
            endBlock: data.endBlock.toString(),
            forVotes: data.forVotes.toString(),
            againstVotes: data.againstVotes.toString(),
            abstainVotes: data.abstainVotes?.toString?.() || '0',
            canceled: Boolean(data.canceled),
            executed: Boolean(data.executed),
            state: Number(state),
        };
    } catch (error) {
        if (error?.code !== 'CALL_EXCEPTION') {
            console.warn(`Unable to fetch proposal ${proposalId}`, error);
        }
        return null;
    }
}

async function findProposalTitle(proposal, votingDelay) {
    const startBlock = Number(proposal.startBlock);
    const createdAround = Number.isFinite(startBlock) ? startBlock - Number(votingDelay || 0) : 0;
    if (!Number.isFinite(createdAround) || createdAround <= 0) return `Proposal #${proposal.id}`;

    try {
        const logs = await getLogsWithSplit({
            address: GOVERNOR_ADDRESS,
            topics: [PROPOSAL_CREATED_TOPIC],
            fromBlock: ethers.utils.hexValue(Math.max(0, createdAround - 24)),
            toBlock: ethers.utils.hexValue(createdAround + 24),
        }, VOTE_LOG_CHUNK_SIZE);

        for (const log of logs) {
            try {
                const parsed = governorInterface.parseLog(log);
                if (parsed.args.id.toString() === String(proposal.id)) {
                    return titleFromDescription(parsed.args.description, proposal.id);
                }
            } catch {
                // Ignore malformed logs.
            }
        }
    } catch (error) {
        console.warn(`Unable to fetch ProposalCreated for ${proposal.id}`, error);
    }

    return `Proposal #${proposal.id}`;
}

function titleFromDescription(description, proposalId) {
    const raw = String(description || '').trim();
    if (!raw) return `Proposal #${proposalId}`;

    try {
        const parsed = JSON.parse(raw);
        const projectName = String(parsed.projectName || parsed.title || '').trim();
        if (projectName) return `Proposal #${proposalId}: ${truncate(projectName, 96)}`;
    } catch {
        // Fall back to first text line below.
    }

    const firstLine = raw
        .split(/\r?\n/)
        .map((line) => line.replace(/^#+\s*/, '').replace(/^title\s*:\s*/i, '').trim())
        .find(Boolean);

    return firstLine ? `Proposal #${proposalId}: ${truncate(firstLine, 96)}` : `Proposal #${proposalId}`;
}

async function getVoteCastLogs(fromBlock, toBlock) {
    if (fromBlock > toBlock) return [];
    return getLogsWithSplit({
        address: GOVERNOR_ADDRESS,
        topics: [VOTE_CAST_TOPIC],
        fromBlock: ethers.utils.hexValue(fromBlock),
        toBlock: ethers.utils.hexValue(toBlock),
    }, VOTE_LOG_CHUNK_SIZE);
}

function parseVoteLogsForProposal(logs, proposalId) {
    const wantedId = String(proposalId);
    const events = [];

    for (const log of logs) {
        try {
            const parsed = governorInterface.parseLog(log);
            if (parsed.args.proposalId.toString() !== wantedId) continue;
            events.push({
                voter: ethers.utils.getAddress(parsed.args.voter),
                proposalId: parsed.args.proposalId.toString(),
                support: Number(parsed.args.support),
                votes: parsed.args.votes.toString(),
                reason: String(parsed.args.reason || ''),
                transactionHash: log.transactionHash,
                blockNumber: parseRpcNumber(log.blockNumber),
                transactionIndex: parseRpcNumber(log.transactionIndex || '0x0'),
                logIndex: parseRpcNumber(log.logIndex || '0x0'),
            });
        } catch {
            // Ignore unrelated or malformed logs.
        }
    }

    return events;
}

function mergeVoteEvents(existing, incoming) {
    const byKey = new Map();

    for (const event of existing || []) {
        if (!event?.transactionHash) continue;
        byKey.set(eventKey(event), event);
    }

    for (const event of incoming || []) {
        if (!event?.transactionHash) continue;
        byKey.set(eventKey(event), event);
    }

    return Array.from(byKey.values()).sort(sortEventsAsc);
}

async function buildZeroWalletRows(proposal, zeroVoteEvents, cachedWallets) {
    const cachedByVoter = new Map(
        (cachedWallets || []).map((wallet) => [String(wallet.voter || '').toLowerCase(), wallet]),
    );
    const eventByVoter = new Map();

    for (const event of zeroVoteEvents) {
        const key = event.voter.toLowerCase();
        if (!eventByVoter.has(key) || sortEventsAsc(event, eventByVoter.get(key)) < 0) {
            eventByVoter.set(key, event);
        }
    }

    const missingEvents = Array.from(eventByVoter.entries())
        .filter(([key]) => !cachedByVoter.has(key))
        .map(([, event]) => event);

    let newRows = [];
    if (missingEvents.length) {
        const voters = missingEvents.map((event) => event.voter);
        let snapshotData = new Map();
        let sourceData = new Map();

        try {
            snapshotData = await getSnapshotDataForVoters(voters, Number(proposal.startBlock));
        } catch (error) {
            snapshotData = new Map(voters.map((voter) => [voter.toLowerCase(), {
                snapshotBalance: '0',
                snapshotDelegate: ZERO_ADDRESS,
                currentBalance: '0',
                currentDelegate: ZERO_ADDRESS,
            }]));
        }

        try {
            sourceData = await getVoteSources(missingEvents);
        } catch {
            sourceData = new Map();
        }

        newRows = missingEvents.map((event) => {
            const key = event.voter.toLowerCase();
            const snapshot = snapshotData.get(key) || {};
            const source = sourceData.get(event.transactionHash.toLowerCase()) || 'VoteCast';

            return {
                voter: event.voter,
                support: event.support,
                transactionHash: event.transactionHash,
                blockNumber: event.blockNumber,
                logIndex: event.logIndex,
                snapshotBalance: snapshot.snapshotBalance || '0',
                snapshotDelegate: snapshot.snapshotDelegate || ZERO_ADDRESS,
                currentBalance: snapshot.currentBalance || '0',
                currentDelegate: snapshot.currentDelegate || ZERO_ADDRESS,
                source,
            };
        });
    }

    const merged = new Map(cachedByVoter);
    for (const row of newRows) merged.set(row.voter.toLowerCase(), row);

    return Array.from(eventByVoter.keys())
        .map((key) => merged.get(key))
        .filter(Boolean)
        .sort((a, b) => compareBigNumbersDesc(
            ethers.BigNumber.from(a.snapshotBalance || '0'),
            ethers.BigNumber.from(b.snapshotBalance || '0'),
        ));
}

async function getSnapshotDataForVoters(voters, blockNumber) {
    const uniqueVoters = Array.from(new Set(voters.map((voter) => ethers.utils.getAddress(voter))));
    const result = new Map();
    const failed = [];

    await mapLimit(uniqueVoters, CALL_CONCURRENCY, async (voter) => {
        const key = voter.toLowerCase();
        try {
            const [snapshotBalance, snapshotDelegate, currentBalance, currentDelegate] = await Promise.all([
                dcultContract.balanceOf(voter, { blockTag: blockNumber }),
                dcultContract.delegates(voter, { blockTag: blockNumber }),
                dcultContract.balanceOf(voter),
                dcultContract.delegates(voter),
            ]);
            result.set(key, {
                snapshotBalance: snapshotBalance.toString(),
                snapshotDelegate: ethers.utils.getAddress(snapshotDelegate),
                currentBalance: currentBalance.toString(),
                currentDelegate: ethers.utils.getAddress(currentDelegate),
            });
        } catch (error) {
            failed.push(voter);
        }
    });

    if (!failed.length) return result;

    const [snapshotBalances, snapshotDelegates, currentData] = await Promise.all([
        getSnapshotBalancesFromTransferLogs(failed, blockNumber),
        getSnapshotDelegatesFromLogs(failed, blockNumber),
        getCurrentWalletData(failed),
    ]);

    for (const voter of failed) {
        const key = voter.toLowerCase();
        const current = currentData.get(key) || {};
        result.set(key, {
            snapshotBalance: snapshotBalances.get(key) || '0',
            snapshotDelegate: snapshotDelegates.get(key) || ZERO_ADDRESS,
            currentBalance: current.currentBalance || '0',
            currentDelegate: current.currentDelegate || ZERO_ADDRESS,
        });
    }

    return result;
}

async function getCurrentWalletData(voters) {
    const result = new Map();
    await mapLimit(voters, CALL_CONCURRENCY, async (voter) => {
        const key = voter.toLowerCase();
        try {
            const [currentBalance, currentDelegate] = await Promise.all([
                dcultContract.balanceOf(voter),
                dcultContract.delegates(voter),
            ]);
            result.set(key, {
                currentBalance: currentBalance.toString(),
                currentDelegate: ethers.utils.getAddress(currentDelegate),
            });
        } catch {
            result.set(key, {
                currentBalance: '0',
                currentDelegate: ZERO_ADDRESS,
            });
        }
    });
    return result;
}

async function getSnapshotBalancesFromTransferLogs(voters, blockNumber) {
    const balances = new Map(voters.map((voter) => [voter.toLowerCase(), 0n]));
    if (blockNumber < DCULT_START_BLOCK) return stringifyBigIntMap(balances);

    for (const voterChunk of chunkArray(voters, ADDRESS_TOPIC_CHUNK_SIZE)) {
        const topics = voterChunk.map(addressTopic);
        const [incoming, outgoing] = await Promise.all([
            getLogsWithSplit({
                address: DCULT_ADDRESS,
                topics: [TRANSFER_TOPIC, null, topics],
                fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
                toBlock: ethers.utils.hexValue(blockNumber),
            }, HISTORY_LOG_CHUNK_SIZE),
            getLogsWithSplit({
                address: DCULT_ADDRESS,
                topics: [TRANSFER_TOPIC, topics, null],
                fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
                toBlock: ethers.utils.hexValue(blockNumber),
            }, HISTORY_LOG_CHUNK_SIZE),
        ]);

        for (const log of incoming) {
            if (!log?.topics || log.topics.length < 3 || !log.data) continue;
            const to = topicToAddress(log.topics[2]).toLowerCase();
            if (!balances.has(to)) continue;
            balances.set(to, balances.get(to) + BigInt(log.data));
        }

        for (const log of outgoing) {
            if (!log?.topics || log.topics.length < 3 || !log.data) continue;
            const from = topicToAddress(log.topics[1]).toLowerCase();
            if (!balances.has(from)) continue;
            balances.set(from, balances.get(from) - BigInt(log.data));
        }
    }

    return stringifyBigIntMap(balances);
}

async function getSnapshotDelegatesFromLogs(voters, blockNumber) {
    const delegates = new Map(voters.map((voter) => [voter.toLowerCase(), ZERO_ADDRESS]));
    if (blockNumber < DCULT_START_BLOCK) return delegates;

    for (const voterChunk of chunkArray(voters, ADDRESS_TOPIC_CHUNK_SIZE)) {
        const topics = voterChunk.map(addressTopic);
        const logs = await getLogsWithSplit({
            address: DCULT_ADDRESS,
            topics: [DELEGATE_CHANGED_TOPIC, topics],
            fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
            toBlock: ethers.utils.hexValue(blockNumber),
        }, HISTORY_LOG_CHUNK_SIZE);

        logs.sort(sortLogsAsc);
        for (const log of logs) {
            if (!log?.topics || log.topics.length < 4) continue;
            const delegator = topicToAddress(log.topics[1]).toLowerCase();
            const toDelegate = topicToAddress(log.topics[3]);
            if (delegates.has(delegator)) delegates.set(delegator, toDelegate);
        }
    }

    return delegates;
}

async function getVoteSources(events) {
    cache.txSources = cache.txSources && typeof cache.txSources === 'object' ? cache.txSources : {};
    const txHashes = Array.from(new Set(events.map((event) => event.transactionHash.toLowerCase())));
    const result = new Map();
    const missing = [];

    for (const txHash of txHashes) {
        if (cache.txSources[txHash]) {
            result.set(txHash, cache.txSources[txHash]);
        } else {
            missing.push(txHash);
        }
    }

    await mapLimit(missing, CALL_CONCURRENCY, async (txHash) => {
        const source = await getVoteSource(txHash);
        cache.txSources[txHash] = source;
        result.set(txHash, source);
    });

    return result;
}

async function getVoteSource(txHash) {
    try {
        const tx = await readProvider.getTransaction(txHash);
        if (!tx?.to || !tx?.data) return 'VoteCast';
        const to = tx.to.toLowerCase();
        const selector = tx.data.slice(0, 10).toLowerCase();

        if (to === BATCH_VOTE_ADDRESS.toLowerCase()) {
            if (selector === voteSourceInterface.getSighash('castVoteBySigs').toLowerCase()) return 'Batch sig';
            return 'Batch tx';
        }

        if (to === GOVERNOR_ADDRESS.toLowerCase()) {
            if (selector === voteSourceInterface.getSighash('castVoteBySig').toLowerCase()) return 'Vote sig';
            if (selector === voteSourceInterface.getSighash('castVoteWithReason').toLowerCase()) return 'Direct reason';
            if (selector === voteSourceInterface.getSighash('castVote').toLowerCase()) return 'Direct';
        }
    } catch {
        // Source is contextual, not required for totals.
    }

    return 'VoteCast';
}

function summarizeProposal({
    proposal,
    title,
    voteEvents,
    zeroWallets,
    snapshotTotalSupply,
    snapshotHolderCount,
    snapshotReadyHolderCount,
    snapshotReadyDcultSupply,
    snapshotGuardianHolderCount,
    snapshotGuardianReadyHolderCount,
    snapshotGuardianDcultSupply,
    snapshotGuardianReadyDcultSupply,
    delegateDuty,
    scannedToBlock,
    scanError,
}) {
    const classifiedZeroWallets = dedupeWalletRowsByVoter(classifyZeroWallets(zeroWallets, voteEvents));
    const wastedWallets = classifiedZeroWallets.filter((wallet) => wallet.representationStatus === 'wasted');
    const noRightsWasteWallets = wastedWallets.filter((wallet) => wallet.wasteReason === 'no_voting_rights');
    const delegateMissedWallets = wastedWallets.filter((wallet) => wallet.wasteReason === 'delegate_not_voted');
    const alignedDelegatedWallets = classifiedZeroWallets.filter((wallet) => wallet.representationStatus === 'represented');
    const misalignedWallets = classifiedZeroWallets.filter((wallet) => wallet.representationStatus === 'misaligned');
    const voterWalletCount = new Set(voteEvents.map((event) => String(event.voter || '').toLowerCase()).filter(Boolean)).size;
    const wastedFor = sumWalletBalances(wastedWallets.filter((wallet) => wallet.support === 1));
    const wastedAgainst = sumWalletBalances(wastedWallets.filter((wallet) => wallet.support === 0));
    const wastedAbstain = sumWalletBalances(wastedWallets.filter((wallet) => wallet.support === 2));
    const noRightsWasteTotal = sumWalletBalances(noRightsWasteWallets);
    const delegateMissedWasteTotal = sumWalletBalances(delegateMissedWallets);
    const alignedDelegatedTotal = sumWalletBalances(alignedDelegatedWallets);
    const misalignedDelegatedTotal = sumWalletBalances(misalignedWallets);
    const actualFor = ethers.BigNumber.from(proposal.forVotes || '0');
    const actualAgainst = ethers.BigNumber.from(proposal.againstVotes || '0');
    const actualTotal = actualFor.add(actualAgainst).add(ethers.BigNumber.from(proposal.abstainVotes || '0'));
    const snapshotSupply = ethers.BigNumber.from(snapshotTotalSupply || '0');
    const readyDcultSupply = ethers.BigNumber.from(snapshotReadyDcultSupply || '0');
    const adjustedVotes = getIntentAdjustedVotes(actualFor, actualAgainst, classifiedZeroWallets);
    const margin = actualFor.gte(actualAgainst) ? actualFor.sub(actualAgainst) : actualAgainst.sub(actualFor);
    const leadingSide = actualFor.eq(actualAgainst) ? 'Tie' : actualFor.gt(actualAgainst) ? 'For' : 'Against';
    const losingSide = actualFor.eq(actualAgainst) ? 'None' : actualFor.gt(actualAgainst) ? 'Against' : 'For';
    const losingWasted = actualFor.gt(actualAgainst) ? wastedAgainst : actualAgainst.gt(actualFor) ? wastedFor : ethers.BigNumber.from(0);
    const leadingWasted = actualFor.gt(actualAgainst) ? wastedFor : actualAgainst.gt(actualFor) ? wastedAgainst : ethers.BigNumber.from(0);
    const netLosingWasted = losingWasted.gt(leadingWasted) ? losingWasted.sub(leadingWasted) : ethers.BigNumber.from(0);
    const adjustedLeadingSide = adjustedVotes.forVotes.eq(adjustedVotes.againstVotes)
        ? 'Tie'
        : adjustedVotes.forVotes.gt(adjustedVotes.againstVotes) ? 'For' : 'Against';
    const couldSwing = leadingSide !== 'Tie' && adjustedLeadingSide !== 'Tie' && leadingSide !== adjustedLeadingSide;

    return {
        id: proposal.id,
        proposal,
        title,
        stateName: PROPOSAL_STATES[proposal.state] || `State ${proposal.state}`,
        voteEvents,
        zeroWallets: classifiedZeroWallets,
        voterWalletCount,
        zeroWalletCount: classifiedZeroWallets.length,
        wastedWalletCount: wastedWallets.length,
        noRightsWasteWalletCount: noRightsWasteWallets.length,
        delegateMissedWalletCount: delegateMissedWallets.length,
        alignedDelegatedWalletCount: alignedDelegatedWallets.length,
        misalignedWalletCount: misalignedWallets.length,
        wastedFor,
        wastedAgainst,
        wastedAbstain,
        wastedTotal: wastedFor.add(wastedAgainst).add(wastedAbstain),
        noRightsWasteTotal,
        delegateMissedWasteTotal,
        alignedDelegatedTotal,
        misalignedDelegatedTotal,
        actualFor,
        actualAgainst,
        actualTotal,
        snapshotTotalSupply: snapshotSupply,
        snapshotHolderCount: Number(snapshotHolderCount || 0),
        snapshotReadyHolderCount: Number(snapshotReadyHolderCount || 0),
        snapshotReadyDcultSupply: readyDcultSupply,
        snapshotGuardianHolderCount: Number(snapshotGuardianHolderCount || 0),
        snapshotGuardianReadyHolderCount: Number(snapshotGuardianReadyHolderCount || 0),
        snapshotGuardianDcultSupply: ethers.BigNumber.from(snapshotGuardianDcultSupply || '0'),
        snapshotGuardianReadyDcultSupply: ethers.BigNumber.from(snapshotGuardianReadyDcultSupply || '0'),
        adjustedFor: adjustedVotes.forVotes,
        adjustedAgainst: adjustedVotes.againstVotes,
        adjustedLeadingSide,
        margin,
        leadingSide,
        losingSide,
        leadingWasted,
        losingWasted,
        netLosingWasted,
        couldSwing,
        delegateDuty: normalizeDelegateDuty(delegateDuty),
        scannedToBlock,
        scanError,
    };
}

function classifyZeroWallets(zeroWallets, voteEvents) {
    const delegateVotes = getEffectiveVoteByVoter(voteEvents);

    return zeroWallets.map((wallet) => {
        const snapshotBalance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
        const voter = String(wallet.voter || '');
        const snapshotDelegate = String(wallet.snapshotDelegate || ZERO_ADDRESS);

        if (snapshotBalance.isZero()) {
            return {
                ...wallet,
                representationStatus: 'empty',
                wasteReason: 'none',
                delegateSupport: null,
                delegateVotes: '0',
                delegateVoter: '',
            };
        }

        if (isThirdPartyDelegate(voter, snapshotDelegate)) {
            const delegateVote = delegateVotes.get(snapshotDelegate.toLowerCase());
            if (delegateVote && !ethers.BigNumber.from(delegateVote.votes || '0').isZero()) {
                const sameDirection = Number(delegateVote.support) === Number(wallet.support);
                return {
                    ...wallet,
                    representationStatus: sameDirection ? 'represented' : 'misaligned',
                    wasteReason: 'none',
                    delegateSupport: Number(delegateVote.support),
                    delegateVotes: delegateVote.votes || '0',
                    delegateVoter: delegateVote.voter,
                };
            }
        }

        return {
            ...wallet,
            representationStatus: 'wasted',
            wasteReason: isThirdPartyDelegate(voter, snapshotDelegate) ? 'delegate_not_voted' : 'no_voting_rights',
            delegateSupport: null,
            delegateVotes: '0',
            delegateVoter: '',
        };
    });
}

function dedupeWalletRowsByVoter(wallets) {
    const rowsByVoter = new Map();
    for (const wallet of wallets || []) {
        const voter = String(wallet?.voter || '').toLowerCase();
        if (!voter || rowsByVoter.has(voter)) continue;
        rowsByVoter.set(voter, wallet);
    }
    return Array.from(rowsByVoter.values());
}

function getEffectiveVoteByVoter(voteEvents) {
    const result = new Map();

    for (const event of voteEvents || []) {
        const key = String(event.voter || '').toLowerCase();
        if (!key) continue;
        const existing = result.get(key);
        const hasVotes = !ethers.BigNumber.from(event.votes || '0').isZero();
        const existingHasVotes = existing && !ethers.BigNumber.from(existing.votes || '0').isZero();

        if (!existing || (hasVotes && !existingHasVotes)) {
            result.set(key, event);
        }
    }

    return result;
}

function isThirdPartyDelegate(voter, delegatee) {
    const delegate = String(delegatee || ZERO_ADDRESS).toLowerCase();
    return delegate !== ZERO_ADDRESS && delegate !== String(voter || '').toLowerCase();
}

function getIntentAdjustedVotes(actualFor, actualAgainst, zeroWallets) {
    return zeroWallets.reduce((acc, wallet) => {
        const snapshotBalance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
        if (snapshotBalance.isZero()) return acc;

        if (wallet.representationStatus === 'misaligned') {
            if (wallet.delegateSupport === 1) acc.forVotes = subtractBigNumberFloor(acc.forVotes, snapshotBalance);
            if (wallet.delegateSupport === 0) acc.againstVotes = subtractBigNumberFloor(acc.againstVotes, snapshotBalance);
        }

        if (wallet.representationStatus === 'wasted' || wallet.representationStatus === 'misaligned') {
            if (wallet.support === 1) acc.forVotes = acc.forVotes.add(snapshotBalance);
            if (wallet.support === 0) acc.againstVotes = acc.againstVotes.add(snapshotBalance);
        }

        return acc;
    }, {
        forVotes: ethers.BigNumber.from(actualFor || 0),
        againstVotes: ethers.BigNumber.from(actualAgainst || 0),
    });
}

function subtractBigNumberFloor(value, amount) {
    const bn = ethers.BigNumber.from(value || 0);
    const subtrahend = ethers.BigNumber.from(amount || 0);
    return bn.gt(subtrahend) ? bn.sub(subtrahend) : ethers.BigNumber.from(0);
}

function sumWalletBalances(wallets) {
    return wallets.reduce((sum, wallet) => sum.add(ethers.BigNumber.from(wallet.snapshotBalance || '0')), ethers.BigNumber.from(0));
}

function hasCachedDelegateDutyMetrics(row) {
    return Boolean((row?.delegateDutyIndexed || row?.delegateDutyCachePresent) && row?.delegateDuty);
}

function hasCachedHolderSnapshotMetrics(row) {
    return Boolean(row?.holderMetricsIndexed || row?.holderMetricsCachePresent);
}

function hasCachedDelegateOwnPower(row) {
    if (row?.delegateOwnPowerCachePresent) return true;
    const duty = normalizeDelegateDuty(row?.delegateDuty);
    return !duty.absentDelegates.concat(duty.votedDelegates).length;
}

function hasStoredDelegateDutyMetrics(cached) {
    if (!cached?.delegateDuty || typeof cached.delegateDuty !== 'object') return false;
    if (cached.delegateDutyIndexed === true) return true;

    const duty = cached.delegateDuty;
    return Number(duty.activeDelegateCount || 0) > 0
        || (Array.isArray(duty.absentDelegates) && duty.absentDelegates.length > 0)
        || (Array.isArray(duty.votedDelegates) && duty.votedDelegates.length > 0);
}

function hasStoredHolderSnapshotMetrics(cached) {
    const hasFields = Boolean(
        cached
        && cached.snapshotHolderCount !== undefined
        && cached.snapshotReadyHolderCount !== undefined
        && cached.snapshotReadyDcultSupply !== undefined
        && cached.snapshotGuardianHolderCount !== undefined
        && cached.snapshotGuardianReadyHolderCount !== undefined
        && cached.snapshotGuardianDcultSupply !== undefined
        && cached.snapshotGuardianReadyDcultSupply !== undefined
    );
    if (!hasFields) return false;
    if (cached.holderMetricsIndexed === true) return true;

    return Number(cached.snapshotHolderCount || 0) > 0
        || Number(cached.snapshotReadyHolderCount || 0) > 0
        || !ethers.BigNumber.from(cached.snapshotReadyDcultSupply || '0').isZero();
}

function hasStoredDelegateOwnPower(delegateDuty) {
    if (!delegateDuty || typeof delegateDuty !== 'object') return false;
    const rows = []
        .concat(Array.isArray(delegateDuty.absentDelegates) ? delegateDuty.absentDelegates : [])
        .concat(Array.isArray(delegateDuty.votedDelegates) ? delegateDuty.votedDelegates : []);
    return rows.every((delegateRow) => (
        delegateRow.ownBalance !== undefined
        && delegateRow.ownVotingPower !== undefined
        && delegateRow.combinedVotingPower !== undefined
    ));
}

async function attachDelegateDutyMetrics(rows) {
    const snapshotBlocks = rows.map((row) => Number(row.proposal.startBlock || 0)).filter((block) => Number.isFinite(block) && block > 0);
    if (!snapshotBlocks.length) return;

    const maxSnapshotBlock = Math.max(...snapshotBlocks);
    const index = await getDelegateDutyIndex(maxSnapshotBlock);
    const ledger = createDelegateDutyLedger();
    const rowsAsc = [...rows].sort((a, b) => Number(a.proposal.startBlock || 0) - Number(b.proposal.startBlock || 0));
    let eventCursor = 0;

    for (const row of rowsAsc) {
        const snapshotBlock = Number(row.proposal.startBlock || 0);
        while (eventCursor < index.events.length && index.events[eventCursor].blockNumber <= snapshotBlock) {
            applyDelegateDutyEvent(ledger, index.events[eventCursor]);
            eventCursor += 1;
        }

        row.delegateDuty = summarizeDelegateDutySnapshot(ledger, row.voteEvents);
        row.delegateDutyIndexed = true;
        row.delegateDutyCachePresent = true;
        row.delegateOwnPowerCachePresent = false;
        const cached = cache.proposals[String(row.id)];
        if (cached) {
            cached.delegateDuty = row.delegateDuty;
            cached.delegateDutyIndexed = row.delegateDutyIndexed;
        }
    }
}

async function attachHolderSnapshotMetrics(rows) {
    const snapshotBlocks = rows.map((row) => Number(row.proposal.startBlock || 0)).filter((block) => Number.isFinite(block) && block > 0);
    if (!snapshotBlocks.length) return;

    const maxSnapshotBlock = Math.max(...snapshotBlocks);
    const index = await getHolderSnapshotIndex(maxSnapshotBlock);
    const ledger = createHolderSnapshotLedger();
    const rowsAsc = [...rows].sort((a, b) => Number(a.proposal.startBlock || 0) - Number(b.proposal.startBlock || 0));
    let eventCursor = 0;

    for (const row of rowsAsc) {
        const snapshotBlock = Number(row.proposal.startBlock || 0);
        while (eventCursor < index.events.length && index.events[eventCursor].blockNumber <= snapshotBlock) {
            applyHolderSnapshotEvent(ledger, index.events[eventCursor]);
            eventCursor += 1;
        }

        row.snapshotHolderCount = ledger.holderCount;
        row.snapshotReadyHolderCount = ledger.readyHolderCount;
        row.snapshotReadyDcultSupply = ethers.BigNumber.from(ledger.readyDcultSupply.toString());
        const guardianSnapshot = await getGuardianSnapshotMetrics(snapshotBlock, ledger);
        row.snapshotGuardianHolderCount = guardianSnapshot.holderCount;
        row.snapshotGuardianReadyHolderCount = guardianSnapshot.readyHolderCount;
        row.snapshotGuardianDcultSupply = guardianSnapshot.dcultSupply;
        row.snapshotGuardianReadyDcultSupply = guardianSnapshot.readyDcultSupply;
        row.delegateDuty = enrichDelegateDutyWithOwnPower(row.delegateDuty, ledger);
        row.holderMetricsIndexed = true;
        row.holderMetricsCachePresent = true;
        row.delegateOwnPowerCachePresent = true;
        const cached = cache.proposals[String(row.id)];
        if (cached) {
            cached.snapshotHolderCount = row.snapshotHolderCount;
            cached.snapshotReadyHolderCount = row.snapshotReadyHolderCount;
            cached.snapshotReadyDcultSupply = row.snapshotReadyDcultSupply.toString();
            cached.snapshotGuardianHolderCount = row.snapshotGuardianHolderCount;
            cached.snapshotGuardianReadyHolderCount = row.snapshotGuardianReadyHolderCount;
            cached.snapshotGuardianDcultSupply = row.snapshotGuardianDcultSupply.toString();
            cached.snapshotGuardianReadyDcultSupply = row.snapshotGuardianReadyDcultSupply.toString();
            cached.delegateDuty = row.delegateDuty;
            cached.holderMetricsIndexed = row.holderMetricsIndexed;
        }
    }
}

function enrichDelegateDutyWithOwnPower(delegateDuty, holderLedger) {
    const duty = normalizeDelegateDuty(delegateDuty);
    const enrichRow = (delegateRow) => {
        const delegatee = String(delegateRow.delegatee || '').toLowerCase();
        const ownBalance = holderLedger.balances.get(delegatee) || 0n;
        const ownDelegate = holderLedger.delegates.get(delegatee) || ZERO_ADDRESS;
        const ownVotingPower = ownDelegate === delegatee ? ownBalance : 0n;
        const delegatedPower = BigInt(String(delegateRow.delegatedPower || '0'));
        return {
            ...delegateRow,
            ownBalance: ownBalance.toString(),
            ownVotingPower: ownVotingPower.toString(),
            ownDelegate: ethers.utils.getAddress(ownDelegate),
            combinedVotingPower: (delegatedPower + ownVotingPower).toString(),
        };
    };

    return normalizeDelegateDuty({
        ...duty,
        votedDelegates: duty.votedDelegates.map(enrichRow),
        absentDelegates: duty.absentDelegates.map(enrichRow),
    });
}

async function getGuardianSnapshotMetrics(snapshotBlock, ledger) {
    const addresses = await getGuardianAddressesAtBlock(snapshotBlock);
    let holderCount = 0;
    let readyHolderCount = 0;
    let dcultSupply = 0n;
    let readyDcultSupply = 0n;

    for (const address of addresses) {
        const key = address.toLowerCase();
        const balance = ledger.balances.get(key) || 0n;
        if (balance <= 0n) continue;

        holderCount += 1;
        dcultSupply += balance;
        if (holderSnapshotHasDelegate(ledger, key)) {
            readyHolderCount += 1;
            readyDcultSupply += balance;
        }
    }

    return {
        holderCount,
        readyHolderCount,
        dcultSupply: ethers.BigNumber.from(dcultSupply.toString()),
        readyDcultSupply: ethers.BigNumber.from(readyDcultSupply.toString()),
    };
}

async function getGuardianAddressesAtBlock(blockNumber) {
    const block = Number(blockNumber || 0);
    if (!Number.isFinite(block) || block <= 0) return [];
    if (guardianSnapshotCache.has(block)) return guardianSnapshotCache.get(block);

    const promise = fetchGuardianAddressesAtBlock(block).catch((error) => {
        console.warn(`Unable to fetch guardian snapshot at block ${block}:`, error);
        return [];
    });
    guardianSnapshotCache.set(block, promise);
    return promise;
}

async function fetchGuardianAddressesAtBlock(blockNumber) {
    const limit = FALLBACK_GUARDIAN_COUNT;
    const rows = [];
    await mapLimit(Array.from({ length: limit }, (_, index) => index), CALL_CONCURRENCY, async (index) => {
        try {
            const row = await dcultContract.highestStakerInPool(GUARDIAN_POOL_ID, index, { blockTag: blockNumber });
            const address = ethers.utils.getAddress(getContractGuardianAddress(row));
            if (address.toLowerCase() !== ZERO_ADDRESS) rows.push(address);
        } catch {
            // Older snapshots or RPCs without archive support can fail per slot.
        }
    });

    return Array.from(new Set(rows.filter(Boolean).map((address) => ethers.utils.getAddress(address))));
}

async function getHolderSnapshotIndex(toBlock) {
    if (holderSnapshotIndexPromise && holderSnapshotIndexToBlock >= toBlock) return holderSnapshotIndexPromise;

    holderSnapshotIndexToBlock = toBlock;
    holderSnapshotIndexPromise = buildHolderSnapshotIndex(toBlock).catch((error) => {
        holderSnapshotIndexPromise = null;
        holderSnapshotIndexToBlock = 0;
        throw error;
    });
    return holderSnapshotIndexPromise;
}

async function buildHolderSnapshotIndex(toBlock) {
    const safeToBlock = Math.max(DCULT_START_BLOCK, Number(toBlock || DCULT_START_BLOCK));
    const [transferLogs, delegateLogs] = await Promise.all([
        getLogsWithSplit({
            address: DCULT_ADDRESS,
            topics: [TRANSFER_TOPIC],
            fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
            toBlock: ethers.utils.hexValue(safeToBlock),
        }, HISTORY_LOG_CHUNK_SIZE),
        getLogsWithSplit({
            address: DCULT_ADDRESS,
            topics: [DELEGATE_CHANGED_TOPIC],
            fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
            toBlock: ethers.utils.hexValue(safeToBlock),
        }, HISTORY_LOG_CHUNK_SIZE),
    ]);

    const events = transferLogs
        .map(parseTransferDutyEvent)
        .concat(delegateLogs.map(parseDelegateDutyEvent))
        .filter(Boolean)
        .sort(sortDutyEventsAsc);
    return { toBlock: safeToBlock, events };
}

function createHolderSnapshotLedger() {
    return {
        balances: new Map(),
        delegates: new Map(),
        holderCount: 0,
        readyHolderCount: 0,
        readyDcultSupply: 0n,
    };
}

function applyHolderSnapshotEvent(ledger, event) {
    if (event.type === 'transfer') {
        moveHolderSnapshotBalance(ledger, event.from, -event.value);
        moveHolderSnapshotBalance(ledger, event.to, event.value);
        return;
    }

    if (event.type === 'delegate') {
        updateHolderSnapshotDelegate(ledger, event.delegator, event.toDelegate);
    }
}

function moveHolderSnapshotBalance(ledger, address, delta) {
    if (!address || address === ZERO_ADDRESS || delta === 0n) return;
    const previous = ledger.balances.get(address) || 0n;
    const next = previous + delta;
    const wasHolder = previous > 0n;
    const isHolder = next > 0n;
    const hasDelegate = holderSnapshotHasDelegate(ledger, address);
    if (hasDelegate) ledger.readyDcultSupply += delta;

    if (!wasHolder && isHolder) {
        ledger.holderCount += 1;
        if (hasDelegate) ledger.readyHolderCount += 1;
    }
    if (wasHolder && !isHolder) {
        ledger.holderCount -= 1;
        if (hasDelegate) ledger.readyHolderCount -= 1;
    }

    if (next <= 0n) {
        ledger.balances.delete(address);
    } else {
        ledger.balances.set(address, next);
    }
}

function updateHolderSnapshotDelegate(ledger, address, delegatee) {
    if (!address || address === ZERO_ADDRESS) return;
    const balance = ledger.balances.get(address) || 0n;
    const isHolder = balance > 0n;
    const wasReady = isHolder && holderSnapshotHasDelegate(ledger, address);

    if (!delegatee || delegatee === ZERO_ADDRESS) {
        ledger.delegates.delete(address);
    } else {
        ledger.delegates.set(address, delegatee);
    }

    const isReady = isHolder && holderSnapshotHasDelegate(ledger, address);
    if (!wasReady && isReady) {
        ledger.readyHolderCount += 1;
        ledger.readyDcultSupply += balance;
    }
    if (wasReady && !isReady) {
        ledger.readyHolderCount -= 1;
        ledger.readyDcultSupply -= balance;
    }
}

function holderSnapshotHasDelegate(ledger, address) {
    const delegatee = ledger.delegates.get(address);
    return Boolean(delegatee && delegatee !== ZERO_ADDRESS);
}

async function getDelegateDutyIndex(toBlock) {
    if (delegateDutyIndexPromise && delegateDutyIndexToBlock >= toBlock) return delegateDutyIndexPromise;

    delegateDutyIndexToBlock = toBlock;
    delegateDutyIndexPromise = buildDelegateDutyIndex(toBlock).catch((error) => {
        delegateDutyIndexPromise = null;
        delegateDutyIndexToBlock = 0;
        throw error;
    });
    return delegateDutyIndexPromise;
}

async function buildDelegateDutyIndex(toBlock) {
    const safeToBlock = Math.max(DCULT_START_BLOCK, Number(toBlock || DCULT_START_BLOCK));
    const delegateLogs = await getLogsWithSplit({
        address: DCULT_ADDRESS,
        topics: [DELEGATE_CHANGED_TOPIC],
        fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
        toBlock: ethers.utils.hexValue(safeToBlock),
    }, HISTORY_LOG_CHUNK_SIZE);

    const events = [];
    const delegators = new Set();
    for (const log of delegateLogs) {
        const event = parseDelegateDutyEvent(log);
        if (!event) continue;
        events.push(event);
        delegators.add(event.delegator);
    }
    events.push(...await getDutyTransferEventsForDelegators(Array.from(delegators), safeToBlock));

    events.sort(sortDutyEventsAsc);
    return { toBlock: safeToBlock, events };
}

async function getDutyTransferEventsForDelegators(delegators, toBlock) {
    const eventsByKey = new Map();
    if (!delegators.length) return [];

    for (const delegatorChunk of chunkArray(delegators, ADDRESS_TOPIC_CHUNK_SIZE)) {
        const topics = delegatorChunk.map(addressTopic);
        const [incoming, outgoing] = await Promise.all([
            getLogsWithSplit({
                address: DCULT_ADDRESS,
                topics: [TRANSFER_TOPIC, null, topics],
                fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
                toBlock: ethers.utils.hexValue(toBlock),
            }, HISTORY_LOG_CHUNK_SIZE),
            getLogsWithSplit({
                address: DCULT_ADDRESS,
                topics: [TRANSFER_TOPIC, topics, null],
                fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
                toBlock: ethers.utils.hexValue(toBlock),
            }, HISTORY_LOG_CHUNK_SIZE),
        ]);

        for (const log of incoming.concat(outgoing)) {
            const key = eventKey(log);
            if (eventsByKey.has(key)) continue;
            const event = parseTransferDutyEvent(log);
            if (event) eventsByKey.set(key, event);
        }
    }

    return Array.from(eventsByKey.values());
}

function parseTransferDutyEvent(log) {
    if (!log?.topics || log.topics.length < 3 || !log.data) return null;
    return {
        type: 'transfer',
        blockNumber: parseRpcNumber(log.blockNumber),
        transactionIndex: parseRpcNumber(log.transactionIndex || '0x0'),
        logIndex: parseRpcNumber(log.logIndex || '0x0'),
        from: topicToAddress(log.topics[1]).toLowerCase(),
        to: topicToAddress(log.topics[2]).toLowerCase(),
        value: BigInt(log.data),
    };
}

function parseDelegateDutyEvent(log) {
    if (!log?.topics || log.topics.length < 4) return null;
    return {
        type: 'delegate',
        blockNumber: parseRpcNumber(log.blockNumber),
        transactionIndex: parseRpcNumber(log.transactionIndex || '0x0'),
        logIndex: parseRpcNumber(log.logIndex || '0x0'),
        delegator: topicToAddress(log.topics[1]).toLowerCase(),
        toDelegate: topicToAddress(log.topics[3]).toLowerCase(),
    };
}

function sortDutyEventsAsc(a, b) {
    return (a.blockNumber - b.blockNumber)
        || (a.transactionIndex - b.transactionIndex)
        || (a.logIndex - b.logIndex);
}

function createDelegateDutyLedger() {
    return {
        balances: new Map(),
        delegates: new Map(),
    };
}

function applyDelegateDutyEvent(ledger, event) {
    if (event.type === 'transfer') {
        moveLedgerBalance(ledger.balances, event.from, -event.value);
        moveLedgerBalance(ledger.balances, event.to, event.value);
        return;
    }

    if (event.type === 'delegate') {
        if (event.toDelegate === ZERO_ADDRESS) {
            ledger.delegates.delete(event.delegator);
        } else {
            ledger.delegates.set(event.delegator, event.toDelegate);
        }
    }
}

function moveLedgerBalance(balances, address, delta) {
    if (!address || address === ZERO_ADDRESS || delta === 0n) return;
    const next = (balances.get(address) || 0n) + delta;
    if (next <= 0n) {
        balances.delete(address);
    } else {
        balances.set(address, next);
    }
}

function summarizeDelegateDutySnapshot(ledger, voteEvents) {
    const delegatedByDelegate = new Map();
    const effectiveVotes = getEffectiveVoteByVoter(voteEvents);

    for (const [delegator, balance] of ledger.balances.entries()) {
        if (balance <= 0n) continue;
        const delegatee = ledger.delegates.get(delegator) || ZERO_ADDRESS;
        if (!isThirdPartyDelegate(delegator, delegatee)) continue;

        const existing = delegatedByDelegate.get(delegatee) || {
            delegatee: ethers.utils.getAddress(delegatee),
            delegatedPower: 0n,
            delegatorCount: 0,
            delegators: [],
        };
        existing.delegatedPower += balance;
        existing.delegatorCount += 1;
        existing.delegators.push({
            delegator: ethers.utils.getAddress(delegator),
            balance: balance.toString(),
        });
        delegatedByDelegate.set(delegatee, existing);
    }

    let activeDelegatedPower = 0n;
    let votedDelegatedPower = 0n;
    let absentDelegatedPower = 0n;
    let activeDelegatorCount = 0;
    let votedDelegatorCount = 0;
    let absentDelegatorCount = 0;
    const votedDelegates = [];
    const absentDelegates = [];

    for (const delegateData of delegatedByDelegate.values()) {
        if (delegateData.delegatedPower <= 0n) continue;
        const vote = effectiveVotes.get(delegateData.delegatee.toLowerCase());
        const voted = vote && !ethers.BigNumber.from(vote.votes || '0').isZero();
        const row = {
            delegatee: delegateData.delegatee,
            delegatedPower: delegateData.delegatedPower.toString(),
            delegatorCount: delegateData.delegatorCount,
            delegators: delegateData.delegators.sort(sortDelegatorRowsDesc),
            support: voted ? Number(vote.support) : null,
            votes: voted ? String(vote.votes || '0') : '0',
        };

        activeDelegatedPower += delegateData.delegatedPower;
        activeDelegatorCount += delegateData.delegatorCount;

        if (voted) {
            votedDelegatedPower += delegateData.delegatedPower;
            votedDelegatorCount += delegateData.delegatorCount;
            votedDelegates.push(row);
        } else {
            absentDelegatedPower += delegateData.delegatedPower;
            absentDelegatorCount += delegateData.delegatorCount;
            absentDelegates.push(row);
        }
    }

    votedDelegates.sort(sortDelegateDutyRowsDesc);
    absentDelegates.sort(sortDelegateDutyRowsDesc);

    return normalizeDelegateDuty({
        activeDelegateCount: delegatedByDelegate.size,
        votedDelegateCount: votedDelegates.length,
        absentDelegateCount: absentDelegates.length,
        activeDelegatorCount,
        votedDelegatorCount,
        absentDelegatorCount,
        activeDelegatedPower: activeDelegatedPower.toString(),
        votedDelegatedPower: votedDelegatedPower.toString(),
        absentDelegatedPower: absentDelegatedPower.toString(),
        votedDelegates,
        absentDelegates,
    });
}

function sortDelegateDutyRowsDesc(a, b) {
    const left = ethers.BigNumber.from(a.delegatedPower || '0');
    const right = ethers.BigNumber.from(b.delegatedPower || '0');
    return compareBigNumbersDesc(left, right);
}

function sortDelegatorRowsDesc(a, b) {
    const left = ethers.BigNumber.from(a.balance || '0');
    const right = ethers.BigNumber.from(b.balance || '0');
    return compareBigNumbersDesc(left, right);
}

function normalizeDelegateDuty(duty = {}) {
    return {
        activeDelegateCount: Number(duty.activeDelegateCount || 0),
        votedDelegateCount: Number(duty.votedDelegateCount || 0),
        absentDelegateCount: Number(duty.absentDelegateCount || 0),
        activeDelegatorCount: Number(duty.activeDelegatorCount || 0),
        votedDelegatorCount: Number(duty.votedDelegatorCount || 0),
        absentDelegatorCount: Number(duty.absentDelegatorCount || 0),
        activeDelegatedPower: String(duty.activeDelegatedPower || '0'),
        votedDelegatedPower: String(duty.votedDelegatedPower || '0'),
        absentDelegatedPower: String(duty.absentDelegatedPower || '0'),
        votedDelegates: normalizeDelegateRows(duty.votedDelegates),
        absentDelegates: normalizeDelegateRows(duty.absentDelegates),
    };
}

function normalizeDelegateRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
        ...row,
        ownBalance: String(row.ownBalance || '0'),
        ownVotingPower: String(row.ownVotingPower || '0'),
        ownDelegate: row.ownDelegate || ZERO_ADDRESS,
        combinedVotingPower: String(row.combinedVotingPower || ethers.BigNumber.from(row.delegatedPower || '0').add(row.ownVotingPower || '0').toString()),
        delegators: Array.isArray(row.delegators) ? row.delegators : [],
    }));
}

function isVoteOutcomeProposal(row) {
    const state = Number(row.proposal.state);
    return [3, 4, 5, 7].includes(state) || isCanceledAfterPassingProposal(row);
}

function isDelegateDutyReportable(row) {
    return Number(row?.proposal?.state) !== 2 || isCanceledAfterPassingProposal(row);
}

function isCanceledAfterPassingProposal(row) {
    const proposal = row?.proposal || row;
    const state = Number(proposal?.state);
    if (state !== 2 || proposal?.canceled === false) return false;

    const forVotes = ethers.BigNumber.from(proposal?.forVotes || '0');
    const againstVotes = ethers.BigNumber.from(proposal?.againstVotes || '0');
    const eta = ethers.BigNumber.from(proposal?.eta || '0');
    return forVotes.gt(againstVotes) && eta.isZero();
}

function getGuardianDcultSupply(row) {
    return ethers.BigNumber.from(row.snapshotGuardianDcultSupply || '0');
}

function getGuardianReadyDcultSupply(row) {
    return ethers.BigNumber.from(row.snapshotGuardianReadyDcultSupply || '0');
}

function getEligibleDcultSupply(row) {
    return subtractBigNumberFloor(row.snapshotTotalSupply || '0', getGuardianDcultSupply(row));
}

function getEligibleReadyDcultSupply(row) {
    return subtractBigNumberFloor(row.snapshotReadyDcultSupply || '0', getGuardianReadyDcultSupply(row));
}

function getEligibleHolderWallets(row) {
    return Math.max(0, Number(row.snapshotHolderCount || 0) - Number(row.snapshotGuardianHolderCount || 0));
}

function getEligibleReadyHolderWallets(row) {
    return Math.max(0, Number(row.snapshotReadyHolderCount || 0) - Number(row.snapshotGuardianReadyHolderCount || 0));
}

function getWastedWalletRecurrence(rows) {
    const wallets = new Map();
    for (const row of rows || []) {
        const proposalId = String(row.id || row.proposal?.id || '');
        for (const wallet of row.zeroWallets || []) {
            if (wallet.representationStatus !== 'wasted') continue;
            const voter = String(wallet.voter || '').toLowerCase();
            if (!voter) continue;

            if (!wallets.has(voter)) {
                wallets.set(voter, {
                    attempts: 0,
                    proposals: new Set(),
                    power: ethers.BigNumber.from(0),
                });
            }

            const record = wallets.get(voter);
            record.attempts += 1;
            record.proposals.add(proposalId);
            record.power = record.power.add(wallet.snapshotBalance || '0');
        }
    }

    const result = {
        repeatWallets: 0,
        oneTimeWallets: 0,
        repeatAttempts: 0,
        oneTimeAttempts: 0,
        repeatPower: ethers.BigNumber.from(0),
        oneTimePower: ethers.BigNumber.from(0),
    };

    for (const record of wallets.values()) {
        const isRepeat = record.proposals.size > 1;
        if (isRepeat) {
            result.repeatWallets += 1;
            result.repeatAttempts += record.attempts;
            result.repeatPower = result.repeatPower.add(record.power);
        } else {
            result.oneTimeWallets += 1;
            result.oneTimeAttempts += record.attempts;
            result.oneTimePower = result.oneTimePower.add(record.power);
        }
    }

    result.totalWallets = result.repeatWallets + result.oneTimeWallets;
    result.totalAttempts = result.repeatAttempts + result.oneTimeAttempts;
    result.totalPower = result.repeatPower.add(result.oneTimePower);
    return result;
}

function formatWastedRecurrenceHtml(recurrence) {
    const repeatShare = formatCountPercent(recurrence.repeatWallets, recurrence.totalWallets, 1);
    const repeatPowerShare = formatPercent(recurrence.repeatPower, recurrence.totalPower, 1);
    return `
        <span>${formatInteger(recurrence.repeatWallets)} / ${formatInteger(recurrence.oneTimeWallets)} wallets</span>
        <span class="value-subline">${formatInteger(recurrence.repeatAttempts)} / ${formatInteger(recurrence.oneTimeAttempts)} vote attempts</span>
        <span class="value-subline">${formatTokenAmount(recurrence.repeatPower, 0)} / ${formatTokenAmount(recurrence.oneTimePower, 0)} dCULT</span>
        <span class="value-subline">${repeatShare} wallets / ${repeatPowerShare} dCULT repeat</span>
    `;
}

function renderWastedSourceChart(rows) {
    if (!el.wastedSourceChart) return;

    const mode = getSourceChartMode();
    const points = getWastedSourceTrend(rows, mode);
    const lastPoint = points[points.length - 1];
    if (!lastPoint) {
        el.wastedSourceChart.innerHTML = '<p class="empty-state">No wasted vote source data yet.</p>';
        return;
    }

    const summaryPoint = getSourceLegendPoint(points, mode);
    if (summaryPoint.chartTotal.isZero()) {
        el.wastedSourceChart.innerHTML = '<p class="empty-state">No wasted vote source data yet.</p>';
        return;
    }

    const hasUnclassified = points.some((point) => point.unclassified.gt(0));
    const series = getSourceChartSeries(hasUnclassified);
    const visibleTotal = getVisibleSourceTotal(summaryPoint, series);
    const legendItems = series.map((item) => renderSourceLegendItem(
        item,
        getSourcePointValue(summaryPoint, item.key),
        visibleTotal,
        isSourceSeriesVisible(item.key),
        summaryPoint,
        mode,
    )).join('');
    const note = mode === 'cumulative'
        ? 'Each bar accumulates missed voting power through that proposal.'
        : 'Each bar is one non-canceled proposal, split by missed-power source.';

    const latestProposalLabel = lastPoint.id ? `through #${escapeHtml(lastPoint.id)}` : 'through latest indexed proposal';
    el.wastedSourceChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>${mode === 'cumulative'
                    ? `Cumulative non-canceled proposal history, ${latestProposalLabel}.`
                    : `Per-proposal missed voting power, latest shown #${escapeHtml(lastPoint.id)}.`}</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${formatDcultBillions(visibleTotal)} ${mode === 'proposal' ? 'shown total' : 'through latest'}</span>
                    <span>${formatDcultBillions(summaryPoint.stackTotal)} direct / ${formatDcultBillions(summaryPoint.absentDuty)} absent duty</span>
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Missed voting power chart mode">
                    <button class="chart-mode-button ${mode === 'proposal' ? 'is-active' : ''}" type="button" data-source-chart-mode="proposal" aria-pressed="${mode === 'proposal' ? 'true' : 'false'}">By proposal</button>
                    <button class="chart-mode-button ${mode === 'cumulative' ? 'is-active' : ''}" type="button" data-source-chart-mode="cumulative" aria-pressed="${mode === 'cumulative' ? 'true' : 'false'}">Cumulative</button>
                </div>
            </div>
        </div>
        <div class="source-chart-body">
            ${renderWastedSourceAreaSvg(points, series)}
            <div class="source-chart-legend">${legendItems}</div>
        </div>
        <p class="source-chart-note">${escapeHtml(note)}</p>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function handleWastedSourceChartClick(event) {
    const modeButton = event.target.closest('[data-source-chart-mode]');
    if (modeButton) {
        const mode = modeButton.dataset.sourceChartMode === 'proposal' ? 'proposal' : 'cumulative';
        if (sourceChartState.mode !== mode) {
            sourceChartState.mode = mode;
            renderWastedSourceChart((currentRows || []).filter(isDelegateDutyReportable));
        }
        return;
    }

    const toggleButton = event.target.closest('[data-source-toggle]');
    if (toggleButton) {
        const key = toggleButton.dataset.sourceToggle;
        if (key && Object.prototype.hasOwnProperty.call(sourceChartState.visible, key)) {
            const points = getWastedSourceTrend((currentRows || []).filter(isDelegateDutyReportable), getSourceChartMode());
            const lastPoint = points[points.length - 1];
            const series = getSourceChartSeries(Boolean(lastPoint?.unclassified?.gt(0)));
            const visibleCount = series.filter((item) => isSourceSeriesVisible(item.key)).length;
            if (sourceChartState.visible[key] && visibleCount <= 1) return;
            sourceChartState.visible[key] = !sourceChartState.visible[key];
            renderWastedSourceChart((currentRows || []).filter(isDelegateDutyReportable));
        }
        return;
    }

}

function getSourceLegendPoint(points, mode = getSourceChartMode()) {
    if (mode === 'cumulative') return points[points.length - 1];

    const lastPoint = points[points.length - 1] || createZeroSourcePoint('');
    return points.reduce((summary, point) => ({
        id: lastPoint.id,
        title: lastPoint.title,
        noRights: summary.noRights.add(point.noRights || '0'),
        delegateMissed: summary.delegateMissed.add(point.delegateMissed || '0'),
        directWasted: summary.directWasted.add(point.directWasted || '0'),
        repeatWasted: summary.repeatWasted.add(point.repeatWasted || '0'),
        oneTimeWasted: summary.oneTimeWasted.add(point.oneTimeWasted || '0'),
        oneTimeNoRights: summary.oneTimeNoRights.add(point.oneTimeNoRights || '0'),
        oneTimeDelegateMissed: summary.oneTimeDelegateMissed.add(point.oneTimeDelegateMissed || '0'),
        absentDuty: summary.absentDuty.add(point.absentDuty || '0'),
        unclassified: summary.unclassified.add(point.unclassified || '0'),
        sourceTotal: summary.sourceTotal.add(point.sourceTotal || '0'),
        total: summary.total.add(point.total || '0'),
        stackTotal: summary.stackTotal.add(point.stackTotal || '0'),
        chartTotal: summary.chartTotal.add(point.chartTotal || '0'),
    }), {
        ...createZeroSourcePoint(lastPoint.id),
        title: lastPoint.title,
        sourceTotal: ethers.BigNumber.from(0),
        total: ethers.BigNumber.from(0),
        stackTotal: ethers.BigNumber.from(0),
        chartTotal: ethers.BigNumber.from(0),
    });
}

function handleWastedSourceChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.wastedSourceChart.contains(band)) {
        hideWastedSourceChartTooltip();
        return;
    }

    const tooltip = el.wastedSourceChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderSourceChartTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.wastedSourceChart, tooltip, event);
}

function hideWastedSourceChartTooltip() {
    const tooltip = el.wastedSourceChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderProposalCompositionChart(rows) {
    if (!el.proposalCompositionChart) return;

    const points = getProposalCompositionTrend(rows);
    const lastPoint = points[points.length - 1];
    if (!lastPoint) {
        el.proposalCompositionChart.innerHTML = '<p class="empty-state">No proposal composition data yet.</p>';
        return;
    }

    const series = getProposalCompositionSeries();
    const averageShares = getProposalCompositionAverageShares(points, series);
    const legendItems = series.map((item) => renderProposalCompositionLegendItem(
        item,
        averageShares[item.key],
        isProposalCompositionSeriesVisible(item.key),
    )).join('');
    const latestProposalLabel = lastPoint.id ? `latest #${escapeHtml(lastPoint.id)}` : 'latest indexed proposal';
    const latestVisibleTotal = getProposalCompositionVisibleTotal(lastPoint, series);
    const latestReadyTotal = getProposalCompositionPointValue(lastPoint, 'readyEligibleSupply');
    const latestEligibleTotal = getProposalCompositionPointValue(lastPoint, 'eligibleSupply');
    const mode = getProposalCompositionMode();
    const modeCopy = mode === 'wallet'
        ? 'Per-proposal wallet count, normalized to the currently visible series. Eligible + ready wallets are staked wallets with active governance delegation; eligible staked wallets are staked holders excluding protocol-ineligible guardians.'
        : 'Per-proposal token weight, normalized to the currently visible series. Eligible + ready dCULT is delegated voting power; eligible staked dCULT is staked supply excluding protocol-ineligible guardians.';

    el.proposalCompositionChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>${escapeHtml(modeCopy)}</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${formatProposalCompositionValue(latestVisibleTotal)} visible at ${latestProposalLabel}</span>
                    <span>${formatProposalCompositionValue(latestReadyTotal)} eligible + ready / ${formatProposalCompositionValue(latestEligibleTotal)} eligible staked</span>
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Proposal composition chart mode">
                    <button class="chart-mode-button ${mode === 'token' ? 'is-active' : ''}" type="button" data-proposal-composition-mode="token" aria-pressed="${mode === 'token' ? 'true' : 'false'}">Token weight</button>
                    <button class="chart-mode-button ${mode === 'wallet' ? 'is-active' : ''}" type="button" data-proposal-composition-mode="wallet" aria-pressed="${mode === 'wallet' ? 'true' : 'false'}">Wallet count</button>
                </div>
            </div>
        </div>
        <div class="source-chart-body">
            ${renderProposalCompositionSvg(points, series)}
            <div class="source-chart-legend">${legendItems}</div>
        </div>
        <p class="source-chart-note">Each point is one non-canceled proposal. Legend values are average percentages across the plotted proposals.</p>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getProposalCompositionTrend(rows) {
    return (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0))
        .map((row) => {
            const duty = normalizeDelegateDuty(row.delegateDuty);
            const directWastedWallets = Number(row.wastedWalletCount || 0);
            const tokenYesVotes = ethers.BigNumber.from(row.actualFor || '0');
            const tokenNoVotes = ethers.BigNumber.from(row.actualAgainst || '0');
            const walletVoteSplit = getProposalCompositionWalletVoteSplit(row, duty);
            return {
                id: String(row.id || row.proposal?.id || ''),
                title: stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || ''),
                token: {
                    actualVotes: tokenYesVotes.add(tokenNoVotes),
                    actualFor: tokenYesVotes,
                    actualAgainst: tokenNoVotes,
                    directWasted: ethers.BigNumber.from(row.wastedTotal || '0'),
                    absentDuty: ethers.BigNumber.from(duty.absentDelegatedPower || '0'),
                    eligibleSupply: getEligibleDcultSupply(row),
                    readyEligibleSupply: getEligibleReadyDcultSupply(row),
                },
                wallet: {
                    actualVotes: walletVoteSplit.actualFor + walletVoteSplit.actualAgainst,
                    actualFor: walletVoteSplit.actualFor,
                    actualAgainst: walletVoteSplit.actualAgainst,
                    directWasted: directWastedWallets,
                    absentDuty: Number(duty.absentDelegatorCount || 0),
                    eligibleSupply: getEligibleHolderWallets(row),
                    readyEligibleSupply: getEligibleReadyHolderWallets(row),
                },
            };
        });
}

function getProposalCompositionWalletVoteSplit(row, duty = normalizeDelegateDuty(row?.delegateDuty)) {
    const supportByWallet = new Map();
    const effectiveVotes = getEffectiveVoteByVoter(row?.voteEvents || []);

    for (const [wallet, event] of effectiveVotes.entries()) {
        if (ethers.BigNumber.from(event?.votes || '0').isZero()) continue;
        const support = Number(event.support);
        if (support === 1 || support === 0) supportByWallet.set(wallet, support);
    }

    for (const delegateRow of duty.votedDelegates || []) {
        const support = Number(delegateRow.support);
        if (support !== 1 && support !== 0) continue;
        for (const delegatorRow of delegateRow.delegators || []) {
            const delegator = String(delegatorRow.delegator || '').toLowerCase();
            if (!delegator || supportByWallet.has(delegator)) continue;
            supportByWallet.set(delegator, support);
        }
    }

    let actualFor = 0;
    let actualAgainst = 0;
    for (const support of supportByWallet.values()) {
        if (support === 1) actualFor += 1;
        if (support === 0) actualAgainst += 1;
    }

    return { actualFor, actualAgainst };
}

function getProposalCompositionSeries() {
    const walletMode = isProposalCompositionWalletMode();
    return [
        { key: 'actualVotes', className: 'proper-votes', label: walletMode ? 'Proper voting wallets' : 'Proper votes' },
        { key: 'directWasted', className: 'direct-wasted', label: walletMode ? 'Direct wasted wallets' : 'Direct wasted votes' },
        { key: 'absentDuty', className: 'absent-duty', label: walletMode ? 'Absent represented wallets' : 'Absent delegatee duty' },
        { key: 'readyEligibleSupply', className: 'ready-eligible-supply', label: walletMode ? 'Eligible + ready wallets' : 'Eligible + ready dCULT' },
        { key: 'eligibleSupply', className: 'eligible-supply', label: walletMode ? 'Eligible staked wallets' : 'Eligible staked dCULT' },
    ];
}

function isProposalCompositionSeriesVisible(key) {
    return proposalCompositionChartState.visible[key] !== false;
}

function getProposalCompositionMode() {
    return proposalCompositionChartState.mode === 'wallet' ? 'wallet' : 'token';
}

function isProposalCompositionWalletMode() {
    return getProposalCompositionMode() === 'wallet';
}

function getProposalCompositionPointValue(point, key) {
    if (isProposalCompositionWalletMode()) {
        return Number(point?.wallet?.[key] || 0);
    }
    return ethers.BigNumber.from(point?.token?.[key] || '0');
}

function getProposalCompositionZeroValue() {
    return isProposalCompositionWalletMode() ? 0 : ethers.BigNumber.from(0);
}

function addProposalCompositionValues(left, right) {
    if (isProposalCompositionWalletMode()) {
        return Number(left || 0) + Number(right || 0);
    }
    return ethers.BigNumber.from(left || '0').add(right || '0');
}

function getProposalCompositionValueNumber(value) {
    return isProposalCompositionWalletMode() ? Number(value || 0) : tokenNumber(value);
}

function getProposalCompositionSharePercentNumber(value, denominator) {
    if (isProposalCompositionWalletMode()) {
        const bottom = Number(denominator || 0);
        if (!bottom) return 0;
        return (Number(value || 0) / bottom) * 100;
    }
    return getSharePercentNumber(value, denominator);
}

function formatProposalCompositionValue(value) {
    if (isProposalCompositionWalletMode()) {
        return `${formatInteger(value)} wallets`;
    }
    return formatDcultBillions(value);
}

function formatProposalCompositionPercent(numerator, denominator, fractionDigits = 2) {
    if (isProposalCompositionWalletMode()) {
        return formatCountPercent(numerator, denominator, fractionDigits);
    }
    return formatPercent(numerator, denominator, fractionDigits);
}

function getProposalCompositionVisibleTotal(point, series) {
    return series.reduce((sum, item) => {
        if (!isProposalCompositionSeriesVisible(item.key)) return sum;
        return addProposalCompositionValues(sum, getProposalCompositionPointValue(point, item.key));
    }, getProposalCompositionZeroValue());
}

function getProposalCompositionAverageShares(points, series) {
    const averages = {};
    const count = Math.max((points || []).length, 1);
    for (const item of series) {
        averages[item.key] = { visible: 0, ready: 0, eligible: 0 };
    }

    for (const point of points || []) {
        const visibleTotal = getProposalCompositionVisibleTotal(point, series);
        const readyTotal = getProposalCompositionPointValue(point, 'readyEligibleSupply');
        const eligibleTotal = getProposalCompositionPointValue(point, 'eligibleSupply');
        for (const item of series) {
            const value = getProposalCompositionPointValue(point, item.key);
            averages[item.key].visible += isProposalCompositionSeriesVisible(item.key)
                ? getProposalCompositionSharePercentNumber(value, visibleTotal)
                : 0;
            averages[item.key].ready += getProposalCompositionSharePercentNumber(value, readyTotal);
            averages[item.key].eligible += getProposalCompositionSharePercentNumber(value, eligibleTotal);
        }
    }

    for (const item of series) {
        averages[item.key].visible /= count;
        averages[item.key].ready /= count;
        averages[item.key].eligible /= count;
    }

    return averages;
}

function renderProposalCompositionLegendItem(item, averages, active) {
    const visibleShare = `${formatDecimal(averages?.visible || 0, 1)}%`;
    const readyShare = `${formatDecimal(averages?.ready || 0, 1)}%`;
    const eligibleShare = `${formatDecimal(averages?.eligible || 0, 1)}%`;
    const detail = active
        ? `Avg per proposal: ${visibleShare} visible / ${readyShare} ready / ${eligibleShare} staked`
        : `Hidden · avg ${readyShare} ready / ${eligibleShare} staked`;

    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-proposal-composition-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${item.className}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
        </button>
    `;
}

function renderProposalCompositionSvg(points, series) {
    const width = 980;
    const height = 300;
    const pad = { top: 18, right: 18, bottom: 38, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const barWidth = innerWidth / Math.max(points.length, 1);
    const yFor = (percent) => pad.top + innerHeight - ((Number(percent) || 0) / 100) * innerHeight;

    const chartPoints = points.map((point, index) => {
        const chartPoint = {
            x: pad.left + index * barWidth,
            width: Math.max(barWidth - 1, 1),
        };
        const visibleTotal = getProposalCompositionValueNumber(getProposalCompositionVisibleTotal(point, series));
        let cursor = 0;
        for (const item of series) {
            const value = isProposalCompositionSeriesVisible(item.key)
                ? getProposalCompositionValueNumber(getProposalCompositionPointValue(point, item.key))
                : 0;
            const share = visibleTotal > 0 ? (value / visibleTotal) * 100 : 0;
            chartPoint[`${item.key}Bottom`] = cursor;
            cursor += share;
            chartPoint[`${item.key}Top`] = cursor;
        }
        chartPoint.visibleTotal = cursor;
        return chartPoint;
    });

    const grid = [100, 50, 0].map((value) => {
        const y = yFor(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${value}%</text>
            </g>
        `;
    }).join('');
    const activeBars = chartPoints.map((point, index) => series
        .filter((item) => isProposalCompositionSeriesVisible(item.key))
        .map((item) => {
            const bottom = point[`${item.key}Bottom`];
            const top = point[`${item.key}Top`];
            const y = yFor(top);
            const barHeight = Math.max(yFor(bottom) - y, 0);
            if (barHeight <= 0) return '';
            const rect = `<rect class="source-area source-${item.className}" x="${roundSvg(point.x)}" y="${roundSvg(y)}" width="${roundSvg(point.width)}" height="${roundSvg(barHeight)}"></rect>`;
            if (item.key !== 'actualVotes') return rect;
            const yesValue = getProposalCompositionValueNumber(getProposalCompositionPointValue(points[index], 'actualFor'));
            const noValue = getProposalCompositionValueNumber(getProposalCompositionPointValue(points[index], 'actualAgainst'));
            const voteTotal = yesValue + noValue;
            if (yesValue <= 0 || noValue <= 0 || voteTotal <= 0) return rect;
            const splitY = yFor(bottom + ((top - bottom) * (yesValue / voteTotal)));
            return `
                ${rect}
                <line class="proper-vote-split" x1="${roundSvg(point.x)}" x2="${roundSvg(point.x + point.width)}" y1="${roundSvg(splitY)}" y2="${roundSvg(splitY)}"></line>
            `;
        }).join('')).join('');
    const hoverBands = makeProposalCompositionHoverBands(points, series, pad.left, width - pad.right, height, innerWidth);
    const firstId = points[0]?.id || '';
    const lastId = points[points.length - 1]?.id || '';

    return `
        <svg class="source-chart-svg proposal-composition-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Per-proposal voting power composition">
            ${grid}
            ${activeBars}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">#${escapeHtml(firstId)}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">#${escapeHtml(lastId)}</text>
        </svg>
    `;
}

function makeProposalCompositionHoverBands(points, series, xMin, xMax, height, innerWidth) {
    if (!points.length) return '';
    const widthForPoint = innerWidth / Math.max(points.length, 1);
    return points.map((point, index) => {
        const left = Math.max(xMin, xMin + index * widthForPoint);
        const right = Math.min(xMax, left + widthForPoint);
        const visibleTotal = getProposalCompositionVisibleTotal(point, series);
        const readyTotal = getProposalCompositionPointValue(point, 'readyEligibleSupply');
        const eligibleTotal = getProposalCompositionPointValue(point, 'eligibleSupply');
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-proposal-id="${escapeHtml(point.id || 'unknown')}"
                data-proposal-title="${escapeHtml(truncateTooltipTitle(point.title || ''))}"
                data-visible-total="${escapeHtml(formatProposalCompositionValue(visibleTotal))}"
                data-ready-eligible-supply="${escapeHtml(formatProposalCompositionValue(readyTotal))}"
                data-eligible-supply="${escapeHtml(formatProposalCompositionValue(eligibleTotal))}"
                data-actual-votes-yes="${escapeHtml(formatProposalCompositionValue(getProposalCompositionPointValue(point, 'actualFor')))}"
                data-actual-votes-no="${escapeHtml(formatProposalCompositionValue(getProposalCompositionPointValue(point, 'actualAgainst')))}"
                data-actual-votes-yes-share="${escapeHtml(formatProposalCompositionPercent(getProposalCompositionPointValue(point, 'actualFor'), getProposalCompositionPointValue(point, 'actualVotes'), 2))}"
                data-actual-votes-no-share="${escapeHtml(formatProposalCompositionPercent(getProposalCompositionPointValue(point, 'actualAgainst'), getProposalCompositionPointValue(point, 'actualVotes'), 2))}"
                ${series.map((item) => {
                    const value = getProposalCompositionPointValue(point, item.key);
                    return `
                        data-${toDataAttributeName(item.key)}="${escapeHtml(formatProposalCompositionValue(value))}"
                        data-${toDataAttributeName(item.key)}-visible-share="${escapeHtml(formatProposalCompositionPercent(value, visibleTotal, 2))}"
                        data-${toDataAttributeName(item.key)}-ready-share="${escapeHtml(formatProposalCompositionPercent(value, readyTotal, 2))}"
                        data-${toDataAttributeName(item.key)}-eligible-share="${escapeHtml(formatProposalCompositionPercent(value, eligibleTotal, 2))}"
                    `;
                }).join('')}
            ></rect>
        `;
    }).join('');
}

function toDataAttributeName(key) {
    return String(key || '').replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function handleProposalCompositionChartClick(event) {
    const modeButton = event.target.closest('[data-proposal-composition-mode]');
    if (modeButton) {
        const mode = modeButton.dataset.proposalCompositionMode === 'wallet' ? 'wallet' : 'token';
        if (proposalCompositionChartState.mode !== mode) {
            proposalCompositionChartState.mode = mode;
            renderProposalCompositionChart((currentRows || []).filter(isDelegateDutyReportable));
        }
        return;
    }

    const toggleButton = event.target.closest('[data-proposal-composition-toggle]');
    if (toggleButton) {
        const key = toggleButton.dataset.proposalCompositionToggle;
        if (key && Object.prototype.hasOwnProperty.call(proposalCompositionChartState.visible, key)) {
            const visibleCount = Object.values(proposalCompositionChartState.visible).filter(Boolean).length;
            if (proposalCompositionChartState.visible[key] && visibleCount <= 1) return;
            proposalCompositionChartState.visible[key] = !proposalCompositionChartState.visible[key];
            renderProposalCompositionChart((currentRows || []).filter(isDelegateDutyReportable));
        }
    }
}

function handleProposalCompositionChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.proposalCompositionChart.contains(band)) {
        hideProposalCompositionChartTooltip();
        return;
    }

    const tooltip = el.proposalCompositionChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderProposalCompositionTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.proposalCompositionChart, tooltip, event);
}

function hideProposalCompositionChartTooltip() {
    const tooltip = el.proposalCompositionChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderProposalCompositionTooltipHtml(data) {
    const emptyValue = isProposalCompositionWalletMode() ? '0 wallets' : '0.00B dCULT';
    const rows = getProposalCompositionSeries()
        .filter((item) => isProposalCompositionSeriesVisible(item.key))
        .map((item) => {
            const attr = toDatasetKey(item.key);
            return {
                key: item.key,
                className: item.className,
                label: item.label,
                value: data[attr],
                visibleShare: data[`${attr}VisibleShare`],
                readyShare: data[`${attr}ReadyShare`],
                eligibleShare: data[`${attr}EligibleShare`],
            };
        });

    return `
        <div class="source-tooltip-title">Proposal #${escapeHtml(data.proposalId || 'unknown')}</div>
        ${data.proposalTitle ? `<div class="source-tooltip-subtitle">${escapeHtml(data.proposalTitle)}</div>` : ''}
        <div class="source-tooltip-total">
            <span>Visible selected</span>
            <strong>${escapeHtml(data.visibleTotal || emptyValue)}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Eligible + ready</span>
            <strong>${escapeHtml(data.readyEligibleSupply || emptyValue)}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Eligible staked</span>
            <strong>${escapeHtml(data.eligibleSupply || emptyValue)}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row composition-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>
                        ${escapeHtml(row.label)}
                        <small>${escapeHtml(row.visibleShare || '0.00%')} visible / ${escapeHtml(row.readyShare || '0.00%')} ready / ${escapeHtml(row.eligibleShare || '0.00%')} staked</small>
                        ${row.key === 'actualVotes' ? `
                            <small>Yes ${escapeHtml(data.actualVotesYes || emptyValue)} (${escapeHtml(data.actualVotesYesShare || '0.00%')}) / No ${escapeHtml(data.actualVotesNo || emptyValue)} (${escapeHtml(data.actualVotesNoShare || '0.00%')})</small>
                        ` : ''}
                    </span>
                    <strong>${escapeHtml(row.value || emptyValue)}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAdditionalVisuals(rows) {
    const reportRows = (rows || []).filter(isDelegateDutyReportable);
    renderCultSupplyChart();
    renderProposalRiskChart(reportRows);
    renderDelegateeReliabilityScatter(reportRows);
    renderDelegateeReliabilityChart(reportRows);
    renderRepeatFailureChart(reportRows);
    renderParticipationTrendChart(reportRows);
    renderDelegateAbsenceHeatmap(reportRows);
}

function renderCultSupplyChart() {
    if (!el.cultSupplyChart) return;

    const rawPoints = getCultSupplyPoints();
    const maxSupply = getCultSupplyMax(rawPoints);
    const points = rawPoints.map((point) => withCultSupplyDerivedPoint(point, maxSupply));
    const latest = points[points.length - 1];
    if (!latest) {
        const copy = readProvider
            ? 'Building CULT supply samples. This uses CULT totalSupply, treasury, burn-wallet, dCULT staked, and Uniswap pair balances.'
            : 'Connect a wallet or use public RPC to build CULT supply history.';
        el.cultSupplyChart.innerHTML = `<p class="empty-state">${escapeHtml(copy)}</p>`;
        return;
    }

    const series = getCultSupplySeries();
    const visibleSeries = series.filter((item) => isCultSupplySeriesVisible(item.key));
    const legendItems = series.map((item) => renderCultSupplyLegendItem(
        item,
        latest[item.key],
        maxSupply,
        isCultSupplySeriesVisible(item.key),
    )).join('');
    const latestDate = latest.timestamp ? formatShortDate(latest.timestamp) : `block ${formatInteger(latest.block)}`;
    const visibleCopy = visibleSeries
        .map((item) => `${item.shortLabel} ${formatPercent(latest[item.key], maxSupply, 1)}`)
        .join(' / ');

    el.cultSupplyChart.innerHTML = `
        <div class="source-chart-header cult-supply-chart-header">
            <strong>
                <span>${escapeHtml(latestDate)} latest</span>
                <span>${formatCultAmountShort(latest.circulatingSupply)} circulating · ${escapeHtml(visibleCopy || 'No visible series')}</span>
            </strong>
        </div>
        <div class="source-chart-body">
            ${renderCultSupplySvg(points, series, maxSupply)}
            <div class="source-chart-legend">${legendItems}</div>
        </div>
        <p class="source-chart-note">Burned supply fills the top of the max-supply frame. Circulating supply is max supply minus burn-wallet balances; free-floating CULT is circulating supply minus treasury, staked dCULT, and the CULT held by the Uniswap pair.</p>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getCultSupplySeries() {
    return [
        { key: 'burnedSupply', className: 'cult-burned-supply', label: 'Burned supply', shortLabel: 'burned' },
        { key: 'treasuryBalance', className: 'cult-treasury-balance', label: 'Treasury balance', shortLabel: 'treasury' },
        { key: 'restSupply', className: 'cult-rest-supply', label: 'Free-floating CULT', shortLabel: 'float' },
        { key: 'stakedSupply', className: 'cult-staked-supply', label: 'Staked dCULT', shortLabel: 'staked' },
        { key: 'lpSupply', className: 'cult-lp-supply', label: 'Uniswap pair CULT', shortLabel: 'LP' },
    ];
}

function getCultSupplyPoints() {
    const supplyCache = getCultSupplyCache();
    return Object.values(supplyCache.samples || {})
        .filter((sample) => sample && Number(sample.block || 0) >= CULT_START_BLOCK)
        .map((sample) => normalizeCultSupplyPoint(sample))
        .filter(Boolean)
        .sort((a, b) => a.block - b.block);
}

function normalizeCultSupplyPoint(sample) {
    try {
        const totalSupply = ethers.BigNumber.from(sample.totalSupply || '0');
        const treasuryBalance = ethers.BigNumber.from(sample.treasuryBalance || '0');
        const burnedSupply = ethers.BigNumber.from(sample.burnedSupply || '0');
        const stakedSupply = ethers.BigNumber.from(sample.stakedSupply || '0');
        const lpSupply = ethers.BigNumber.from(sample.lpSupply || '0');
        let restSupply = sample.restSupply !== undefined
            ? ethers.BigNumber.from(sample.restSupply || '0')
            : subtractBigNumberFloor(totalSupply, treasuryBalance.add(burnedSupply).add(stakedSupply).add(lpSupply));
        if (restSupply.lt(0)) restSupply = ethers.BigNumber.from(0);
        return {
            block: Number(sample.block || 0),
            timestamp: Number(sample.timestamp || 0),
            totalSupply,
            treasuryBalance,
            burnedSupply,
            stakedSupply,
            lpSupply,
            restSupply,
        };
    } catch {
        return null;
    }
}

function withCultSupplyDerivedPoint(point, maxSupply) {
    const safeMaxSupply = ethers.BigNumber.from(maxSupply || 0);
    const burnedSupply = ethers.BigNumber.from(point.burnedSupply || 0);
    const treasuryBalance = ethers.BigNumber.from(point.treasuryBalance || 0);
    const stakedSupply = ethers.BigNumber.from(point.stakedSupply || 0);
    const lpSupply = ethers.BigNumber.from(point.lpSupply || 0);
    const circulatingSupply = subtractBigNumberFloor(safeMaxSupply, burnedSupply);
    const committedCirculating = treasuryBalance.add(stakedSupply).add(lpSupply);
    const restSupply = subtractBigNumberFloor(circulatingSupply, committedCirculating);

    return {
        ...point,
        circulatingSupply,
        lpSupply,
        restSupply,
    };
}

function getCultSupplyMax(points) {
    const max = (points || []).reduce((highest, point) => {
        const total = ethers.BigNumber.from(point?.totalSupply || '0');
        return total.gt(highest) ? total : highest;
    }, ethers.BigNumber.from(0));
    return max.isZero() ? ethers.BigNumber.from(1) : max;
}

function isCultSupplySeriesVisible(key) {
    return cultSupplyChartState.visible[key] !== false;
}

function renderCultSupplyLegendItem(item, value, maxSupply, active) {
    const detail = active
        ? `${formatCultAmountShort(value)} · ${formatPercent(value, maxSupply, 2)} max`
        : `${formatCultAmountShort(value)} · hidden`;
    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-cult-supply-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${escapeHtml(item.className)}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
        </button>
    `;
}

function renderCultSupplySvg(points, series, maxSupply) {
    const width = 980;
    const height = 300;
    const pad = { top: 18, right: 18, bottom: 38, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const visibleSeries = series.filter((item) => isCultSupplySeriesVisible(item.key));
    const stackSeries = [...visibleSeries].reverse();
    const barWidth = innerWidth / Math.max(points.length, 1);
    const yForSupply = (value) => {
        const percent = getSharePercentNumber(value, maxSupply);
        return pad.top + innerHeight - (Math.max(0, Math.min(100, Number(percent || 0))) / 100) * innerHeight;
    };
    const gridValues = [
        { value: maxSupply, label: '100%' },
        { value: maxSupply.div(2), label: '50%' },
        { value: ethers.BigNumber.from(0), label: '0' },
    ];
    const grid = gridValues.map(({ value, label }) => {
        const y = yForSupply(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${escapeHtml(label)}</text>
            </g>
        `;
    }).join('');
    const bars = points.map((point, pointIndex) => {
        const x = pad.left + pointIndex * barWidth;
        const widthForPoint = Math.max(barWidth - 1, 1);
        let cursor = ethers.BigNumber.from(0);
        return stackSeries.map((item) => {
            const value = ethers.BigNumber.from(point[item.key] || '0');
            const bottom = cursor;
            cursor = cursor.add(value);
            const y = yForSupply(cursor);
            const barHeight = Math.max(yForSupply(bottom) - y, 0);
            if (barHeight <= 0) return '';
            return `<rect class="supply-bar source-${escapeHtml(item.className)}" x="${roundSvg(x)}" y="${roundSvg(y)}" width="${roundSvg(widthForPoint)}" height="${roundSvg(barHeight)}"></rect>`;
        }).join('');
    }).join('');
    const hoverBands = points.map((point, index) => {
        const left = Math.max(pad.left, pad.left + index * barWidth);
        const right = Math.min(width - pad.right, left + barWidth);
        const visibleTotal = visibleSeries.reduce((sum, item) => sum.add(point[item.key] || '0'), ethers.BigNumber.from(0));
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-block="${escapeHtml(String(point.block || ''))}"
                data-date="${escapeHtml(point.timestamp ? formatShortDate(point.timestamp) : 'date unavailable')}"
                data-visible-total="${escapeHtml(formatCultAmountShort(visibleTotal))}"
                data-total-supply="${escapeHtml(formatCultAmountShort(point.totalSupply))}"
                data-circulating-supply="${escapeHtml(formatCultAmountShort(point.circulatingSupply))}"
                data-circulating-supply-percent="${escapeHtml(formatPercent(point.circulatingSupply, maxSupply, 2))}"
                data-treasury-balance="${escapeHtml(formatCultAmountShort(point.treasuryBalance))}"
                data-treasury-balance-percent="${escapeHtml(formatPercent(point.treasuryBalance, maxSupply, 2))}"
                data-burned-supply="${escapeHtml(formatCultAmountShort(point.burnedSupply))}"
                data-burned-supply-percent="${escapeHtml(formatPercent(point.burnedSupply, maxSupply, 2))}"
                data-staked-supply="${escapeHtml(formatCultAmountShort(point.stakedSupply))}"
                data-staked-supply-percent="${escapeHtml(formatPercent(point.stakedSupply, maxSupply, 2))}"
                data-lp-supply="${escapeHtml(formatCultAmountShort(point.lpSupply))}"
                data-lp-supply-percent="${escapeHtml(formatPercent(point.lpSupply, maxSupply, 2))}"
                data-rest-supply="${escapeHtml(formatCultAmountShort(point.restSupply))}"
                data-rest-supply-percent="${escapeHtml(formatPercent(point.restSupply, maxSupply, 2))}"
                data-max-supply="${escapeHtml(formatCultAmountShort(maxSupply))}"
                aria-label="${escapeHtml(formatCultSupplyTooltip(point, maxSupply))}"
            ></rect>
        `;
    }).join('');
    const firstLabel = points[0]?.timestamp ? formatShortDate(points[0].timestamp) : `#${points[0]?.block || ''}`;
    const lastLabel = points[points.length - 1]?.timestamp ? formatShortDate(points[points.length - 1].timestamp) : `#${points[points.length - 1]?.block || ''}`;

    return `
        <svg class="source-chart-svg cult-supply-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="CULT supply distribution">
            ${grid}
            ${bars}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">${escapeHtml(firstLabel)}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">${escapeHtml(lastLabel)}</text>
        </svg>
    `;
}

function formatCultSupplyTooltip(point, maxSupply) {
    return [
        point.timestamp ? formatShortDate(point.timestamp) : `Block ${point.block}`,
        `Max supply: ${formatCultAmountShort(maxSupply)}`,
        `Circulating supply: ${formatCultAmountShort(point.circulatingSupply)} (${formatPercent(point.circulatingSupply, maxSupply, 2)} of max)`,
        `Treasury balance: ${formatCultAmountShort(point.treasuryBalance)} (${formatPercent(point.treasuryBalance, maxSupply, 2)} of max)`,
        `Free-floating CULT: ${formatCultAmountShort(point.restSupply)} (${formatPercent(point.restSupply, maxSupply, 2)} of max)`,
        `Uniswap pair CULT: ${formatCultAmountShort(point.lpSupply)} (${formatPercent(point.lpSupply, maxSupply, 2)} of max)`,
        `Staked dCULT: ${formatCultAmountShort(point.stakedSupply)} (${formatPercent(point.stakedSupply, maxSupply, 2)} of max)`,
        `Burned supply: ${formatCultAmountShort(point.burnedSupply)} (${formatPercent(point.burnedSupply, maxSupply, 2)} of max)`,
    ].join('\n');
}

function handleCultSupplyChartClick(event) {
    const toggleButton = event.target.closest('[data-cult-supply-toggle]');
    if (!toggleButton) return;

    const key = toggleButton.dataset.cultSupplyToggle;
    if (!key || !Object.prototype.hasOwnProperty.call(cultSupplyChartState.visible, key)) return;
    const series = getCultSupplySeries();
    const visibleCount = series.filter((item) => isCultSupplySeriesVisible(item.key)).length;
    if (cultSupplyChartState.visible[key] && visibleCount <= 1) return;
    cultSupplyChartState.visible[key] = !cultSupplyChartState.visible[key];
    renderCultSupplyChart();
}

function handleCultSupplyChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.cultSupplyChart.contains(band)) {
        hideCultSupplyChartTooltip();
        return;
    }

    const tooltip = el.cultSupplyChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderCultSupplyTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');
    positionChartTooltip(el.cultSupplyChart, tooltip, event);
}

function hideCultSupplyChartTooltip() {
    const tooltip = el.cultSupplyChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderCultSupplyTooltipHtml(data) {
    const rows = getCultSupplySeries()
        .filter((item) => isCultSupplySeriesVisible(item.key))
        .map((item) => {
            const attr = toDatasetKey(item.key);
            return {
                className: item.className,
                label: item.label,
                value: data[attr],
                percent: data[`${attr}Percent`],
            };
        });

    return `
        <div class="source-tooltip-title">${escapeHtml(data.date || 'Supply sample')}</div>
        <div class="source-tooltip-subtitle">Block ${escapeHtml(data.block || 'unknown')}</div>
        <div class="source-tooltip-total">
            <span>Max supply</span>
            <strong>${escapeHtml(data.maxSupply || '0 CULT')}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Circulating supply</span>
            <strong>${escapeHtml(data.circulatingSupply || '0 CULT')}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Visible selected</span>
            <strong>${escapeHtml(data.visibleTotal || '0 CULT')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row composition-tooltip-row">
                    <span class="source-tooltip-swatch source-${escapeHtml(row.className)}" aria-hidden="true"></span>
                    <span>
                        ${escapeHtml(row.label)}
                        <small>${escapeHtml(row.percent || '0.00%')} of max supply</small>
                    </span>
                    <strong>${escapeHtml(row.value || '0 CULT')}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function getCultSupplyCache() {
    cache.cultSupply = normalizeCultSupplyCache(cache.cultSupply);
    return cache.cultSupply;
}

function getCultSupplySampleBlocks() {
    if (!Number.isFinite(latestSafeBlock) || latestSafeBlock <= CULT_START_BLOCK) return [];
    const blocks = [];
    for (let block = CULT_START_BLOCK; block <= latestSafeBlock; block += CULT_SUPPLY_WEEK_BLOCK_STEP) {
        blocks.push(block);
    }
    return blocks;
}

function startCultSupplyTimelineIndex() {
    renderCultSupplyChart();
    if (!readProvider || !cultContract || !dcultContract || cultSupplyIndexPromise) return;
    cultSupplyIndexPromise = ensureCultSupplyTimeline()
        .catch((error) => {
            console.warn('Unable to build CULT supply timeline:', error);
        })
        .finally(() => {
            cultSupplyIndexPromise = null;
            renderCultSupplyChart();
        });
}

async function ensureCultSupplyTimeline() {
    const supplyCache = getCultSupplyCache();
    const sampleBlocks = getCultSupplySampleBlocks();
    const missingBlocks = sampleBlocks.filter((block) => {
        const sample = supplyCache.samples[String(block)];
        return !sample || sample.lpSupply === undefined;
    });
    if (!missingBlocks.length) {
        renderCultSupplyChart();
        return;
    }

    renderCultSupplyChart();

    for (const batch of chunkArray(missingBlocks, CULT_SUPPLY_SAMPLE_CONCURRENCY)) {
        await Promise.all(batch.map(async (block) => {
            try {
                const sample = await fetchCultSupplySample(block);
                supplyCache.samples[String(block)] = sample;
            } catch (error) {
                console.warn(`Unable to build CULT supply sample at block ${formatInteger(block)}`, error);
            }
        }));
        supplyCache.updatedAt = Date.now();
        await saveCache(cache);
        renderCultSupplyChart();
        await sleep(35);
    }
    renderCultSupplyChart();
}

async function fetchCultSupplySample(block) {
    const blockTag = Number(block);
    const [blockData, totalSupply, stakedSupply, treasuryBalance, lpSupply, ...burnBalances] = await Promise.all([
        withTimeout(readProvider.getBlock(blockTag), 10_000, `CULT supply block ${blockTag}`),
        withTimeout(cultContract.totalSupply({ blockTag }), 15_000, `CULT totalSupply ${blockTag}`),
        readHistoricalBigNumber(dcultContract.totalSupply({ blockTag }), ethers.BigNumber.from(0), `dCULT totalSupply ${blockTag}`),
        withTimeout(cultContract.balanceOf(TREASURY_ADDRESS, { blockTag }), 15_000, `CULT treasury ${blockTag}`),
        withTimeout(cultContract.balanceOf(UNISWAP_PAIR_ADDRESS, { blockTag }), 15_000, `CULT Uniswap pair ${blockTag}`),
        ...CULT_BURN_WALLETS.map((address) => withTimeout(
            cultContract.balanceOf(address, { blockTag }),
            15_000,
            `CULT burn wallet ${blockTag}`,
        )),
    ]);
    const burnedSupply = burnBalances.reduce((sum, balance) => sum.add(balance), ethers.BigNumber.from(0));
    const restSupply = subtractBigNumberFloor(totalSupply, treasuryBalance.add(burnedSupply).add(stakedSupply).add(lpSupply));
    return {
        block: blockTag,
        timestamp: Number(blockData?.timestamp || 0),
        totalSupply: totalSupply.toString(),
        treasuryBalance: treasuryBalance.toString(),
        burnedSupply: burnedSupply.toString(),
        stakedSupply: stakedSupply.toString(),
        lpSupply: lpSupply.toString(),
        restSupply: restSupply.toString(),
    };
}

async function readHistoricalBigNumber(promise, fallback, label) {
    try {
        return ethers.BigNumber.from(await withTimeout(promise, 15_000, label));
    } catch (error) {
        if (isHistoricalEmptyCallError(error)) return ethers.BigNumber.from(fallback || 0);
        throw error;
    }
}

function isHistoricalEmptyCallError(error) {
    const message = String(error?.message || '');
    return error?.code === 'CALL_EXCEPTION'
        || /call revert exception|data="0x"|missing revert data|returned no data|contract not deployed/i.test(message);
}

function renderProposalRiskChart(rows) {
    if (!el.proposalRiskChart) return;
    const riskRows = getProposalRiskRows(rows).slice(0, 40);
    if (!riskRows.length) {
        el.proposalRiskChart.innerHTML = '<p class="empty-state">No proposal risk data yet.</p>';
        return;
    }

    el.proposalRiskChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>Highest risk proposals first. Bars compare yes, no, direct wasted votes, and absent delegated representation.</p>
            </div>
            <strong>
                <span>${formatInteger(riskRows.filter((row) => row.directFlip).length)} wasted flip flags</span>
                <span>${formatInteger(riskRows.filter((row) => row.absentFlip).length)} absent flip flags in shown rows</span>
            </strong>
        </div>
        <div class="risk-map-list">
            ${riskRows.map(renderProposalRiskRow).join('')}
        </div>
        <p class="source-chart-note">Icons mark proposals where missed voting power could have changed or dominated the outcome.</p>
    `;
}

function getProposalRiskRows(rows) {
    return (rows || [])
        .filter(isDelegateDutyReportable)
        .map((row) => {
            const duty = normalizeDelegateDuty(row.delegateDuty);
            const directWasted = ethers.BigNumber.from(row.wastedTotal || '0');
            const absentDuty = ethers.BigNumber.from(duty.absentDelegatedPower || '0');
            const margin = ethers.BigNumber.from(row.margin || '0');
            const riskTotal = directWasted.add(absentDuty);
            const riskScore = margin.isZero()
                ? tokenNumber(riskTotal)
                : tokenNumber(riskTotal) / Math.max(tokenNumber(margin), 1);
            return {
                row,
                duty,
                directWasted,
                absentDuty,
                riskTotal,
                riskScore,
                directFlip: Boolean(row.couldSwing),
                absentFlip: delegateDutyCouldSwing(row, duty),
                absentDominate: delegateDutyCouldDominate(row, duty),
            };
        })
        .sort((a, b) => {
            if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
            return compareBigNumbersDesc(a.riskTotal, b.riskTotal);
        });
}

function renderProposalRiskRow(item) {
    const row = item.row;
    const total = ethers.BigNumber.from(row.actualFor || '0')
        .add(row.actualAgainst || '0')
        .add(item.directWasted)
        .add(item.absentDuty);
    const segments = [
        { label: 'For / Yes', className: 'is-for', value: ethers.BigNumber.from(row.actualFor || '0') },
        { label: 'Against / No', className: 'is-against', value: ethers.BigNumber.from(row.actualAgainst || '0') },
        { label: 'Direct wasted', className: 'is-wasted', value: item.directWasted },
        { label: 'Absent duty', className: 'is-absent', value: item.absentDuty },
    ];
    const title = stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || '');
    const badges = [
        renderWastedFlipIcon(row),
        renderDelegateAbsenceImpactIcon(item.absentFlip, item.absentDominate),
    ].join('');

    return `
        <article class="risk-map-row">
            <div class="risk-map-title">
                <span class="risk-map-proposal">#${escapeHtml(row.id || row.proposal?.id || '')} ${escapeHtml(truncateTooltipTitle(title, 68))}</span>
                <span class="risk-map-flags">${badges}</span>
            </div>
            <div class="risk-map-bars" title="${escapeHtml(getRiskRowTitle(item))}">
                ${segments.map((segment) => renderRiskBarSegment(segment, total)).join('')}
            </div>
            <div class="risk-map-values">
                <span>Yes ${formatCompactDcult(segmentValue(row.actualFor))}</span>
                <span>No ${formatCompactDcult(segmentValue(row.actualAgainst))}</span>
                <span>Wasted ${formatCompactDcult(item.directWasted)}</span>
                <span>Absent ${formatCompactDcult(item.absentDuty)}</span>
            </div>
        </article>
    `;
}

function renderRiskBarSegment(segment, total) {
    const share = getSharePercentNumber(segment.value, total);
    if (share <= 0) return '';
    return `
        <span
            class="risk-bar-segment ${segment.className}"
            style="width: ${Math.max(share, 1).toFixed(2)}%;"
            title="${escapeHtml(`${segment.label}: ${formatTokenAmount(segment.value, 0)} dCULT (${formatPercent(segment.value, total, 1)})`)}"
        ></span>
    `;
}

function getRiskRowTitle(item) {
    const row = item.row;
    return [
        `Proposal #${row.id}: ${stripProposalTitlePrefix(row.title || '', row.id || '')}`,
        `For: ${formatTokenAmount(row.actualFor, 0)} dCULT`,
        `Against: ${formatTokenAmount(row.actualAgainst, 0)} dCULT`,
        `Direct wasted: ${formatTokenAmount(item.directWasted, 0)} dCULT`,
        `Absent duty: ${formatTokenAmount(item.absentDuty, 0)} dCULT`,
        item.directFlip ? 'Direct wasted votes could flip outcome.' : '',
        item.absentFlip ? `Absent delegated representation could ${item.absentDominate ? 'dominate' : 'flip'} outcome.` : '',
    ].filter(Boolean).join('\n');
}

function segmentValue(value) {
    return ethers.BigNumber.from(value || '0');
}

function renderDelegateeReliabilityScatter(rows) {
    if (!el.delegateeReliabilityScatter) return;
    const { ranking } = getDelegateeReliabilityRows(rows);
    const scope = getDelegateeReliabilityScope();
    const currentRanking = ranking.filter(hasCurrentAttachedDelegatePower);
    const formerRanking = ranking.filter((item) => !hasCurrentAttachedDelegatePower(item));
    const items = scope === 'all' ? ranking : currentRanking;
    if (!items.length) {
        el.delegateeReliabilityScatter.innerHTML = '<p class="empty-state">No delegatee reliability scatter data yet.</p>';
        return;
    }

    const representedAverage = getDelegateeReliabilityWeightedAverage(items);
    const missedPower = items.reduce((sum, item) => sum.add(item.record.missedPower), ethers.BigNumber.from(0));
    const totalPower = items.reduce((sum, item) => sum.add(item.record.totalPower), ethers.BigNumber.from(0));
    const historicalDutyAverage = formatHistoricalDutyAverage(rows);

    el.delegateeReliabilityScatter.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>X is total delegated responsibility tracked over time. Y is duty fulfilled by dCULT weight. Bubble size follows represented wallet-proposals.</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${formatInteger(items.length)} shown delegatees</span>
                    <span>${formatDecimal(representedAverage, 1)}% represented / ${formatDcultBillions(missedPower)} missed</span>
                    <span>${formatDcultBillions(totalPower)} tracked responsibility</span>
                    ${historicalDutyAverage ? `<span>${escapeHtml(historicalDutyAverage)}</span>` : ''}
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Delegatee reliability scatter scope">
                    <button class="chart-mode-button ${scope === 'current' ? 'is-active' : ''}" type="button" data-delegatee-reliability-scope="current" aria-pressed="${scope === 'current' ? 'true' : 'false'}">Current</button>
                    <button class="chart-mode-button ${scope === 'all' ? 'is-active' : ''}" type="button" data-delegatee-reliability-scope="all" aria-pressed="${scope === 'all' ? 'true' : 'false'}">All</button>
                </div>
            </div>
        </div>
        ${renderDelegateeReliabilityScatterSvg(items)}
        <div class="source-chart-legend compact-visual-legend">
            <div class="source-legend-item is-active static-legend-item">
                <span class="source-legend-swatch scatter-good" aria-hidden="true"></span>
                <span><strong>80%+ represented</strong><small>strong historical duty</small></span>
            </div>
            <div class="source-legend-item is-active static-legend-item">
                <span class="source-legend-swatch scatter-mid" aria-hidden="true"></span>
                <span><strong>50-79% represented</strong><small>mixed duty</small></span>
            </div>
            <div class="source-legend-item is-active static-legend-item">
                <span class="source-legend-swatch scatter-bad" aria-hidden="true"></span>
                <span><strong>Below 50% represented</strong><small>poor duty record</small></span>
            </div>
        </div>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getDelegateeReliabilityWeightedAverage(items) {
    const fulfilled = (items || []).reduce((sum, item) => sum.add(item.record.fulfilledPower), ethers.BigNumber.from(0));
    const total = (items || []).reduce((sum, item) => sum.add(item.record.totalPower), ethers.BigNumber.from(0));
    return getSharePercentNumber(fulfilled, total);
}

function renderDelegateeReliabilityScatterSvg(items) {
    const width = 980;
    const height = 360;
    const pad = { top: 24, right: 28, bottom: 46, left: 72 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const maxPower = Math.max(...items.map((item) => tokenNumber(item.record.totalPower)), 1);
    const maxWallets = Math.max(...items.map((item) => Number(item.record.totalWallets || 0)), 1);
    const xFor = (power) => pad.left + (tokenNumber(power) / maxPower) * innerWidth;
    const yFor = (percent) => pad.top + ((100 - Number(percent || 0)) / 100) * innerHeight;
    const radiusFor = (wallets) => 5 + (Math.sqrt(Math.max(Number(wallets || 0), 0)) / Math.sqrt(maxWallets)) * 13;
    const xGridValues = [0, maxPower / 2, maxPower];
    const yGridValues = [100, 50, 0];
    const xGrid = xGridValues.map((value) => {
        const x = pad.left + (value / maxPower) * innerWidth;
        return `
            <g class="source-grid scatter-grid">
                <line x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}"></line>
                <text x="${x}" y="${height - pad.bottom + 24}">${formatCompactDcultNumber(value)}</text>
            </g>
        `;
    }).join('');
    const yGrid = yGridValues.map((value) => {
        const y = yFor(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${formatDecimal(value, 0)}%</text>
            </g>
        `;
    }).join('');
    const circles = items.map((item) => {
        const record = item.record;
        const representedPercent = getSharePercentNumber(record.fulfilledPower, record.totalPower);
        const x = xFor(record.totalPower);
        const y = yFor(representedPercent);
        const radius = radiusFor(record.totalWallets);
        const qualityClass = representedPercent >= 80 ? 'is-good' : representedPercent >= 50 ? 'is-mid' : 'is-bad';
        const currentClass = hasCurrentAttachedDelegatePower(item) ? 'is-current' : 'is-former';
        return `
            <circle
                class="scatter-point ${qualityClass} ${currentClass}"
                cx="${roundSvg(x)}"
                cy="${roundSvg(y)}"
                r="${roundSvg(radius)}"
                data-delegatee="${escapeHtml(item.delegatee)}"
                data-address="${escapeHtml(shortAddress(item.delegatee))}"
                data-status="${escapeHtml(hasCurrentAttachedDelegatePower(item) ? 'Current delegatee' : 'Former delegatee')}"
                data-represented-percent="${escapeHtml(`${formatDecimal(representedPercent, 1)}%`)}"
                data-missed-percent="${escapeHtml(formatPercent(record.missedPower, record.totalPower, 1))}"
                data-total-power="${escapeHtml(formatDcultBillions(record.totalPower))}"
                data-represented-power="${escapeHtml(formatDcultBillions(record.fulfilledPower))}"
                data-missed-power="${escapeHtml(formatDcultBillions(record.missedPower))}"
                data-total-wallets="${escapeHtml(formatInteger(record.totalWallets))}"
                data-represented-wallets="${escapeHtml(formatInteger(record.fulfilledWallets))}"
                data-missed-wallets="${escapeHtml(formatInteger(record.missedWallets))}"
                data-proposals="${escapeHtml(`${formatInteger(record.fulfilledProposals)} represented / ${formatInteger(record.missedProposals)} missed`)}"
                data-current-attached="${escapeHtml(formatDcultBillions(item.latest?.delegatedPower || '0'))}"
                data-latest-fulfilled="${escapeHtml(formatLatestFulfilledDuty(record).replace('Last fulfilled: ', ''))}"
            ></circle>
        `;
    }).join('');

    return `
        <svg class="source-chart-svg delegatee-scatter-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Delegatee reliability scatter">
            ${xGrid}
            ${yGrid}
            <text class="scatter-axis-label" x="${pad.left + innerWidth / 2}" y="${height - 8}">Tracked dCULT responsibility</text>
            <text class="scatter-axis-label" x="18" y="${pad.top + innerHeight / 2}" transform="rotate(-90 18 ${pad.top + innerHeight / 2})">Duty fulfilled</text>
            ${circles}
        </svg>
    `;
}

function renderDelegateeReliabilityChart(rows) {
    if (!el.delegateeReliabilityChart) return;
    const { ranking, latestRow } = getDelegateeReliabilityRows(rows);
    const scope = getDelegateeReliabilityScope();
    const currentRanking = ranking.filter(hasCurrentAttachedDelegatePower);
    const formerRanking = ranking.filter((item) => !hasCurrentAttachedDelegatePower(item));
    if (!ranking.length) {
        el.delegateeReliabilityChart.innerHTML = '<p class="empty-state">No delegatee reliability data yet.</p>';
        return;
    }
    const historicalDutyAverage = formatHistoricalDutyAverage(rows);

    el.delegateeReliabilityChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>Current shows delegatees with attached power now. All appends former delegatees below the current list.</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${formatInteger(currentRanking.length)} current / ${formatInteger(formerRanking.length)} former</span>
                    ${latestRow ? `<span>latest snapshot #${escapeHtml(String(latestRow.id || ''))}</span>` : ''}
                    <span>sorted by missed dCULT in each group</span>
                    ${historicalDutyAverage ? `<span>${escapeHtml(historicalDutyAverage)}</span>` : ''}
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Delegatee reliability ranking scope">
                    <button class="chart-mode-button ${scope === 'current' ? 'is-active' : ''}" type="button" data-delegatee-reliability-scope="current" aria-pressed="${scope === 'current' ? 'true' : 'false'}">Current</button>
                    <button class="chart-mode-button ${scope === 'all' ? 'is-active' : ''}" type="button" data-delegatee-reliability-scope="all" aria-pressed="${scope === 'all' ? 'true' : 'false'}">All</button>
                </div>
            </div>
        </div>
        ${renderDelegateeReliabilityGroup(
            'Current Delegatees',
            currentRanking,
            'Still have attached third-party voting power in the latest indexed proposal snapshot.',
            'No current delegatees with attached voting power.',
        )}
        ${scope === 'all' ? renderDelegateeReliabilityGroup(
            'Former Delegatees',
            formerRanking,
            'No attached third-party voting power in the latest indexed proposal snapshot, but had delegatee responsibility historically.',
            'No former delegatees found.',
        ) : ''}
    `;
}

function getDelegateeReliabilityScope() {
    return delegateeReliabilityState.scope === 'all' ? 'all' : 'current';
}

function renderDelegateeReliabilityGroup(title, items, description, emptyText) {
    return `
        <div class="reliability-group">
            <div class="reliability-group-heading">
                <div>
                    <h5>${escapeHtml(title)}</h5>
                    <p>${escapeHtml(description)}</p>
                </div>
                <span>${formatInteger(items.length)} delegatees</span>
            </div>
            ${items.length ? `
                <div class="visual-table reliability-table">
                    ${items.map(renderDelegateeReliabilityRow).join('')}
                </div>
            ` : `<p class="empty-state compact-empty">${escapeHtml(emptyText)}</p>`}
        </div>
    `;
}

function hasCurrentAttachedDelegatePower(item) {
    return Boolean(item?.latest) && ethers.BigNumber.from(item.latest.delegatedPower || '0').gt(0);
}

function getDelegateeReliabilityRows(rows) {
    const records = new Map();
    const latestRow = getDelegateePowerSourceRow(rows);
    const latestByDelegatee = new Map();
    if (latestRow) {
        for (const delegateRow of getDelegateePowerRows(latestRow)) {
            const key = String(delegateRow.delegatee || '').toLowerCase();
            if (key) latestByDelegatee.set(key, delegateRow);
        }
    }

    for (const row of rows || []) {
        if (!isDelegateDutyReportable(row)) continue;
        const duty = normalizeDelegateDuty(row.delegateDuty);
        for (const delegateRow of duty.absentDelegates || []) {
            const key = String(delegateRow.delegatee || '').toLowerCase();
            if (!key) continue;
            if (!records.has(key)) records.set(key, { delegatee: delegateRow.delegatee, key, record: createDelegateeDutyRecord() });
            collectDelegateeDutyRecordFromRows(records.get(key).record, row, [delegateRow], false);
        }
        for (const delegateRow of duty.votedDelegates || []) {
            const key = String(delegateRow.delegatee || '').toLowerCase();
            if (!key) continue;
            if (!records.has(key)) records.set(key, { delegatee: delegateRow.delegatee, key, record: createDelegateeDutyRecord() });
            collectDelegateeDutyRecordFromRows(records.get(key).record, row, [delegateRow], true);
        }
    }

    const ranking = [...records.values()].map((item) => ({
        ...item,
        latest: latestByDelegatee.get(item.key) || null,
    })).sort((a, b) => {
        const missed = compareBigNumbersDesc(a.record.missedPower, b.record.missedPower);
        if (missed) return missed;
        return compareBigNumbersDesc(a.record.totalPower, b.record.totalPower);
    });
    return { ranking, latestRow };
}

function renderDelegateeReliabilityRow(item) {
    const record = item.record;
    const latest = item.latest;
    const representedShare = formatPercent(record.fulfilledPower, record.totalPower, 1);
    const missedShare = formatPercent(record.missedPower, record.totalPower, 1);
    const latestVoted = latest?.dutyStatus === 'voted';
    const latestStatusLabel = latest ? (latestVoted ? 'Fulfilled Duty' : 'Missed Duty') : 'No Current Power';
    const latestStatusClass = latest ? (latestVoted ? 'status-active' : 'status-attention') : 'status-muted';
    const rowStatusClass = latest ? (latestVoted ? 'is-represented' : 'is-wasted') : 'is-muted';
    const latestAction = latest
        ? latestVoted ? `Voted ${supportLabel(latest.support)}` : 'Did not vote'
        : 'No attached power in latest snapshot';
    const latestAttached = ethers.BigNumber.from(latest?.delegatedPower || '0');
    const latestOwn = ethers.BigNumber.from(latest?.ownVotingPower || '0');
    const latestCombined = ethers.BigNumber.from(latest?.combinedVotingPower || latestAttached.add(latestOwn));
    const latestWallets = Number(latest?.delegatorCount || (Array.isArray(latest?.delegators) ? latest.delegators.length : 0));
    const representedWallets = Array.isArray(latest?.delegators) ? latest.delegators : [];
    const reliabilityKey = reliabilityDelegateKey(item.delegatee);
    const expanded = expandedReliabilityDelegatees.has(reliabilityKey);

    return `
        <div class="delegatee-power-item reliability-item">
            <article class="visual-table-row reliability-row ${rowStatusClass}">
                <div>
                    ${renderAddressLink(item.delegatee)}
                    <span class="event-meta">Delegatee</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Latest Action</span>
                    <span class="wallet-detail-value">${escapeHtml(latestAction)}</span>
                    <span class="status-flag ${latestStatusClass}">${escapeHtml(latestStatusLabel)}</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Attached Power</span>
                    <span class="wallet-amount">${formatDcultBillions(latestAttached)}</span>
                    <span class="value-subline">${formatDcultBillions(latestOwn)} own / ${formatDcultBillions(latestCombined)} combined / ${formatInteger(latestWallets)} represented wallets</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Duty Record</span>
                    <span class="wallet-detail-value">${formatInteger(record.fulfilledProposals)} represented / ${formatInteger(record.missedProposals)} missed</span>
                    <span class="value-subline">${representedShare} represented / ${missedShare} missed</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Represented</span>
                    <span class="wallet-amount">${formatDcultBillions(record.fulfilledPower)}</span>
                    <span class="value-subline">${formatInteger(record.fulfilledWallets)} represented wallet-proposals</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Missed</span>
                    <span class="wallet-amount">${formatDcultBillions(record.missedPower)}</span>
                    <span class="value-subline">${formatInteger(record.missedWallets)} missed wallet-proposals</span>
                </div>
                <div>
                    <span class="wallet-detail-label">Latest Fulfilled</span>
                    <span class="wallet-detail-value">${escapeHtml(formatLatestFulfilledDuty(record).replace('Last fulfilled: ', ''))}</span>
                    <span class="value-subline">${formatInteger(record.totalProposals)} tracked proposals</span>
                </div>
                <div class="row-icon-actions">
                    ${representedWallets.length ? `
                        <button class="tiny-icon-button reliability-delegatee-toggle" type="button" data-delegatee="${escapeHtml(item.delegatee)}" title="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}" aria-label="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}">
                            ${expanded ? '&minus;' : '+'}
                        </button>
                    ` : ''}
                    <a class="tx-icon-link" href="${addressUrl(item.delegatee)}" target="_blank" rel="noopener noreferrer" title="View delegatee on Etherscan" aria-label="View delegatee on Etherscan">
                        ${renderExternalLinkIcon()}
                    </a>
                </div>
            </article>
            ${expanded ? renderDelegatorList(representedWallets) : ''}
        </div>
    `;
}

function renderRepeatFailureChart(rows) {
    if (!el.repeatFailureChart) return;
    const recurrence = getWastedWalletRecurrence(rows || []);
    if (!recurrence.totalWallets) {
        el.repeatFailureChart.innerHTML = '<p class="empty-state">No repeat failure data yet.</p>';
        return;
    }

    el.repeatFailureChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>Shows whether wasted voting power came from recurring wallets or one-time mistakes.</p>
            </div>
            <strong>
                <span>${formatCountPercent(recurrence.repeatWallets, recurrence.totalWallets, 1)} repeat wallets</span>
                <span>${formatPercent(recurrence.repeatPower, recurrence.totalPower, 1)} repeat dCULT</span>
            </strong>
        </div>
        <div class="concentration-grid">
            ${renderConcentrationRow('Wallets', recurrence.repeatWallets, recurrence.oneTimeWallets, 'repeat', 'one-time')}
            ${renderConcentrationRow('Vote attempts', recurrence.repeatAttempts, recurrence.oneTimeAttempts, 'repeat', 'one-time')}
            ${renderConcentrationPowerRow('dCULT weight', recurrence.repeatPower, recurrence.oneTimePower)}
        </div>
    `;
}

function renderConcentrationRow(label, repeat, oneTime, repeatLabel, oneTimeLabel) {
    const total = Number(repeat || 0) + Number(oneTime || 0);
    const repeatShare = total ? (Number(repeat || 0) / total) * 100 : 0;
    const oneTimeShare = Math.max(0, 100 - repeatShare);
    return `
        <div class="concentration-row">
            <div class="concentration-label">${escapeHtml(label)}</div>
            <div class="concentration-bar" aria-label="${escapeHtml(label)} repeat versus one-time">
                <span class="concentration-segment is-repeat" style="width: ${repeatShare.toFixed(2)}%;"></span>
                <span class="concentration-segment is-one-time" style="width: ${oneTimeShare.toFixed(2)}%;"></span>
            </div>
            <div class="concentration-values">${formatInteger(repeat)} ${escapeHtml(repeatLabel)} / ${formatInteger(oneTime)} ${escapeHtml(oneTimeLabel)}</div>
        </div>
    `;
}

function renderConcentrationPowerRow(label, repeatPower, oneTimePower) {
    const total = ethers.BigNumber.from(repeatPower || '0').add(oneTimePower || '0');
    const repeatShare = getSharePercentNumber(repeatPower, total);
    const oneTimeShare = Math.max(0, 100 - repeatShare);
    return `
        <div class="concentration-row">
            <div class="concentration-label">${escapeHtml(label)}</div>
            <div class="concentration-bar" aria-label="${escapeHtml(label)} repeat versus one-time">
                <span class="concentration-segment is-repeat" style="width: ${repeatShare.toFixed(2)}%;"></span>
                <span class="concentration-segment is-one-time" style="width: ${oneTimeShare.toFixed(2)}%;"></span>
            </div>
            <div class="concentration-values">${formatTokenAmount(repeatPower, 0)} repeat / ${formatTokenAmount(oneTimePower, 0)} one-time</div>
        </div>
    `;
}

function renderParticipationTrendChart(rows) {
    if (!el.participationTrendChart) return;
    const points = getParticipationTrendPoints(rows);
    if (points.length < 2) {
        el.participationTrendChart.innerHTML = '<p class="empty-state">No participation trend data yet.</p>';
        return;
    }

    const mode = getParticipationTrendMode();
    const latest = points[points.length - 1];
    const series = getParticipationTrendSeries(mode);
    const latestParticipating = getParticipationTrendPointValue(latest, 'participating', mode);
    const latestReadyTotal = getParticipationTrendPointValue(latest, 'ready', mode);
    const latestEligibleTotal = getParticipationTrendPointValue(latest, 'eligible', mode);
    const latestTotalStaked = getParticipationTrendPointValue(latest, 'totalStaked', mode);
    const smoothMode = isParticipationTrendSmoothMode(mode);
    const modeCopy = mode === 'wallet'
        ? 'Per-proposal wallet participation against governance-ready and staked wallets. Eligible staked wallets exclude protocol-ineligible guardians; total staked wallets include them.'
        : smoothMode
            ? `Trailing ${PARTICIPATION_SMOOTHING_WINDOW}-proposal moving average of participating token weight against governance-ready and staked dCULT.`
        : 'Per-proposal participating token weight against governance-ready and staked dCULT. Eligible staked dCULT excludes protocol-ineligible guardians; total staked dCULT includes them.';
    const latestParticipationLabel = smoothMode
        ? `${formatParticipationTrendValue(latestParticipating, mode)} smoothed participating through latest #${escapeHtml(latest.id)}`
        : `${formatParticipationTrendValue(latestParticipating, mode)} participating at latest #${escapeHtml(latest.id)}`;

    el.participationTrendChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>${escapeHtml(modeCopy)}</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${latestParticipationLabel}</span>
                    <span>${formatParticipationTrendValue(latestReadyTotal, mode)} ready / ${formatParticipationTrendValue(latestEligibleTotal, mode)} eligible</span>
                    <span>${formatParticipationTrendValue(latestTotalStaked, mode)} total staked incl. guardians</span>
                    <span>${formatDcultBillions(latest.guardianDcult)} guardian dCULT inside total</span>
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Participation chart mode">
                    <button class="chart-mode-button ${mode === 'token' ? 'is-active' : ''}" type="button" data-participation-chart-mode="token" aria-pressed="${mode === 'token' ? 'true' : 'false'}">Token weight</button>
                    <button class="chart-mode-button ${mode === 'wallet' ? 'is-active' : ''}" type="button" data-participation-chart-mode="wallet" aria-pressed="${mode === 'wallet' ? 'true' : 'false'}">Wallet count</button>
                    <button class="chart-mode-button ${mode === 'smooth' ? 'is-active' : ''}" type="button" data-participation-chart-mode="smooth" aria-pressed="${mode === 'smooth' ? 'true' : 'false'}">Smoothed avg</button>
                </div>
            </div>
        </div>
        ${renderParticipationTrendSvg(points, series, mode)}
        <div class="source-chart-legend compact-visual-legend">
            ${series.map((item) => renderParticipationLegendItem(item, mode)).join('')}
        </div>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getParticipationTrendPoints(rows) {
    const points = (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0))
        .map((row) => {
            const duty = normalizeDelegateDuty(row.delegateDuty);
            const participatingWallets = getParticipatingWalletCount(row, duty);
            const readyWallets = getEligibleReadyHolderWallets(row);
            const eligibleWallets = getEligibleHolderWallets(row);
            const totalStakedWallets = Number(row.snapshotHolderCount || 0);
            const participatingDcult = ethers.BigNumber.from(row.actualTotal || '0');
            const readyDcult = getEligibleReadyDcultSupply(row);
            const eligibleDcult = getEligibleDcultSupply(row);
            const totalStakedDcult = ethers.BigNumber.from(row.snapshotTotalSupply || '0');
            return {
                id: String(row.id || row.proposal?.id || ''),
                title: stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || ''),
                wallet: {
                    participating: participatingWallets,
                    ready: readyWallets,
                    eligible: eligibleWallets,
                    totalStaked: totalStakedWallets,
                },
                token: {
                    participating: participatingDcult,
                    ready: readyDcult,
                    eligible: eligibleDcult,
                    totalStaked: totalStakedDcult,
                },
                participatingDcult,
                readyDcult,
                eligibleDcult,
                totalStakedDcult,
                totalStakedWallets,
                guardianDcult: getGuardianDcultSupply(row),
            };
        });
    return addParticipationSmoothing(points);
}

function addParticipationSmoothing(points) {
    const keys = ['participating', 'ready', 'eligible', 'totalStaked'];
    return points.map((point, index) => {
        const start = Math.max(0, index - PARTICIPATION_SMOOTHING_WINDOW + 1);
        const window = points.slice(start, index + 1);
        const smooth = keys.reduce((acc, key) => {
            const total = window.reduce((sum, row) => sum.add(row.token?.[key] || '0'), ethers.BigNumber.from(0));
            acc[key] = avgBigNumber(total, window.length);
            return acc;
        }, {});
        return { ...point, smooth };
    });
}

function getParticipationTrendSeries(mode = getParticipationTrendMode()) {
    const walletMode = isParticipationTrendWalletMode(mode);
    const smoothMode = isParticipationTrendSmoothMode(mode);
    return [
        { key: 'participating', className: 'proper-votes', label: walletMode ? 'Participating wallets' : smoothMode ? 'Avg participating dCULT' : 'Participating dCULT', detail: walletMode ? 'actual voting wallets' : smoothMode ? `${PARTICIPATION_SMOOTHING_WINDOW}-proposal moving average` : 'actual vote weight' },
        { key: 'ready', className: 'ready-eligible-supply', label: walletMode ? 'Eligible + ready wallets' : smoothMode ? 'Avg ready dCULT' : 'Eligible + ready dCULT', detail: walletMode ? 'staked + governance-ready' : smoothMode ? `${PARTICIPATION_SMOOTHING_WINDOW}-proposal moving average` : 'delegated voting power' },
        { key: 'eligible', className: 'eligible-supply', label: walletMode ? 'Eligible staked wallets' : smoothMode ? 'Avg eligible dCULT' : 'Eligible staked dCULT', detail: walletMode ? 'staked holders, guardians excluded' : smoothMode ? `${PARTICIPATION_SMOOTHING_WINDOW}-proposal moving average` : 'staked supply, guardians excluded' },
        { key: 'totalStaked', className: 'total-staked-supply', label: walletMode ? 'Total staked wallets' : smoothMode ? 'Avg total staked dCULT' : 'Total staked dCULT', detail: walletMode ? 'all staked holders, guardians included' : smoothMode ? `${PARTICIPATION_SMOOTHING_WINDOW}-proposal moving average` : 'staked supply, guardians included' },
    ];
}

function isParticipationTrendSeriesVisible(key) {
    return participationTrendChartState.visible[key] !== false;
}

function getParticipationTrendMode() {
    if (participationTrendChartState.mode === 'wallet') return 'wallet';
    if (participationTrendChartState.mode === 'smooth') return 'smooth';
    return 'token';
}

function isParticipationTrendWalletMode(mode = getParticipationTrendMode()) {
    return mode === 'wallet';
}

function isParticipationTrendSmoothMode(mode = getParticipationTrendMode()) {
    return mode === 'smooth';
}

function getParticipationTrendPointValue(point, key, mode = getParticipationTrendMode()) {
    if (isParticipationTrendWalletMode(mode)) {
        return Number(point?.wallet?.[key] || 0);
    }
    if (isParticipationTrendSmoothMode(mode)) {
        return ethers.BigNumber.from(point?.smooth?.[key] || '0');
    }
    return ethers.BigNumber.from(point?.token?.[key] || '0');
}

function getParticipationTrendValueNumber(value, mode = getParticipationTrendMode()) {
    return isParticipationTrendWalletMode(mode) ? Number(value || 0) : tokenNumber(value);
}

function getParticipationTrendVisibleTotal(point, series, mode = getParticipationTrendMode()) {
    return series.reduce((sum, item) => {
        if (!isParticipationTrendSeriesVisible(item.key)) return sum;
        const value = getParticipationTrendPointValue(point, item.key, mode);
        return isParticipationTrendWalletMode(mode)
            ? Number(sum || 0) + Number(value || 0)
            : ethers.BigNumber.from(sum || '0').add(value);
    }, isParticipationTrendWalletMode(mode) ? 0 : ethers.BigNumber.from(0));
}

function formatParticipationTrendValue(value, mode = getParticipationTrendMode()) {
    if (isParticipationTrendWalletMode(mode)) {
        return `${formatInteger(value)} wallets`;
    }
    return formatDcultBillions(value);
}

function formatParticipationTrendAxisValue(value, mode = getParticipationTrendMode()) {
    return isParticipationTrendWalletMode(mode) ? formatCompactDecimal(value) : formatCompactDcultNumber(value);
}

function renderParticipationLegendItem(item, mode) {
    const active = isParticipationTrendSeriesVisible(item.key);
    const detail = active ? item.detail : `${item.detail} · hidden`;
    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-participation-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${escapeHtml(item.className)}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
        </button>
    `;
}

function renderParticipationTrendSvg(points, series, mode) {
    const width = 980;
    const height = 260;
    const pad = { top: 18, right: 18, bottom: 34, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const visibleSeries = series.filter((item) => isParticipationTrendSeriesVisible(item.key));
    const maxValue = Math.max(...points.map((point) => Math.max(
        ...visibleSeries.map((item) => getParticipationTrendValueNumber(getParticipationTrendPointValue(point, item.key, mode), mode)),
        0,
    )), 1);
    const xFor = (index) => points.length <= 1
        ? pad.left + innerWidth / 2
        : pad.left + (innerWidth * index) / (points.length - 1);
    const yFor = (value) => pad.top + innerHeight - (Number(value || 0) / maxValue) * innerHeight;
    const linePath = (key) => points.map((point, index) => {
        const value = getParticipationTrendValueNumber(getParticipationTrendPointValue(point, key, mode), mode);
        return `${index ? 'L' : 'M'} ${roundSvg(xFor(index))} ${roundSvg(yFor(value))}`;
    }).join(' ');
    const gridValues = [maxValue, maxValue / 2, 0];
    const grid = gridValues.map((value) => {
        const y = yFor(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${formatParticipationTrendAxisValue(value, mode)}</text>
            </g>
        `;
    }).join('');
    const lines = visibleSeries.map((item) => `<path class="trend-line source-${item.className}" d="${linePath(item.key)}"></path>`).join('');
    const hoverBands = makeParticipationHoverBands(points, pad.left, width - pad.right, height, innerWidth, mode);
    return `
        <svg class="source-chart-svg participation-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Participation ${escapeHtml(mode)} trend">
            ${grid}
            ${lines}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">#${escapeHtml(points[0]?.id || '')}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">#${escapeHtml(points[points.length - 1]?.id || '')}</text>
        </svg>
    `;
}

function makeParticipationHoverBands(points, xMin, xMax, height, innerWidth, mode) {
    if (!points.length) return '';
    const widthForPoint = innerWidth / Math.max(points.length, 1);
    return points.map((point, index) => {
        const left = Math.max(xMin, xMin + index * widthForPoint);
        const right = Math.min(xMax, left + widthForPoint);
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-participation-mode="${escapeHtml(mode)}"
                data-proposal-id="${escapeHtml(point.id || 'unknown')}"
                data-proposal-title="${escapeHtml(truncateTooltipTitle(point.title || ''))}"
                data-participating="${escapeHtml(formatParticipationTrendValue(getParticipationTrendPointValue(point, 'participating', mode), mode))}"
                data-ready="${escapeHtml(formatParticipationTrendValue(getParticipationTrendPointValue(point, 'ready', mode), mode))}"
                data-eligible="${escapeHtml(formatParticipationTrendValue(getParticipationTrendPointValue(point, 'eligible', mode), mode))}"
                data-total-staked="${escapeHtml(formatParticipationTrendValue(getParticipationTrendPointValue(point, 'totalStaked', mode), mode))}"
                data-participating-wallets="${escapeHtml(formatInteger(point.wallet.participating))}"
                data-ready-wallets="${escapeHtml(formatInteger(point.wallet.ready))}"
                data-eligible-wallets="${escapeHtml(formatInteger(point.wallet.eligible))}"
                data-total-staked-wallets="${escapeHtml(formatInteger(point.totalStakedWallets))}"
                data-participating-dcult="${escapeHtml(formatDcultBillions(point.participatingDcult))}"
                data-ready-dcult="${escapeHtml(formatDcultBillions(point.readyDcult))}"
                data-eligible-dcult="${escapeHtml(formatDcultBillions(point.eligibleDcult))}"
                data-total-staked-dcult="${escapeHtml(formatDcultBillions(point.totalStakedDcult))}"
                data-guardian-dcult="${escapeHtml(formatDcultBillions(point.guardianDcult))}"
            ></rect>
        `;
    }).join('');
}

function handleParticipationTrendChartClick(event) {
    const modeButton = event.target.closest('[data-participation-chart-mode]');
    if (modeButton) {
        const requestedMode = modeButton.dataset.participationChartMode;
        const mode = requestedMode === 'wallet' ? 'wallet' : requestedMode === 'smooth' ? 'smooth' : 'token';
        if (participationTrendChartState.mode !== mode) {
            participationTrendChartState.mode = mode;
            renderParticipationTrendChart((currentRows || []).filter(isDelegateDutyReportable));
        }
        return;
    }

    const toggleButton = event.target.closest('[data-participation-toggle]');
    if (!toggleButton) return;

    const key = toggleButton.dataset.participationToggle;
    if (!key || !Object.prototype.hasOwnProperty.call(participationTrendChartState.visible, key)) return;

    const visibleCount = Object.values(participationTrendChartState.visible).filter(Boolean).length;
    if (participationTrendChartState.visible[key] && visibleCount <= 1) return;

    participationTrendChartState.visible[key] = !participationTrendChartState.visible[key];
    renderParticipationTrendChart((currentRows || []).filter(isDelegateDutyReportable));
}

function handleParticipationTrendChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.participationTrendChart.contains(band)) {
        hideParticipationTrendTooltip();
        return;
    }

    const tooltip = el.participationTrendChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderParticipationTrendTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.participationTrendChart, tooltip, event);
}

function hideParticipationTrendTooltip() {
    const tooltip = el.participationTrendChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderParticipationTrendTooltipHtml(data) {
    const mode = data.participationMode === 'wallet' ? 'wallet' : data.participationMode === 'smooth' ? 'smooth' : 'token';
    const walletMode = isParticipationTrendWalletMode(mode);
    const smoothMode = isParticipationTrendSmoothMode(mode);
    const modeLabel = walletMode ? 'Wallet count' : smoothMode ? 'Smoothed average' : 'Token weight';
    const series = getParticipationTrendSeries(mode);
    const emptyValue = walletMode ? '0 wallets' : '0.00B dCULT';
    const contextByKey = walletMode
        ? {
            participating: { label: 'Participating dCULT', value: data.participatingDcult || '0.00B dCULT' },
            ready: { label: 'Eligible + ready dCULT', value: data.readyDcult || '0.00B dCULT' },
            eligible: { label: 'Eligible staked dCULT', value: data.eligibleDcult || '0.00B dCULT' },
            totalStaked: { label: 'Total staked dCULT', value: data.totalStakedDcult || '0.00B dCULT' },
        }
        : {
            participating: { label: 'Participating wallets', value: data.participatingWallets || '0' },
            ready: { label: 'Eligible + ready wallets', value: data.readyWallets || '0' },
            eligible: { label: 'Eligible staked wallets', value: data.eligibleWallets || '0' },
            totalStaked: { label: 'Total staked wallets', value: data.totalStakedWallets || '0' },
        };
    const rows = series
        .filter((item) => isParticipationTrendSeriesVisible(item.key))
        .map((item) => ({
            className: item.className,
            label: item.label,
            value: data[toDatasetKey(item.key)] || emptyValue,
        }));
    const contextRows = series
        .filter((item) => isParticipationTrendSeriesVisible(item.key))
        .map((item) => ({
            className: item.className,
            label: contextByKey[item.key]?.label || item.label,
            value: contextByKey[item.key]?.value || emptyValue,
        }));

    return `
        <div class="source-tooltip-title">Proposal #${escapeHtml(data.proposalId || 'unknown')}</div>
        ${data.proposalTitle ? `<div class="source-tooltip-subtitle">${escapeHtml(data.proposalTitle)}</div>` : ''}
        <div class="source-tooltip-total">
            <span>${escapeHtml(modeLabel)} view</span>
            <strong>${escapeHtml(data.participating || emptyValue)}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Guardian dCULT inside total</span>
            <strong>${escapeHtml(data.guardianDcult || '0.00B dCULT')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${escapeHtml(row.value)}</strong>
                </div>
            `).join('')}
        </div>
        <div class="source-tooltip-total source-tooltip-context">
            <span>${escapeHtml(walletMode ? 'Token context' : 'Wallet context')}</span>
        </div>
        <div class="source-tooltip-rows">
            ${contextRows.map((row) => `
                <div class="source-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${escapeHtml(row.value)}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function renderDelegateAbsenceHeatmap(rows) {
    if (!el.delegateAbsenceHeatmap) return;
    const data = getDelegateAbsenceHeatmapData(rows);
    if (!data.proposals.length) {
        el.delegateAbsenceHeatmap.innerHTML = '<p class="empty-state">No delegatee absence heatmap data yet.</p>';
        return;
    }
    const scope = getDelegateAbsenceHeatmapScope();
    const scopeCopy = scope === 'current'
        ? `Current delegatees with attached third-party voting power from #${data.firstProposalId} through latest proposal #${data.latestProposalId}.`
        : 'All delegatees that held attached third-party voting power across the full indexed non-canceled period.';
    const proposalCountLabel = scope === 'current' ? 'active-period proposals' : 'proposals';
    const historicalDutyAverage = formatHistoricalDutyAverage(rows);

    el.delegateAbsenceHeatmap.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>${escapeHtml(scopeCopy)} Red means missed duty; green means represented.</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>${formatInteger(data.delegatees.length)} delegatees</span>
                    <span>${formatInteger(data.proposals.length)} ${proposalCountLabel}</span>
                    ${historicalDutyAverage ? `<span>${escapeHtml(historicalDutyAverage)}</span>` : ''}
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Delegatee absence heatmap scope">
                    <button class="chart-mode-button ${scope === 'current' ? 'is-active' : ''}" type="button" data-delegate-heatmap-scope="current" aria-pressed="${scope === 'current' ? 'true' : 'false'}">Current</button>
                    <button class="chart-mode-button ${scope === 'all' ? 'is-active' : ''}" type="button" data-delegate-heatmap-scope="all" aria-pressed="${scope === 'all' ? 'true' : 'false'}">All</button>
                </div>
            </div>
        </div>
        ${data.delegatees.length ? `
            <div class="delegate-heatmap" style="--heatmap-columns: ${data.proposals.length};">
                ${data.delegatees.map((delegatee) => renderDelegateHeatmapRow(delegatee, data.proposals, data.statusByDelegatee)).join('')}
            </div>
        ` : '<p class="empty-state">No delegatees with attached voting power in this scope.</p>'}
        <p class="source-chart-note">Faint cells mean the wallet had no attached third-party voting power on that proposal.</p>
    `;
}

function getDelegateAbsenceHeatmapData(rows) {
    const reportRows = (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0));
    const scope = getDelegateAbsenceHeatmapScope();
    const latestRow = reportRows[reportRows.length - 1] || null;
    const latestProposalId = String(latestRow?.id || latestRow?.proposal?.id || '');
    const latestDelegatePower = getDelegatePowerMapForRow(latestRow);
    const delegateStats = new Map();
    const statusByDelegatee = new Map();

    for (const row of reportRows) {
        const proposalId = String(row.id || row.proposal?.id || '');
        const duty = normalizeDelegateDuty(row.delegateDuty);
        for (const delegateRow of duty.absentDelegates || []) {
            collectDelegateHeatmapStatus(delegateStats, statusByDelegatee, delegateRow, proposalId, 'missed');
        }
        for (const delegateRow of duty.votedDelegates || []) {
            collectDelegateHeatmapStatus(delegateStats, statusByDelegatee, delegateRow, proposalId, 'voted');
        }
    }

    const currentDelegateKeys = new Set(latestDelegatePower.keys());
    const currentStartIndex = scope === 'current'
        ? reportRows.findIndex((row) => {
            const proposalId = String(row.id || row.proposal?.id || '');
            return [...currentDelegateKeys].some((key) => statusByDelegatee.get(key)?.has(proposalId));
        })
        : 0;
    const proposals = scope === 'all'
        ? reportRows
        : reportRows.slice(currentStartIndex >= 0 ? currentStartIndex : reportRows.length);
    const shownProposalIds = proposals.map((row) => String(row.id || row.proposal?.id || ''));

    const delegatees = [...delegateStats.values()]
        .filter((delegatee) => {
            if (delegatee.power.isZero()) return false;
            if (scope === 'current' && !latestDelegatePower.has(delegatee.key)) return false;
            const statuses = statusByDelegatee.get(delegatee.key);
            return shownProposalIds.some((proposalId) => statuses?.has(proposalId));
        })
        .sort((a, b) => {
            if (scope === 'current') {
                return compareBigNumbersDesc(
                    latestDelegatePower.get(a.key) || ethers.BigNumber.from(0),
                    latestDelegatePower.get(b.key) || ethers.BigNumber.from(0),
                );
            }
            return compareBigNumbersDesc(a.power, b.power);
    });
    return {
        proposals: shownProposalIds,
        delegatees,
        statusByDelegatee,
        latestProposalId,
        firstProposalId: shownProposalIds[0] || latestProposalId,
    };
}

function collectDelegateHeatmapStatus(delegateStats, statusByDelegatee, delegateRow, proposalId, status) {
    const key = String(delegateRow.delegatee || '').toLowerCase();
    if (!key) return;
    const power = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
    if (!delegateStats.has(key)) {
        delegateStats.set(key, { delegatee: delegateRow.delegatee, key, power: ethers.BigNumber.from(0) });
    }
    delegateStats.get(key).power = delegateStats.get(key).power.add(power);
    if (!statusByDelegatee.has(key)) statusByDelegatee.set(key, new Map());
    statusByDelegatee.get(key).set(proposalId, status);
}

function getDelegatePowerMapForRow(row) {
    const map = new Map();
    if (!row) return map;
    const duty = normalizeDelegateDuty(row.delegateDuty);
    for (const delegateRow of [...(duty.absentDelegates || []), ...(duty.votedDelegates || [])]) {
        const key = String(delegateRow.delegatee || '').toLowerCase();
        if (!key) continue;
        const power = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
        if (power.isZero()) continue;
        map.set(key, (map.get(key) || ethers.BigNumber.from(0)).add(power));
    }
    return map;
}

function getDelegateAbsenceHeatmapScope() {
    return delegateAbsenceHeatmapState.scope === 'all' ? 'all' : 'current';
}

function handleDelegateAbsenceHeatmapClick(event) {
    const scopeButton = event.target.closest('[data-delegate-heatmap-scope]');
    if (!scopeButton) return;
    const scope = scopeButton.dataset.delegateHeatmapScope === 'all' ? 'all' : 'current';
    if (delegateAbsenceHeatmapState.scope === scope) return;
    delegateAbsenceHeatmapState.scope = scope;
    renderDelegateAbsenceHeatmap((currentRows || []).filter(isDelegateDutyReportable));
}

function renderDelegateHeatmapRow(delegatee, proposals, statusByDelegatee) {
    const statuses = statusByDelegatee.get(delegatee.key) || new Map();
    return `
        <div class="delegate-heatmap-label">
            ${renderAddressLink(delegatee.delegatee)}
        </div>
        <div class="delegate-heatmap-cells">
            ${proposals.map((proposalId) => {
                const status = statuses.get(proposalId) || 'none';
                const label = `${shortAddress(delegatee.delegatee)} / #${proposalId}: ${status === 'voted' ? 'represented' : status === 'missed' ? 'missed duty' : 'no attached power'}`;
                const title = status === 'none' ? '' : ` title="${escapeHtml(label)}"`;
                return `<span class="heatmap-cell is-${status}"${title}></span>`;
            }).join('')}
        </div>
    `;
}

function renderMissedPowerSpikeChart(rows) {
    if (!el.missedPowerSpikeChart) return;
    const points = getMissedPowerSpikePoints(rows);
    if (!points.length) {
        el.missedPowerSpikeChart.innerHTML = '<p class="empty-state">No missed power data yet.</p>';
        return;
    }
    const latest = points[points.length - 1];
    const series = getMissedPowerSpikeSeries();
    const visibleTotal = getVisibleMissedPowerSpikeTotal(latest, series);
    el.missedPowerSpikeChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>Per-proposal missed power, not cumulative. Use this to spot individual spikes.</p>
            </div>
            <strong>
                <span>#${escapeHtml(latest.id)} latest shown</span>
                <span>${formatCompactDcult(visibleTotal)} visible missed power</span>
            </strong>
        </div>
        ${renderMissedPowerSpikeSvg(points, series)}
        <div class="source-chart-legend compact-visual-legend">
            ${series.map((item) => renderMissedPowerSpikeLegendItem(
                item,
                getMissedPowerSpikePointValue(latest, item.key),
                visibleTotal,
                isMissedPowerSpikeSeriesVisible(item.key),
            )).join('')}
        </div>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getMissedPowerSpikePoints(rows) {
    return (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0))
        .map((row) => {
            const direct = ethers.BigNumber.from(row.wastedTotal || '0');
            const absent = ethers.BigNumber.from(row.delegateDuty?.absentDelegatedPower || '0');
            const noRights = ethers.BigNumber.from(row.noRightsWasteTotal || '0');
            const delegateMissed = ethers.BigNumber.from(row.delegateMissedWasteTotal || '0');
            return {
                id: String(row.id || row.proposal?.id || ''),
                title: stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || ''),
                direct,
                absent,
                noRights,
                delegateMissed,
                total: direct.add(absent),
            };
        });
}

function getMissedPowerSpikeSeries() {
    return [
        { key: 'direct', className: 'direct-wasted', label: 'Direct wasted votes', detail: 'zero-weight vote attempts' },
        { key: 'absent', className: 'absent-duty', label: 'Absent delegatee duty', detail: 'unrepresented delegated power' },
    ];
}

function getMissedPowerSpikePointValue(point, key) {
    return ethers.BigNumber.from(point?.[key] || '0');
}

function isMissedPowerSpikeSeriesVisible(key) {
    return missedPowerSpikeChartState.visible[key] !== false;
}

function getVisibleMissedPowerSpikeTotal(point, series) {
    return series.reduce((sum, item) => {
        if (!isMissedPowerSpikeSeriesVisible(item.key)) return sum;
        return sum.add(getMissedPowerSpikePointValue(point, item.key));
    }, ethers.BigNumber.from(0));
}

function renderMissedPowerSpikeLegendItem(item, value, total, active) {
    const detail = active
        ? `${formatDcultBillions(value)} · ${formatPercent(value, total, 1)}`
        : `${formatDcultBillions(value)} · hidden`;
    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-missed-spike-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${escapeHtml(item.className)}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
                <small class="source-legend-overlay">${escapeHtml(item.detail)}</small>
            </span>
        </button>
    `;
}

function renderMissedPowerSpikeSvg(points, series) {
    const width = 980;
    const height = 280;
    const pad = { top: 18, right: 18, bottom: 36, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...points.map((point) => tokenNumber(getVisibleMissedPowerSpikeTotal(point, series))), 1);
    const barWidth = innerWidth / Math.max(points.length, 1);
    const yFor = (value) => pad.top + innerHeight - (Number(value || 0) / maxValue) * innerHeight;
    const gridValues = [maxValue, maxValue / 2, 0];
    const grid = gridValues.map((value) => {
        const y = yFor(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${formatCompactDcultNumber(value)}</text>
            </g>
        `;
    }).join('');
    const bars = points.map((point, index) => {
        const x = pad.left + index * barWidth;
        let cursor = 0;
        return series.map((item) => {
            if (!isMissedPowerSpikeSeriesVisible(item.key)) return '';
            const value = tokenNumber(getMissedPowerSpikePointValue(point, item.key));
            const bottom = cursor;
            cursor += value;
            const top = cursor;
            const y = yFor(top);
            const barHeight = Math.max(yFor(bottom) - y, 0);
            if (barHeight <= 0) return '';
            const className = item.key === 'direct' ? 'is-direct' : 'is-absent';
            return `<rect class="spike-bar ${className}" x="${roundSvg(x)}" y="${roundSvg(y)}" width="${roundSvg(Math.max(barWidth - 1, 1))}" height="${roundSvg(barHeight)}"></rect>`;
        }).join('');
    }).join('');
    const hoverBands = makeMissedPowerSpikeHoverBands(points, series, pad.left, width - pad.right, height, innerWidth);
    return `
        <svg class="source-chart-svg missed-spike-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Per-proposal missed power by cause">
            ${grid}
            ${bars}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">#${escapeHtml(points[0]?.id || '')}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">#${escapeHtml(points[points.length - 1]?.id || '')}</text>
        </svg>
    `;
}

function makeMissedPowerSpikeHoverBands(points, series, xMin, xMax, height, innerWidth) {
    if (!points.length) return '';
    const widthForPoint = innerWidth / Math.max(points.length, 1);
    return points.map((point, index) => {
        const left = Math.max(xMin, xMin + index * widthForPoint);
        const right = Math.min(xMax, left + widthForPoint);
        const visibleTotal = getVisibleMissedPowerSpikeTotal(point, series);
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-proposal-id="${escapeHtml(point.id || 'unknown')}"
                data-proposal-title="${escapeHtml(truncateTooltipTitle(point.title || ''))}"
                data-visible-total="${escapeHtml(formatDcultBillions(visibleTotal))}"
                data-direct="${escapeHtml(formatDcultBillions(point.direct))}"
                data-no-rights="${escapeHtml(formatDcultBillions(point.noRights))}"
                data-delegate-missed="${escapeHtml(formatDcultBillions(point.delegateMissed))}"
                data-absent="${escapeHtml(formatDcultBillions(point.absent))}"
                aria-label="${escapeHtml(formatMissedPowerSpikeTooltip(point, series))}"
            ></rect>
        `;
    }).join('');
}

function formatMissedPowerSpikeTooltip(point, series) {
    const visibleTotal = getVisibleMissedPowerSpikeTotal(point, series);
    const showDirect = isMissedPowerSpikeSeriesVisible('direct');
    const showAbsent = isMissedPowerSpikeSeriesVisible('absent');
    const lines = [
        `Proposal #${point.id || 'unknown'}${point.title ? `: ${truncateTooltipTitle(point.title)}` : ''}`,
        `Visible selected: ${formatDcultBillions(visibleTotal)}`,
        ...(showDirect ? [`Direct wasted votes: ${formatDcultBillions(point.direct)}`] : []),
        ...(showDirect ? [`No-rights direct waste: ${formatDcultBillions(point.noRights)}`] : []),
        ...(showDirect ? [`Delegatee-absent direct waste: ${formatDcultBillions(point.delegateMissed)}`] : []),
        ...(showAbsent ? [`Absent delegatee duty: ${formatDcultBillions(point.absent)}`] : []),
    ];
    return lines.join('\n');
}

function handleMissedPowerSpikeChartClick(event) {
    const toggleButton = event.target.closest('[data-missed-spike-toggle]');
    if (!toggleButton) return;

    const key = toggleButton.dataset.missedSpikeToggle;
    if (!key || !Object.prototype.hasOwnProperty.call(missedPowerSpikeChartState.visible, key)) return;

    const visibleCount = Object.values(missedPowerSpikeChartState.visible).filter(Boolean).length;
    if (missedPowerSpikeChartState.visible[key] && visibleCount <= 1) return;

    missedPowerSpikeChartState.visible[key] = !missedPowerSpikeChartState.visible[key];
    renderMissedPowerSpikeChart((currentRows || []).filter(isDelegateDutyReportable));
}

function handleMissedPowerSpikeChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.missedPowerSpikeChart.contains(band)) {
        hideMissedPowerSpikeTooltip();
        return;
    }

    const tooltip = el.missedPowerSpikeChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderMissedPowerSpikeTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.missedPowerSpikeChart, tooltip, event);
}

function hideMissedPowerSpikeTooltip() {
    const tooltip = el.missedPowerSpikeChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderMissedPowerSpikeTooltipHtml(data) {
    const showDirect = isMissedPowerSpikeSeriesVisible('direct');
    const showAbsent = isMissedPowerSpikeSeriesVisible('absent');
    const rows = [
        ...(showDirect ? [{ className: 'direct-wasted', label: 'Direct wasted votes', value: data.direct }] : []),
        ...(showDirect ? [{ className: 'no-rights-total', label: 'No-rights direct waste', value: data.noRights }] : []),
        ...(showDirect ? [{ className: 'delegate-missed-overlay', label: 'Delegatee-absent direct waste', value: data.delegateMissed }] : []),
        ...(showAbsent ? [{ className: 'absent-duty', label: 'Absent delegatee duty', value: data.absent }] : []),
    ];

    return `
        <div class="source-tooltip-title">Proposal #${escapeHtml(data.proposalId || 'unknown')}</div>
        ${data.proposalTitle ? `<div class="source-tooltip-subtitle">${escapeHtml(data.proposalTitle)}</div>` : ''}
        <div class="source-tooltip-total">
            <span>Visible selected</span>
            <strong>${escapeHtml(data.visibleTotal || '0.00B dCULT')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${escapeHtml(row.value || '0.00B dCULT')}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function renderStaticLegendItem(className, label, detail) {
    return `
        <div class="source-legend-item is-active static-legend-item">
            <span class="source-legend-swatch source-${escapeHtml(className)}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(label)}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
        </div>
    `;
}

function formatCompactDcult(value) {
    return `${formatCompactDcultNumber(tokenNumber(value))} dCULT`;
}

function toDatasetKey(key) {
    return String(key || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function positionChartTooltip(chartEl, tooltip, event) {
    const chartRect = chartEl.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const cursorX = event.clientX - chartRect.left;
    const cursorY = event.clientY - chartRect.top;
    const spaceRight = chartRect.width - cursorX;
    const preferredLeft = spaceRight < tooltipRect.width + 28
        ? cursorX - tooltipRect.width - 14
        : cursorX + 14;
    const preferredTop = event.clientY - chartRect.top - tooltipRect.height - 14;
    const left = Math.min(Math.max(8, preferredLeft), Math.max(8, chartRect.width - tooltipRect.width - 8));
    const top = Math.max(8, Math.min(preferredTop, cursorY + 14));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function renderVotingPowerChart(rows) {
    if (!el.votingPowerChart) return;

    const mode = getVotingPowerChartMode();
    const points = getVotingPowerPoints(rows, mode);
    const latest = points[points.length - 1];
    if (!latest) {
        el.votingPowerChart.innerHTML = '<p class="empty-state">No voting power data yet.</p>';
        return;
    }

    const series = getVotingPowerSeries();
    const summaryPoint = getVotingPowerLegendPoint(points, mode);
    if (summaryPoint.total.isZero()) {
        el.votingPowerChart.innerHTML = '<p class="empty-state">No voting power data yet.</p>';
        return;
    }

    const visibleTotal = getVisibleVotingPowerTotal(summaryPoint, series);
    const legendItems = series.map((item) => renderVotingPowerLegendItem(
        item,
        getVotingPowerPointValue(summaryPoint, item.key),
        visibleTotal,
        isVotingPowerSeriesVisible(item.key),
        mode,
    )).join('');
    const modeCopy = mode === 'cumulative'
        ? 'Each bar accumulates proper votes, direct wasted votes, and absent delegatee power through that proposal.'
        : 'Each bar is one non-canceled proposal, comparing proper votes, direct wasted votes, and absent delegatee power.';

    el.votingPowerChart.innerHTML = `
        <div class="source-chart-header">
            <div>
                <p>${escapeHtml(modeCopy)}</p>
            </div>
            <div class="source-chart-side">
                <strong>
                    <span>#${escapeHtml(latest.id)} latest shown</span>
                    <span>${formatDcultBillions(visibleTotal)} ${mode === 'proposal' ? 'shown total' : 'through latest'}</span>
                </strong>
                <div class="chart-mode-toggle" role="group" aria-label="Voting power chart mode">
                    <button class="chart-mode-button ${mode === 'proposal' ? 'is-active' : ''}" type="button" data-voting-power-chart-mode="proposal" aria-pressed="${mode === 'proposal' ? 'true' : 'false'}">By proposal</button>
                    <button class="chart-mode-button ${mode === 'cumulative' ? 'is-active' : ''}" type="button" data-voting-power-chart-mode="cumulative" aria-pressed="${mode === 'cumulative' ? 'true' : 'false'}">Cumulative</button>
                </div>
            </div>
        </div>
        <div class="source-chart-body">
            ${renderVotingPowerSvg(points, series, mode)}
            <div class="source-chart-legend">${legendItems}</div>
        </div>
        <div class="source-tooltip" aria-hidden="true"></div>
    `;
}

function getVotingPowerPoints(rows, mode = getVotingPowerChartMode()) {
    const cumulative = mode === 'cumulative';
    let yesVotes = ethers.BigNumber.from(0);
    let noVotes = ethers.BigNumber.from(0);
    let directWasted = ethers.BigNumber.from(0);
    let absentDuty = ethers.BigNumber.from(0);

    return (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0))
        .map((row) => {
            const rowYes = ethers.BigNumber.from(row.actualFor || '0');
            const rowNo = ethers.BigNumber.from(row.actualAgainst || '0');
            const rowWasted = ethers.BigNumber.from(row.wastedTotal || '0');
            const rowAbsent = ethers.BigNumber.from(row.delegateDuty?.absentDelegatedPower || '0');
            if (cumulative) {
                yesVotes = yesVotes.add(rowYes);
                noVotes = noVotes.add(rowNo);
                directWasted = directWasted.add(rowWasted);
                absentDuty = absentDuty.add(rowAbsent);
            } else {
                yesVotes = rowYes;
                noVotes = rowNo;
                directWasted = rowWasted;
                absentDuty = rowAbsent;
            }
            const properVotes = yesVotes.add(noVotes);
            const total = properVotes.add(directWasted).add(absentDuty);
            return {
                id: String(row.id || row.proposal?.id || ''),
                title: stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || ''),
                yesVotes,
                noVotes,
                properVotes,
                directWasted,
                absentDuty,
                total,
            };
        });
}

function getVotingPowerSeries() {
    return [
        { key: 'properVotes', className: 'proper-votes', label: 'Proper votes' },
        { key: 'directWasted', className: 'direct-wasted', label: 'Direct wasted votes' },
        { key: 'absentDuty', className: 'absent-duty', label: 'Absent delegatee duty' },
    ];
}

function getVotingPowerChartMode() {
    return votingPowerChartState.mode === 'cumulative' ? 'cumulative' : 'proposal';
}

function getVotingPowerPointValue(point, key) {
    return ethers.BigNumber.from(point?.[key] || '0');
}

function getVotingPowerLegendPoint(points, mode = getVotingPowerChartMode()) {
    if (mode === 'cumulative') return points[points.length - 1];

    const latest = points[points.length - 1] || {};
    return points.reduce((summary, point) => {
        const yesVotes = summary.yesVotes.add(point.yesVotes || '0');
        const noVotes = summary.noVotes.add(point.noVotes || '0');
        const properVotes = summary.properVotes.add(point.properVotes || '0');
        const directWasted = summary.directWasted.add(point.directWasted || '0');
        const absentDuty = summary.absentDuty.add(point.absentDuty || '0');
        return {
            id: latest.id || '',
            title: latest.title || '',
            yesVotes,
            noVotes,
            properVotes,
            directWasted,
            absentDuty,
            total: properVotes.add(directWasted).add(absentDuty),
        };
    }, {
        id: latest.id || '',
        title: latest.title || '',
        yesVotes: ethers.BigNumber.from(0),
        noVotes: ethers.BigNumber.from(0),
        properVotes: ethers.BigNumber.from(0),
        directWasted: ethers.BigNumber.from(0),
        absentDuty: ethers.BigNumber.from(0),
        total: ethers.BigNumber.from(0),
    });
}

function isVotingPowerSeriesVisible(key) {
    return votingPowerChartState.visible[key] !== false;
}

function getVisibleVotingPowerTotal(point, series) {
    return series.reduce((sum, item) => {
        if (!isVotingPowerSeriesVisible(item.key)) return sum;
        return sum.add(getVotingPowerPointValue(point, item.key));
    }, ethers.BigNumber.from(0));
}

function renderVotingPowerLegendItem(item, value, total, active, mode = getVotingPowerChartMode()) {
    const scope = mode === 'proposal' ? 'shown total' : 'through latest';
    const detail = active
        ? `${formatDcultBillions(value)} · ${formatPercent(value, total, 1)} · ${scope}`
        : `${formatDcultBillions(value)} · hidden`;
    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-voting-power-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${escapeHtml(item.className)}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
            </span>
        </button>
    `;
}

function renderVotingPowerSvg(points, series, mode) {
    const width = 980;
    const height = 300;
    const pad = { top: 18, right: 18, bottom: 38, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...points.map((point) => tokenNumber(getVisibleVotingPowerTotal(point, series))), 1);
    const barWidth = innerWidth / Math.max(points.length, 1);
    const yFor = (value) => pad.top + innerHeight - ((Number(value || 0)) / maxValue) * innerHeight;
    const gridValues = [maxValue, maxValue / 2, 0];
    const grid = gridValues.map((value) => {
        const y = yFor(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${formatCompactDcultNumber(value)}</text>
            </g>
        `;
    }).join('');
    const bars = points.map((point, index) => {
        const x = pad.left + index * barWidth;
        const widthForBar = Math.max(barWidth - 1, 1);
        let cursor = 0;
        return series.map((item) => {
            if (!isVotingPowerSeriesVisible(item.key)) return '';
            const value = tokenNumber(getVotingPowerPointValue(point, item.key));
            const bottom = cursor;
            cursor += value;
            const y = yFor(cursor);
            const barHeight = Math.max(yFor(bottom) - y, 0);
            if (barHeight <= 0) return '';
            const rect = `<rect class="source-area source-${escapeHtml(item.className)}" x="${roundSvg(x)}" y="${roundSvg(y)}" width="${roundSvg(widthForBar)}" height="${roundSvg(barHeight)}"></rect>`;
            if (item.key !== 'properVotes') return rect;
            const yesValue = tokenNumber(point.yesVotes || '0');
            const noValue = tokenNumber(point.noVotes || '0');
            if (yesValue <= 0 || noValue <= 0) return rect;
            const splitY = yFor(bottom + yesValue);
            return `
                ${rect}
                <line class="proper-vote-split" x1="${roundSvg(x)}" x2="${roundSvg(x + widthForBar)}" y1="${roundSvg(splitY)}" y2="${roundSvg(splitY)}"></line>
            `;
        }).join('');
    }).join('');
    const hoverBands = makeVotingPowerHoverBands(points, series, pad.left, width - pad.right, height, innerWidth);

    return `
        <svg class="source-chart-svg voting-power-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Voting power ${escapeHtml(mode)} bars">
            ${grid}
            ${bars}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">#${escapeHtml(points[0]?.id || '')}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">#${escapeHtml(points[points.length - 1]?.id || '')}</text>
        </svg>
    `;
}

function makeVotingPowerHoverBands(points, series, xMin, xMax, height, innerWidth) {
    if (!points.length) return '';
    const widthForPoint = innerWidth / Math.max(points.length, 1);
    return points.map((point, index) => {
        const left = Math.max(xMin, xMin + index * widthForPoint);
        const right = Math.min(xMax, left + widthForPoint);
        const visibleTotal = getVisibleVotingPowerTotal(point, series);
        const properShare = getSharePercentNumber(point.properVotes, visibleTotal).toFixed(2);
        const directShare = getSharePercentNumber(point.directWasted, visibleTotal).toFixed(2);
        const absentShare = getSharePercentNumber(point.absentDuty, visibleTotal).toFixed(2);
        const yesShare = getSharePercentNumber(point.yesVotes, point.properVotes).toFixed(2);
        const noShare = getSharePercentNumber(point.noVotes, point.properVotes).toFixed(2);
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-proposal-id="${escapeHtml(point.id || 'unknown')}"
                data-proposal-title="${escapeHtml(truncateTooltipTitle(point.title || ''))}"
                data-visible-total="${escapeHtml(formatDcultBillions(visibleTotal))}"
                data-proper-votes="${escapeHtml(formatDcultBillions(point.properVotes))}"
                data-proper-votes-share="${escapeHtml(properShare)}"
                data-yes-votes="${escapeHtml(formatDcultBillions(point.yesVotes))}"
                data-yes-votes-share="${escapeHtml(yesShare)}"
                data-no-votes="${escapeHtml(formatDcultBillions(point.noVotes))}"
                data-no-votes-share="${escapeHtml(noShare)}"
                data-direct-wasted="${escapeHtml(formatDcultBillions(point.directWasted))}"
                data-direct-wasted-share="${escapeHtml(directShare)}"
                data-absent-duty="${escapeHtml(formatDcultBillions(point.absentDuty))}"
                data-absent-duty-share="${escapeHtml(absentShare)}"
            ></rect>
        `;
    }).join('');
}

function handleVotingPowerChartClick(event) {
    const modeButton = event.target.closest('[data-voting-power-chart-mode]');
    if (modeButton) {
        const mode = modeButton.dataset.votingPowerChartMode === 'cumulative' ? 'cumulative' : 'proposal';
        if (votingPowerChartState.mode !== mode) {
            votingPowerChartState.mode = mode;
            renderVotingPowerChart((currentRows || []).filter(isDelegateDutyReportable));
        }
        return;
    }

    const toggleButton = event.target.closest('[data-voting-power-toggle]');
    if (!toggleButton) return;

    const key = toggleButton.dataset.votingPowerToggle;
    if (!key || !Object.prototype.hasOwnProperty.call(votingPowerChartState.visible, key)) return;

    const visibleCount = Object.values(votingPowerChartState.visible).filter(Boolean).length;
    if (votingPowerChartState.visible[key] && visibleCount <= 1) return;

    votingPowerChartState.visible[key] = !votingPowerChartState.visible[key];
    renderVotingPowerChart((currentRows || []).filter(isDelegateDutyReportable));
}

function handleVotingPowerChartPointerMove(event) {
    const band = event.target.closest('.source-hover-band');
    if (!band || !el.votingPowerChart.contains(band)) {
        hideVotingPowerChartTooltip();
        return;
    }

    const tooltip = el.votingPowerChart.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderVotingPowerTooltipHtml(band.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.votingPowerChart, tooltip, event);
}

function hideVotingPowerChartTooltip() {
    const tooltip = el.votingPowerChart?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderVotingPowerTooltipHtml(data) {
    const series = getVotingPowerSeries();
    const rows = series
        .filter((item) => isVotingPowerSeriesVisible(item.key))
        .map((item) => ({
            className: item.className,
            label: item.label,
            value: data[toDatasetKey(item.key)],
            detailHtml: item.key === 'properVotes'
                ? renderVotingPowerProperTooltipDetail(data)
                : `<small>${escapeHtml(data[`${toDatasetKey(item.key)}Share`] || '0.00')}% visible</small>`,
        }));

    return `
        <div class="source-tooltip-title">Proposal #${escapeHtml(data.proposalId || 'unknown')}</div>
        ${data.proposalTitle ? `<div class="source-tooltip-subtitle">${escapeHtml(data.proposalTitle)}</div>` : ''}
        <div class="source-tooltip-total">
            <span>Visible selected</span>
            <strong>${escapeHtml(data.visibleTotal || '0.00B dCULT')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row ${row.detailHtml ? 'composition-tooltip-row' : ''}">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>
                        ${escapeHtml(row.label)}
                        ${row.detailHtml || ''}
                    </span>
                    <strong>${escapeHtml(row.value || '0.00B dCULT')}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function renderVotingPowerProperTooltipDetail(data) {
    return `
        <small class="voting-power-split-detail">
            <span>${escapeHtml(data.properVotesShare || '0.00')}% visible</span>
            <span>Yes ${escapeHtml(data.yesVotes || '0.00B dCULT')} · ${escapeHtml(data.yesVotesShare || '0.00')}%</span>
            <span>No ${escapeHtml(data.noVotes || '0.00B dCULT')} · ${escapeHtml(data.noVotesShare || '0.00')}%</span>
        </small>
    `;
}

function getWastedSourceTrend(rows, mode = getSourceChartMode()) {
    const sortedRows = (rows || [])
        .filter(isDelegateDutyReportable)
        .slice()
        .sort((a, b) => Number(a.id || a.proposal?.id || 0) - Number(b.id || b.proposal?.id || 0));
    const repeatWastedVoters = getRepeatWastedVoters(sortedRows);
    const cumulative = mode === 'cumulative';
    let noRights = ethers.BigNumber.from(0);
    let delegateMissed = ethers.BigNumber.from(0);
    let directWasted = ethers.BigNumber.from(0);
    let repeatWasted = ethers.BigNumber.from(0);
    let oneTimeWasted = ethers.BigNumber.from(0);
    let oneTimeNoRights = ethers.BigNumber.from(0);
    let oneTimeDelegateMissed = ethers.BigNumber.from(0);
    let absentDuty = ethers.BigNumber.from(0);
    let total = ethers.BigNumber.from(0);

    return sortedRows.map((row) => {
        const split = getRowWastedRepeatSplit(row, repeatWastedVoters);
        const rowNoRights = ethers.BigNumber.from(row.noRightsWasteTotal || '0');
        const rowDelegateMissed = ethers.BigNumber.from(row.delegateMissedWasteTotal || '0');
        const rowDirectWasted = ethers.BigNumber.from(row.wastedTotal || '0');
        const rowAbsentDuty = ethers.BigNumber.from(row.delegateDuty?.absentDelegatedPower || '0');
        if (cumulative) {
            noRights = noRights.add(rowNoRights);
            delegateMissed = delegateMissed.add(rowDelegateMissed);
            directWasted = directWasted.add(rowDirectWasted);
            repeatWasted = repeatWasted.add(split.repeatWasted);
            oneTimeWasted = oneTimeWasted.add(split.oneTimeWasted);
            oneTimeNoRights = oneTimeNoRights.add(split.oneTimeNoRights);
            oneTimeDelegateMissed = oneTimeDelegateMissed.add(split.oneTimeDelegateMissed);
            absentDuty = absentDuty.add(rowAbsentDuty);
            total = total.add(rowDirectWasted);
        } else {
            noRights = rowNoRights;
            delegateMissed = rowDelegateMissed;
            directWasted = rowDirectWasted;
            repeatWasted = split.repeatWasted;
            oneTimeWasted = split.oneTimeWasted;
            oneTimeNoRights = split.oneTimeNoRights;
            oneTimeDelegateMissed = split.oneTimeDelegateMissed;
            absentDuty = rowAbsentDuty;
            total = rowDirectWasted;
        }
        const sourceTotal = directWasted;
        const unclassified = total.gt(sourceTotal) ? total.sub(sourceTotal) : ethers.BigNumber.from(0);
        const stackTotal = sourceTotal.add(unclassified);
        const chartTotal = stackTotal.add(absentDuty);
        return {
            id: String(row.id || row.proposal?.id || ''),
            title: stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || ''),
            noRights,
            delegateMissed,
            directWasted,
            repeatWasted,
            oneTimeWasted,
            oneTimeNoRights,
            oneTimeDelegateMissed,
            absentDuty,
            unclassified,
            sourceTotal,
            total,
            stackTotal,
            chartTotal,
        };
    });
}

function getSourceChartMode() {
    return sourceChartState.mode === 'proposal' ? 'proposal' : 'cumulative';
}

function getRepeatWastedVoters(rows) {
    const proposalsByVoter = new Map();
    for (const row of rows || []) {
        const proposalId = String(row.id || row.proposal?.id || '');
        for (const wallet of row.zeroWallets || []) {
            if (wallet.representationStatus !== 'wasted') continue;
            const voter = String(wallet.voter || '').toLowerCase();
            if (!voter) continue;
            if (!proposalsByVoter.has(voter)) proposalsByVoter.set(voter, new Set());
            proposalsByVoter.get(voter).add(proposalId);
        }
    }

    return new Set([...proposalsByVoter.entries()]
        .filter(([, proposals]) => proposals.size > 1)
        .map(([voter]) => voter));
}

function getRowWastedRepeatSplit(row, repeatWastedVoters) {
    return (row.zeroWallets || []).reduce((split, wallet) => {
        if (wallet.representationStatus !== 'wasted') return split;
        const balance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
        if (balance.isZero()) return split;
        const voter = String(wallet.voter || '').toLowerCase();
        if (repeatWastedVoters.has(voter)) {
            split.repeatWasted = split.repeatWasted.add(balance);
        } else {
            split.oneTimeWasted = split.oneTimeWasted.add(balance);
            if (wallet.wasteReason === 'delegate_not_voted') {
                split.oneTimeDelegateMissed = split.oneTimeDelegateMissed.add(balance);
            } else {
                split.oneTimeNoRights = split.oneTimeNoRights.add(balance);
            }
        }
        return split;
    }, {
        repeatWasted: ethers.BigNumber.from(0),
        oneTimeWasted: ethers.BigNumber.from(0),
        oneTimeNoRights: ethers.BigNumber.from(0),
        oneTimeDelegateMissed: ethers.BigNumber.from(0),
    });
}

function getRowWastedRepeatWalletSplit(row, repeatWastedVoters) {
    const repeat = new Set();
    const oneTime = new Set();
    for (const wallet of row.zeroWallets || []) {
        if (wallet.representationStatus !== 'wasted') continue;
        const voter = String(wallet.voter || '').toLowerCase();
        if (!voter) continue;
        if (repeatWastedVoters.has(voter)) {
            repeat.add(voter);
        } else {
            oneTime.add(voter);
        }
    }
    return {
        repeat: repeat.size,
        oneTime: oneTime.size,
        total: repeat.size + oneTime.size,
    };
}

function getSourceChartSeries(hasUnclassified) {
    const series = [
        { key: 'directWasted', className: 'direct-wasted', label: 'Direct wasted votes' },
        { key: 'absentDuty', className: 'absent-duty', label: 'Absent delegatee duty' },
    ];
    if (hasUnclassified) series.push({ key: 'unclassified', className: 'unclassified', label: 'Unclassified' });
    return series;
}

function getSourcePointValue(point, key) {
    return ethers.BigNumber.from(point?.[key] || '0');
}

function isSourceSeriesVisible(key) {
    return sourceChartState.visible[key] !== false;
}

function getVisibleSourceTotal(point, series) {
    return series.reduce((sum, item) => {
        if (!isSourceSeriesVisible(item.key)) return sum;
        return sum.add(getSourcePointValue(point, item.key));
    }, ethers.BigNumber.from(0));
}

function renderSourceLegendItem(item, value, total, active, latestPoint = null, mode = getSourceChartMode()) {
    const scope = mode === 'proposal' ? 'shown total' : 'through latest';
    const detail = active
        ? `${formatDcultBillions(value)} · ${formatPercent(value, total, 1)} · ${scope}`
        : `${formatDcultBillions(value)} · hidden`;
    const directOverlay = item.key === 'directWasted' && active
        ? {
            repeat: getSourcePointValue(latestPoint, 'repeatWasted'),
            oneTime: getSourcePointValue(latestPoint, 'oneTimeWasted'),
            oneTimeNoRights: getSourcePointValue(latestPoint, 'oneTimeNoRights'),
            oneTimeDelegateMissed: getSourcePointValue(latestPoint, 'oneTimeDelegateMissed'),
            delegateMissed: getSourcePointValue(latestPoint, 'delegateMissed'),
        }
        : ethers.BigNumber.from(0);

    return `
        <button class="source-legend-item ${active ? 'is-active' : 'is-muted'}" type="button" data-source-toggle="${escapeHtml(item.key)}" aria-pressed="${active ? 'true' : 'false'}">
            <span class="source-legend-swatch source-${item.className}" aria-hidden="true"></span>
            <span>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(detail)}</small>
                ${directOverlay.repeat?.gt(0) || directOverlay.oneTime?.gt(0) ? `
                    <small class="source-legend-overlay source-legend-breakdown-row">
                        <span class="source-legend-breakdown-swatch is-repeat" aria-hidden="true"></span>
                        <span>Repeat wasted ${formatDcultBillions(directOverlay.repeat)}</span>
                    </small>
                    <small class="source-legend-overlay source-legend-breakdown-row">
                        <span class="source-legend-breakdown-swatch is-one-time" aria-hidden="true"></span>
                        <span>One-time no rights ${formatDcultBillions(directOverlay.oneTimeNoRights)}</span>
                    </small>
                    <small class="source-legend-overlay source-legend-breakdown-row">
                        <span class="source-legend-breakdown-swatch is-delegatee-absent" aria-hidden="true"></span>
                        <span>Delegatee-absent direct waste ${formatDcultBillions(directOverlay.delegateMissed)}</span>
                    </small>
                ` : ''}
            </span>
        </button>
    `;
}

function renderWastedSourceAreaSvg(points, series) {
    const width = 980;
    const height = 300;
    const pad = { top: 18, right: 18, bottom: 38, left: 62 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const maxValue = Math.max(...points.map((point) => tokenNumber(getVisibleSourceTotal(point, series))), 1);
    const barWidth = innerWidth / Math.max(points.length, 1);
    const yFor = (value) => {
        return pad.top + innerHeight - ((Number(value) || 0) / maxValue) * innerHeight;
    };
    const chartPoints = points.map((point, index) => {
        const chartPoint = {
            x: pad.left + index * barWidth,
            width: Math.max(barWidth - 1, 1),
        };
        let cursor = 0;
        for (const item of series) {
            const value = isSourceSeriesVisible(item.key) ? tokenNumber(getSourcePointValue(point, item.key)) : 0;
            chartPoint[`${item.key}Bottom`] = cursor;
            cursor += value;
            chartPoint[`${item.key}Top`] = cursor;
        }
        const directWastedValue = tokenNumber(point.directWasted || '0');
        const delegateMissedValue = Math.min(tokenNumber(point.delegateMissed || '0'), directWastedValue);
        const availableNoRightsArea = Math.max(directWastedValue - delegateMissedValue, 0);
        chartPoint.oneTimeNoRightsOverlayBottom = 0;
        chartPoint.oneTimeNoRightsOverlayTop = shouldShowOneTimeWastedOverlay()
            ? Math.min(tokenNumber(point.oneTimeNoRights || '0'), availableNoRightsArea)
            : 0;
        chartPoint.delegateMissedOverlayBottom = shouldShowOneTimeWastedOverlay()
            ? Math.max(directWastedValue - delegateMissedValue, 0)
            : 0;
        chartPoint.delegateMissedOverlayTop = shouldShowOneTimeWastedOverlay()
            ? directWastedValue
            : 0;
        chartPoint.visibleTotal = cursor;
        return chartPoint;
    });
    const grid = getSourceChartGridValues(maxValue).map((value) => {
        const y = yFor(value);
        const label = value === 0 ? '0' : formatCompactDcultNumber(value);
        return `
            <g class="source-grid">
                <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}"></line>
                <text x="${pad.left - 10}" y="${y + 4}">${escapeHtml(label)}</text>
            </g>
        `;
    }).join('');
    const latest = points[points.length - 1];
    const firstId = points[0]?.id || '';
    const lastId = latest?.id || '';
    const activeBars = chartPoints.map((point) => series
        .filter((item) => isSourceSeriesVisible(item.key))
        .map((item) => {
            const bottom = point[`${item.key}Bottom`];
            const top = point[`${item.key}Top`];
            const y = yFor(top);
            const barHeight = Math.max(yFor(bottom) - y, 0);
            if (barHeight <= 0) return '';
            return `<rect class="source-area source-${item.className}" x="${roundSvg(point.x)}" y="${roundSvg(y)}" width="${roundSvg(point.width)}" height="${roundSvg(barHeight)}"></rect>`;
        }).join('')).join('');
    const oneTimeOverlays = shouldShowOneTimeWastedOverlay()
        ? chartPoints.map((point) => {
            const noRightsY = yFor(point.oneTimeNoRightsOverlayTop);
            const noRightsHeight = Math.max(yFor(point.oneTimeNoRightsOverlayBottom) - noRightsY, 0);
            const delegateY = yFor(point.delegateMissedOverlayTop);
            const delegateHeight = Math.max(yFor(point.delegateMissedOverlayBottom) - delegateY, 0);
            return `
                ${noRightsHeight > 0 ? `<rect class="source-one-time-no-rights-overlay" x="${roundSvg(point.x)}" y="${roundSvg(noRightsY)}" width="${roundSvg(point.width)}" height="${roundSvg(noRightsHeight)}"></rect>` : ''}
                ${delegateHeight > 0 ? `<rect class="source-delegate-missed-overlay" x="${roundSvg(point.x)}" y="${roundSvg(delegateY)}" width="${roundSvg(point.width)}" height="${roundSvg(delegateHeight)}"></rect>` : ''}
            `;
        }).join('')
        : '';
    const hoverBands = makeSourceChartHoverBands(points, series, pad.left, width - pad.right, height, innerWidth);

    return `
        <svg class="source-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Missed voting power by source">
            ${grid}
            ${activeBars}
            ${oneTimeOverlays}
            ${hoverBands}
            <text class="source-x-label" x="${pad.left}" y="${height - 10}">#${escapeHtml(firstId)}</text>
            <text class="source-x-label source-x-label-end" x="${width - pad.right}" y="${height - 10}">#${escapeHtml(lastId)}</text>
        </svg>
    `;
}

function createZeroSourcePoint(id) {
    return {
        id,
        directWasted: ethers.BigNumber.from(0),
        noRights: ethers.BigNumber.from(0),
        delegateMissed: ethers.BigNumber.from(0),
        repeatWasted: ethers.BigNumber.from(0),
        oneTimeWasted: ethers.BigNumber.from(0),
        oneTimeNoRights: ethers.BigNumber.from(0),
        oneTimeDelegateMissed: ethers.BigNumber.from(0),
        absentDuty: ethers.BigNumber.from(0),
        unclassified: ethers.BigNumber.from(0),
    };
}

function shouldShowOneTimeWastedOverlay() {
    return isSourceSeriesVisible('directWasted');
}

function getSourceChartGridValues(maxValue) {
    return [maxValue, maxValue / 2, 0];
}

function makeSourceChartHoverBands(points, series, xMin, xMax, height, innerWidth) {
    if (!points.length) return '';
    const widthForPoint = innerWidth / Math.max(points.length, 1);
    return points.map((point, index) => {
        const left = Math.max(xMin, xMin + index * widthForPoint);
        const right = Math.min(xMax, left + widthForPoint);
        const visibleTotal = getVisibleSourceTotal(point, series);
        const noRightsDirectShare = getSharePercentNumber(point.noRights, point.directWasted);
        const delegateMissedDirectShare = getSharePercentNumber(point.delegateMissed, point.directWasted);
        return `
            <rect
                class="source-hover-band"
                x="${roundSvg(left)}"
                y="0"
                width="${roundSvg(Math.max(right - left, 4))}"
                height="${height}"
                data-proposal-id="${escapeHtml(point.id || 'unknown')}"
                data-proposal-title="${escapeHtml(truncateTooltipTitle(point.title || ''))}"
                data-visible-total="${escapeHtml(formatDcultBillions(visibleTotal))}"
                data-direct-wasted="${escapeHtml(formatDcultBillions(point.directWasted))}"
                data-no-rights="${escapeHtml(formatDcultBillions(point.noRights))}"
                data-no-rights-direct-share="${escapeHtml(noRightsDirectShare.toFixed(2))}"
                data-delegate-missed="${escapeHtml(formatDcultBillions(point.delegateMissed))}"
                data-delegate-missed-direct-share="${escapeHtml(delegateMissedDirectShare.toFixed(2))}"
                data-repeat-wasted="${escapeHtml(formatDcultBillions(point.repeatWasted))}"
                data-one-time-wasted="${escapeHtml(formatDcultBillions(point.oneTimeWasted))}"
                data-one-time-no-rights="${escapeHtml(formatDcultBillions(point.oneTimeNoRights))}"
                data-one-time-delegate-missed="${escapeHtml(formatDcultBillions(point.oneTimeDelegateMissed))}"
                data-absent-duty="${escapeHtml(formatDcultBillions(point.absentDuty))}"
                aria-label="${escapeHtml(formatSourceChartTooltip(point, series))}"
            ></rect>
        `;
    }).join('');
}

function formatSourceChartTooltip(point, series) {
    const visibleTotal = getVisibleSourceTotal(point, series);
    const showDirectWasted = isSourceSeriesVisible('directWasted');
    const showAbsentDuty = isSourceSeriesVisible('absentDuty');
    const showDirectCauseSplit = showDirectWasted
        && shouldShowDirectCauseTooltipSplit(point.noRights, point.delegateMissed, point.directWasted);
    const lines = [
        `Proposal #${point.id || 'unknown'}${point.title ? `: ${truncateTooltipTitle(point.title)}` : ''}`,
        `Visible selected: ${formatDcultBillions(visibleTotal)}`,
        ...(showDirectWasted ? [`Direct wasted total: ${formatDcultBillions(point.directWasted)}`] : []),
        ...(showDirectCauseSplit ? [
            `No-rights direct waste: ${formatDcultBillions(point.noRights)}`,
            `Delegatee-absent direct waste: ${formatDcultBillions(point.delegateMissed)}`,
        ] : []),
        ...(showAbsentDuty ? [`Absent delegatee duty: ${formatDcultBillions(point.absentDuty)}`] : []),
    ];
    return lines.join('\n');
}

function renderSourceChartTooltipHtml(data) {
    const subRowThreshold = 4;
    const showDirectWasted = isSourceSeriesVisible('directWasted');
    const showAbsentDuty = isSourceSeriesVisible('absentDuty');
    const directCauseCandidates = [
        {
            className: 'no-rights-total',
            label: 'No-rights direct waste',
            value: data.noRights,
            share: Number(data.noRightsDirectShare || 0),
        },
        {
            className: 'delegate-missed-overlay',
            label: 'Delegatee-absent direct waste',
            value: data.delegateMissed,
            share: Number(data.delegateMissedDirectShare || 0),
        },
    ];
    const directCauseRows = showDirectWasted && directCauseCandidates.every((row) => row.share > subRowThreshold)
        ? directCauseCandidates
        : [];
    const rows = [
        ...(showDirectWasted ? [{ className: 'direct-wasted', label: 'Direct wasted total', value: data.directWasted }] : []),
        ...directCauseRows,
        ...(showAbsentDuty ? [{ className: 'absent-duty', label: 'Absent delegatee duty', value: data.absentDuty }] : []),
    ];

    return `
        <div class="source-tooltip-title">Proposal #${escapeHtml(data.proposalId || 'unknown')}</div>
        ${data.proposalTitle ? `<div class="source-tooltip-subtitle">${escapeHtml(data.proposalTitle)}</div>` : ''}
        <div class="source-tooltip-total">
            <span>Visible selected</span>
            <strong>${escapeHtml(data.visibleTotal || '0.00B dCULT')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${escapeHtml(row.value || '0.00B dCULT')}</strong>
                </div>
            `).join('')}
        </div>
    `;
}

function formatDcultBillions(value) {
    const billions = tokenNumber(value) / 1_000_000_000;
    return `${billions.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}B dCULT`;
}

function formatCultAmountShort(value) {
    return `${formatCompactDcultNumber(tokenNumber(value))} CULT`;
}

function formatCultAxisAmount(value) {
    const amount = tokenNumber(value);
    const abs = Math.abs(amount);
    if (abs >= 1_000_000_000_000) return `${formatDecimal(amount / 1_000_000_000_000, 3)}T`;
    if (abs >= 1_000_000_000) return `${formatDecimal(amount / 1_000_000_000, 2)}B`;
    if (abs >= 1_000_000) return `${formatDecimal(amount / 1_000_000, 2)}M`;
    if (abs >= 1_000) return `${formatDecimal(amount / 1_000, 2)}K`;
    return formatDecimal(amount, 0);
}

function formatShortDate(timestamp) {
    const date = new Date(Number(timestamp || 0) * 1000);
    if (Number.isNaN(date.getTime())) return 'date unavailable';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    });
}

function getSharePercentNumber(numerator, denominator) {
    const top = ethers.BigNumber.from(numerator || '0');
    const bottom = ethers.BigNumber.from(denominator || '0');
    if (bottom.isZero()) return 0;
    return Number(top.mul(10000).div(bottom).toString()) / 100;
}

function shouldShowDirectCauseTooltipSplit(noRights, delegateMissed, directWasted) {
    return getSharePercentNumber(noRights, directWasted) > 4
        && getSharePercentNumber(delegateMissed, directWasted) > 4;
}

function truncateTooltipTitle(title, maxLength = 72) {
    const normalized = String(title || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function stripProposalTitlePrefix(title, proposalId) {
    const normalized = String(title || '').replace(/\s+/g, ' ').trim();
    const id = String(proposalId || '').trim();
    if (!normalized || !id) return normalized;
    return normalized.replace(new RegExp(`^Proposal\\s*#?${escapeRegExp(id)}\\s*:?\\s*`, 'i'), '').trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeStepAreaPath(points, bottomAccessor, topAccessor, yFor) {
    if (!points.length) return '';
    if (points.length === 1) {
        const point = points[0];
        const x1 = point.x - 8;
        const x2 = point.x + 8;
        return [
            `M ${x1} ${yFor(topAccessor(point))}`,
            `L ${x2} ${yFor(topAccessor(point))}`,
            `L ${x2} ${yFor(bottomAccessor(point))}`,
            `L ${x1} ${yFor(bottomAccessor(point))}`,
            'Z',
        ].join(' ');
    }

    const top = makeStepPoints(points, topAccessor, yFor);
    const bottom = makeStepPoints(points, bottomAccessor, yFor).reverse();
    return `M ${top.map(formatSvgPoint).join(' L ')} L ${bottom.map(formatSvgPoint).join(' L ')} Z`;
}

function makeStepLinePath(points, valueAccessor, yFor) {
    return `M ${makeStepPoints(points, valueAccessor, yFor).map(formatSvgPoint).join(' L ')}`;
}

function makeStepPoints(points, valueAccessor, yFor) {
    if (!points.length) return [];
    const stepPoints = [{ x: points[0].x, y: yFor(valueAccessor(points[0])) }];
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        stepPoints.push(
            { x: current.x, y: yFor(valueAccessor(previous)) },
            { x: current.x, y: yFor(valueAccessor(current)) },
        );
    }
    return stepPoints;
}

function formatSvgPoint(point) {
    return `${roundSvg(point.x)} ${roundSvg(point.y)}`;
}

function roundSvg(value) {
    return Number(value || 0).toFixed(2);
}

function tokenNumber(value) {
    const formatted = ethers.utils.formatUnits(ethers.BigNumber.from(value || '0'), 18);
    const number = Number(formatted);
    return Number.isFinite(number) ? number : 0;
}

function formatCompactDcultNumber(value) {
    const abs = Math.abs(Number(value || 0));
    if (abs >= 1_000_000_000_000) return `${formatCompactDecimal(value / 1_000_000_000_000)}T`;
    if (abs >= 1_000_000_000) return `${formatCompactDecimal(value / 1_000_000_000)}B`;
    if (abs >= 1_000_000) return `${formatCompactDecimal(value / 1_000_000)}M`;
    if (abs >= 1_000) return `${formatCompactDecimal(value / 1_000)}K`;
    return formatCompactDecimal(value);
}

function formatCompactDecimal(value) {
    const abs = Math.abs(Number(value || 0));
    const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });
}

function renderDashboard(rows) {
    const reportRows = (rows || []).filter(isDelegateDutyReportable);
    const recurrence = getWastedWalletRecurrence(reportRows);
    const totals = reportRows.reduce((acc, row) => {
        const isVoteOutcome = isVoteOutcomeProposal(row);
        const includeDelegateDuty = isDelegateDutyReportable(row);
        const duty = normalizeDelegateDuty(row.delegateDuty);
        const hasDelegateDuty = duty.activeDelegateCount > 0 && includeDelegateDuty;
        acc.wastedTotal = acc.wastedTotal.add(row.wastedTotal);
        acc.wastedFor = acc.wastedFor.add(row.wastedFor);
        acc.wastedAgainst = acc.wastedAgainst.add(row.wastedAgainst);
        acc.wastedAbstain = acc.wastedAbstain.add(row.wastedAbstain || '0');
        acc.noRightsWaste = acc.noRightsWaste.add(row.noRightsWasteTotal);
        acc.delegateMissedWaste = acc.delegateMissedWaste.add(row.delegateMissedWasteTotal);
        acc.alignedDelegated = acc.alignedDelegated.add(row.alignedDelegatedTotal);
        acc.misalignedDelegated = acc.misalignedDelegated.add(row.misalignedDelegatedTotal);
        if (includeDelegateDuty) {
            acc.delegateDutyActive += row.delegateDuty.activeDelegateCount;
            acc.delegateDutyVoted += row.delegateDuty.votedDelegateCount;
            acc.delegateDutyAbsent += row.delegateDuty.absentDelegateCount;
            acc.delegateDutyActiveDelegators += row.delegateDuty.activeDelegatorCount;
            acc.delegateDutyVotedDelegators += row.delegateDuty.votedDelegatorCount;
            acc.delegateDutyAbsentPower = acc.delegateDutyAbsentPower.add(row.delegateDuty.absentDelegatedPower);
        }
        acc.actualTotal = acc.actualTotal.add(row.actualTotal);
        acc.snapshotTotalSupply = acc.snapshotTotalSupply.add(row.snapshotTotalSupply);
        acc.readyDcultSupply = acc.readyDcultSupply.add(row.snapshotReadyDcultSupply || '0');
        acc.guardianDcultSupply = acc.guardianDcultSupply.add(getGuardianDcultSupply(row));
        acc.guardianReadyDcultSupply = acc.guardianReadyDcultSupply.add(getGuardianReadyDcultSupply(row));
        acc.eligibleDcultSupply = acc.eligibleDcultSupply.add(getEligibleDcultSupply(row));
        acc.eligibleReadyDcultSupply = acc.eligibleReadyDcultSupply.add(getEligibleReadyDcultSupply(row));
        acc.participatingWallets += getParticipatingWalletCount(row);
        acc.readyHolderWallets += row.snapshotReadyHolderCount || 0;
        acc.holderWallets += row.snapshotHolderCount || 0;
        acc.guardianHolderWallets += row.snapshotGuardianHolderCount || 0;
        acc.guardianReadyHolderWallets += row.snapshotGuardianReadyHolderCount || 0;
        acc.eligibleHolderWallets += getEligibleHolderWallets(row);
        acc.eligibleReadyHolderWallets += getEligibleReadyHolderWallets(row);
        acc.zeroWallets += row.zeroWalletCount;
        acc.wastedWallets += row.wastedWalletCount;
        acc.misalignedWallets += row.misalignedWalletCount;
        acc.voterWallets += row.voterWalletCount;
        acc.swingFlags += row.couldSwing ? 1 : 0;
        acc.outcomeProposals += isVoteOutcome ? 1 : 0;
        acc.outcomeSwingFlags += isVoteOutcome && row.couldSwing ? 1 : 0;
        acc.delegateDutyProposals += hasDelegateDuty ? 1 : 0;
        acc.delegateDutyFlipFlags += hasDelegateDuty && delegateDutyCouldSwing(row, duty) ? 1 : 0;
        acc.delegateDutyDominanceFlags += hasDelegateDuty && delegateDutyCouldDominate(row, duty) ? 1 : 0;
        return acc;
    }, {
        wastedTotal: ethers.BigNumber.from(0),
        wastedFor: ethers.BigNumber.from(0),
        wastedAgainst: ethers.BigNumber.from(0),
        wastedAbstain: ethers.BigNumber.from(0),
        noRightsWaste: ethers.BigNumber.from(0),
        delegateMissedWaste: ethers.BigNumber.from(0),
        alignedDelegated: ethers.BigNumber.from(0),
        misalignedDelegated: ethers.BigNumber.from(0),
        delegateDutyActive: 0,
        delegateDutyVoted: 0,
        delegateDutyAbsent: 0,
        delegateDutyActiveDelegators: 0,
        delegateDutyVotedDelegators: 0,
        delegateDutyAbsentPower: ethers.BigNumber.from(0),
        actualTotal: ethers.BigNumber.from(0),
        snapshotTotalSupply: ethers.BigNumber.from(0),
        readyDcultSupply: ethers.BigNumber.from(0),
        guardianDcultSupply: ethers.BigNumber.from(0),
        guardianReadyDcultSupply: ethers.BigNumber.from(0),
        eligibleDcultSupply: ethers.BigNumber.from(0),
        eligibleReadyDcultSupply: ethers.BigNumber.from(0),
        participatingWallets: 0,
        readyHolderWallets: 0,
        holderWallets: 0,
        guardianHolderWallets: 0,
        guardianReadyHolderWallets: 0,
        eligibleHolderWallets: 0,
        eligibleReadyHolderWallets: 0,
        zeroWallets: 0,
        wastedWallets: 0,
        misalignedWallets: 0,
        voterWallets: 0,
        swingFlags: 0,
        outcomeProposals: 0,
        outcomeSwingFlags: 0,
        delegateDutyProposals: 0,
        delegateDutyFlipFlags: 0,
        delegateDutyDominanceFlags: 0,
    });

    el.totalWasted.textContent = `${formatTokenAmount(totals.wastedTotal, 0)} dCULT`;
    el.zeroWallets.textContent = formatWalletRatio(totals.zeroWallets, totals.voterWallets);
    el.wastingWallets.textContent = formatWalletRatio(totals.wastedWallets, totals.voterWallets);
    el.repeatWastedWallets.innerHTML = formatWastedRecurrenceHtml(recurrence);
    el.wastedFor.textContent = `${formatTokenAmount(totals.wastedFor, 0)} dCULT`;
    el.wastedAgainst.textContent = `${formatTokenAmount(totals.wastedAgainst, 0)} dCULT`;
    el.wastedAbstain.textContent = `${formatTokenAmount(totals.wastedAbstain, 0)} dCULT`;
    el.alignedDelegated.textContent = `${formatTokenAmount(totals.alignedDelegated, 0)} dCULT`;
    el.misalignedDelegated.textContent = `${formatTokenAmount(totals.misalignedDelegated, 0)} dCULT`;
    el.noRightsWaste.textContent = `${formatTokenAmount(totals.noRightsWaste, 0)} dCULT`;
    el.delegateMissedWaste.textContent = `${formatTokenAmount(totals.delegateMissedWaste, 0)} dCULT`;
    el.delegateDutyWallets.innerHTML = formatDelegateDutyHtml(
        totals.delegateDutyVoted,
        totals.delegateDutyActive,
        totals.delegateDutyVotedDelegators,
        totals.delegateDutyActiveDelegators,
    );
    el.delegateDutyAbsentPower.textContent = `${formatTokenAmount(totals.delegateDutyAbsentPower, 0)} dCULT`;
    el.delegateDutyImpact.innerHTML = formatAbsentDelegateImpactHtml(
        totals.delegateDutyFlipFlags,
        totals.delegateDutyDominanceFlags,
        totals.delegateDutyProposals,
    );
    el.actualVotes.textContent = `${formatTokenAmount(totals.actualTotal, 0)} dCULT`;
    el.snapshotDcultSupply.innerHTML = formatSupplyWithEligibleHtml(totals.snapshotTotalSupply, totals.eligibleDcultSupply, totals.guardianDcultSupply);
    el.guardianDcultSupply.innerHTML = formatGuardianSupplyHtml(totals.guardianDcultSupply, totals.guardianHolderWallets);
    el.voterTurnout.innerHTML = formatTokenTurnoutHtml(
        totals.actualTotal,
        totals.eligibleReadyDcultSupply,
        totals.eligibleDcultSupply,
        totals.snapshotTotalSupply,
    );
    el.walletTurnout.innerHTML = formatWalletTurnoutHtml(
        totals.participatingWallets,
        totals.eligibleReadyHolderWallets,
        totals.eligibleHolderWallets,
        false,
        totals.holderWallets,
    );
    el.swingFlags.textContent = `${formatInteger(totals.swingFlags)} / ${formatInteger(reportRows.length)} indexed`;
    el.outcomeSwingFlags.textContent = `${formatInteger(totals.outcomeSwingFlags)} / ${formatInteger(totals.outcomeProposals)} decided`;
    el.proposalCount.textContent = formatInteger(getIndexedProposalCount(rows));

    renderGovernanceSnapshot(reportRows);
    renderVotingPowerChart(reportRows);
    renderWastedSourceChart(reportRows);
    renderProposalCompositionChart(reportRows);
    renderAdditionalVisuals(reportRows);

    renderAverages(rows);

    renderDelegateePowerSection(rows);

    renderProposalList(rows);
    renderGuardianOverview();
}

function renderGovernanceSnapshot(rows) {
    if (!el.governanceSnapshot) return;
    const reportRows = (rows || []).filter(isDelegateDutyReportable);
    const mode = governanceSnapshotState.mode === 'average' ? 'average' : 'latest';
    const snapshot = buildGovernanceSnapshot(reportRows, mode);

    if (!snapshot) {
        el.governanceSnapshot.innerHTML = '<p class="empty-state">No governance snapshot data yet.</p>';
        return;
    }

    const donuts = getGovernanceSnapshotDonuts(snapshot);
    el.governanceSnapshot.innerHTML = `
        <div class="governance-snapshot-header">
            <div>
                <h4>${mode === 'average' ? 'Average Governance State' : 'Current Governance State'}</h4>
                <p>${escapeHtml(snapshot.description)}</p>
            </div>
            <div class="chart-mode-toggle" role="group" aria-label="Governance snapshot mode">
                <button class="chart-mode-button ${mode === 'latest' ? 'is-active' : ''}" type="button" data-governance-snapshot-mode="latest" aria-pressed="${mode === 'latest' ? 'true' : 'false'}">Current*</button>
                <button class="chart-mode-button ${mode === 'average' ? 'is-active' : ''}" type="button" data-governance-snapshot-mode="average" aria-pressed="${mode === 'average' ? 'true' : 'false'}">Average</button>
            </div>
        </div>
        <div class="governance-snapshot-grid">
            ${donuts.map((donut, index) => `${index === 4 ? '<div class="governance-snapshot-row-divider" aria-hidden="true"></div>' : ''}${renderGovernanceSnapshotDonut(donut)}`).join('')}
        </div>
    `;
}

function buildGovernanceSnapshot(rows, mode) {
    const reportRows = (rows || []).filter(isDelegateDutyReportable);
    if (!reportRows.length) return null;
    const repeatWastedVoters = getRepeatWastedVoters(reportRows);
    return mode === 'average'
        ? buildAverageGovernanceSnapshot(reportRows, repeatWastedVoters)
        : buildLatestGovernanceSnapshot(reportRows, repeatWastedVoters);
}

function buildLatestGovernanceSnapshot(rows, repeatWastedVoters) {
    const row = rows[0];
    if (!row) return null;
    const duty = normalizeDelegateDuty(row.delegateDuty);
    const repeatSplit = getRowWastedRepeatSplit(row, repeatWastedVoters);
    const participatingWallets = getParticipatingWalletCount(row, duty);
    const readyWallets = getEligibleReadyHolderWallets(row);
    const eligibleWallets = getEligibleHolderWallets(row);
    const outcomeProposal = isVoteOutcomeProposal(row);
    const directFlip = outcomeProposal && row.couldSwing ? 1 : 0;
    const absentFlip = outcomeProposal && delegateDutyCouldSwing(row, duty) ? 1 : 0;
    const affectedOutcome = directFlip || absentFlip ? 1 : 0;

    return {
        mode: 'latest',
        count: 1,
        description: '* current data where available; otherwise latest proposal data or toggle for average.',
        actualTotal: ethers.BigNumber.from(row.actualTotal || '0'),
        eligibleReadyDcultSupply: getEligibleReadyDcultSupply(row),
        eligibleDcultSupply: getEligibleDcultSupply(row),
        directWasted: ethers.BigNumber.from(row.wastedTotal || '0'),
        absentDuty: ethers.BigNumber.from(duty.absentDelegatedPower || '0'),
        repeatWasted: repeatSplit.repeatWasted,
        oneTimeWasted: repeatSplit.oneTimeWasted,
        wastedWallets: Number(row.wastedWalletCount || 0),
        participatingWallets,
        readyWallets,
        eligibleWallets,
        votedDelegatees: Number(duty.votedDelegateCount || 0),
        activeDelegatees: Number(duty.activeDelegateCount || 0),
        votedDelegatorWallets: Number(duty.votedDelegatorCount || 0),
        activeDelegatorWallets: Number(duty.activeDelegatorCount || 0),
        outcomeProposals: outcomeProposal ? 1 : 0,
        affectedOutcomeProposals: affectedOutcome,
        directFlipFlags: directFlip,
        absentFlipFlags: absentFlip,
        display: {
            actualTotal: ethers.BigNumber.from(row.actualTotal || '0'),
            directWasted: ethers.BigNumber.from(row.wastedTotal || '0'),
            absentDuty: ethers.BigNumber.from(duty.absentDelegatedPower || '0'),
            repeatWasted: repeatSplit.repeatWasted,
            oneTimeWasted: repeatSplit.oneTimeWasted,
            wastedWallets: Number(row.wastedWalletCount || 0),
            participatingWallets,
            readyWallets,
            eligibleWallets,
            votedDelegatees: Number(duty.votedDelegateCount || 0),
            activeDelegatees: Number(duty.activeDelegateCount || 0),
            votedDelegatorWallets: Number(duty.votedDelegatorCount || 0),
            activeDelegatorWallets: Number(duty.activeDelegatorCount || 0),
        },
    };
}

function buildAverageGovernanceSnapshot(rows, repeatWastedVoters) {
    const count = rows.length;
    const totals = rows.reduce((acc, row) => {
        const duty = normalizeDelegateDuty(row.delegateDuty);
        const repeatSplit = getRowWastedRepeatSplit(row, repeatWastedVoters);
        const participatingWallets = getParticipatingWalletCount(row, duty);
        const outcomeProposal = isVoteOutcomeProposal(row);
        const directFlip = outcomeProposal && row.couldSwing ? 1 : 0;
        const absentFlip = outcomeProposal && delegateDutyCouldSwing(row, duty) ? 1 : 0;

        acc.actualTotal = acc.actualTotal.add(row.actualTotal || '0');
        acc.eligibleReadyDcultSupply = acc.eligibleReadyDcultSupply.add(getEligibleReadyDcultSupply(row));
        acc.eligibleDcultSupply = acc.eligibleDcultSupply.add(getEligibleDcultSupply(row));
        acc.directWasted = acc.directWasted.add(row.wastedTotal || '0');
        acc.absentDuty = acc.absentDuty.add(duty.absentDelegatedPower || '0');
        acc.repeatWasted = acc.repeatWasted.add(repeatSplit.repeatWasted);
        acc.oneTimeWasted = acc.oneTimeWasted.add(repeatSplit.oneTimeWasted);
        acc.wastedWallets += Number(row.wastedWalletCount || 0);
        acc.participatingWallets += participatingWallets;
        acc.readyWallets += getEligibleReadyHolderWallets(row);
        acc.eligibleWallets += getEligibleHolderWallets(row);
        acc.votedDelegatees += Number(duty.votedDelegateCount || 0);
        acc.activeDelegatees += Number(duty.activeDelegateCount || 0);
        acc.votedDelegatorWallets += Number(duty.votedDelegatorCount || 0);
        acc.activeDelegatorWallets += Number(duty.activeDelegatorCount || 0);
        acc.outcomeProposals += outcomeProposal ? 1 : 0;
        acc.affectedOutcomeProposals += directFlip || absentFlip ? 1 : 0;
        acc.directFlipFlags += directFlip;
        acc.absentFlipFlags += absentFlip;
        return acc;
    }, {
        actualTotal: ethers.BigNumber.from(0),
        eligibleReadyDcultSupply: ethers.BigNumber.from(0),
        eligibleDcultSupply: ethers.BigNumber.from(0),
        directWasted: ethers.BigNumber.from(0),
        absentDuty: ethers.BigNumber.from(0),
        repeatWasted: ethers.BigNumber.from(0),
        oneTimeWasted: ethers.BigNumber.from(0),
        wastedWallets: 0,
        participatingWallets: 0,
        readyWallets: 0,
        eligibleWallets: 0,
        votedDelegatees: 0,
        activeDelegatees: 0,
        votedDelegatorWallets: 0,
        activeDelegatorWallets: 0,
        outcomeProposals: 0,
        affectedOutcomeProposals: 0,
        directFlipFlags: 0,
        absentFlipFlags: 0,
    });

    return {
        mode: 'average',
        count,
        description: '* current data where available; otherwise latest proposal data or toggle for average.',
        ...totals,
        display: {
            actualTotal: avgBigNumber(totals.actualTotal, count),
            directWasted: avgBigNumber(totals.directWasted, count),
            absentDuty: avgBigNumber(totals.absentDuty, count),
            repeatWasted: avgBigNumber(totals.repeatWasted, count),
            oneTimeWasted: avgBigNumber(totals.oneTimeWasted, count),
            wastedWallets: totals.wastedWallets / count,
            participatingWallets: totals.participatingWallets / count,
            readyWallets: totals.readyWallets / count,
            eligibleWallets: totals.eligibleWallets / count,
            votedDelegatees: totals.votedDelegatees / count,
            activeDelegatees: totals.activeDelegatees / count,
            votedDelegatorWallets: totals.votedDelegatorWallets / count,
            activeDelegatorWallets: totals.activeDelegatorWallets / count,
        },
    };
}

function getGovernanceSnapshotDonuts(snapshot) {
    const display = snapshot.display;
    const actualVotes = ethers.BigNumber.from(snapshot.actualTotal || '0');
    const readyDcult = ethers.BigNumber.from(snapshot.eligibleReadyDcultSupply || '0');
    const eligibleDcult = ethers.BigNumber.from(snapshot.eligibleDcultSupply || '0');
    const turnoutVotes = minBigNumber(actualVotes, readyDcult);
    const unusedReadyDcult = subtractBigNumberFloor(readyDcult, turnoutVotes);
    const totalPower = actualVotes.add(snapshot.directWasted || '0').add(snapshot.absentDuty || '0');
    const wastedWalletOther = Math.max(0, Number(snapshot.participatingWallets || 0) - Number(snapshot.wastedWallets || 0));
    const absentDelegatees = Math.max(0, Number(snapshot.activeDelegatees || 0) - Number(snapshot.votedDelegatees || 0));
    const absentDelegatorWallets = Math.max(0, Number(snapshot.activeDelegatorWallets || 0) - Number(snapshot.votedDelegatorWallets || 0));
    const unaffectedOutcomeProposals = Math.max(0, Number(snapshot.outcomeProposals || 0) - Number(snapshot.affectedOutcomeProposals || 0));
    const average = snapshot.mode === 'average';
    const prefix = average ? 'avg ' : '';
    const activeMemberClass = getGovernanceShareClass(snapshot.participatingWallets, snapshot.readyWallets);
    const tokenTurnoutClass = getGovernanceShareClass(actualVotes, readyDcult);
    const delegateeDutyClass = getGovernanceShareClass(snapshot.votedDelegatees, snapshot.activeDelegatees);
    const delegatorWalletClass = getGovernanceShareClass(snapshot.votedDelegatorWallets, snapshot.activeDelegatorWallets);

    return [
        {
            label: 'Active DAO members turnout',
            centerPrimary: formatCountPercent(snapshot.participatingWallets, snapshot.readyWallets, 1),
            centerSecondary: `${prefix}${formatSnapshotCountRatio(display.participatingWallets, display.readyWallets, average)} ready wallets`,
            detail: 'participating / ready',
            breakdown: [
                ['Participating', formatSnapshotCount(display.participatingWallets, average)],
                ['Ready', formatSnapshotCount(display.readyWallets, average)],
                ['Eligible', formatSnapshotCount(display.eligibleWallets, average)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} active DAO members turnout`,
                `Participating wallets: ${formatSnapshotCount(display.participatingWallets, average)}`,
                `Ready eligible wallets: ${formatSnapshotCount(display.readyWallets, average)}`,
                `Eligible wallets: ${formatSnapshotCount(display.eligibleWallets, average)}`,
            ],
            segments: [
                { label: 'Participating', className: activeMemberClass, value: snapshot.participatingWallets, title: `Participating wallets: ${formatSnapshotCount(display.participatingWallets, average)}` },
                { label: 'Ready but inactive', className: 'is-unused', value: Math.max(0, snapshot.readyWallets - snapshot.participatingWallets), title: `Ready but inactive wallets: ${formatSnapshotCount(Math.max(0, display.readyWallets - display.participatingWallets), average)}` },
            ],
        },
        {
            label: 'Voting Power Sources',
            centerPrimary: formatPercent(actualVotes, totalPower, 1),
            centerSecondary: `${prefix}${formatDcultBillions(display.actualTotal)} proper`,
            detail: 'proper / missed power',
            breakdown: [
                ['Proper', formatDcultBillions(display.actualTotal)],
                ['Direct wasted', formatDcultBillions(display.directWasted)],
                ['Absent duty', formatDcultBillions(display.absentDuty)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} proper versus missed voting power`,
                `Proper votes: ${formatDcultBillions(display.actualTotal)}`,
                `Direct wasted votes: ${formatDcultBillions(display.directWasted)}`,
                `Absent delegatee duty: ${formatDcultBillions(display.absentDuty)}`,
            ],
            segments: [
                { label: 'Proper votes', className: 'is-focus', value: actualVotes, title: `Proper votes: ${formatDcultBillions(display.actualTotal)}` },
                { label: 'Direct wasted votes', className: 'is-secondary', value: snapshot.directWasted, title: `Direct wasted votes: ${formatDcultBillions(display.directWasted)}` },
                { label: 'Absent delegatee duty', className: 'is-tertiary', value: snapshot.absentDuty, title: `Absent delegatee duty: ${formatDcultBillions(display.absentDuty)}` },
            ],
        },
        {
            label: 'Token turnout',
            centerPrimary: formatPercent(actualVotes, readyDcult, 1),
            centerSecondary: `${prefix}${formatDcultBillions(display.actualTotal)} voted`,
            detail: 'of ready dCULT',
            breakdown: [
                ['Voted', formatDcultBillions(display.actualTotal)],
                ['Ready', formatDcultBillions(average ? avgBigNumber(readyDcult, snapshot.count) : readyDcult)],
                ['Eligible', formatDcultBillions(average ? avgBigNumber(eligibleDcult, snapshot.count) : eligibleDcult)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} token turnout`,
                `Actual votes: ${formatDcultBillions(display.actualTotal)}`,
                `Ready eligible dCULT: ${formatDcultBillions(average ? avgBigNumber(readyDcult, snapshot.count) : readyDcult)}`,
                `Eligible dCULT: ${formatDcultBillions(average ? avgBigNumber(eligibleDcult, snapshot.count) : eligibleDcult)}`,
            ],
            segments: [
                { label: 'Actual votes', className: tokenTurnoutClass, value: turnoutVotes, title: `Actual votes: ${formatDcultBillions(display.actualTotal)}` },
                { label: 'Ready but unused', className: 'is-unused', value: unusedReadyDcult, title: `Ready but unused: ${formatDcultBillions(subtractBigNumberFloor(average ? avgBigNumber(readyDcult, snapshot.count) : readyDcult, display.actualTotal))}` },
            ],
        },
        {
            label: 'Direct wasted',
            centerPrimary: formatPercent(snapshot.repeatWasted, snapshot.directWasted, 1),
            centerSecondary: `${prefix}${formatDcultBillions(display.directWasted)} direct`,
            detail: 'repeat share',
            breakdown: [
                ['Repeat', formatDcultBillions(display.repeatWasted)],
                ['One-time', formatDcultBillions(display.oneTimeWasted)],
                ['Total', formatDcultBillions(display.directWasted)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} direct wasted vote split`,
                `Repeat wasted: ${formatDcultBillions(display.repeatWasted)}`,
                `One-time wasted: ${formatDcultBillions(display.oneTimeWasted)}`,
                `Direct wasted total: ${formatDcultBillions(display.directWasted)}`,
            ],
            segments: [
                { label: 'Repeat wasted', className: 'is-repeat', value: snapshot.repeatWasted, title: `Repeat wasted: ${formatDcultBillions(display.repeatWasted)}` },
                { label: 'One-time wasted', className: 'is-one-time-waste', value: snapshot.oneTimeWasted, title: `One-time wasted: ${formatDcultBillions(display.oneTimeWasted)}` },
            ],
        },
        {
            label: 'Wasted wallets',
            centerPrimary: formatCountPercent(snapshot.wastedWallets, snapshot.participatingWallets, 1),
            centerSecondary: `${prefix}${formatSnapshotCountRatio(display.wastedWallets, display.participatingWallets, average)}`,
            detail: 'wasted / participating',
            breakdown: [
                ['Wasted', formatSnapshotCount(display.wastedWallets, average)],
                ['Participating', formatSnapshotCount(display.participatingWallets, average)],
                ['Share', formatCountPercent(snapshot.wastedWallets, snapshot.participatingWallets, 1)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} wasted wallet share`,
                `Wasted wallets: ${formatSnapshotCount(display.wastedWallets, average)}`,
                `Participating wallets: ${formatSnapshotCount(display.participatingWallets, average)}`,
                `Wasted share: ${formatCountPercent(snapshot.wastedWallets, snapshot.participatingWallets, 1)}`,
            ],
            segments: [
                { label: 'Wasted wallets', className: 'is-wasted', value: snapshot.wastedWallets, title: `Wasted wallets: ${formatSnapshotCount(display.wastedWallets, average)}` },
                { label: 'Other participating wallets', className: 'is-clean', value: wastedWalletOther, title: `Other participating wallets: ${formatSnapshotCount(Math.max(0, display.participatingWallets - display.wastedWallets), average)}` },
            ],
        },
        {
            label: 'Delegatee duty',
            centerPrimary: formatCountPercent(snapshot.votedDelegatees, snapshot.activeDelegatees, 1),
            centerSecondary: `${prefix}${formatSnapshotCountRatio(display.votedDelegatees, display.activeDelegatees, average)} delegatees`,
            detail: 'delegatees represented',
            breakdown: [
                ['Represented', formatSnapshotCount(display.votedDelegatees, average)],
                ['Active', formatSnapshotCount(display.activeDelegatees, average)],
                ['Share', formatCountPercent(snapshot.votedDelegatees, snapshot.activeDelegatees, 1)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} delegatee duty`,
                `Delegatees represented: ${formatSnapshotCount(display.votedDelegatees, average)} / ${formatSnapshotCount(display.activeDelegatees, average)}`,
                `Representation share: ${formatCountPercent(snapshot.votedDelegatees, snapshot.activeDelegatees, 1)}`,
            ],
            segments: [
                { label: 'Represented', className: delegateeDutyClass, value: snapshot.votedDelegatees, title: `Represented delegatees: ${formatSnapshotCount(display.votedDelegatees, average)}` },
                { label: 'Absent', className: 'is-absent', value: absentDelegatees, title: `Absent delegatees: ${formatSnapshotCount(Math.max(0, display.activeDelegatees - display.votedDelegatees), average)}` },
            ],
        },
        {
            label: 'Delegator wallets',
            centerPrimary: formatCountPercent(snapshot.votedDelegatorWallets, snapshot.activeDelegatorWallets, 1),
            centerSecondary: `${prefix}${formatSnapshotCountRatio(display.votedDelegatorWallets, display.activeDelegatorWallets, average)}`,
            detail: 'wallets represented',
            breakdown: [
                ['Represented', formatSnapshotCount(display.votedDelegatorWallets, average)],
                ['Delegated', formatSnapshotCount(display.activeDelegatorWallets, average)],
                ['Share', formatCountPercent(snapshot.votedDelegatorWallets, snapshot.activeDelegatorWallets, 1)],
            ],
            tooltip: [
                `${average ? 'Average' : 'Latest'} delegated wallet representation`,
                `Represented wallets: ${formatSnapshotCount(display.votedDelegatorWallets, average)} / ${formatSnapshotCount(display.activeDelegatorWallets, average)}`,
                `Representation share: ${formatCountPercent(snapshot.votedDelegatorWallets, snapshot.activeDelegatorWallets, 1)}`,
            ],
            segments: [
                { label: 'Represented wallets', className: delegatorWalletClass, value: snapshot.votedDelegatorWallets, title: `Represented wallets: ${formatSnapshotCount(display.votedDelegatorWallets, average)}` },
                { label: 'Absent wallets', className: 'is-absent', value: absentDelegatorWallets, title: `Absent wallets: ${formatSnapshotCount(Math.max(0, display.activeDelegatorWallets - display.votedDelegatorWallets), average)}` },
            ],
        },
        {
            label: 'Outcome risk',
            centerPrimary: formatCountPercent(snapshot.affectedOutcomeProposals, snapshot.outcomeProposals, 1),
            centerSecondary: `${formatInteger(snapshot.affectedOutcomeProposals)} / ${formatInteger(snapshot.outcomeProposals)} affected`,
            detail: 'decided proposals',
            breakdown: [
                ['Affected', formatInteger(snapshot.affectedOutcomeProposals)],
                ['Decided', formatInteger(snapshot.outcomeProposals)],
                ['Share', formatCountPercent(snapshot.affectedOutcomeProposals, snapshot.outcomeProposals, 1)],
            ],
            tooltip: [
                `${average ? 'Historical' : 'Latest'} outcome-risk flags`,
                `Affected decided proposals: ${formatInteger(snapshot.affectedOutcomeProposals)} / ${formatInteger(snapshot.outcomeProposals)}`,
                `Direct wasted flip flags: ${formatInteger(snapshot.directFlipFlags)}`,
                `Absent delegatee flip flags: ${formatInteger(snapshot.absentFlipFlags)}`,
            ],
            segments: [
                { label: 'Affected', className: 'is-risk', value: snapshot.affectedOutcomeProposals, title: `Affected decided proposals: ${formatInteger(snapshot.affectedOutcomeProposals)}` },
                { label: 'Unaffected decided proposals', className: 'is-unused', value: unaffectedOutcomeProposals, title: `Unaffected decided proposals: ${formatInteger(unaffectedOutcomeProposals)}` },
            ],
        },
    ];
}

function renderGovernanceSnapshotDonut(item) {
    return `
        <div class="governance-snapshot-donut">
            <span class="governance-snapshot-label">${escapeHtml(item.label)}</span>
            ${renderProposalMiniDonut(item.segments, item.centerPrimary, item.centerSecondary)}
            <span class="governance-snapshot-detail">${escapeHtml(item.detail || '')}</span>
            ${renderGovernanceSnapshotBreakdown(item.breakdown)}
        </div>
    `;
}

function renderGovernanceSnapshotBreakdown(lines = []) {
    if (!lines.length) return '';
    return `
        <div class="governance-snapshot-breakdown">
            ${lines.map(([label, value]) => `
                <span class="governance-snapshot-breakdown-row">
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(value)}</strong>
                </span>
            `).join('')}
        </div>
    `;
}

function getGovernanceShareClass(numerator, denominator) {
    const denominatorValue = getDonutValueNumber(denominator);
    if (!denominatorValue) return 'is-score-neutral';
    const percent = (getDonutValueNumber(numerator) / denominatorValue) * 100;
    return percent >= 80 ? 'is-score-good' : 'is-score-bad';
}

function handleGovernanceSnapshotClick(event) {
    const modeButton = event.target.closest('[data-governance-snapshot-mode]');
    if (!modeButton) return;
    const mode = modeButton.dataset.governanceSnapshotMode === 'average' ? 'average' : 'latest';
    if (governanceSnapshotState.mode === mode) return;
    governanceSnapshotState.mode = mode;
    renderGovernanceSnapshot(currentRows);
}

function formatSnapshotCount(value, decimal = false) {
    return decimal ? formatDecimal(value, 1) : formatInteger(value);
}

function formatSnapshotCountRatio(numerator, denominator, decimal = false) {
    return `${formatSnapshotCount(numerator, decimal)}/${formatSnapshotCount(denominator, decimal)}`;
}

function getIndexedProposalCount(rows = []) {
    return Math.max(Object.keys(cache?.proposals || {}).length, (rows || []).length);
}

function renderAverages(rows) {
    const eligibleRows = rows.filter(isDelegateDutyReportable);
    const count = eligibleRows.length;

    if (!count) {
        el.avgForVotes.textContent = '0 dCULT';
        el.avgAgainstVotes.textContent = '0 dCULT';
        el.avgMargin.textContent = '0 dCULT';
        el.avgTotalVotes.textContent = '0 dCULT';
        el.avgSnapshotDcultSupply.textContent = '0 dCULT';
        el.avgGuardianDcultSupply.textContent = '0 dCULT';
        el.avgTurnout.innerHTML = formatTokenTurnoutHtml(0, 0, 0);
        el.avgVotingWallets.textContent = '0';
        el.avgReadyHolderWallets.textContent = '0';
        el.avgHolderWallets.textContent = '0';
        el.avgWalletTurnout.innerHTML = formatWalletTurnoutHtml(0, 0, 0, true);
        el.avgVotingWalletsLast10.textContent = '0';
        el.avgWastingWallets.textContent = '0 / 0';
        el.avgWastedTotal.textContent = '0 dCULT';
        el.avgMisalignedDelegated.textContent = '0 dCULT';
        el.avgNoRightsWaste.textContent = '0 dCULT';
        el.avgDelegateMissedWaste.textContent = '0 dCULT';
        el.avgDelegateDutyWallets.innerHTML = formatDelegateDutyHtml(0, 0, 0, 0, true);
        el.avgDelegateDutyAbsentPower.textContent = '0 dCULT';
        el.avgWastedFor.textContent = '0 dCULT';
        el.avgWastedAgainst.textContent = '0 dCULT';
        return;
    }

    const totals = eligibleRows.reduce((acc, row) => {
        acc.actualFor = acc.actualFor.add(row.actualFor);
        acc.actualAgainst = acc.actualAgainst.add(row.actualAgainst);
        acc.actualTotal = acc.actualTotal.add(row.actualTotal);
        acc.snapshotTotalSupply = acc.snapshotTotalSupply.add(row.snapshotTotalSupply);
        acc.readyDcultSupply = acc.readyDcultSupply.add(row.snapshotReadyDcultSupply || '0');
        acc.guardianDcultSupply = acc.guardianDcultSupply.add(getGuardianDcultSupply(row));
        acc.guardianReadyDcultSupply = acc.guardianReadyDcultSupply.add(getGuardianReadyDcultSupply(row));
        acc.eligibleDcultSupply = acc.eligibleDcultSupply.add(getEligibleDcultSupply(row));
        acc.eligibleReadyDcultSupply = acc.eligibleReadyDcultSupply.add(getEligibleReadyDcultSupply(row));
        acc.margin = acc.margin.add(row.margin);
        acc.wastedTotal = acc.wastedTotal.add(row.wastedTotal);
        acc.misalignedDelegated = acc.misalignedDelegated.add(row.misalignedDelegatedTotal);
        acc.noRightsWaste = acc.noRightsWaste.add(row.noRightsWasteTotal);
        acc.delegateMissedWaste = acc.delegateMissedWaste.add(row.delegateMissedWasteTotal);
        acc.delegateDutyActive += row.delegateDuty.activeDelegateCount || 0;
        acc.delegateDutyVoted += row.delegateDuty.votedDelegateCount || 0;
        acc.delegateDutyActiveDelegators += row.delegateDuty.activeDelegatorCount || 0;
        acc.delegateDutyVotedDelegators += row.delegateDuty.votedDelegatorCount || 0;
        acc.delegateDutyAbsentPower = acc.delegateDutyAbsentPower.add(row.delegateDuty.absentDelegatedPower || '0');
        acc.wastedFor = acc.wastedFor.add(row.wastedFor);
        acc.wastedAgainst = acc.wastedAgainst.add(row.wastedAgainst);
        acc.participatingWallets += getParticipatingWalletCount(row);
        acc.voterWallets += row.voterWalletCount || 0;
        acc.readyHolderWallets += row.snapshotReadyHolderCount || 0;
        acc.holderWallets += row.snapshotHolderCount || 0;
        acc.guardianHolderWallets += row.snapshotGuardianHolderCount || 0;
        acc.guardianReadyHolderWallets += row.snapshotGuardianReadyHolderCount || 0;
        acc.eligibleHolderWallets += getEligibleHolderWallets(row);
        acc.eligibleReadyHolderWallets += getEligibleReadyHolderWallets(row);
        acc.wastingWallets += row.wastedWalletCount || 0;
        return acc;
    }, {
        actualFor: ethers.BigNumber.from(0),
        actualAgainst: ethers.BigNumber.from(0),
        actualTotal: ethers.BigNumber.from(0),
        snapshotTotalSupply: ethers.BigNumber.from(0),
        readyDcultSupply: ethers.BigNumber.from(0),
        guardianDcultSupply: ethers.BigNumber.from(0),
        guardianReadyDcultSupply: ethers.BigNumber.from(0),
        eligibleDcultSupply: ethers.BigNumber.from(0),
        eligibleReadyDcultSupply: ethers.BigNumber.from(0),
        margin: ethers.BigNumber.from(0),
        wastedTotal: ethers.BigNumber.from(0),
        misalignedDelegated: ethers.BigNumber.from(0),
        noRightsWaste: ethers.BigNumber.from(0),
        delegateMissedWaste: ethers.BigNumber.from(0),
        delegateDutyActive: 0,
        delegateDutyVoted: 0,
        delegateDutyActiveDelegators: 0,
        delegateDutyVotedDelegators: 0,
        delegateDutyAbsentPower: ethers.BigNumber.from(0),
        wastedFor: ethers.BigNumber.from(0),
        wastedAgainst: ethers.BigNumber.from(0),
        participatingWallets: 0,
        voterWallets: 0,
        readyHolderWallets: 0,
        holderWallets: 0,
        guardianHolderWallets: 0,
        guardianReadyHolderWallets: 0,
        eligibleHolderWallets: 0,
        eligibleReadyHolderWallets: 0,
        wastingWallets: 0,
    });

    el.avgForVotes.textContent = `${formatTokenAmount(avgBigNumber(totals.actualFor, count), 0)} dCULT`;
    el.avgAgainstVotes.textContent = `${formatTokenAmount(avgBigNumber(totals.actualAgainst, count), 0)} dCULT`;
    el.avgMargin.textContent = `${formatTokenAmount(avgBigNumber(totals.margin, count), 0)} dCULT`;
    el.avgTotalVotes.textContent = `${formatTokenAmount(avgBigNumber(totals.actualTotal, count), 0)} dCULT`;
    el.avgSnapshotDcultSupply.innerHTML = formatSupplyWithEligibleHtml(
        avgBigNumber(totals.snapshotTotalSupply, count),
        avgBigNumber(totals.eligibleDcultSupply, count),
        avgBigNumber(totals.guardianDcultSupply, count),
    );
    el.avgGuardianDcultSupply.textContent = `${formatTokenAmount(avgBigNumber(totals.guardianDcultSupply, count), 0)} dCULT`;
    el.avgTurnout.innerHTML = formatTokenTurnoutHtml(
        totals.actualTotal,
        totals.eligibleReadyDcultSupply,
        totals.eligibleDcultSupply,
        totals.snapshotTotalSupply,
    );
    el.avgVotingWallets.textContent = formatDecimal(totals.voterWallets / count, 1);
    el.avgReadyHolderWallets.textContent = formatDecimal(totals.eligibleReadyHolderWallets / count, 1);
    el.avgHolderWallets.textContent = formatDecimal(totals.eligibleHolderWallets / count, 1);
    el.avgWalletTurnout.innerHTML = formatWalletTurnoutHtml(
        totals.participatingWallets / count,
        totals.eligibleReadyHolderWallets / count,
        totals.eligibleHolderWallets / count,
        true,
        totals.holderWallets / count,
    );
    el.avgVotingWalletsLast10.textContent = formatAverageVotingWallets(eligibleRows.slice(0, 10));
    el.avgWastingWallets.textContent = `${formatDecimal(totals.wastingWallets / count, 1)} / ${formatDecimal(totals.voterWallets / count, 1)}`;
    el.avgWastedTotal.textContent = `${formatTokenAmount(avgBigNumber(totals.wastedTotal, count), 0)} dCULT`;
    el.avgMisalignedDelegated.textContent = `${formatTokenAmount(avgBigNumber(totals.misalignedDelegated, count), 0)} dCULT`;
    el.avgNoRightsWaste.textContent = `${formatTokenAmount(avgBigNumber(totals.noRightsWaste, count), 0)} dCULT`;
    el.avgDelegateMissedWaste.textContent = `${formatTokenAmount(avgBigNumber(totals.delegateMissedWaste, count), 0)} dCULT`;
    el.avgDelegateDutyWallets.innerHTML = formatDelegateDutyHtml(
        totals.delegateDutyVoted / count,
        totals.delegateDutyActive / count,
        totals.delegateDutyVotedDelegators / count,
        totals.delegateDutyActiveDelegators / count,
        true,
    );
    el.avgDelegateDutyAbsentPower.textContent = `${formatTokenAmount(avgBigNumber(totals.delegateDutyAbsentPower, count), 0)} dCULT`;
    el.avgWastedFor.textContent = `${formatTokenAmount(avgBigNumber(totals.wastedFor, count), 0)} dCULT`;
    el.avgWastedAgainst.textContent = `${formatTokenAmount(avgBigNumber(totals.wastedAgainst, count), 0)} dCULT`;
}

function formatAverageVotingWallets(rows) {
    if (!rows.length) return '0';
    const total = rows.reduce((sum, row) => sum + (row.voterWalletCount || 0), 0);
    return formatDecimal(total / rows.length, 1);
}

function renderDelegateePowerSection(rows) {
    const latestRow = getDelegateePowerSourceRow(rows);
    if (!latestRow) {
        el.delegateePowerStatus.textContent = 'No proposal snapshot indexed yet.';
        el.delegateePowerList.innerHTML = '<p class="empty-state">No delegatee voting power indexed yet.</p>';
        return;
    }

    const duty = normalizeDelegateDuty(latestRow.delegateDuty);
    const delegates = getDelegateePowerRows(latestRow);
    const snapshotBlock = formatInteger(latestRow.proposal.startBlock || 0);
    const historicalDutyAverage = formatHistoricalDutyAverage(rows);
    const historicalDutyText = historicalDutyAverage ? ` ${historicalDutyAverage}.` : '';
    el.delegateePowerStatus.textContent = `Latest non-canceled proposal #${latestRow.id} snapshot block ${snapshotBlock}. ${formatInteger(duty.votedDelegateCount)} / ${formatInteger(duty.activeDelegateCount)} delegatees voted.${historicalDutyText}`;

    if (!delegates.length) {
        el.delegateePowerList.innerHTML = '<p class="empty-state">No third-party delegated voting power at the latest indexed proposal snapshot.</p>';
        return;
    }

    el.delegateePowerList.innerHTML = `
        <div class="delegatee-power-table">
            ${delegates.map((delegateRow) => renderDelegateePowerRow(latestRow.id, delegateRow)).join('')}
        </div>
    `;
}

function getDelegateePowerSourceRow(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows.find(isDelegateDutyReportable) || rows[0];
}

function getDelegateePowerRows(row) {
    const duty = normalizeDelegateDuty(row.delegateDuty);
    return [
        ...duty.absentDelegates.map((delegateRow) => ({ ...delegateRow, dutyStatus: 'absent' })),
        ...duty.votedDelegates.map((delegateRow) => ({ ...delegateRow, dutyStatus: 'voted' })),
    ].sort((a, b) => compareBigNumbersDesc(
        ethers.BigNumber.from(a.combinedVotingPower || a.delegatedPower || '0'),
        ethers.BigNumber.from(b.combinedVotingPower || b.delegatedPower || '0'),
    ));
}

function createDelegateeDutyRecord() {
    return {
        fulfilledPower: ethers.BigNumber.from(0),
        missedPower: ethers.BigNumber.from(0),
        totalPower: ethers.BigNumber.from(0),
        fulfilledProposals: 0,
        missedProposals: 0,
        totalProposals: 0,
        fulfilledWallets: 0,
        missedWallets: 0,
        totalWallets: 0,
        latestFulfilledProposalId: null,
        latestFulfilledTitle: '',
        latestFulfilledBlock: 0,
        latestFulfilledTimestamp: 0,
    };
}

function getDelegateeDutyOverview(rows) {
    const record = createDelegateeDutyRecord();
    for (const row of rows || []) {
        if (!isDelegateDutyReportable(row)) continue;
        const duty = normalizeDelegateDuty(row.delegateDuty);
        collectDelegateeDutyRecordFromRows(record, row, duty.absentDelegates, false);
        collectDelegateeDutyRecordFromRows(record, row, duty.votedDelegates, true);
    }
    return record;
}

function formatHistoricalDutyAverage(rows) {
    const dutyOverview = getDelegateeDutyOverview(rows);
    if (!dutyOverview.totalProposals) return '';
    return `Historical avg: ${formatCountPercent(dutyOverview.fulfilledWallets, dutyOverview.totalWallets, 1)} wallets / ${formatPercent(dutyOverview.fulfilledPower, dutyOverview.totalPower, 1)} dCULT represented`;
}

function getDelegateeDutyRecord(address) {
    const target = String(address || '').toLowerCase();
    const record = createDelegateeDutyRecord();
    if (!target) return record;

    for (const row of currentRows || []) {
        if (!isDelegateDutyReportable(row)) continue;
        const duty = normalizeDelegateDuty(row.delegateDuty);
        collectDelegateeDutyRecordFromRows(record, row, duty.absentDelegates, false, target);
        collectDelegateeDutyRecordFromRows(record, row, duty.votedDelegates, true, target);
    }

    return record;
}

function collectDelegateeDutyRecordFromRows(record, row, delegateRows, fulfilled, target = null) {
    for (const delegateRow of delegateRows || []) {
        const delegatee = String(delegateRow.delegatee || '').toLowerCase();
        if (target && delegatee !== target) continue;

        const delegatedPower = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
        const representedWallets = Number(delegateRow.delegatorCount || (Array.isArray(delegateRow.delegators) ? delegateRow.delegators.length : 0));
        record.totalProposals += 1;
        record.totalPower = record.totalPower.add(delegatedPower);
        record.totalWallets += representedWallets;

        if (fulfilled) {
            record.fulfilledProposals += 1;
            record.fulfilledPower = record.fulfilledPower.add(delegatedPower);
            record.fulfilledWallets += representedWallets;
            updateLatestFulfilledDuty(record, row, delegateRow);
        } else {
            record.missedProposals += 1;
            record.missedPower = record.missedPower.add(delegatedPower);
            record.missedWallets += representedWallets;
        }
    }
}

function updateLatestFulfilledDuty(record, row, delegateRow) {
    const voteEvent = findDelegateVoteEvent(row, delegateRow.delegatee);
    const fulfilledBlock = Number(voteEvent?.blockNumber || row?.proposal?.endBlock || row?.proposal?.startBlock || 0);
    if (!Number.isFinite(fulfilledBlock) || fulfilledBlock <= 0 || fulfilledBlock < record.latestFulfilledBlock) return;

    record.latestFulfilledProposalId = row.id;
    record.latestFulfilledTitle = row.title || `Proposal #${row.id}`;
    record.latestFulfilledBlock = fulfilledBlock;
    record.latestFulfilledTimestamp = getCachedBlockTimestamp(fulfilledBlock);
}

function findDelegateVoteEvent(row, delegatee) {
    const target = String(delegatee || '').toLowerCase();
    if (!target) return null;

    return (row?.voteEvents || [])
        .filter((event) => String(event.voter || '').toLowerCase() === target && !ethers.BigNumber.from(event.votes || '0').isZero())
        .sort(sortEventsAsc)
        .at(-1) || null;
}

function renderDelegateeDutyRecord(record) {
    const avgFulfilledWallets = record.totalProposals ? record.fulfilledWallets / record.totalProposals : 0;
    const avgTotalWallets = record.totalProposals ? record.totalWallets / record.totalProposals : 0;

    return `
        <span class="wallet-detail-value">${formatCountPercent(record.fulfilledWallets, record.totalWallets, 1)} represented</span>
        <span class="value-subline">${formatInteger(record.fulfilledProposals)} / ${formatInteger(record.totalProposals)} proposals</span>
        <span class="value-subline">${formatLatestFulfilledDuty(record)}</span>
        <span class="value-subline">Avg ${formatDecimal(avgFulfilledWallets, 1)} / ${formatDecimal(avgTotalWallets, 1)} wallets</span>
        <span class="value-subline">${formatTokenAmount(record.missedPower, 0)} dCULT missed</span>
    `;
}

function formatLatestFulfilledDuty(record) {
    if (!record.latestFulfilledProposalId) return 'Last fulfilled: never';
    if (record.latestFulfilledBlock) ensureBlockTimestampForDisplay(record.latestFulfilledBlock);
    const when = record.latestFulfilledTimestamp
        ? formatBlockDate(record.latestFulfilledTimestamp)
        : `block ${formatInteger(record.latestFulfilledBlock)}`;
    return `Last fulfilled: ${when} / #${record.latestFulfilledProposalId}`;
}

function renderDelegateePowerRow(proposalId, delegateRow) {
    const delegatedPower = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
    const ownVotingPower = ethers.BigNumber.from(delegateRow.ownVotingPower || '0');
    const combinedPower = ethers.BigNumber.from(delegateRow.combinedVotingPower || delegatedPower.add(ownVotingPower));
    const ownBalance = ethers.BigNumber.from(delegateRow.ownBalance || '0');
    const voteWeight = ethers.BigNumber.from(delegateRow.votes || '0');
    const voted = delegateRow.dutyStatus === 'voted';
    const statusLabel = voted ? 'Fulfilled Duty' : 'Missed Duty';
    const statusClass = voted ? 'status-active' : 'status-attention';
    const actionLabel = voted ? `Voted ${supportLabel(delegateRow.support)} (${formatTokenAmount(voteWeight, 0)} dCULT)` : 'Did not vote';
    const delegateKey = delegatePowerKey(proposalId, delegateRow.delegatee);
    const expanded = expandedPowerDelegatees.has(delegateKey);
    const representedWallets = Array.isArray(delegateRow.delegators) ? delegateRow.delegators : [];
    const dutyRecord = getDelegateeDutyRecord(delegateRow.delegatee);
    const ownSubline = ownVotingPower.gt(0)
        ? 'self-delegated'
        : ownBalance.gt(0) ? `${formatTokenAmount(ownBalance, 0)} own dCULT not self-delegated` : 'no own dCULT';
    const dutyRecordTitle = `${formatInteger(dutyRecord.fulfilledWallets)} / ${formatInteger(dutyRecord.totalWallets)} represented wallet-proposals fulfilled. ${formatTokenAmount(dutyRecord.fulfilledPower, 0)} dCULT fulfilled / ${formatTokenAmount(dutyRecord.missedPower, 0)} dCULT missed.`;

    return `
        <div class="delegatee-power-item">
            <article class="wallet-row delegatee-power-row ${voted ? 'is-represented' : 'is-wasted'}">
                <div class="wallet-detail">
                    ${renderAddressLink(delegateRow.delegatee)}
                    <div class="event-meta">Delegatee</div>
                </div>
                <div class="wallet-support-cell">
                    <span class="wallet-detail-label">Delegatee Action</span>
                    <span class="wallet-detail-value">${escapeHtml(actionLabel)}</span>
                    <span class="status-flag ${statusClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Own Voting Power</span>
                    <span class="wallet-amount">${formatTokenAmount(ownVotingPower, 0)}</span>
                    <span class="event-meta">${escapeHtml(ownSubline)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Attached Power</span>
                    <span class="wallet-amount">${formatTokenAmount(delegatedPower, 0)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Combined Power</span>
                    <span class="wallet-amount">${formatTokenAmount(combinedPower, 0)}</span>
                </div>
                <div class="wallet-detail" title="${escapeHtml(dutyRecordTitle)}">
                    <span class="wallet-detail-label">Duty Record</span>
                    ${renderDelegateeDutyRecord(dutyRecord)}
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Represented Wallets</span>
                    <span class="wallet-detail-value">${formatInteger(delegateRow.delegatorCount)}</span>
                </div>
                <div class="row-icon-actions">
                    <button class="tiny-icon-button delegatee-power-toggle" type="button" data-proposal-id="${proposalId}" data-delegatee="${escapeHtml(delegateRow.delegatee)}" title="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}" aria-label="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}">
                        ${expanded ? '&minus;' : '+'}
                    </button>
                    <a class="tx-icon-link" href="${addressUrl(delegateRow.delegatee)}" target="_blank" rel="noopener noreferrer" title="View delegatee on Etherscan" aria-label="View delegatee on Etherscan">
                        ${renderExternalLinkIcon()}
                    </a>
                </div>
            </article>
            ${expanded ? renderDelegatorList(representedWallets) : ''}
        </div>
    `;
}

function renderProposalList(rows) {
    const filteredRows = getFilteredProposalRows(rows);
    const visibleRows = filteredRows.slice(0, proposalVisibleLimit);

    if (!filteredRows.length) {
        const emptyMessage = rows?.length
            ? 'No proposals match those filters.'
            : 'No proposals indexed yet.';
        el.proposalList.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
        updateProposalListFooter(0, 0);
        return;
    }

    const repeatWastedVoters = getRepeatWastedVoters((rows || []).filter(isDelegateDutyReportable));
    el.proposalList.innerHTML = visibleRows.map((row) => renderProposalCard(row, repeatWastedVoters)).join('');
    updateProposalListFooter(visibleRows.length, filteredRows.length);
}

function getFilteredProposalRows(rows) {
    const stateFilters = [];
    if (proposalFilters.executedOnly) stateFilters.push(7);
    if (proposalFilters.defeatedOnly) stateFilters.push(3);
    const titleSearch = proposalFilters.titleSearch;

    return (rows || []).filter((row) => {
        const state = Number(row.proposal.state);
        if (proposalFilters.hideCanceled && state === 2) return false;
        if (stateFilters.length && !stateFilters.includes(state)) return false;
        if (titleSearch) {
            const title = stripProposalTitlePrefix(row.title || '', row.id || row.proposal?.id || '').toLowerCase();
            if (!title.includes(titleSearch)) return false;
        }
        return true;
    });
}

function updateProposalListFooter(visibleCount, totalCount) {
    el.proposalVisibleCount.textContent = `${formatInteger(visibleCount)} / ${formatInteger(totalCount)} shown`;
    el.showMoreProposals.hidden = visibleCount >= totalCount;
    el.showMoreProposals.disabled = visibleCount >= totalCount;
    const isNarrowed = Boolean(proposalFilters.titleSearch || proposalFilters.executedOnly || proposalFilters.defeatedOnly);
    el.showMoreProposals.textContent = isNarrowed ? 'Load More' : 'Load Older Proposals';
}

function renderGuardianOverview(statusOverride = '') {
    if (!el.guardiansOverview || !el.guardiansOverviewStatus) return;

    const guardianCache = normalizeGuardianOverviewCache(cache?.guardianOverview);
    const rows = Array.isArray(guardianCache.rows)
        ? guardianCache.rows.filter((row) => row?.wallet && ethers.utils.isAddress(row.wallet))
        : [];
    const blockNumber = Number(guardianCache.blockNumber || 0);
    const hasRows = Boolean(rows.length);
    const isBuilding = Boolean(guardianOverviewPromise);

    if (el.refreshGuardiansOverview) {
        el.refreshGuardiansOverview.disabled = isBuilding || !readProvider;
        el.refreshGuardiansOverview.textContent = isBuilding ? 'Refreshing...' : hasRows ? 'Refresh Guardians' : 'Build Guardians';
    }

    if (statusOverride) {
        el.guardiansOverviewStatus.textContent = statusOverride;
    } else if (hasRows) {
        const blockText = blockNumber ? ` at block ${formatInteger(blockNumber)}` : '';
        const slotText = getGuardianOverviewSlotSummaryText(guardianCache.summary);
        el.guardiansOverviewStatus.textContent = `Contract guardian slots compared with reconstructed top-50 dCULT holders${blockText}.${slotText} To update your guardian status, stake some CULT or claim rewards and stake them. Decided proposal submissions use indexed governance data.`;
    } else if (readProvider) {
        el.guardiansOverviewStatus.textContent = 'No guardian overview data yet. Build it once to cache and export it with the historical dataset.';
    } else {
        el.guardiansOverviewStatus.textContent = 'Connect a wallet or public RPC to build the Guardians Overview.';
    }

    if (!hasRows) {
        el.guardiansOverview.innerHTML = '<p class="empty-state">No guardian overview data yet.</p>';
        return;
    }

    const summary = guardianCache.summary || {};
    const viewMode = getGuardianOverviewViewMode();

    el.guardiansOverview.innerHTML = `
        <div class="guardian-overview-summary" aria-label="Guardian overview summary">
            ${renderGuardianSummaryDonut(summary, rows)}
        </div>
        <div class="guardian-overview-toolbar">
            ${renderGuardianOverviewViewToggle(viewMode)}
        </div>
        <div class="visual-table guardian-overview-table is-${escapeHtml(viewMode)}">
            ${renderGuardianOverviewHead(viewMode)}
            ${renderGuardianOverviewRows(rows, viewMode)}
        </div>
    `;
}

function renderGuardianOverviewViewToggle(viewMode) {
    return `
        <div class="chart-mode-toggle guardian-view-toggle" role="group" aria-label="Guardian list detail level">
            <button class="chart-mode-button ${viewMode === 'simple' ? 'is-active' : ''}" type="button" data-guardian-view-mode="simple" aria-pressed="${viewMode === 'simple' ? 'true' : 'false'}">Simple</button>
            <button class="chart-mode-button ${viewMode === 'detailed' ? 'is-active' : ''}" type="button" data-guardian-view-mode="detailed" aria-pressed="${viewMode === 'detailed' ? 'true' : 'false'}">Detailed</button>
        </div>
    `;
}

function renderGuardianOverviewHead(viewMode) {
    if (viewMode === 'simple') {
        return `
            <div class="guardian-overview-row guardian-overview-head guardian-overview-simple-head" aria-hidden="true">
                <span>Rank</span>
                <span>Wallet</span>
                <span>dCULT</span>
                <span>Proposals</span>
            </div>
        `;
    }

    return `
        <div class="guardian-overview-row guardian-overview-head" aria-hidden="true">
            <span>Rank</span>
            <span>Wallet / stake / delegation</span>
            <span>dCULT</span>
            <span>CULT wallet</span>
            <span>Decided proposals</span>
        </div>
    `;
}

function renderGuardianSummaryDonut(summary, rows) {
    const inside = Number(summary?.overlap || 0);
    const outside = Number(summary?.trueTopOnly || 0);
    const total = Number(summary?.trueTopCount || inside + outside || FALLBACK_GUARDIAN_COUNT);
    const lowestTopDcult = getLowestTopFiftyDcultBalance(rows);
    const lowestText = lowestTopDcult
        ? `${formatTokenAmount(lowestTopDcult, 0)} dCULT`
        : 'not indexed';
    const thresholdText = summary?.contractThresholdDcult
        ? `${formatTokenAmount(summary.contractThresholdDcult, 0)} dCULT`
        : 'not indexed';
    const gapText = formatGuardianThresholdGap(summary?.contractThresholdDcult, lowestTopDcult);
    const centerPrimary = formatCountPercent(inside, total, 0);
    const centerSecondary = `${formatInteger(inside)} / ${formatInteger(outside)} wallets`;
    const insideTitle = getGuardianWalletSegmentTitle('Inside guardian slots', inside, total);
    const outsideTitle = getGuardianWalletSegmentTitle('Outside guardian slots', outside, total);
    const tooltip = [
        'Top-50 by current dCULT vs contract guardian slots',
        `Inside guardian slots: ${formatInteger(inside)} wallets`,
        `Outside guardian slots: ${formatInteger(outside)} wallets`,
        `Guardian threshold: ${thresholdText}`,
        `Lowest current top-50 dCULT: ${lowestText}`,
        `Gap: ${gapText}`,
    ].join('\n');

    return `
        <div class="guardian-summary-donut" title="${escapeHtml(tooltip)}">
            <div class="guardian-summary-donut-chart">
                ${renderProposalMiniDonut([
                    {
                        label: 'Inside guardian slots',
                        className: 'is-guardian-in',
                        value: inside,
                        title: insideTitle,
                    },
                    {
                        label: 'Outside guardian slots',
                        className: 'is-guardian-out',
                        value: outside,
                        title: outsideTitle,
                    },
                ], `${formatInteger(inside)} / ${formatInteger(outside)}`, '')}
            </div>
            <div class="guardian-summary-donut-text">
                <div class="guardian-summary-main">
                    <span>Top-50 inside guardian slots</span>
                    <span class="value-subline">current top-50 dCULT stakers inside / outside contract guardian slots</span>
                </div>
                <div class="guardian-summary-breakdown">
                    <span>
                        <span>Guardian threshold</span>
                        <strong>${escapeHtml(thresholdText)}</strong>
                    </span>
                    <span>
                        <span>Top-50 floor</span>
                        <strong>${escapeHtml(lowestText)}</strong>
                    </span>
                    <span>
                        <span>Gap</span>
                        <strong>${escapeHtml(gapText)}</strong>
                    </span>
                </div>
            </div>
        </div>
    `;
}

function getGuardianWalletSegmentTitle(label, count, total) {
    return `${label}: ${formatInteger(count)} wallets (${formatCountPercent(count, total, 0)} of current top 50)`;
}

function formatGuardianThresholdGap(thresholdDcult, lowestTopDcult) {
    if (!thresholdDcult || !lowestTopDcult) return 'not indexed';
    const threshold = ethers.BigNumber.from(thresholdDcult || '0');
    const topFloor = ethers.BigNumber.from(lowestTopDcult || '0');
    if (threshold.isZero() || topFloor.isZero()) return 'not indexed';
    if (topFloor.eq(threshold)) return 'same';

    const diff = topFloor.gt(threshold)
        ? topFloor.sub(threshold)
        : threshold.sub(topFloor);
    const direction = topFloor.gt(threshold) ? 'more for top-50' : 'less than threshold';
    return `${formatTokenAmount(diff, 0)} dCULT ${direction}`;
}

function getLowestTopFiftyDcultBalance(rows) {
    const topRows = (rows || []).filter((row) => row.trueRank);
    if (!topRows.length) return null;

    return topRows
        .sort((a, b) => Number(b.trueRank || 0) - Number(a.trueRank || 0))[0]
        ?.dcultBalance || null;
}

function getGuardianOverviewSlotSummaryText(summary) {
    const slotsChecked = Number(summary?.contractSlotsChecked || 0);
    const activeSeats = Number(summary?.contractGuardianCount || 0);
    if (!slotsChecked || slotsChecked === activeSeats) return '';

    const missing = Math.max(0, slotsChecked - activeSeats);
    const emptySlots = Array.isArray(summary?.contractEmptySlots) ? summary.contractEmptySlots : [];
    const failedSlots = Array.isArray(summary?.contractFailedSlots) ? summary.contractFailedSlots : [];
    const slotDetails = formatGuardianSlotIssueText(emptySlots, failedSlots);
    return ` ${formatInteger(slotsChecked)} contract slots checked; ${formatInteger(activeSeats)} active slot wallets found${missing ? `, ${formatInteger(missing)} empty/unread` : ''}${slotDetails}.`;
}

function formatGuardianSlotIssueText(emptySlots, failedSlots) {
    const details = [];
    if (emptySlots.length) details.push(`empty slot indexes ${emptySlots.map(formatInteger).join(', ')}`);
    if (failedSlots.length) details.push(`unread slot indexes ${failedSlots.map(formatInteger).join(', ')}`);
    return details.length ? ` (${details.join('; ')})` : '';
}

function renderGuardianOverviewRows(rows, viewMode = getGuardianOverviewViewMode()) {
    const chunks = [];
    let topGroupStarted = false;
    let slotOnlyGroupStarted = false;
    let outsideTopFiftyIndex = 0;

    rows.forEach((row) => {
        if (row.trueRank && !topGroupStarted) {
            chunks.push(renderGuardianOverviewDivider('Top 50 stakers by current dCULT amount'));
            topGroupStarted = true;
        }

        if (!row.trueRank && !slotOnlyGroupStarted) {
            chunks.push(renderGuardianOverviewDivider('Guardian slots outside the current top 50 stakers'));
            slotOnlyGroupStarted = true;
        }

        const displayRank = row.trueRank ? row.trueRank : ++outsideTopFiftyIndex;
        chunks.push(renderGuardianOverviewRow(row, viewMode, displayRank));
    });

    return chunks.join('');
}

function renderGuardianOverviewDivider(label) {
    return `<div class="guardian-overview-divider">${escapeHtml(label)}</div>`;
}

function renderGuardianOverviewRow(row, viewMode = getGuardianOverviewViewMode(), displayRank = null) {
    const status = getGuardianOverviewStatusMeta(row.status);
    const statusBadge = status.label
        ? `<span class="status-flag ${status.className}">${escapeHtml(status.label)}</span>`
        : '';
    const proposalIds = getDecidedSubmittedProposalIds(row.submittedProposalIds);
    const dcultBalance = ethers.BigNumber.from(row.dcultBalance || '0');
    if (viewMode === 'simple') {
        return `
            <div class="visual-table-row guardian-overview-row guardian-overview-simple-row">
                ${renderGuardianRankCell(row, { compact: true, proposalIds, displayRank })}
                <div class="guardian-simple-wallet">${renderAddressLink(row.wallet)}</div>
                <div>
                    <strong class="guardian-simple-dcult">${formatTokenAmount(dcultBalance, 0)} dCULT</strong>
                </div>
                <div class="guardian-simple-proposals">
                    ${renderGuardianSimpleProposals(proposalIds)}
                </div>
            </div>
        `;
    }

    return `
        <div class="visual-table-row guardian-overview-row">
            ${renderGuardianRankCell(row, { proposalIds, displayRank })}
            <div>
                ${renderAddressLink(row.wallet)}
                ${statusBadge}
                ${renderGuardianStakerSinceInfo(row)}
                ${renderGuardianDelegationInfo(row)}
            </div>
            <div>
                <span class="visual-label">Current dCULT</span>
                <strong>${formatTokenAmount(dcultBalance, 0)} dCULT</strong>
            </div>
            <div>
                <span class="visual-label">Wallet CULT</span>
                <strong>${formatTokenAmount(row.cultBalance || '0', 0)} CULT</strong>
            </div>
            <div>
                <span class="visual-label">Submitted proposals</span>
                <strong>${formatInteger(proposalIds.length)}</strong>
                ${renderGuardianSubmittedProposals(proposalIds)}
            </div>
        </div>
    `;
}

function renderGuardianRankCell(row, options = {}) {
    const compact = Boolean(options.compact);
    const hasTopRank = Boolean(row.trueRank);
    const rankValue = Number(options.displayRank || 0) || (hasTopRank ? row.trueRank : row.contractSeatRank);
    const topLine = hasTopRank
        ? `Top-50 Staker #${formatInteger(row.trueRank)}`
        : 'Outside Top 50';
    const slotLine = row.contractSeatRank
        ? `Guardian slot #${formatInteger(row.contractSeatRank)}`
        : 'No guardian slot';
    const badgeClass = getGuardianRankBadgeClass(row);
    const tooltip = getGuardianRankTooltip(row, options.proposalIds, rankValue);

    if (compact) {
        return `
            <div class="guardian-rank-cell is-compact">
                <span class="guardian-rank-badge ${badgeClass}" title="${escapeHtml(tooltip)}">${formatInteger(rankValue || 0)}</span>
            </div>
        `;
    }

    return `
        <div class="guardian-rank-cell">
            <span class="guardian-rank-badge ${badgeClass}" title="${escapeHtml(tooltip)}">${formatInteger(rankValue || 0)}</span>
            <span class="guardian-rank-copy">
                <span class="visual-label">${escapeHtml(topLine)}</span>
                <span class="value-subline">${escapeHtml(slotLine)}</span>
            </span>
        </div>
    `;
}

function getGuardianRankBadgeClass(row) {
    if (row?.trueRank && !row?.contractSeatRank) return 'is-missing-slot';
    if (!row?.trueRank && row?.contractSeatRank) return 'is-contract-only';
    return '';
}

function getGuardianRankTooltip(row, proposalIds = null, displayRank = null) {
    const status = getGuardianOverviewStatusMeta(row.status);
    const ids = Array.isArray(proposalIds) ? proposalIds : getDecidedSubmittedProposalIds(row.submittedProposalIds);
    const stakerSince = formatGuardianSinceDate(row?.stakerSinceTimestamp);
    const delegateText = getGuardianDelegationTooltip(row);
    const lines = [
        row.trueRank ? `Top-50 Staker #${formatInteger(row.trueRank)}` : `Outside top-50 wallet #${formatInteger(displayRank || 0)}`,
        row.contractSeatRank ? `Guardian slot #${formatInteger(row.contractSeatRank)}` : 'No guardian slot',
    ];

    if (status.label) lines.push(status.label);
    if (stakerSince) lines.push(`Staker since ${stakerSince}`);
    if (delegateText) lines.push(`Delegation: ${delegateText}`);
    lines.push(`Current dCULT: ${formatTokenAmount(row.dcultBalance || '0', 0)} dCULT`);
    lines.push(`Wallet CULT: ${formatTokenAmount(row.cultBalance || '0', 0)} CULT`);
    lines.push(`Decided proposals: ${formatInteger(ids.length)}`);
    if (ids.length) lines.push(ids.slice(0, 6).map((id) => `#${formatInteger(id)}`).join(' '));

    return lines.join('\n');
}

function getGuardianDelegationTooltip(row) {
    if (!Object.prototype.hasOwnProperty.call(row, 'currentDelegate')) return '';
    const delegatee = getValidGuardianDelegate(row.currentDelegate);
    if (!delegatee || delegatee.toLowerCase() === ZERO_ADDRESS) return 'none';
    if (delegatee.toLowerCase() === String(row.wallet || '').toLowerCase()) return 'self';
    return `delegated to ${delegatee}`;
}

function renderGuardianDelegationInfo(row) {
    if (!Object.prototype.hasOwnProperty.call(row, 'currentDelegate')) return '';

    const delegatee = getValidGuardianDelegate(row.currentDelegate);
    if (!delegatee || delegatee.toLowerCase() === ZERO_ADDRESS) {
        return '<span class="value-subline guardian-delegate-line">delegation: none</span>';
    }

    const wallet = String(row.wallet || '').toLowerCase();
    if (delegatee.toLowerCase() === wallet) {
        return '<span class="value-subline guardian-delegate-line">delegation: self</span>';
    }

    return `
        <span class="value-subline guardian-delegate-line">
            delegated to
            <a class="wallet-address" href="${addressUrl(delegatee)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(delegatee))}</a>
        </span>
    `;
}

function renderGuardianStakerSinceInfo(row) {
    const label = formatGuardianSinceDate(row?.stakerSinceTimestamp);
    if (!label) return '';
    return `<span class="value-subline guardian-staker-since-line">staker since ${escapeHtml(label)}</span>`;
}

function getValidGuardianDelegate(delegatee) {
    try {
        return ethers.utils.getAddress(delegatee || ZERO_ADDRESS);
    } catch {
        return ZERO_ADDRESS;
    }
}

function renderGuardianSubmittedProposals(proposalIds) {
    if (!proposalIds.length) return '';
    const shown = proposalIds.slice(0, 6).map((id) => `#${formatInteger(id)}`).join(' ');
    const extra = proposalIds.length > 6 ? ` +${formatInteger(proposalIds.length - 6)} more` : '';
    return `<span class="value-subline">${escapeHtml(shown + extra)}</span>`;
}

function renderGuardianSimpleProposals(proposalIds) {
    if (!proposalIds.length) return '<span class="guardian-simple-empty">-</span>';
    const shown = proposalIds.slice(0, 3).map((id) => `#${formatInteger(id)}`).join(' ');
    const extra = proposalIds.length > 3 ? ` +${formatInteger(proposalIds.length - 3)}` : '';
    return `<span>${escapeHtml(shown + extra)}</span>`;
}

function getDecidedSubmittedProposalIds(proposalIds) {
    if (!Array.isArray(proposalIds)) return [];
    return proposalIds
        .map((id) => Number(id || 0))
        .filter((id) => Number.isFinite(id) && id > 0 && isStrictDecidedCachedProposal(cache?.proposals?.[String(id)]))
        .sort((a, b) => b - a);
}

function getGuardianOverviewStatusMeta(status) {
    if (status === 'in_both') return { label: '', className: '' };
    if (status === 'true_top_only') return { label: 'Top-50 dCULT only', className: 'status-attention' };
    if (status === 'contract_only') return { label: 'Guardian slot only', className: 'status-muted' };
    return { label: 'Unknown', className: 'status-muted' };
}

function handleGuardianOverviewClick(event) {
    const modeButton = event.target.closest('[data-guardian-view-mode]');
    if (!modeButton) return;

    const mode = modeButton.dataset.guardianViewMode === 'simple' ? 'simple' : 'detailed';
    if (getGuardianOverviewViewMode() === mode) return;
    guardianOverviewViewMode = mode;
    try {
        localStorage.setItem(GUARDIAN_VIEW_STORAGE_KEY, mode);
    } catch {
        // Non-critical preference.
    }
    renderGuardianOverview();
}

function applySavedGuardianOverviewViewMode() {
    try {
        guardianOverviewViewMode = localStorage.getItem(GUARDIAN_VIEW_STORAGE_KEY) === 'detailed' ? 'detailed' : 'simple';
    } catch {
        guardianOverviewViewMode = 'simple';
    }
}

function getGuardianOverviewViewMode() {
    return guardianOverviewViewMode === 'simple' ? 'simple' : 'detailed';
}

async function startGuardianOverviewRefresh() {
    if (guardianOverviewPromise) return guardianOverviewPromise;
    if (!readProvider || !dcultContract || !cultContract) {
        renderGuardianOverview('Connect a wallet or public RPC to build the Guardians Overview.');
        return null;
    }

    renderGuardianOverview('Building Guardians Overview. This scans current dCULT holders and compares them with contract guardian slots.');
    guardianOverviewPromise = buildGuardianOverview()
        .then(async (overview) => {
            cache.guardianOverview = overview;
            cache.updatedAt = Date.now();
            await saveCache(cache);
            renderGuardianOverview();
            return overview;
        })
        .catch((error) => {
            console.warn('Unable to build Guardians Overview:', error);
            renderGuardianOverview(`Guardian overview paused: ${shortError(error)}`);
            return null;
        })
        .finally(() => {
            guardianOverviewPromise = null;
            renderGuardianOverview();
        });

    return guardianOverviewPromise;
}

async function buildGuardianOverview() {
    const currentBlock = latestSafeBlock || Math.max(DCULT_START_BLOCK, await readProvider.getBlockNumber() - FINALITY_BLOCKS);
    const blockNumber = Math.max(DCULT_START_BLOCK, Number(currentBlock || DCULT_START_BLOCK));
    const [holderIndex, contractSeatSnapshot] = await Promise.all([
        getHolderSnapshotIndex(blockNumber),
        fetchContractGuardianSeats(blockNumber),
    ]);
    const holderLedger = buildHolderLedgerFromIndex(holderIndex, blockNumber);
    const contractSeats = contractSeatSnapshot.rows;
    const trueTopRows = getTrueTopDcultRows(holderLedger, FALLBACK_GUARDIAN_COUNT);
    const trueTopByAddress = new Map(trueTopRows.map((row) => [row.address.toLowerCase(), row]));
    const contractByAddress = new Map(contractSeats.map((row) => [row.address.toLowerCase(), row]));
    const addresses = Array.from(new Set([...trueTopByAddress.keys(), ...contractByAddress.keys()]))
        .map((address) => ethers.utils.getAddress(address));
    const [cultBalances, submittedProposals, firstDepositBlocks] = await Promise.all([
        fetchCultBalances(addresses, blockNumber),
        Promise.resolve(getSubmittedProposalsByAddress()),
        fetchFirstGuardianDepositBlocks(addresses, blockNumber),
    ]);
    const firstDepositTimestamps = await fetchGuardianSinceTimestamps(firstDepositBlocks);

    const rows = addresses.map((address) => {
        const key = address.toLowerCase();
        const trueTop = trueTopByAddress.get(key) || null;
        const contractSeat = contractByAddress.get(key) || null;
        const balance = trueTop?.balance || (holderLedger.balances.get(key) || 0n).toString();
        const delegatee = getGuardianLedgerDelegate(holderLedger, key);
        const stakerSinceBlock = firstDepositBlocks.get(key) || null;
        return {
            wallet: address,
            trueRank: trueTop?.rank || null,
            contractSeatRank: contractSeat?.seatRank || null,
            contractSlotIndex: contractSeat?.slotIndex ?? null,
            stakerSinceBlock,
            stakerSinceTimestamp: stakerSinceBlock ? (firstDepositTimestamps.get(stakerSinceBlock) || 0) : 0,
            status: getGuardianOverviewStatus(trueTop, contractSeat),
            currentDelegate: delegatee,
            delegationStatus: getGuardianDelegationStatus(address, delegatee),
            dcultBalance: balance,
            contractDeposited: contractSeat?.amount || '0',
            cultBalance: cultBalances.get(key) || '0',
            submittedProposalIds: submittedProposals.get(key) || [],
        };
    }).sort(sortGuardianOverviewRows);

    const overlap = rows.filter((row) => row.trueRank && row.contractSeatRank).length;
    const trueTopOnly = rows.filter((row) => row.trueRank && !row.contractSeatRank).length;
    const contractOnly = rows.filter((row) => !row.trueRank && row.contractSeatRank).length;

    return {
        schema: GUARDIAN_OVERVIEW_SCHEMA,
        dcult: DCULT_ADDRESS,
        cult: CULT_ADDRESS,
        blockNumber,
        rows,
        summary: {
            overlap,
            trueTopOnly,
            contractOnly,
            trueTopCount: trueTopRows.length,
            contractGuardianCount: contractSeats.length,
            contractSlotsChecked: contractSeatSnapshot.slotsChecked,
            contractEmptySlotCount: contractSeatSnapshot.emptySlots.length,
            contractFailedSlotCount: contractSeatSnapshot.failedSlots.length,
            contractEmptySlots: contractSeatSnapshot.emptySlots,
            contractFailedSlots: contractSeatSnapshot.failedSlots,
            contractThresholdDcult: contractSeatSnapshot.thresholdAmount,
        },
        updatedAt: Date.now(),
    };
}

function buildHolderLedgerFromIndex(index, blockNumber) {
    const ledger = createHolderSnapshotLedger();
    for (const event of index.events) {
        if (event.blockNumber > blockNumber) break;
        applyHolderSnapshotEvent(ledger, event);
    }
    return ledger;
}

async function fetchGuardianSinceTimestamps(sinceBlocks) {
    const uniqueBlocks = Array.from(new Set(Array.from(sinceBlocks.values()).filter(Boolean)));
    const timestamps = new Map();
    if (!uniqueBlocks.length || !readProvider?.getBlock) return timestamps;

    await mapLimit(uniqueBlocks, CALL_CONCURRENCY, async (blockNumber) => {
        const cachedTimestamp = getCachedBlockTimestamp(blockNumber);
        if (cachedTimestamp) {
            timestamps.set(blockNumber, cachedTimestamp);
            return;
        }

        try {
            const blockData = await withTimeout(readProvider.getBlock(blockNumber), 10_000, `block ${blockNumber} timestamp`);
            const timestamp = Number(blockData?.timestamp || 0);
            if (!timestamp) return;
            timestamps.set(blockNumber, timestamp);
            cache.blockTimestamps = cache.blockTimestamps && typeof cache.blockTimestamps === 'object' ? cache.blockTimestamps : {};
            cache.blockTimestamps[String(blockNumber)] = timestamp;
        } catch (error) {
            console.warn(`Unable to fetch guardian since timestamp for block ${blockNumber}:`, error);
        }
    });

    return timestamps;
}

async function fetchFirstGuardianDepositBlocks(addresses, blockNumber) {
    const firstBlocks = new Map();
    const uniqueAddresses = Array.from(new Set((addresses || [])
        .map((address) => {
            try {
                return ethers.utils.getAddress(address);
            } catch {
                return null;
            }
        })
        .filter(Boolean)));
    if (!uniqueAddresses.length || blockNumber < DCULT_START_BLOCK) return firstBlocks;

    const poolTopic = uint256Topic(GUARDIAN_POOL_ID);
    for (const addressChunk of chunkArray(uniqueAddresses, ADDRESS_TOPIC_CHUNK_SIZE)) {
        const topics = addressChunk.map(addressTopic);
        const logs = await getLogsWithSplit({
            address: DCULT_ADDRESS,
            topics: [DEPOSIT_TOPIC, topics, poolTopic],
            fromBlock: ethers.utils.hexValue(DCULT_START_BLOCK),
            toBlock: ethers.utils.hexValue(blockNumber),
        }, HISTORY_LOG_CHUNK_SIZE);

        logs.sort(sortLogsAsc);
        for (const log of logs) {
            if (!log?.topics || log.topics.length < 3) continue;
            const user = topicToAddress(log.topics[1]).toLowerCase();
            if (firstBlocks.has(user)) continue;
            firstBlocks.set(user, parseRpcNumber(log.blockNumber));
        }
    }

    return firstBlocks;
}

function getTrueTopDcultRows(ledger, limit) {
    return Array.from(ledger.balances.entries())
        .filter(([, balance]) => balance > 0n)
        .sort(([addressA, balanceA], [addressB, balanceB]) => {
            if (balanceA === balanceB) return addressA.localeCompare(addressB);
            return balanceA > balanceB ? -1 : 1;
        })
        .slice(0, limit)
        .map(([address, balance], index) => ({
            rank: index + 1,
            address: ethers.utils.getAddress(address),
            balance: balance.toString(),
        }));
}

async function fetchContractGuardianSeats(blockNumber) {
    const limit = FALLBACK_GUARDIAN_COUNT;
    const rows = [];
    const emptySlots = [];
    const failedSlots = [];
    let thresholdAmount = '0';

    await mapLimit(Array.from({ length: limit }, (_, index) => index), CALL_CONCURRENCY, async (index) => {
        try {
            const row = await dcultContract.highestStakerInPool(GUARDIAN_POOL_ID, index, { blockTag: blockNumber });
            const rawAddress = getContractGuardianAddress(row);
            const address = ethers.utils.getAddress(rawAddress);
            const amount = getContractGuardianAmount(row).toString();
            if (index === 0) thresholdAmount = amount;
            if (address.toLowerCase() === ZERO_ADDRESS) {
                emptySlots.push(index);
                return;
            }
            rows.push({
                address,
                amount,
                slotIndex: index,
                seatRank: limit - index,
            });
        } catch {
            failedSlots.push(index);
            // Empty historical slots and archive gaps are tolerated per slot.
        }
    });

    return {
        rows: rows
            .filter(Boolean)
            .sort((a, b) => (a.seatRank - b.seatRank) || a.address.localeCompare(b.address)),
        slotsChecked: limit,
        emptySlots: emptySlots.sort((a, b) => a - b),
        failedSlots: failedSlots.sort((a, b) => a - b),
        thresholdAmount,
    };
}

function getContractGuardianAmount(row) {
    return row?.[0] || row?.deposited || row?.amount || row?.balance || '0';
}

function getContractGuardianAddress(row) {
    return row?.[1] || row?.addr || ZERO_ADDRESS;
}

async function fetchCultBalances(addresses, blockNumber) {
    const balances = new Map();
    await mapLimit(addresses, CALL_CONCURRENCY, async (address) => {
        try {
            const balance = await cultContract.balanceOf(address, { blockTag: blockNumber });
            balances.set(address.toLowerCase(), balance.toString());
        } catch {
            balances.set(address.toLowerCase(), '0');
        }
    });
    return balances;
}

function getSubmittedProposalsByAddress() {
    const submitted = new Map();
    for (const cachedProposal of Object.values(cache?.proposals || {})) {
        if (!isStrictDecidedCachedProposal(cachedProposal)) continue;
        const proposer = cachedProposal?.proposal?.proposer;
        const id = Number(cachedProposal?.id || cachedProposal?.proposal?.id || 0);
        if (!proposer || !Number.isFinite(id) || id <= 0) continue;
        const key = proposer.toLowerCase();
        if (!submitted.has(key)) submitted.set(key, []);
        submitted.get(key).push(id);
    }

    for (const ids of submitted.values()) {
        ids.sort((a, b) => b - a);
    }
    return submitted;
}

function isStrictDecidedCachedProposal(cachedProposal) {
    const state = Number(cachedProposal?.proposal?.state ?? cachedProposal?.state);
    return [3, 4, 5, 7].includes(state);
}

function getGuardianOverviewStatus(trueTop, contractSeat) {
    if (trueTop && contractSeat) return 'in_both';
    if (trueTop) return 'true_top_only';
    if (contractSeat) return 'contract_only';
    return 'unknown';
}

function getGuardianLedgerDelegate(holderLedger, addressKey) {
    const delegatee = holderLedger.delegates.get(String(addressKey || '').toLowerCase()) || ZERO_ADDRESS;
    return getValidGuardianDelegate(delegatee);
}

function getGuardianDelegationStatus(wallet, delegatee) {
    const normalizedDelegate = getValidGuardianDelegate(delegatee);
    if (normalizedDelegate.toLowerCase() === ZERO_ADDRESS) return 'none';
    if (normalizedDelegate.toLowerCase() === String(wallet || '').toLowerCase()) return 'self';
    return 'third_party';
}

function sortGuardianOverviewRows(a, b) {
    const rankA = a.trueRank || Number.MAX_SAFE_INTEGER;
    const rankB = b.trueRank || Number.MAX_SAFE_INTEGER;
    return (rankA - rankB)
        || ((a.contractSeatRank || Number.MAX_SAFE_INTEGER) - (b.contractSeatRank || Number.MAX_SAFE_INTEGER))
        || String(a.wallet).localeCompare(String(b.wallet));
}

function handleProposalFilterChange(event) {
    if (event?.target === el.filterExecutedOnly && el.filterExecutedOnly.checked) {
        el.filterDefeatedOnly.checked = false;
    }
    if (event?.target === el.filterDefeatedOnly && el.filterDefeatedOnly.checked) {
        el.filterExecutedOnly.checked = false;
    }

    proposalFilters.executedOnly = el.filterExecutedOnly.checked;
    proposalFilters.defeatedOnly = el.filterDefeatedOnly.checked;
    proposalFilters.hideCanceled = el.filterHideCanceled.checked;
    proposalFilters.titleSearch = el.proposalTitleSearch.value.trim().toLowerCase();
    proposalVisibleLimit = PROPOSAL_PAGE_SIZE;
    renderProposalList(currentRows);
}

function showMoreProposals() {
    proposalVisibleLimit += PROPOSAL_PAGE_SIZE;
    renderProposalList(currentRows);
}

function renderProposalCard(row, repeatWastedVoters = new Set()) {
    const detailsExpanded = expandedProposalDetails.has(String(row.id));
    const walletsExpanded = expandedProposals.has(String(row.id));
    const stateClass = `status-${row.stateName.toLowerCase()}`;
    const wastedVotes = ethers.BigNumber.from(row.wastedTotal || '0');
    const delegateDuty = isDelegateDutyReportable(row) ? normalizeDelegateDuty(row.delegateDuty) : normalizeDelegateDuty();
    const dutyCouldSwing = delegateDutyCouldSwing(row, delegateDuty);
    const dutyCouldDominate = delegateDutyCouldDominate(row, delegateDuty);
    const participatingWalletCount = getParticipatingWalletCount(row, delegateDuty);
    const hasWalletDetails = row.zeroWalletCount || delegateDuty.activeDelegateCount;
    const detailsLabel = delegateDuty.activeDelegateCount
        ? 'Show wasted wallets and third-party delegatee duty'
        : 'Show wasted wallets';

    return `
        <article class="proposal-card" data-proposal-id="${row.id}">
            <div class="proposal-top">
                <h3 class="proposal-title">${escapeHtml(row.title)}</h3>
                <div class="proposal-badges">
                    ${renderWastedFlipIcon(row)}
                    ${renderDelegateAbsenceImpactIcon(dutyCouldSwing, dutyCouldDominate)}
                    <span class="proposal-state ${stateClass}">${escapeHtml(row.stateName)}</span>
                </div>
            </div>
            ${renderProposalDonutDashboard(row, delegateDuty, participatingWalletCount, repeatWastedVoters)}
            <details class="proposal-detail-disclosure proposal-metrics-disclosure" ${detailsExpanded ? 'open' : ''}>
                <summary class="advanced-options-summary proposal-detail-summary" data-proposal-detail-id="${row.id}">Show Details</summary>
                <div class="proposal-metrics">
                    ${renderMetricCell('Actual For', `${formatTokenAmount(row.actualFor, 0)} dCULT`, 'value-for')}
                    ${renderMetricCell('Actual Against', `${formatTokenAmount(row.actualAgainst, 0)} dCULT`, 'value-against')}
                    ${renderMetricCell('Actual Total', `${formatTokenAmount(row.actualTotal, 0)} dCULT`, '')}
                    ${renderMetricCell('Snapshot dCULT', `${formatTokenAmount(row.snapshotTotalSupply, 0)} dCULT`, '')}
                    ${renderMetricCell('Protocol-Ineligible dCULT', `${formatTokenAmount(getGuardianDcultSupply(row), 0)} dCULT`, '')}
                    ${renderMetricCell('Token Turnout', formatTokenTurnoutText(row.actualTotal, getEligibleReadyDcultSupply(row), getEligibleDcultSupply(row), row.snapshotTotalSupply), '')}
                    ${renderMetricCell('Participating / Ready / Eligible Wallets', formatWalletTriple(participatingWalletCount, getEligibleReadyHolderWallets(row), getEligibleHolderWallets(row)), '')}
                    ${renderMetricCell('Wallet Turnout', formatWalletTurnoutText(participatingWalletCount, getEligibleReadyHolderWallets(row), getEligibleHolderWallets(row), row.snapshotHolderCount), '')}
                    ${renderMetricCell('Margin', `${formatTokenAmount(row.margin, 0)} dCULT`, '')}
                    ${renderMetricCell('Wasted Votes', `${formatTokenAmount(wastedVotes, 0)} dCULT`, '')}
                    ${renderMetricCell('No Rights Waste', `${formatTokenAmount(row.noRightsWasteTotal, 0)} dCULT`, '')}
                    ${renderMetricCell('Delegatee No-Vote Waste', `${formatTokenAmount(row.delegateMissedWasteTotal, 0)} dCULT`, '')}
                    ${renderMetricCell('Wasted Abstain', `${formatTokenAmount(row.wastedAbstain || '0', 0)} dCULT`, '')}
                    ${renderMetricCell('Aligned Delegated', `${formatTokenAmount(row.alignedDelegatedTotal, 0)} dCULT`, 'value-for')}
                    ${renderMetricCell('Misaligned Delegated', `${formatTokenAmount(row.misalignedDelegatedTotal, 0)} dCULT`, 'value-misaligned')}
                    ${renderMetricCellHtml('Third-Party Delegatees', formatDelegateDutyHtml(
                        delegateDuty.votedDelegateCount,
                        delegateDuty.activeDelegateCount,
                        delegateDuty.votedDelegatorCount,
                        delegateDuty.activeDelegatorCount,
                    ), '')}
                    ${renderMetricCell('Absent Delegatee Power', `${formatTokenAmount(delegateDuty.absentDelegatedPower, 0)} dCULT`, '')}
                    ${renderMetricCell('Wasted Wallets', formatWalletRatio(row.wastedWalletCount, participatingWalletCount), '')}
                    ${renderMetricCell('Misaligned Wallets', formatWalletRatio(row.misalignedWalletCount, row.voterWalletCount), '')}
                </div>
            </details>
            ${hasWalletDetails ? `
                <details class="proposal-detail-disclosure" ${walletsExpanded ? 'open' : ''}>
                    <summary class="advanced-options-summary proposal-detail-summary" data-proposal-wallet-id="${row.id}">${detailsLabel}</summary>
                    ${renderExpandedWalletDetails(row)}
                </details>
            ` : ''}
        </article>
    `;
}

function renderProposalDonutDashboard(row, delegateDuty, participatingWalletCount, repeatWastedVoters) {
    const donuts = [
        getVoteSplitDonut(row, delegateDuty),
        getTokenTurnoutDonut(row),
        getWalletTurnoutDonut(row, participatingWalletCount),
        getWastedWalletDonut(row, participatingWalletCount, repeatWastedVoters),
        getDelegateDutyDonut(delegateDuty),
    ];

    return `
        <div class="proposal-donut-dashboard" aria-label="Proposal summary donuts">
            ${donuts.map(renderProposalDonutItem).join('')}
        </div>
    `;
}

function getVoteSplitDonut(row, delegateDuty) {
    const mode = proposalDonutState.voteSplit === 'wallet' ? 'wallet' : 'token';
    if (mode === 'wallet') {
        const split = getProposalCompositionWalletVoteSplit(row, delegateDuty);
        const total = split.actualFor + split.actualAgainst;
        const winner = getCountWinner(split.actualFor, split.actualAgainst, 'Yes', 'No');
        return {
            label: 'Vote split',
            stateKey: 'voteSplit',
            options: [['token', 'Token'], ['wallet', 'Wallet']],
            centerPrimary: winner.label,
            centerSecondary: `Y ${formatCountPercent(split.actualFor, total, 0)} / N ${formatCountPercent(split.actualAgainst, total, 0)}`,
            tooltip: [
                'Vote split (wallets)',
                `Yes: ${formatInteger(split.actualFor)} wallets`,
                `No: ${formatInteger(split.actualAgainst)} wallets`,
                `Total proper voting wallets: ${formatInteger(total)}`,
            ],
            segments: [
                { label: 'Yes', className: 'is-yes', value: split.actualFor },
                { label: 'No', className: 'is-no', value: split.actualAgainst },
            ],
        };
    }

    const yesVotes = ethers.BigNumber.from(row.actualFor || '0');
    const noVotes = ethers.BigNumber.from(row.actualAgainst || '0');
    const total = yesVotes.add(noVotes);
    const winner = getBigNumberWinner(yesVotes, noVotes, 'Yes', 'No');
    return {
        label: 'Vote split',
        stateKey: 'voteSplit',
        options: [['token', 'Token'], ['wallet', 'Wallet']],
        centerPrimary: winner.label,
        centerSecondary: `Y ${formatPercent(yesVotes, total, 0)} / N ${formatPercent(noVotes, total, 0)}`,
        tooltip: [
            'Vote split (token weight)',
            `Yes: ${formatDcultBillions(yesVotes)}`,
            `No: ${formatDcultBillions(noVotes)}`,
            `Proper votes: ${formatDcultBillions(total)}`,
        ],
        segments: [
            { label: 'Yes', className: 'is-yes', value: yesVotes },
            { label: 'No', className: 'is-no', value: noVotes },
        ],
    };
}

function getTokenTurnoutDonut(row) {
    const mode = proposalDonutState.tokenTurnout === 'eligible' ? 'eligible' : 'ready';
    const actualVotes = ethers.BigNumber.from(row.actualTotal || '0');
    const denominator = mode === 'eligible' ? getEligibleDcultSupply(row) : getEligibleReadyDcultSupply(row);
    const chartVotes = minBigNumber(actualVotes, denominator);
    const unused = subtractBigNumberFloor(denominator, chartVotes);
    const denominatorLabel = mode === 'eligible' ? 'eligible dCULT' : 'ready eligible dCULT';
    return {
        label: 'Token turnout',
        stateKey: 'tokenTurnout',
        options: [['ready', 'Ready'], ['eligible', 'Elig.']],
        centerPrimary: formatPercent(actualVotes, denominator, 1),
        centerSecondary: `${formatPercent(actualVotes, denominator, 1)} turnout`,
        tooltip: [
            `Token turnout (${denominatorLabel})`,
            `Actual votes: ${formatDcultBillions(actualVotes)}`,
            `${mode === 'eligible' ? 'Eligible' : 'Ready eligible'} dCULT: ${formatDcultBillions(denominator)}`,
            `Unused denominator: ${formatDcultBillions(unused)}`,
        ],
        segments: [
            { label: 'Actual votes', className: 'is-focus', value: chartVotes },
            { label: 'Unused', className: 'is-unused', value: unused },
        ],
    };
}

function getWalletTurnoutDonut(row, participatingWalletCount) {
    const mode = proposalDonutState.walletTurnout === 'wallets' ? 'wallets' : 'percent';
    const readyEligibleWallets = getEligibleReadyHolderWallets(row);
    const eligibleWallets = getEligibleHolderWallets(row);
    const participating = Math.max(0, Number(participatingWalletCount || 0));
    const chartParticipating = Math.min(participating, readyEligibleWallets);
    const inactive = Math.max(0, readyEligibleWallets - chartParticipating);
    return {
        label: 'Wallet turnout',
        stateKey: 'walletTurnout',
        options: [['percent', '%'], ['wallets', '#']],
        centerPrimary: mode === 'wallets'
            ? formatCompactRatio(participating, readyEligibleWallets)
            : formatCountPercent(participating, readyEligibleWallets, 1),
        centerSecondary: `${formatCountPercent(participating, readyEligibleWallets, 1)} ready`,
        tooltip: [
            'Wallet turnout (ready eligible wallets)',
            `Participating wallets: ${formatInteger(participating)}`,
            `Ready eligible wallets: ${formatInteger(readyEligibleWallets)}`,
            `Eligible wallets: ${formatInteger(eligibleWallets)}`,
        ],
        segments: [
            { label: 'Participating', className: 'is-focus', value: chartParticipating },
            { label: 'Ready but not participating', className: 'is-unused', value: inactive },
        ],
    };
}

function getWastedWalletDonut(row, participatingWalletCount, repeatWastedVoters) {
    const mode = proposalDonutState.wastedWallets === 'repeat' ? 'repeat' : 'total';
    const wastedWallets = Number(row.wastedWalletCount || 0);
    const participatingWallets = Math.max(0, Number(participatingWalletCount || 0));
    if (mode === 'repeat') {
        const split = getRowWastedRepeatWalletSplit(row, repeatWastedVoters);
        return {
            label: 'Wasted wallets',
            stateKey: 'wastedWallets',
            options: [['total', 'Total'], ['repeat', 'Repeat']],
            centerPrimary: formatCompactRatio(split.repeat, split.total),
            centerSecondary: `${formatCountPercent(split.repeat, split.total, 1)} repeat`,
            tooltip: [
                'Wasted wallets (repeat split)',
                `Repeat wasted wallets: ${formatInteger(split.repeat)}`,
                `One-time wasted wallets: ${formatInteger(split.oneTime)}`,
                `Total wasted wallets: ${formatInteger(split.total)}`,
            ],
            segments: [
                { label: 'Repeat', className: 'is-repeat', value: split.repeat },
                { label: 'One-time', className: 'is-muted', value: split.oneTime },
            ],
        };
    }

    const chartWasted = Math.min(wastedWallets, participatingWallets);
    const nonWasted = Math.max(0, participatingWallets - chartWasted);
    return {
        label: 'Wasted wallets',
        stateKey: 'wastedWallets',
        options: [['total', 'Total'], ['repeat', 'Repeat']],
        centerPrimary: formatCompactRatio(wastedWallets, participatingWallets),
        centerSecondary: `${formatCountPercent(wastedWallets, participatingWallets, 1)} wasted`,
        tooltip: [
            'Wasted wallets (total)',
            `Wasted wallets: ${formatInteger(wastedWallets)}`,
            `Participating wallets: ${formatInteger(participatingWallets)}`,
            `Wasted share: ${formatCountPercent(wastedWallets, participatingWallets, 1)}`,
        ],
        segments: [
            { label: 'Wasted', className: 'is-wasted', value: chartWasted },
            { label: 'Other participating wallets', className: 'is-clean', value: nonWasted },
        ],
    };
}

function getDelegateDutyDonut(delegateDuty) {
    const mode = proposalDonutState.delegateDuty === 'wallets' ? 'wallets' : 'delegatees';
    const votedDelegatees = Number(delegateDuty.votedDelegateCount || 0);
    const activeDelegatees = Number(delegateDuty.activeDelegateCount || 0);
    const votedDelegatorWallets = Number(delegateDuty.votedDelegatorCount || 0);
    const activeDelegatorWallets = Number(delegateDuty.activeDelegatorCount || 0);
    const voted = mode === 'wallets' ? votedDelegatorWallets : votedDelegatees;
    const active = mode === 'wallets' ? activeDelegatorWallets : activeDelegatees;
    const absent = Math.max(0, active - voted);
    const unit = mode === 'wallets' ? 'represented wallets' : 'delegatees';
    return {
        label: 'Third-party duty',
        stateKey: 'delegateDuty',
        options: [['delegatees', 'Deleg.'], ['wallets', 'Wallets']],
        centerPrimary: formatCompactRatio(voted, active),
        centerSecondary: `${formatCountPercent(voted, active, 1)} represented`,
        tooltip: [
            `Third-party duty (${unit})`,
            `Delegatees represented: ${formatInteger(votedDelegatees)} / ${formatInteger(activeDelegatees)}`,
            `Wallets represented: ${formatInteger(votedDelegatorWallets)} / ${formatInteger(activeDelegatorWallets)}`,
            `${mode === 'wallets' ? 'Unrepresented wallets' : 'Absent delegatees'}: ${formatInteger(absent)}`,
            `Representation share: ${formatCountPercent(voted, active, 1)}`,
        ],
        segments: [
            { label: 'Represented', className: 'is-represented', value: voted },
            { label: 'Absent', className: 'is-absent', value: absent },
        ],
    };
}

function renderProposalDonutItem(item) {
    return `
        <div class="proposal-donut-item" title="${escapeHtml(item.tooltip.join('\n'))}">
            <div class="proposal-donut-item-head">
                <span>
                    <span class="proposal-donut-label">${escapeHtml(item.label)}</span>
                    <span class="proposal-donut-mode-row">
                        ${renderProposalDonutToggle(item.stateKey, item.options)}
                        ${renderProposalDonutModeLabels(item.stateKey, item.options)}
                    </span>
                </span>
            </div>
            ${renderProposalMiniDonut(item.segments, item.centerPrimary, item.centerSecondary)}
        </div>
    `;
}

function renderProposalDonutModeLabels(stateKey, options) {
    const currentValue = proposalDonutState[stateKey];
    return `
        <span class="proposal-donut-mode-labels">
            ${options.map(([value, label]) => `
                <span class="${value === currentValue ? 'is-active' : ''}">${escapeHtml(label)}</span>
            `).join('<span class="proposal-donut-mode-separator">/</span>')}
        </span>
    `;
}

function renderProposalDonutToggle(stateKey, options) {
    const currentValue = proposalDonutState[stateKey];
    const currentOption = options.find(([value]) => value === currentValue) || options[0];
    const nextOption = options.find(([value]) => value !== currentValue) || options[0];
    const isRight = options[1]?.[0] === currentValue;

    return `
        <button
            class="proposal-donut-switch ${isRight ? 'is-on' : ''}"
            type="button"
            data-proposal-donut="${escapeHtml(stateKey)}"
            data-proposal-donut-mode="${escapeHtml(nextOption[0])}"
            title="${escapeHtml(`${currentOption[1]} mode. Switch to ${nextOption[1]}.`)}"
            aria-label="${escapeHtml(`${stateKey}: ${currentOption[1]} mode. Switch to ${nextOption[1]}.`)}"
            aria-pressed="${isRight ? 'true' : 'false'}"
        ><span></span></button>
    `;
}

function renderProposalMiniDonut(segments, centerPrimary, centerSecondary) {
    const normalized = normalizeDonutSegments(segments);
    let offset = 0;
    const circles = normalized.map((segment) => {
        const dash = segment.percent;
        const circle = `
            <circle
                class="proposal-donut-segment ${segment.className}"
                cx="24"
                cy="24"
                r="17"
                pathLength="100"
                stroke-dasharray="${roundSvg(dash)} ${roundSvg(Math.max(0, 100 - dash))}"
                stroke-dashoffset="${roundSvg(-offset)}"
            >${segment.title ? `<title>${escapeHtml(segment.title)}</title>` : ''}</circle>
        `;
        offset += dash;
        return circle;
    }).join('');

    return `
        <div class="proposal-donut-visual">
            <svg class="proposal-donut-svg" viewBox="0 0 48 48" aria-hidden="true">
                <circle class="proposal-donut-track" cx="24" cy="24" r="17"></circle>
                ${circles}
            </svg>
            <span class="proposal-donut-center">
                <strong>${escapeHtml(centerPrimary)}</strong>
            </span>
        </div>
        <span class="proposal-donut-caption">${escapeHtml(centerSecondary)}</span>
    `;
}

function normalizeDonutSegments(segments) {
    const rows = (segments || [])
        .map((segment) => ({
            ...segment,
            numberValue: Math.max(0, getDonutValueNumber(segment.value)),
        }))
        .filter((segment) => segment.numberValue > 0);
    const total = rows.reduce((sum, segment) => sum + segment.numberValue, 0);
    if (!total) return [];
    return rows.map((segment) => ({
        ...segment,
        percent: (segment.numberValue / total) * 100,
    }));
}

function getDonutValueNumber(value) {
    if (ethers.BigNumber.isBigNumber(value)) return tokenNumber(value);
    return Number(value || 0);
}

function getBigNumberWinner(left, right, leftLabel, rightLabel) {
    const leftValue = ethers.BigNumber.from(left || '0');
    const rightValue = ethers.BigNumber.from(right || '0');
    if (leftValue.eq(rightValue)) return { label: 'Tie', value: leftValue };
    return leftValue.gt(rightValue)
        ? { label: leftLabel, value: leftValue }
        : { label: rightLabel, value: rightValue };
}

function getCountWinner(left, right, leftLabel, rightLabel) {
    const leftValue = Number(left || 0);
    const rightValue = Number(right || 0);
    if (leftValue === rightValue) return { label: 'Tie', value: leftValue };
    return leftValue > rightValue
        ? { label: leftLabel, value: leftValue }
        : { label: rightLabel, value: rightValue };
}

function minBigNumber(left, right) {
    const a = ethers.BigNumber.from(left || '0');
    const b = ethers.BigNumber.from(right || '0');
    return a.lte(b) ? a : b;
}

function formatCompactCount(value) {
    const number = Number(value || 0);
    const abs = Math.abs(number);
    if (abs >= 1_000_000) return `${formatCompactDecimal(number / 1_000_000)}M`;
    if (abs >= 1_000) return `${formatCompactDecimal(number / 1_000)}K`;
    return formatInteger(number);
}

function formatCompactRatio(numerator, denominator) {
    return `${formatCompactCount(numerator)}/${formatCompactCount(denominator)}`;
}

function renderDelegateAbsenceImpactIcon(couldSwing, couldDominate) {
    if (!couldSwing) return '';
    const label = `Absent delegated representation could have ${couldDominate ? 'dominated' : 'flipped'} this proposal`;
    const strengthClass = couldDominate ? 'is-dominate' : 'is-flip';
    const icon = couldDominate ? renderSolidUserIcon() : renderDashedUserIcon();

    return `
        <span class="proposal-impact-icon swing-duty ${strengthClass}" title="${escapeHtml(label)}" role="img" aria-label="${escapeHtml(label)}">
            ${icon}
        </span>
    `;
}

function renderWastedFlipIcon(row) {
    if (!row?.couldSwing) return '';
    const direction = row.adjustedLeadingSide === 'For' ? 'up' : 'down';
    const outcome = row.adjustedLeadingSide === 'For' ? 'For / Yes' : 'Against / No';
    const label = `Wasted votes would have flipped outcome to ${outcome}`;

    return `
        <span class="proposal-impact-icon swing-yes" title="${escapeHtml(label)}" role="img" aria-label="${escapeHtml(label)}">
            ${renderDirectionIcon(direction)}
        </span>
    `;
}

function renderDashedUserIcon() {
    return `
        <svg class="duty-impact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">
            <circle cx="128" cy="120" r="40"/>
            <path d="M104,35a95.51,95.51,0,0,1,48,0"/>
            <path d="M35.49,102.3a95.54,95.54,0,0,1,24-41.56"/>
            <path d="M152,221a95.51,95.51,0,0,1-48,0"/>
            <path d="M196.51,60.73a95.54,95.54,0,0,1,24,41.58"/>
            <path d="M220.52,153.7a96,96,0,0,1-28.32,45.67,72,72,0,0,0-128.4,0A96,96,0,0,1,35.48,153.7"/>
        </svg>
    `;
}

function renderSolidUserIcon() {
    return `
        <svg class="duty-impact-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">
            <circle cx="128" cy="128" r="92"/>
            <circle cx="128" cy="108" r="36"/>
            <path d="M63.8,194.8a72,72,0,0,1,128.4,0"/>
        </svg>
    `;
}

function renderDirectionIcon(direction) {
    const arrow = direction === 'up'
        ? '<line x1="160" y1="96" x2="96" y2="160"/><polyline points="112 96 160 96 160 144"/>'
        : '<line x1="160" y1="160" x2="96" y2="96"/><polyline points="160 112 160 160 112 160"/>';
    return `
        <svg class="direction-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">
            <circle cx="128" cy="128" r="96"/>
            ${arrow}
        </svg>
    `;
}

function delegateDutyCouldSwing(row, delegateDuty = normalizeDelegateDuty(row.delegateDuty)) {
    if (!row || row.leadingSide === 'Tie') return false;
    const absentPower = ethers.BigNumber.from(delegateDuty.absentDelegatedPower || '0');
    return absentPower.gt(row.margin || 0);
}

function delegateDutyCouldDominate(row, delegateDuty = normalizeDelegateDuty(row.delegateDuty)) {
    if (!row) return false;
    const absentPower = ethers.BigNumber.from(delegateDuty.absentDelegatedPower || '0');
    return absentPower.gt(row.actualTotal || 0);
}

function getParticipatingWalletCount(row, delegateDuty = normalizeDelegateDuty(row.delegateDuty)) {
    const participants = new Set(
        (row.voteEvents || [])
            .map((event) => String(event.voter || '').toLowerCase())
            .filter(Boolean),
    );

    for (const delegateRow of delegateDuty.votedDelegates || []) {
        for (const delegatorRow of delegateRow.delegators || []) {
            const delegator = String(delegatorRow.delegator || '').toLowerCase();
            if (delegator) participants.add(delegator);
        }
    }

    return participants.size;
}

function renderMetricCell(label, value, valueClass) {
    return `
        <div class="metric-cell">
            <h3>${escapeHtml(label)}</h3>
            <span class="value ${valueClass || ''}">${escapeHtml(value)}</span>
        </div>
    `;
}

function renderMetricCellHtml(label, valueHtml, valueClass) {
    return `
        <div class="metric-cell">
            <h3>${escapeHtml(label)}</h3>
            <span class="value ${valueClass || ''}">${valueHtml}</span>
        </div>
    `;
}

function renderExpandedWalletDetails(row) {
    return `
        <div class="proposal-detail-panel">
            ${renderZeroWeightWalletList(row.zeroWallets)}
            ${renderDelegateDutyList(row)}
        </div>
    `;
}

function renderZeroWeightWalletList(wallets) {
    return `
        <section class="wallet-section">
            <div class="wallet-section-heading">
                <h4>Zero-Weight Voters</h4>
                <span>${formatInteger(wallets.length)} wallet${wallets.length === 1 ? '' : 's'}</span>
            </div>
            ${wallets.length
                ? `<div class="wallet-list">${wallets.map(renderWalletRow).join('')}</div>`
                : '<p class="empty-state compact-empty">No zero-weight wallets for this proposal.</p>'}
        </section>
    `;
}

function renderDelegateDutyList(row) {
    if (!isDelegateDutyReportable(row)) {
        return `
            <section class="wallet-section">
                <div class="wallet-section-heading">
                    <h4>Third-Party Delegatee Duty</h4>
                    <span>Not counted</span>
                </div>
                <p class="empty-state compact-empty">Canceled proposals are excluded from delegatee-duty reports.</p>
            </section>
        `;
    }

    const duty = normalizeDelegateDuty(row.delegateDuty);
    const delegates = [
        ...duty.absentDelegates.map((delegateRow) => ({ ...delegateRow, dutyStatus: 'absent' })),
        ...duty.votedDelegates.map((delegateRow) => ({ ...delegateRow, dutyStatus: 'voted' })),
    ];

    return `
        <section class="wallet-section">
            <div class="wallet-section-heading">
                <h4>Third-Party Delegatee Duty</h4>
                <span>${formatWalletRatio(duty.votedDelegateCount, duty.activeDelegateCount)} voted</span>
            </div>
            ${delegates.length
                ? `<div class="wallet-list delegate-duty-list">${delegates.map((delegateRow) => renderDelegateDutyRow(row.id, delegateRow)).join('')}</div>`
                : '<p class="empty-state compact-empty">No third-party delegated voting power at this proposal snapshot.</p>'}
        </section>
    `;
}

function renderDelegateDutyRow(proposalId, delegateRow) {
    const delegatedPower = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
    const voteWeight = ethers.BigNumber.from(delegateRow.votes || '0');
    const voted = delegateRow.dutyStatus === 'voted';
    const statusLabel = voted ? 'Fulfilled Duty' : 'Missed Duty';
    const statusClass = voted ? 'status-active' : 'status-attention';
    const actionLabel = voted ? `Voted ${supportLabel(delegateRow.support)} (${formatTokenAmount(voteWeight, 0)} dCULT)` : 'Did not vote';
    const delegateKey = delegateDutyKey(proposalId, delegateRow.delegatee);
    const expanded = expandedDelegatees.has(delegateKey);
    const representedWallets = Array.isArray(delegateRow.delegators) ? delegateRow.delegators : [];

    return `
        <div class="delegate-duty-item">
            <article class="wallet-row delegate-duty-row ${voted ? 'is-represented' : 'is-wasted'}">
                <div class="wallet-detail">
                    ${renderAddressLink(delegateRow.delegatee)}
                    <div class="event-meta">Delegatee</div>
                </div>
                <div class="wallet-support-cell">
                    <span class="wallet-detail-label">Delegatee Action</span>
                    <span class="wallet-detail-value">${escapeHtml(actionLabel)}</span>
                    <span class="status-flag ${statusClass}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Attached Power</span>
                    <span class="wallet-amount">${formatTokenAmount(delegatedPower, 0)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Represented Wallets</span>
                    <span class="wallet-detail-value">${formatInteger(delegateRow.delegatorCount)}</span>
                </div>
                <div class="row-icon-actions">
                    <button class="tiny-icon-button delegate-duty-toggle" type="button" data-proposal-id="${proposalId}" data-delegatee="${escapeHtml(delegateRow.delegatee)}" title="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}" aria-label="${expanded ? 'Hide represented wallets' : 'Show represented wallets'}">
                        ${expanded ? '&minus;' : '+'}
                    </button>
                    <a class="tx-icon-link" href="${addressUrl(delegateRow.delegatee)}" target="_blank" rel="noopener noreferrer" title="View delegatee on Etherscan" aria-label="View delegatee on Etherscan">
                        ${renderExternalLinkIcon()}
                    </a>
                </div>
            </article>
            ${expanded ? renderDelegatorList(representedWallets) : ''}
        </div>
    `;
}

function renderDelegatorList(delegators) {
    if (!delegators.length) {
        return '<p class="empty-state compact-empty delegator-empty">No represented-wallet detail cached for this delegatee yet. Rebuild the index to refresh detail rows.</p>';
    }

    return `
        <div class="delegator-list">
            ${delegators.map(renderDelegatorRow).join('')}
        </div>
    `;
}

function renderDelegatorRow(delegatorRow) {
    const balance = ethers.BigNumber.from(delegatorRow.balance || '0');
    const duty = getDelegatorDutySummary(delegatorRow.delegator);

    return `
        <article class="delegator-row">
            <div class="wallet-detail">
                ${renderAddressLink(delegatorRow.delegator)}
                <div class="event-meta">Represented wallet</div>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Attached dCULT</span>
                <span class="wallet-amount">${formatTokenAmount(balance, 0)}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Delegatee Duty</span>
                <span class="wallet-detail-value">${formatInteger(duty.missedCount)} missed / ${formatInteger(duty.trackedCount)} tracked</span>
                <span class="value-subline">Missed ${formatTokenAmount(duty.missed, 0)} / fulfilled ${formatTokenAmount(duty.fulfilled, 0)} dCULT</span>
            </div>
            <a class="tx-icon-link" href="${addressUrl(delegatorRow.delegator)}" target="_blank" rel="noopener noreferrer" title="View delegator on Etherscan" aria-label="View delegator on Etherscan">
                ${renderExternalLinkIcon()}
            </a>
        </article>
    `;
}

function getDelegatorDutySummary(address) {
    const target = String(address || '').toLowerCase();
    const summary = {
        missed: ethers.BigNumber.from(0),
        fulfilled: ethers.BigNumber.from(0),
        missedCount: 0,
        fulfilledCount: 0,
        trackedCount: 0,
    };
    if (!target) return summary;

    for (const row of currentRows || []) {
        if (!isDelegateDutyReportable(row)) continue;
        const duty = normalizeDelegateDuty(row.delegateDuty);
        collectDelegatorDutyFromRows(summary, duty.absentDelegates, target, false);
        collectDelegatorDutyFromRows(summary, duty.votedDelegates, target, true);
    }

    return summary;
}

function collectDelegatorDutyFromRows(summary, delegateRows, target, fulfilled) {
    for (const delegateRow of delegateRows || []) {
        for (const delegatorRow of delegateRow.delegators || []) {
            const delegator = String(delegatorRow.delegator || '').toLowerCase();
            if (delegator !== target) continue;
            const balance = ethers.BigNumber.from(delegatorRow.balance || '0');
            summary.trackedCount += 1;
            if (fulfilled) {
                summary.fulfilled = summary.fulfilled.add(balance);
                summary.fulfilledCount += 1;
            } else {
                summary.missed = summary.missed.add(balance);
                summary.missedCount += 1;
            }
        }
    }
}

function renderWalletRow(wallet) {
    const snapshotBalance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
    const hasSnapshotDcult = !snapshotBalance.isZero();
    const supportClass = `support-${supportSlug(wallet.support)}`;
    const snapshotDelegate = renderDelegateLabel(wallet.voter, wallet.snapshotDelegate);
    const currentDelegate = renderDelegateLabel(wallet.voter, wallet.currentDelegate);
    const currentReady = String(wallet.currentDelegate || '').toLowerCase() === wallet.voter.toLowerCase();
    const impact = walletImpact(wallet, hasSnapshotDcult);

    return `
        <article class="wallet-row ${impact.rowClass}">
            <div class="wallet-detail">
                ${renderAddressLink(wallet.voter)}
                <div class="event-meta">${escapeHtml(wallet.source || 'VoteCast')}</div>
            </div>
            <div class="wallet-support-cell">
                <span class="wallet-detail-label">Vote Intent</span>
                <span class="wallet-support wallet-support-plain ${supportClass}">${supportLabel(wallet.support)}</span>
                <span class="wallet-impact ${impact.className}">${escapeHtml(impact.label)}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Snapshot dCULT</span>
                <span class="wallet-amount">${formatTokenAmount(snapshotBalance, 0)}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Delegated Then</span>
                <span class="wallet-detail-value">${snapshotDelegate}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Now</span>
                <span class="wallet-detail-value ${currentReady ? 'value-for' : 'value-against'}">${currentDelegate}</span>
            </div>
            <a class="tx-icon-link" href="${txUrl(wallet.transactionHash)}" target="_blank" rel="noopener noreferrer" title="View vote transaction on Etherscan" aria-label="View vote transaction on Etherscan">
                ${renderExternalLinkIcon()}
            </a>
        </article>
    `;
}

function walletImpact(wallet, hasSnapshotDcult) {
    if (!hasSnapshotDcult || wallet.representationStatus === 'empty') {
        return { rowClass: 'is-empty', className: 'is-empty', label: getZeroWeightInactiveReason(wallet) };
    }

    if (wallet.representationStatus === 'represented') {
        return { rowClass: 'is-represented', className: 'is-represented', label: `Delegatee voted ${supportLabel(wallet.delegateSupport)}` };
    }

    if (wallet.representationStatus === 'misaligned') {
        return { rowClass: 'is-misaligned', className: 'is-misaligned', label: `Delegatee voted ${supportLabel(wallet.delegateSupport)}` };
    }

    if (wallet.wasteReason === 'delegate_not_voted') {
        return { rowClass: 'is-wasted', className: 'is-wasted', label: 'Delegatee did not vote' };
    }

    return { rowClass: 'is-wasted', className: 'is-wasted', label: getNoVotingRightsReason(wallet) };
}

function getNoVotingRightsReason(wallet) {
    const voter = String(wallet?.voter || '').toLowerCase();
    const snapshotDelegate = String(wallet?.snapshotDelegate || ZERO_ADDRESS).toLowerCase();

    if (!snapshotDelegate || snapshotDelegate === ZERO_ADDRESS) {
        return 'Not delegated at snapshot';
    }

    if (snapshotDelegate === voter) {
        return 'Self-delegated, zero vote weight';
    }

    return 'No voting weight at snapshot';
}

function getZeroWeightInactiveReason(wallet) {
    const reasons = ['No snapshot dCULT'];
    if (!hasSnapshotDelegate(wallet)) reasons.push('not delegated at snapshot');
    return reasons.join(' / ');
}

function hasSnapshotDelegate(wallet) {
    const delegatee = String(wallet?.snapshotDelegate || ZERO_ADDRESS).toLowerCase();
    return Boolean(delegatee && delegatee !== ZERO_ADDRESS);
}

function handleDelegateePowerListClick(event) {
    const button = event.target.closest('.delegatee-power-toggle');
    if (!button) return;

    const key = delegatePowerKey(button.dataset.proposalId, button.dataset.delegatee);
    if (expandedPowerDelegatees.has(key)) {
        expandedPowerDelegatees.delete(key);
    } else {
        expandedPowerDelegatees.add(key);
    }
    renderDelegateePowerSection(currentRows);
}

function handleDelegateeReliabilityChartClick(event) {
    const scopeButton = event.target.closest('[data-delegatee-reliability-scope]');
    if (scopeButton) {
        const scope = scopeButton.dataset.delegateeReliabilityScope === 'all' ? 'all' : 'current';
        if (delegateeReliabilityState.scope !== scope) {
            delegateeReliabilityState.scope = scope;
            renderDelegateeReliabilityScatter(currentRows);
            renderDelegateeReliabilityChart(currentRows);
        }
        return;
    }

    const button = event.target.closest('.reliability-delegatee-toggle');
    if (!button) return;

    const key = reliabilityDelegateKey(button.dataset.delegatee);
    if (expandedReliabilityDelegatees.has(key)) {
        expandedReliabilityDelegatees.delete(key);
    } else {
        expandedReliabilityDelegatees.add(key);
    }
    renderDelegateeReliabilityChart(currentRows);
}

function handleDelegateeReliabilityScatterClick(event) {
    const scopeButton = event.target.closest('[data-delegatee-reliability-scope]');
    if (!scopeButton) return;

    const scope = scopeButton.dataset.delegateeReliabilityScope === 'all' ? 'all' : 'current';
    if (delegateeReliabilityState.scope === scope) return;
    delegateeReliabilityState.scope = scope;
    renderDelegateeReliabilityScatter(currentRows);
    renderDelegateeReliabilityChart(currentRows);
}

function handleDelegateeReliabilityScatterPointerMove(event) {
    const point = event.target.closest('.scatter-point');
    if (!point || !el.delegateeReliabilityScatter.contains(point)) {
        hideDelegateeReliabilityScatterTooltip();
        return;
    }

    const tooltip = el.delegateeReliabilityScatter.querySelector('.source-tooltip');
    if (!tooltip) return;

    tooltip.innerHTML = renderDelegateeReliabilityScatterTooltipHtml(point.dataset);
    tooltip.classList.add('is-visible');
    tooltip.setAttribute('aria-hidden', 'false');

    positionChartTooltip(el.delegateeReliabilityScatter, tooltip, event);
}

function hideDelegateeReliabilityScatterTooltip() {
    const tooltip = el.delegateeReliabilityScatter?.querySelector('.source-tooltip');
    if (!tooltip) return;
    tooltip.classList.remove('is-visible');
    tooltip.setAttribute('aria-hidden', 'true');
}

function renderDelegateeReliabilityScatterTooltipHtml(data) {
    const rows = [
        { className: 'proper-votes', label: 'Represented dCULT', value: data.representedPower },
        { className: 'direct-wasted', label: 'Missed dCULT', value: data.missedPower },
        { className: 'ready-eligible-supply', label: 'Tracked dCULT', value: data.totalPower },
    ];

    return `
        <div class="source-tooltip-title">${escapeHtml(data.address || 'Delegatee')}</div>
        <div class="source-tooltip-subtitle">${escapeHtml(data.status || '')}</div>
        <div class="source-tooltip-total">
            <span>Duty fulfilled</span>
            <strong>${escapeHtml(data.representedPercent || '0.0%')}</strong>
        </div>
        <div class="source-tooltip-total">
            <span>Duty missed</span>
            <strong>${escapeHtml(data.missedPercent || '0.0%')}</strong>
        </div>
        <div class="source-tooltip-rows">
            ${rows.map((row) => `
                <div class="source-tooltip-row">
                    <span class="source-tooltip-swatch source-${row.className}" aria-hidden="true"></span>
                    <span>${escapeHtml(row.label)}</span>
                    <strong>${escapeHtml(row.value || '0.00B dCULT')}</strong>
                </div>
            `).join('')}
        </div>
        <div class="source-tooltip-total source-tooltip-context">
            <span>Wallet-proposals</span>
        </div>
        <div class="source-tooltip-rows">
            <div class="source-tooltip-row">
                <span class="source-tooltip-swatch source-proper-votes" aria-hidden="true"></span>
                <span>Represented</span>
                <strong>${escapeHtml(data.representedWallets || '0')}</strong>
            </div>
            <div class="source-tooltip-row">
                <span class="source-tooltip-swatch source-direct-wasted" aria-hidden="true"></span>
                <span>Missed</span>
                <strong>${escapeHtml(data.missedWallets || '0')}</strong>
            </div>
            <div class="source-tooltip-row">
                <span class="source-tooltip-swatch source-eligible-supply" aria-hidden="true"></span>
                <span>Latest attached</span>
                <strong>${escapeHtml(data.currentAttached || '0.00B dCULT')}</strong>
            </div>
        </div>
        <div class="source-tooltip-subtitle">${escapeHtml(data.proposals || '')} · Latest fulfilled: ${escapeHtml(data.latestFulfilled || 'never')}</div>
    `;
}

function handleProposalListClick(event) {
    const donutButton = event.target.closest('[data-proposal-donut]');
    if (donutButton) {
        const key = donutButton.dataset.proposalDonut;
        const mode = donutButton.dataset.proposalDonutMode;
        if (key && mode && Object.prototype.hasOwnProperty.call(proposalDonutState, key)) {
            proposalDonutState[key] = mode;
            renderProposalList(currentRows);
        }
        return;
    }

    const metricsSummary = event.target.closest('[data-proposal-detail-id]');
    if (metricsSummary) {
        const proposalId = String(metricsSummary.dataset.proposalDetailId || '');
        if (!proposalId) return;
        if (expandedProposalDetails.has(proposalId)) {
            expandedProposalDetails.delete(proposalId);
        } else {
            expandedProposalDetails.add(proposalId);
        }
        return;
    }

    const walletSummary = event.target.closest('[data-proposal-wallet-id]');
    if (walletSummary) {
        const proposalId = String(walletSummary.dataset.proposalWalletId || '');
        if (!proposalId) return;
        if (expandedProposals.has(proposalId)) {
            expandedProposals.delete(proposalId);
        } else {
            expandedProposals.add(proposalId);
        }
        return;
    }

    const delegateButton = event.target.closest('.delegate-duty-toggle');
    if (delegateButton) {
        const key = delegateDutyKey(delegateButton.dataset.proposalId, delegateButton.dataset.delegatee);
        if (expandedDelegatees.has(key)) {
            expandedDelegatees.delete(key);
        } else {
            expandedDelegatees.add(key);
        }
        renderProposalList(currentRows);
        return;
    }
}

function delegateDutyKey(proposalId, delegatee) {
    return `${String(proposalId || '')}:${String(delegatee || '').toLowerCase()}`;
}

function delegatePowerKey(proposalId, delegatee) {
    return `power:${String(proposalId || '')}:${String(delegatee || '').toLowerCase()}`;
}

function reliabilityDelegateKey(delegatee) {
    return `reliability:${String(delegatee || '').toLowerCase()}`;
}

async function getWorkingProvider() {
    let lastError = null;

    for (const rpc of READ_RPCS) {
        try {
            const provider = new ethers.providers.StaticJsonRpcProvider(
                rpc.url,
                { chainId: 1, name: 'homestead' },
            );
            const blockNumber = await withTimeout(provider.getBlockNumber(), 8000, `${rpc.label} block number`);
            if (!Number.isFinite(blockNumber) || blockNumber <= 0) throw new Error(`${rpc.label} returned an invalid block number`);
            return { provider, info: rpc };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('No public Ethereum RPC responded.');
}

async function getLogsWithSplit(filter, chunkSize) {
    const fromBlock = parseRpcNumber(filter.fromBlock);
    const toBlock = parseRpcNumber(filter.toBlock);
    const maxChunkSize = Number(chunkSize || 0);

    if (maxChunkSize > 0 && toBlock - fromBlock + 1 > maxChunkSize) {
        const results = [];
        let cursor = fromBlock;
        while (cursor <= toBlock) {
            const chunkToBlock = Math.min(toBlock, cursor + maxChunkSize - 1);
            const chunkLogs = await getLogsWithSplit({
                ...filter,
                fromBlock: ethers.utils.hexValue(cursor),
                toBlock: ethers.utils.hexValue(chunkToBlock),
            }, maxChunkSize);
            results.push(...chunkLogs);
            cursor = chunkToBlock + 1;
        }
        return results;
    }

    try {
        return await withTimeout(readProvider.getLogs({
            ...filter,
            fromBlock,
            toBlock,
        }), 30_000, `eth_getLogs ${formatInteger(fromBlock)}-${formatInteger(toBlock)}`);
    } catch (error) {
        if (!isRangeLimitError(error) || fromBlock >= toBlock) throw error;

        const midpoint = Math.min(toBlock - 1, Math.max(fromBlock, Math.floor((fromBlock + toBlock) / 2)));
        const [left, right] = await Promise.all([
            getLogsWithSplit({
                ...filter,
                fromBlock: ethers.utils.hexValue(fromBlock),
                toBlock: ethers.utils.hexValue(midpoint),
            }, chunkSize),
            getLogsWithSplit({
                ...filter,
                fromBlock: ethers.utils.hexValue(midpoint + 1),
                toBlock: ethers.utils.hexValue(toBlock),
            }, chunkSize),
        ]);
        return left.concat(right);
    }
}

function isRangeLimitError(error) {
    return /more than 10000|query returned more than|response size exceeded|too many results|block range|limit exceeded|exceed|response too large|query timeout|timed out|timeout|rate limit|too many requests/i.test(error?.message || '');
}

function createEmptyCache() {
    return {
        version: CACHE_VERSION,
        governor: GOVERNOR_ADDRESS,
        dcult: DCULT_ADDRESS,
        proposals: {},
        txSources: {},
        blockTimestamps: {},
        cultSupply: createEmptyCultSupplyCache(),
        guardianOverview: createEmptyGuardianOverviewCache(),
        updatedAt: null,
    };
}

function createEmptyGuardianOverviewCache() {
    return {
        schema: GUARDIAN_OVERVIEW_SCHEMA,
        dcult: DCULT_ADDRESS,
        cult: CULT_ADDRESS,
        blockNumber: 0,
        rows: [],
        summary: null,
        updatedAt: null,
    };
}

function createEmptyCultSupplyCache() {
    return {
        schema: 'cult-supply-composition-v3',
        token: CULT_ADDRESS,
        treasury: TREASURY_ADDRESS,
        uniswapPair: UNISWAP_PAIR_ADDRESS,
        burnWallets: [...CULT_BURN_WALLETS],
        weekBlockStep: CULT_SUPPLY_WEEK_BLOCK_STEP,
        samples: {},
        updatedAt: null,
    };
}

function normalizeCultSupplyCache(storedSupplyCache) {
    if (!storedSupplyCache || typeof storedSupplyCache !== 'object') return createEmptyCultSupplyCache();
    const schema = String(storedSupplyCache.schema || '');
    if (!['cult-supply-composition-v2', 'cult-supply-composition-v3'].includes(schema)) return createEmptyCultSupplyCache();
    if (String(storedSupplyCache.token || '').toLowerCase() !== CULT_ADDRESS.toLowerCase()) return createEmptyCultSupplyCache();
    if (String(storedSupplyCache.treasury || '').toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) return createEmptyCultSupplyCache();
    if (schema === 'cult-supply-composition-v3' && String(storedSupplyCache.uniswapPair || '').toLowerCase() !== UNISWAP_PAIR_ADDRESS.toLowerCase()) return createEmptyCultSupplyCache();
    if (Number(storedSupplyCache.weekBlockStep || 0) !== CULT_SUPPLY_WEEK_BLOCK_STEP) return createEmptyCultSupplyCache();

    return {
        ...createEmptyCultSupplyCache(),
        ...storedSupplyCache,
        schema: 'cult-supply-composition-v3',
        uniswapPair: UNISWAP_PAIR_ADDRESS,
        burnWallets: Array.isArray(storedSupplyCache.burnWallets) ? storedSupplyCache.burnWallets : [...CULT_BURN_WALLETS],
        samples: storedSupplyCache.samples && typeof storedSupplyCache.samples === 'object' ? storedSupplyCache.samples : {},
    };
}

function normalizeGuardianOverviewCache(storedGuardianCache) {
    if (!storedGuardianCache || typeof storedGuardianCache !== 'object') return createEmptyGuardianOverviewCache();
    if (String(storedGuardianCache.schema || '') !== GUARDIAN_OVERVIEW_SCHEMA) return createEmptyGuardianOverviewCache();
    if (String(storedGuardianCache.dcult || '').toLowerCase() !== DCULT_ADDRESS.toLowerCase()) return createEmptyGuardianOverviewCache();
    if (String(storedGuardianCache.cult || '').toLowerCase() !== CULT_ADDRESS.toLowerCase()) return createEmptyGuardianOverviewCache();

    return {
        ...createEmptyGuardianOverviewCache(),
        ...storedGuardianCache,
        rows: Array.isArray(storedGuardianCache.rows) ? storedGuardianCache.rows : [],
        summary: storedGuardianCache.summary && typeof storedGuardianCache.summary === 'object' ? storedGuardianCache.summary : null,
    };
}

async function loadCache() {
    const candidates = [];
    const indexedCache = normalizeStoredCache(await readCacheFromIndexedDb(CACHE_KEY));
    addCacheCandidate(candidates, indexedCache, 'indexed');

    addCacheCandidate(candidates, loadCacheFromLocalStorage(), 'local');
    if (candidates.length) {
        candidates.sort(compareCacheCandidates);
        return candidates[0].cache;
    }

    // A published seed may bootstrap an empty browser, but it must never replace
    // existing local history silently. The shared update dialog owns that choice.
    const staticCache = await loadStaticCacheSeed();
    if (!staticCache) return createEmptyCache();
    await persistImportedCache(staticCache);
    return staticCache;
}

function loadCacheFromLocalStorage() {
    try {
        return normalizeStoredCache(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')) || createEmptyCache();
    } catch {
        return createEmptyCache();
    }
}

function normalizeStoredCache(storedCache) {
    if (!storedCache || storedCache.version !== CACHE_VERSION || storedCache.governor !== GOVERNOR_ADDRESS || storedCache.dcult !== DCULT_ADDRESS) {
        return null;
    }

    return {
        ...createEmptyCache(),
        ...storedCache,
        proposals: storedCache.proposals && typeof storedCache.proposals === 'object' ? storedCache.proposals : {},
        txSources: storedCache.txSources && typeof storedCache.txSources === 'object' ? storedCache.txSources : {},
        blockTimestamps: storedCache.blockTimestamps && typeof storedCache.blockTimestamps === 'object' ? storedCache.blockTimestamps : {},
        cultSupply: normalizeCultSupplyCache(storedCache.cultSupply),
        guardianOverview: normalizeGuardianOverviewCache(storedCache.guardianOverview),
    };
}

function addCacheCandidate(candidates, candidateCache, source) {
    if (!candidateCache?.proposals || typeof candidateCache.proposals !== 'object') return;
    const proposalCount = Object.keys(candidateCache.proposals).length;
    if (!proposalCount) return;
    candidates.push({
        cache: candidateCache,
        source,
        score: getCacheUsefulnessScore(candidateCache),
        proposalCount,
        updatedAt: Number(candidateCache.updatedAt || 0),
    });
}

function compareCacheCandidates(a, b) {
    return (b.score - a.score)
        || (b.proposalCount - a.proposalCount)
        || (b.updatedAt - a.updatedAt);
}

function getCacheUsefulnessScore(candidateCache) {
    let score = Object.values(candidateCache?.proposals || {}).reduce((nextScoreTotal, proposal) => {
        let proposalScore = 1;
        if (Array.isArray(proposal?.zeroWallets)) proposalScore += 2;
        if (hasStoredDelegateDutyMetrics(proposal)) proposalScore += 20;
        if (hasStoredHolderSnapshotMetrics(proposal)) proposalScore += 5;
        if (hasStoredDelegateOwnPower(proposal?.delegateDuty)) proposalScore += 2;
        return nextScoreTotal + proposalScore;
    }, 0);
    if (Array.isArray(candidateCache?.guardianOverview?.rows) && candidateCache.guardianOverview.rows.length) score += 15;
    return score;
}

async function loadStaticCacheSeed() {
    if (window.location.protocol === 'file:') return null;

    try {
        const response = await fetch(STATIC_CACHE_URL, { cache: 'no-cache' });
        if (!response.ok) return null;
        const payload = await response.json();
        return normalizeStoredCache(payload?.cache || payload);
    } catch {
        return null;
    }
}

async function persistImportedCache(importedCache) {
    try {
        await writeCacheToIndexedDb(CACHE_KEY, importedCache);
    } catch (error) {
        console.warn('Unable to persist static wasted-vote seed to IndexedDB:', error);
    }

    try {
        const serialized = JSON.stringify(importedCache);
        if (serialized.length <= LOCAL_STORAGE_CACHE_LIMIT) {
            localStorage.setItem(CACHE_KEY, serialized);
        }
    } catch {
        // IndexedDB is the primary cache for the seed.
    }
}

async function saveCache(nextCache) {
    nextCache.updatedAt = Date.now();
    let indexedSaved = false;

    try {
        await writeCacheToIndexedDb(CACHE_KEY, nextCache);
        indexedSaved = true;
    } catch (error) {
        console.warn('Unable to persist wasted-vote index cache to IndexedDB:', error);
    }

    try {
        const serialized = JSON.stringify(nextCache);
        if (serialized.length <= LOCAL_STORAGE_CACHE_LIMIT) {
            localStorage.setItem(CACHE_KEY, serialized);
        } else {
            localStorage.removeItem(CACHE_KEY);
        }
    } catch (error) {
        if (!indexedSaved) {
            console.warn('Unable to persist wasted-vote index cache:', error);
        }
    }
}

function openCacheDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error('IndexedDB is unavailable.'));
            return;
        }

        const request = window.indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CACHE_DB_STORE)) {
                db.createObjectStore(CACHE_DB_STORE);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    });
}

async function readCacheFromIndexedDb(key) {
    try {
        const db = await openCacheDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(CACHE_DB_STORE, 'readonly');
            const store = tx.objectStore(CACHE_DB_STORE);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('IndexedDB read failed.'));
            tx.oncomplete = () => db.close();
            tx.onabort = () => {
                db.close();
                reject(tx.error || new Error('IndexedDB read aborted.'));
            };
        });
    } catch {
        return null;
    }
}

async function writeCacheToIndexedDb(key, value) {
    const db = await openCacheDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CACHE_DB_STORE, 'readwrite');
        const store = tx.objectStore(CACHE_DB_STORE);
        store.put(value, key);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('IndexedDB write failed.'));
        };
        tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('IndexedDB write aborted.'));
        };
    });
}

function applySavedTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (!savedTheme) {
        applyTheme('default', false);
        return;
    }

    try {
        const parsed = JSON.parse(savedTheme);
        if (parsed?.type === 'random' && parsed.colors) {
            applyRandomTheme(parsed.colors, false);
            return;
        }
        if (parsed?.type === 'standard' && THEME_SEQUENCE.includes(parsed.name)) {
            applyTheme(parsed.name, false);
            return;
        }
    } catch {
        applyTheme(savedTheme, false);
        return;
    }

    applyTheme('default', false);
}

function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'default';
    const currentIndex = THEME_SEQUENCE.indexOf(current);
    const next = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length] || 'default';
    applyTheme(next, true);
}

function applyTheme(themeName, persist) {
    const theme = THEME_SEQUENCE.includes(themeName) ? themeName : 'default';
    const root = document.documentElement;
    if (theme === 'publish') {
        root.style.setProperty('--background-image', 'radial-gradient(circle, #ff5252, black)');
        root.style.setProperty('--btn-bg', '#333333');
        root.style.setProperty('--menu-bg', '#050505');
    } else {
        root.style.setProperty('--background-image', 'radial-gradient(circle, #222222, black)');
        root.style.setProperty('--btn-bg', '#ff5252');
        root.style.setProperty('--menu-bg', '#ff5252');
    }
    document.documentElement.dataset.theme = theme;
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'standard', name: theme }));
}

function shuffleTheme() {
    const colors = {
        color1: getRandomColor(),
        color2: getRandomColor(),
        btnColor: getRandomColor(),
    };
    applyRandomTheme(colors, true);
}

function applyRandomTheme(colors, persist) {
    const root = document.documentElement;
    root.style.setProperty('--background-image', `radial-gradient(circle, ${colors.color1}, ${colors.color2})`);
    root.style.setProperty('--btn-bg', colors.btnColor);
    root.style.setProperty('--menu-bg', '#050505');
    root.dataset.theme = 'random';
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'random', colors }));
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i += 1) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function toggleUtilityMenu(event) {
    event.stopPropagation();
    const isOpen = el.utilityMenu.classList.toggle('show');
    el.menuToggle.setAttribute('aria-expanded', String(isOpen));
}

function closeUtilityMenu() {
    el.utilityMenu.classList.remove('show');
    el.menuToggle.setAttribute('aria-expanded', 'false');
}

function closeUtilityMenuOnOutsideClick(event) {
    if (!el.utilityMenu.classList.contains('show')) return;
    if (event.target.closest('.menu-widget')) return;
    closeUtilityMenu();
}

function closeUtilityMenuOnEscape(event) {
    if (event.key === 'Escape') closeUtilityMenu();
}

function setBusy(isBusy) {
    el.connectWalletBtn.disabled = isBusy;
    el.refreshBtn.disabled = isBusy;
    el.resetCacheBtn.disabled = isBusy;
    el.publicRpcBtn.disabled = isBusy;
    el.proposalScope.disabled = isBusy;
}

function updateConnectButton() {
    if (connectedAddress && ['wallet', 'wrong-network'].includes(providerMode)) {
        const title = providerMode === 'wallet' ? 'Connected wallet provider' : 'Connected wallet · switch to Ethereum';
        if (!window.CultWalletButton?.renderConnected?.(el.connectWalletBtn, connectedAddress, title)) {
            el.connectWalletBtn.textContent = shortAddress(connectedAddress);
            el.connectWalletBtn.title = title;
        }
        el.etherscanLink.href = addressUrl(connectedAddress);
        return;
    }

    if (providerMode === 'public') {
        el.connectWalletBtn.textContent = 'Connect Wallet';
        el.connectWalletBtn.title = 'Switch to wallet RPC';
        el.etherscanLink.href = '#';
        return;
    }

    el.connectWalletBtn.textContent = 'Connect Wallet';
    el.connectWalletBtn.title = 'Use wallet RPC for reads';
    el.etherscanLink.href = '#';
}

function toggleWalletDropdown() {
    if (!connectedAddress) return;
    el.walletDropdown.classList.toggle('show');
}

function closeWalletDropdown() {
    el.walletDropdown.classList.remove('show');
}

function closeWalletDropdownOnOutsideClick(event) {
    if (!el.walletDropdown.classList.contains('show')) return;
    if (event.target.closest('.wallet-widget')) return;
    closeWalletDropdown();
}

function closeWalletDropdownOnEscape(event) {
    if (event.key === 'Escape') closeWalletDropdown();
}

async function copyConnectedAddress() {
    if (!connectedAddress) return;
    try {
        await copyTextToClipboard(connectedAddress);
        el.connectWalletBtn.textContent = 'Copied';
        setTimeout(updateConnectButton, 900);
    } catch {
        setStatus('Could not copy address from this browser.', true);
    } finally {
        closeWalletDropdown();
    }
}

async function handleCopyActionClick(event) {
    const copyAction = event.target.closest('.copy-action');
    if (!copyAction?.dataset.copyAddress) return;
    event.preventDefault();
    event.stopPropagation();

    try {
        await copyTextToClipboard(copyAction.dataset.copyAddress);
        markCopyActionCopied(copyAction);
    } catch {
        setStatus('Could not copy address from this browser.', true);
    }
}

function copyTextToClipboard(text) {
    return navigator.clipboard.writeText(text);
}

function markCopyActionCopied(copyAction) {
    copyAction.classList.add('is-copied');
    copyAction.setAttribute('title', 'Copied');
    const addressLink = copyAction.closest('.address-link');
    addressLink?.querySelector('.copy-feedback')?.remove();
    const feedback = document.createElement('span');
    feedback.className = 'copy-feedback';
    feedback.textContent = 'Copied';
    addressLink?.appendChild(feedback);
    window.setTimeout(() => {
        copyAction.classList.remove('is-copied');
        copyAction.setAttribute('title', 'Copy address');
        feedback.remove();
    }, 900);
}

function disconnectWallet() {
    window.CultWalletSession?.disconnect();
    readProvider = null;
    providerInfo = null;
    providerMode = '';
    connectedAddress = '';
    governorContract = null;
    dcultContract = null;
    cultContract = null;
    closeWalletDropdown();
    renderDisconnectedState('Wallet disconnected locally. Connect again when ready.');
}

function setStatus(message, danger = false) {
    el.statusLine.textContent = message;
    el.statusLine.classList.toggle('danger-text', danger);
}

function setIndexStatus(message, state = '') {
    el.latestBlock.textContent = message;
    el.latestBlock.classList.toggle('is-indexing', state === 'indexing');
    el.latestBlock.classList.toggle('is-indexed', state === 'indexed');
    el.latestBlock.classList.toggle('is-error', state === 'error');
}

function formatTokenAmount(value, fractionDigits = 0) {
    const bn = ethers.BigNumber.from(value || 0);
    const raw = ethers.utils.formatUnits(bn, 18);
    const [wholePart, fractionalPart = ''] = raw.split('.');
    const groupedWhole = formatIntegerString(wholePart);

    if (fractionDigits <= 0) return groupedWhole;

    const fractional = fractionalPart.padEnd(fractionDigits, '0').slice(0, fractionDigits);
    return `${groupedWhole}.${fractional}`;
}

function formatInteger(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatWalletRatio(wastedWallets, voterWallets) {
    return `${formatInteger(wastedWallets)} / ${formatInteger(voterWallets)}`;
}

function formatWalletTriple(first, second, third) {
    return `${formatInteger(first)} / ${formatInteger(second)} / ${formatInteger(third)}`;
}

function formatCountPercent(numerator, denominator, fractionDigits = 2) {
    const bottom = Number(denominator || 0);
    if (!bottom) return `${formatDecimal(0, fractionDigits)}%`;
    return `${formatDecimal((Number(numerator || 0) / bottom) * 100, fractionDigits)}%`;
}

function formatPercent(numerator, denominator, fractionDigits = 2) {
    const top = ethers.BigNumber.from(numerator || '0');
    const bottom = ethers.BigNumber.from(denominator || '0');
    if (bottom.isZero()) return `${formatDecimal(0, fractionDigits)}%`;
    const scale = ethers.BigNumber.from(10).pow(fractionDigits);
    const scaled = top.mul(100).mul(scale).div(bottom);
    const whole = scaled.div(scale).toString();
    const fraction = scaled.mod(scale).toString().padStart(fractionDigits, '0');
    return fractionDigits > 0 ? `${formatIntegerString(whole)}.${fraction}%` : `${formatIntegerString(whole)}%`;
}

function formatSupplyWithEligibleHtml(snapshotTotalSupply, eligibleDcultSupply, guardianDcultSupply) {
    return `
        <span>${formatTokenAmount(snapshotTotalSupply, 0)} dCULT</span>
        <span class="value-subline">${formatTokenAmount(eligibleDcultSupply, 0)} eligible / ${formatTokenAmount(guardianDcultSupply, 0)} guardian</span>
    `;
}

function formatGuardianSupplyHtml(guardianDcultSupply, guardianHolderWallets) {
    return `
        <span>${formatTokenAmount(guardianDcultSupply, 0)} dCULT</span>
        <span class="value-subline">${formatInteger(guardianHolderWallets)} guardian wallets</span>
    `;
}

function formatTokenTurnoutText(actualVotes, readyDcultSupply, snapshotTotalSupply, rawSnapshotTotalSupply = null) {
    if (rawSnapshotTotalSupply) {
        return `${formatPercent(actualVotes, readyDcultSupply, 2)} eligible ready / ${formatPercent(actualVotes, snapshotTotalSupply, 2)} eligible`;
    }
    return `${formatPercent(actualVotes, readyDcultSupply, 2)} ready / ${formatPercent(actualVotes, snapshotTotalSupply, 2)} supply`;
}

function formatTokenTurnoutHtml(actualVotes, readyDcultSupply, snapshotTotalSupply, rawSnapshotTotalSupply = null) {
    const rawLine = rawSnapshotTotalSupply
        ? `${formatPercent(actualVotes, rawSnapshotTotalSupply, 2)} raw supply`
        : 'token-weight turnout';
    return `
        <span>${formatTokenTurnoutText(actualVotes, readyDcultSupply, snapshotTotalSupply, rawSnapshotTotalSupply)}</span>
        <span class="value-subline">${rawLine}</span>
    `;
}

function formatWalletTurnoutText(votedWallets, readyHolderWallets, holderWallets, rawHolderWallets = null) {
    if (rawHolderWallets !== null && rawHolderWallets !== undefined) {
        return `${formatCountPercent(votedWallets, readyHolderWallets, 2)} eligible ready / ${formatCountPercent(votedWallets, holderWallets, 2)} eligible holder`;
    }
    return `${formatCountPercent(votedWallets, readyHolderWallets, 2)} ready / ${formatCountPercent(votedWallets, holderWallets, 2)} holder`;
}

function formatWalletTurnoutHtml(votedWallets, readyHolderWallets, holderWallets, decimal = false, rawHolderWallets = null) {
    const format = decimal
        ? (value) => formatDecimal(value, 1)
        : (value) => formatInteger(value);
    const rawLine = rawHolderWallets !== null && rawHolderWallets !== undefined
        ? `${formatCountPercent(votedWallets, rawHolderWallets, 2)} raw holder`
        : formatWalletTurnoutText(votedWallets, readyHolderWallets, holderWallets);

    return `
        <span>${format(votedWallets)} / ${format(readyHolderWallets)} / ${format(holderWallets)} wallets</span>
        <span class="value-subline">${formatWalletTurnoutText(votedWallets, readyHolderWallets, holderWallets, rawHolderWallets)}${rawHolderWallets !== null && rawHolderWallets !== undefined ? ` / ${rawLine}` : ''}</span>
    `;
}

function formatDelegateDutyHtml(votedDelegates, activeDelegates, votedDelegators, activeDelegators, decimal = false) {
    const format = decimal
        ? (value) => formatDecimal(value, 1)
        : (value) => formatInteger(value);

    return `
        <span>${format(votedDelegates)} / ${format(activeDelegates)} delegatees</span>
        <span class="value-subline">${format(votedDelegators)} / ${format(activeDelegators)} wallets represented</span>
    `;
}

function formatAbsentDelegateImpactHtml(flipCount, dominanceCount, delegateProposalCount) {
    return `
        <span>${formatInteger(flipCount)} / ${formatInteger(delegateProposalCount)} flip</span>
        <span class="value-subline">${formatInteger(dominanceCount)} / ${formatInteger(delegateProposalCount)} dominate</span>
    `;
}

function formatDecimal(value, fractionDigits) {
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

function formatIntegerString(value) {
    return String(value || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercentValue(value, fractionDigits) {
    return Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

function shortAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function renderAddressLink(address, label = shortAddress(address)) {
    const safeAddress = escapeHtml(address);
    return `
        <span class="address-link" title="${safeAddress}">
            <a class="wallet-address" href="${addressUrl(address)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>
            <button class="copy-action" type="button" data-copy-address="${safeAddress}" title="Copy address" aria-label="Copy address">
                ${renderCopyIcon()}
            </button>
        </span>
    `;
}

function renderCopyIcon() {
    return `
        <svg class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
    `;
}

function avgBigNumber(value, count) {
    const divisor = Math.max(1, Number(count || 0));
    return ethers.BigNumber.from(value || 0).div(divisor);
}

function truncate(value, maxLength) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function shortError(error) {
    const message = String(error?.reason || error?.message || 'RPC unavailable');
    return truncate(message.replace(/\s+/g, ' '), 96);
}

function supportLabel(support) {
    if (support === 1) return 'For';
    if (support === 0) return 'Against';
    if (support === 2) return 'Abstain';
    return `Side ${support}`;
}

function supportSlug(support) {
    if (support === 1) return 'for';
    if (support === 0) return 'against';
    if (support === 2) return 'abstain';
    return 'abstain';
}

function delegateLabel(voter, delegatee) {
    const normalized = String(delegatee || ZERO_ADDRESS);
    if (normalized.toLowerCase() === ZERO_ADDRESS) return 'None';
    if (normalized.toLowerCase() === String(voter).toLowerCase()) return 'Self';
    return shortAddress(normalized);
}

function renderDelegateLabel(voter, delegatee) {
    const normalized = String(delegatee || ZERO_ADDRESS);
    if (normalized.toLowerCase() === ZERO_ADDRESS) return 'None';
    if (normalized.toLowerCase() === String(voter).toLowerCase()) return 'Self';
    return renderAddressLink(normalized);
}

function renderExternalLinkIcon() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d="M224,104a8,8,0,0,1-16,0V59.31l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.69,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/>
        </svg>
    `;
}

function addressUrl(address) {
    return `https://etherscan.io/address/${address}`;
}

function txUrl(txHash) {
    return `https://etherscan.io/tx/${txHash}`;
}

function getCachedBlockTimestamp(blockNumber) {
    const block = Number(blockNumber || 0);
    if (!Number.isFinite(block) || block <= 0) return 0;
    return Number(cache?.blockTimestamps?.[String(block)] || 0);
}

function ensureBlockTimestampForDisplay(blockNumber) {
    const block = Number(blockNumber || 0);
    if (!Number.isFinite(block) || block <= 0 || getCachedBlockTimestamp(block) || pendingBlockTimestampFetches.has(block)) return;
    if (!readProvider?.getBlock) return;

    pendingBlockTimestampFetches.add(block);
    withTimeout(readProvider.getBlock(block), 10_000, `block ${block} timestamp`)
        .then(async (blockData) => {
            const timestamp = Number(blockData?.timestamp || 0);
            if (!timestamp) return;
            cache.blockTimestamps = cache.blockTimestamps && typeof cache.blockTimestamps === 'object' ? cache.blockTimestamps : {};
            cache.blockTimestamps[String(block)] = timestamp;
            await saveCache(cache);
            if (currentRows.length) renderDashboard(currentRows);
        })
        .catch((error) => {
            console.warn(`Unable to fetch timestamp for block ${block}`, error);
        })
        .finally(() => {
            pendingBlockTimestampFetches.delete(block);
        });
}

function formatBlockDate(timestamp) {
    const date = new Date(Number(timestamp || 0) * 1000);
    if (Number.isNaN(date.getTime())) return 'date unavailable';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    });
}

function formatGuardianSinceDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10).replace(/-/g, '/');
}

function addressTopic(address) {
    return ethers.utils.hexZeroPad(ethers.utils.getAddress(address), 32).toLowerCase();
}

function uint256Topic(value) {
    return ethers.utils.hexZeroPad(ethers.BigNumber.from(value || 0).toHexString(), 32).toLowerCase();
}

function topicToAddress(topic) {
    return ethers.utils.getAddress(`0x${String(topic).slice(-40)}`);
}

function eventKey(event) {
    return `${String(event.transactionHash).toLowerCase()}:${Number(event.logIndex || 0)}`;
}

function sortEventsAsc(a, b) {
    return (Number(a.blockNumber || 0) - Number(b.blockNumber || 0))
        || (Number(a.transactionIndex || 0) - Number(b.transactionIndex || 0))
        || (Number(a.logIndex || 0) - Number(b.logIndex || 0));
}

function sortLogsAsc(a, b) {
    return (parseRpcNumber(a.blockNumber) - parseRpcNumber(b.blockNumber))
        || (parseRpcNumber(a.transactionIndex || '0x0') - parseRpcNumber(b.transactionIndex || '0x0'))
        || (parseRpcNumber(a.logIndex || '0x0') - parseRpcNumber(b.logIndex || '0x0'));
}

function compareBigNumbersDesc(a, b) {
    if (a.eq(b)) return 0;
    return a.gt(b) ? -1 : 1;
}

function parseRpcNumber(value) {
    if (typeof value === 'number') return value;
    return Number.parseInt(String(value || '0'), 16);
}

function stringifyBigIntMap(map) {
    const result = new Map();
    for (const [key, value] of map.entries()) {
        result.set(key, (value < 0n ? 0n : value).toString());
    }
    return result;
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

async function mapLimit(items, limit, worker) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            await worker(item);
        }
    });
    await Promise.all(workers);
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function withTimeout(promise, ms, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    });

    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timeoutId)),
        timeout,
    ]);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
