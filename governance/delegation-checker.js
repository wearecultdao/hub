const DCULT_ADDRESS = '0x2d77b594b9bbaed03221f7c63af8c4307432daf1';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DCULT_ABI = Object.freeze([
    'function balanceOf(address account) view returns (uint256)',
    'function delegates(address account) view returns (address)',
    'function checkHighestStaker(uint256 index,address account) view returns (bool)',
]);

const READ_RPCS = Object.freeze([
    { label: 'PublicNode', url: 'https://ethereum.publicnode.com' },
    { label: '1RPC', url: 'https://1rpc.io/eth' },
    { label: 'dRPC', url: 'https://eth.drpc.org' },
    { label: 'Cloudflare', url: 'https://cloudflare-eth.com' },
    { label: 'MevBlocker', url: 'https://rpc.mevblocker.io' },
]);

const THEME_STORAGE_KEY = 'cultDelegationCheckerTheme:v1';
const THEME_SEQUENCE = Object.freeze(['default', 'publish']);
const CHECKER_USED_STORAGE_KEY = 'cultDelegationCheckerUsed:v1';
const CACHE_DB_NAME = 'cultWastedVotesCache';
const CACHE_DB_VERSION = 1;
const CACHE_DB_STORE = 'caches';
const STATIC_CACHE_URL = 'historical-cult-governance-data.json';
const WASTED_VOTES_CACHE_KEYS = Object.freeze([
    'cultWastedVotes:v6',
    'cultWastedVotes:v5',
    'cultWastedVotes:v4',
    'cultWastedVotes:v3',
    'cultWastedVotes:v2',
    'cultWastedVotes:v1',
]);
const CHECK_CONCURRENCY = 2;
const MAX_VOTE_ATTEMPT_DETAILS = 50;
const MAX_DELEGATE_DUTY_DETAILS = 50;

let readProvider = null;
let providerInfo = null;
let dcultContract = null;
let currentRows = [];
let embedHeightPublishQueued = false;

const el = {
    walletInput: document.getElementById('wallet-input'),
    checkBtn: document.getElementById('check-btn'),
    clearBtn: document.getElementById('clear-btn'),
    checkerStatus: document.getElementById('checker-status'),
    providerStatus: document.getElementById('provider-status'),
    answerSection: document.getElementById('answer-section'),
    resultsSection: document.getElementById('results-section'),
    checkedCount: document.getElementById('checked-count'),
    readyCount: document.getElementById('ready-count'),
    needsActionCount: document.getElementById('needs-action-count'),
    noPowerCount: document.getElementById('no-power-count'),
    readinessAnswer: document.getElementById('readiness-answer'),
    totalWastedVotes: document.getElementById('total-wasted-votes'),
    noRightsWaste: document.getElementById('no-rights-waste'),
    thirdPartyMissedWaste: document.getElementById('third-party-missed-waste'),
    delegateDutyMissed: document.getElementById('delegate-duty-missed'),
    checkerResults: document.getElementById('checker-results'),
    shuffleTheme: document.getElementById('shuffle-theme-btn'),
    themeToggle: document.getElementById('theme-toggle'),
};

document.addEventListener('DOMContentLoaded', () => {
    applySavedTheme();
    el.checkBtn.addEventListener('click', checkWallets);
    el.clearBtn.addEventListener('click', clearChecker);
    el.walletInput.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') checkWallets();
    });
    if (el.shuffleTheme) el.shuffleTheme.addEventListener('click', shuffleTheme);
    if (el.themeToggle) el.themeToggle.addEventListener('click', toggleTheme);
    document.addEventListener('click', handleCopyActionClick);
    setupEmbedHeightReporting();
});

async function checkWallets() {
    const entries = parseWalletEntries(el.walletInput.value);
    if (!entries.length) {
        setStatus('Enter at least one wallet address.', true);
        renderRows([]);
        return;
    }

    setBusy(true);
    setStatus(`Checking ${entries.length} wallet${entries.length === 1 ? '' : 's'}...`);

    try {
        await ensureProvider();
        const rows = await mapLimit(entries, CHECK_CONCURRENCY, checkWalletEntry);
        currentRows = rows;
        renderRows(rows);
        markCheckerUsedIfResolved(rows);
        const cacheWarning = getWastedVotesCacheWarning(rows);
        setStatus(
            cacheWarning || `Checked ${rows.length} wallet${rows.length === 1 ? '' : 's'}.`,
            Boolean(cacheWarning),
        );
    } catch (error) {
        console.error(error);
        setStatus(error?.message || 'Delegation check failed.', true);
    } finally {
        setBusy(false);
    }
}

function clearChecker() {
    el.walletInput.value = '';
    currentRows = [];
    renderRows([]);
    setStatus('Ready.');
}

function markCheckerUsedIfResolved(rows) {
    if (!(rows || []).some((row) => row.address && row.status !== 'Error')) return;

    try {
        localStorage.setItem(CHECKER_USED_STORAGE_KEY, '1');
    } catch {
        // This is only a same-browser UX marker; failing to store it should not block results.
    }

    if (window.parent !== window) {
        window.parent.postMessage({ type: 'cult-delegation-checker-used' }, '*');
    }
}

async function ensureProvider() {
    if (readProvider && dcultContract) return;
    el.providerStatus.textContent = 'Connecting...';
    const working = await getWorkingProvider();
    setActiveProvider(working.provider, working.info);
}

async function getWorkingProvider() {
    let lastError = null;

    for (const rpc of READ_RPCS) {
        try {
            const provider = createProvider(rpc);
            const blockNumber = await withTimeout(provider.getBlockNumber(), 8000, `${rpc.label} block number`);
            if (!Number.isFinite(blockNumber) || blockNumber <= 0) throw new Error(`${rpc.label} returned an invalid block number`);
            return { provider, info: rpc };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('No public Ethereum RPC responded.');
}

function createProvider(rpc) {
    return new ethers.providers.StaticJsonRpcProvider(
        rpc.url,
        { chainId: 1, name: 'homestead' },
    );
}

function setActiveProvider(provider, info) {
    readProvider = provider;
    providerInfo = info;
    dcultContract = new ethers.Contract(DCULT_ADDRESS, DCULT_ABI, readProvider);
    el.providerStatus.textContent = providerInfo.label;
}

function getProviderAttemptOrder() {
    if (!providerInfo) return READ_RPCS;
    return [
        providerInfo,
        ...READ_RPCS.filter((rpc) => rpc.url !== providerInfo.url),
    ];
}

function getProviderForRpc(rpc) {
    if (providerInfo?.url === rpc.url && readProvider) return readProvider;
    return createProvider(rpc);
}

async function withRpcFallback(label, worker) {
    await ensureProvider();
    let lastError = null;

    for (const rpc of getProviderAttemptOrder()) {
        const provider = getProviderForRpc(rpc);
        const contract = new ethers.Contract(DCULT_ADDRESS, DCULT_ABI, provider);

        try {
            const result = await withTimeout(worker({ provider, contract, rpc }), 12000, `${rpc.label} ${label}`);
            if (providerInfo?.url !== rpc.url) setActiveProvider(provider, rpc);
            return result;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error(`No public Ethereum RPC completed ${label}.`);
}

async function checkWalletEntry(entry) {
    try {
        const resolved = await resolveWallet(entry);
        if (!resolved.address) {
            return {
                input: entry,
                address: '',
                status: 'Invalid',
                statusClass: 'status-error',
                votingRights: 'Invalid Address',
                votingRightsClass: 'value-against',
                delegatee: '',
                dCultBalance: ethers.BigNumber.from(0),
                isGuardian: false,
                error: resolved.error || 'Invalid wallet address.',
                cachedWaste: emptyWasteBreakdown(),
            };
        }

        const [dCultBalance, delegatee, isGuardian] = await withRpcFallback(
            `wallet check ${shortAddress(resolved.address)}`,
            ({ contract }) => Promise.all([
                contract.balanceOf(resolved.address),
                contract.delegates(resolved.address),
                contract.checkHighestStaker(0, resolved.address).catch(() => false),
            ]),
        );

        const normalizedDelegatee = ethers.utils.getAddress(delegatee);
        const isSelfDelegated = normalizedDelegatee.toLowerCase() === resolved.address.toLowerCase();
        const hasDcult = !dCultBalance.isZero();
        const hasNoDelegate = normalizedDelegatee.toLowerCase() === ZERO_ADDRESS;
        const votingRights = getVotingRights({ isGuardian, hasDcult });
        const attention = getAttentionState({ isSelfDelegated, hasDcult, isGuardian, hasNoDelegate });
        const cachedWaste = await getCachedWastedVoteBreakdownForAddress(resolved.address);
        const cachedDelegateDuty = await getCachedDelegateDutyForAddress(resolved.address);

        return {
            input: entry,
            address: resolved.address,
            ens: resolved.ens,
            status: attention.status,
            statusClass: attention.statusClass,
            rowClass: attention.rowClass,
            nextStep: attention.nextStep,
            votingRights: votingRights.label,
            votingRightsClass: votingRights.valueClass,
            delegatee: normalizedDelegatee,
            dCultBalance,
            isGuardian,
            hasDcult,
            isSelfDelegated,
            needsDelegation: attention.needsDelegation,
            isReadyToVote: attention.isReadyToVote,
            currentState: attention.currentState,
            cachedWaste,
            cachedDelegateDuty,
        };
    } catch (error) {
        return {
            input: entry,
            address: ethers.utils.isAddress(entry) ? ethers.utils.getAddress(entry) : '',
            status: 'Error',
            statusClass: 'status-error',
            votingRights: 'Error',
            votingRightsClass: 'value-against',
            delegatee: '',
            dCultBalance: ethers.BigNumber.from(0),
            isGuardian: false,
            error: shortError(error),
            cachedWaste: emptyWasteBreakdown(),
            cachedDelegateDuty: emptyDelegateDutyBreakdown(),
        };
    }
}

async function resolveWallet(entry) {
    const value = String(entry || '').trim();
    if (ethers.utils.isAddress(value)) {
        const address = ethers.utils.getAddress(value);
        if (address.toLowerCase() === ZERO_ADDRESS) {
            return { address: '', ens: '', error: 'Zero address is not a wallet.' };
        }
        return { address, ens: '' };
    }

    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) {
        const address = await resolveEnsName(value);
        if (address && ethers.utils.isAddress(address)) {
            return { address: ethers.utils.getAddress(address), ens: value };
        }
        return { address: '', ens: value, error: 'ENS did not resolve.' };
    }

    return { address: '', ens: '', error: 'Invalid wallet address.' };
}

async function resolveEnsName(name) {
    return withRpcFallback(
        `ENS resolve ${name}`,
        ({ provider }) => provider.resolveName(name),
    ).catch(() => null);
}

function parseWalletEntries(value) {
    const seen = new Set();
    return String(value || '')
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => {
            const key = entry.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function getVotingRights({ isGuardian, hasDcult }) {
    if (isGuardian) return { label: 'Guardian', valueClass: 'value-for' };
    if (hasDcult) return { label: 'The Many', valueClass: 'value-for' };
    return { label: 'None (No dCULT)', valueClass: '' };
}

function getAttentionState({ isSelfDelegated, hasDcult, isGuardian, hasNoDelegate }) {
    if (isGuardian) {
        return {
            status: 'Guardian Rights',
            statusClass: 'status-active',
            rowClass: 'is-ready',
            nextStep: 'No delegation action needed for guardian rights',
            currentState: 'Guardian voting rights active',
            needsDelegation: false,
            isReadyToVote: true,
        };
    }

    if (isSelfDelegated) {
        return {
            status: hasDcult ? 'Ready to Vote' : 'No Voting Rights',
            statusClass: hasDcult ? 'status-active' : 'status-muted',
            rowClass: hasDcult ? 'is-ready' : 'is-muted',
            nextStep: hasDcult ? 'No action needed' : 'Stake dCULT to have voting power',
            currentState: hasDcult ? 'Self-delegated' : 'Self-delegated, no dCULT',
            needsDelegation: false,
            isReadyToVote: hasDcult,
        };
    }

    if (hasDcult) {
        const delegatedElsewhere = !hasNoDelegate;
        return {
            status: hasNoDelegate ? 'Needs Delegation' : 'Delegated Elsewhere',
            statusClass: delegatedElsewhere ? 'status-delegated' : 'status-attention',
            rowClass: 'is-attention',
            nextStep: delegatedElsewhere
                ? 'Delegate to self before voting directly, or make sure the delegatee votes'
                : 'Delegate this wallet to itself before voting',
            currentState: delegatedElsewhere ? 'Voting power sits with a delegate' : 'No delegate set',
            needsDelegation: true,
            isReadyToVote: false,
        };
    }

    return {
        status: 'No Voting Rights',
        statusClass: 'status-muted',
        rowClass: 'is-muted',
        nextStep: 'Stake dCULT first',
        currentState: 'No dCULT',
        needsDelegation: false,
        isReadyToVote: false,
    };
}

function renderRows(rows) {
    const hasRows = Boolean(rows.length);
    el.answerSection.hidden = !hasRows;
    el.resultsSection.hidden = !hasRows;
    renderSummary(rows);

    if (!rows.length) {
        el.checkerResults.innerHTML = '<p class="empty-state">No wallets checked yet.</p>';
        publishEmbedHeight();
        return;
    }

    el.checkerResults.innerHTML = getDisplayRows(rows).map(renderRow).join('');
    publishEmbedHeight();
}

function setupEmbedHeightReporting() {
    if (window.parent === window) return;

    window.addEventListener('load', publishEmbedHeight);
    document.addEventListener('toggle', publishEmbedHeight, true);

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(publishEmbedHeight);
        observer.observe(document.body);
        const page = document.querySelector('.checker-embed-page');
        if (page) observer.observe(page);
    }

    publishEmbedHeight();
}

function publishEmbedHeight() {
    if (window.parent === window) return;
    if (embedHeightPublishQueued) return;
    embedHeightPublishQueued = true;

    requestAnimationFrame(() => {
        embedHeightPublishQueued = false;
        postEmbedHeight();
        setTimeout(postEmbedHeight, 80);
    });
}

function postEmbedHeight() {
    if (window.parent === window) return;
    const page = document.querySelector('.checker-embed-page');
    const height = page
        ? page.getBoundingClientRect().height + 2
        : Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0);
    window.parent.postMessage({ type: 'cult-checker-embed-height', height }, '*');
}

function getDisplayRows(rows) {
    return rows
        .map((row, index) => ({ row, index }))
        .sort(compareDisplayRows)
        .map((entry) => entry.row);
}

function compareDisplayRows(a, b) {
    const groupA = getDisplayRowGroup(a.row);
    const groupB = getDisplayRowGroup(b.row);
    if (groupA !== groupB) return groupA - groupB;

    const balanceOrder = compareBigNumbersDesc(
        getRowDcultBalance(a.row),
        getRowDcultBalance(b.row),
    );
    if (balanceOrder !== 0) return balanceOrder;

    return a.index - b.index;
}

function getDisplayRowGroup(row) {
    if (row?.error) return 2;
    const balance = getRowDcultBalance(row);
    if (row?.isGuardian || !balance.isZero()) return 0;
    return 1;
}

function getRowDcultBalance(row) {
    try {
        return ethers.BigNumber.from(row?.dCultBalance || 0);
    } catch {
        return ethers.BigNumber.from(0);
    }
}

function compareBigNumbersDesc(a, b) {
    if (a.eq(b)) return 0;
    return a.gt(b) ? -1 : 1;
}

function renderSummary(rows) {
    const validRows = rows.filter((row) => row.address && !row.error);
    const readyRows = validRows.filter((row) => row.isReadyToVote);
    const needsActionRows = validRows.filter((row) => row.needsDelegation);
    const noPowerRows = validRows.filter((row) => !row.hasDcult && !row.isGuardian);
    const wasteBreakdown = sumCachedWasteBreakdowns(validRows.map((row) => row.cachedWaste));
    const dutyBreakdown = sumCachedDelegateDutyBreakdowns(validRows.map((row) => row.cachedDelegateDuty));

    renderReadinessAnswer(rows, validRows, readyRows, needsActionRows, noPowerRows);

    el.checkedCount.textContent = formatInteger(validRows.length);
    el.readyCount.textContent = formatInteger(readyRows.length);
    el.needsActionCount.textContent = formatInteger(needsActionRows.length);
    el.noPowerCount.textContent = formatInteger(noPowerRows.length);
    if (validRows.length && wasteBreakdown.cacheVisible === false) {
        el.totalWastedVotes.textContent = 'Cache unavailable';
        el.noRightsWaste.textContent = getCacheUnavailableText();
        el.thirdPartyMissedWaste.textContent = getCacheUnavailableText();
        el.delegateDutyMissed.textContent = dutyBreakdown.cacheVisible === false ? getCacheUnavailableText() : `${formatTokenAmount(dutyBreakdown.missed, 0)} dCULT`;
        return;
    }

    el.totalWastedVotes.textContent = `${formatTokenAmount(wasteBreakdown.total, 0)} dCULT`;
    el.noRightsWaste.textContent = `${formatTokenAmount(wasteBreakdown.noRights, 0)} dCULT`;
    el.thirdPartyMissedWaste.textContent = `${formatTokenAmount(wasteBreakdown.delegateMissed, 0)} dCULT`;
    el.delegateDutyMissed.textContent = dutyBreakdown.cacheVisible === false
        ? getCacheUnavailableText()
        : `${formatTokenAmount(dutyBreakdown.missed, 0)} dCULT`;
}

function renderReadinessAnswer(rows, validRows, readyRows, needsActionRows, noPowerRows) {
    if (!rows.length) {
        el.readinessAnswer.className = 'checker-verdict-banner is-neutral';
        el.readinessAnswer.innerHTML = '';
        return;
    }

    if (!validRows.length) {
        setReadinessAnswer({
            className: 'is-attention',
            statusClass: 'status-attention',
            status: 'Invalid',
            title: 'No valid wallet was checked.',
            body: 'Enter a valid wallet address or ENS name.',
        });
        return;
    }

    if (validRows.length === 1) {
        const row = validRows[0];
        const roleFlags = getDelegateDutyRoleFlags(row);
        if (row.isReadyToVote) {
            setReadinessAnswer({
                className: 'is-ready',
                statusClass: row.statusClass || 'status-active',
                status: row.status || 'Ready to Vote',
                title: 'This wallet is ready to vote.',
                body: `${row.votingRights}. ${formatTokenAmount(row.dCultBalance || 0, 2)} dCULT.`,
                roleFlags,
            });
            return;
        }

        if (!row.hasDcult && !row.isGuardian) {
            setReadinessAnswer({
                className: 'is-neutral',
                statusClass: row.statusClass || 'status-muted',
                status: 'No Vote Power',
                title: 'This wallet has no dCULT voting rights.',
                body: roleFlags.length
                    ? 'No direct voting rights now. Cached history shows this wallet has delegated-power history tracked below.'
                    : 'No delegation action is needed unless this wallet should hold and vote dCULT.',
                roleFlags,
            });
            return;
        }

        setReadinessAnswer({
            className: 'is-attention',
            statusClass: row.statusClass || 'status-attention',
            status: row.status || 'Not Ready',
            title: 'This wallet is not ready to vote directly.',
            body: row.nextStep || 'Action needed before voting.',
            roleFlags,
        });
        return;
    }

    if (readyRows.length === validRows.length) {
        setReadinessAnswer({
            className: 'is-ready',
            statusClass: 'status-active',
            status: 'Ready',
            title: 'All checked wallets are ready to vote.',
            body: `${formatInteger(readyRows.length)} / ${formatInteger(validRows.length)} wallets ready.`,
        });
        return;
    }

    if (!needsActionRows.length) {
        if (readyRows.length) {
            setReadinessAnswer({
                className: 'is-ready',
                statusClass: 'status-active',
                status: 'Ready',
                title: `${formatInteger(readyRows.length)} / ${formatInteger(validRows.length)} checked wallets are ready to vote.`,
                body: `${formatInteger(noPowerRows.length)} wallet${noPowerRows.length === 1 ? '' : 's'} have no dCULT voting rights and do not need delegation action unless they should participate.`,
            });
            return;
        }

        setReadinessAnswer({
            className: 'is-neutral',
            statusClass: 'status-muted',
            status: 'No Vote Power',
            title: `${formatInteger(noPowerRows.length)} checked wallet${noPowerRows.length === 1 ? '' : 's'} have no dCULT voting rights.`,
            body: `${formatInteger(readyRows.length)} / ${formatInteger(validRows.length)} ready. No delegation action is needed for empty or inactive wallets.`,
        });
        return;
    }

    setReadinessAnswer({
        className: 'is-attention',
        statusClass: 'status-attention',
        status: 'Action Needed',
        title: `${formatInteger(needsActionRows.length)} checked wallet${needsActionRows.length === 1 ? '' : 's'} need delegation attention.`,
        body: `${formatInteger(readyRows.length)} / ${formatInteger(validRows.length)} ready. ${formatInteger(needsActionRows.length)} need delegation. ${formatInteger(noPowerRows.length)} have no dCULT voting rights.`,
    });
}

function setReadinessAnswer({ className, statusClass, status, title, body, roleFlags = [] }) {
    el.readinessAnswer.className = `checker-verdict-banner ${className || 'is-neutral'}`;
    el.readinessAnswer.innerHTML = `
        <span class="checker-status-flags">
            <span class="status-flag ${statusClass || 'status-muted'}">${escapeHtml(status)}</span>
            ${renderDelegateDutyRoleFlags(roleFlags)}
        </span>
        <span class="checker-verdict-copy">
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(body)}</span>
        </span>
    `;
}

function getDelegateDutyRoleFlags(row) {
    const events = Array.isArray(row?.cachedDelegateDuty?.events) ? row.cachedDelegateDuty.events : [];
    const roles = new Set(events.map((event) => event?.role).filter(Boolean));
    const flags = [];
    if (roles.has('delegator')) {
        flags.push({ label: 'Delegator Wallet', className: 'status-delegated' });
    }
    if (roles.has('delegatee')) {
        flags.push({ label: 'Delegatee Wallet', className: 'status-delegated' });
    }
    return flags;
}

function renderDelegateDutyRoleFlags(flags) {
    return (flags || [])
        .map((flag) => `<span class="status-flag ${flag.className || 'status-muted'}">${escapeHtml(flag.label)}</span>`)
        .join('');
}

async function getCachedWastedVoteBreakdownForAddress(address) {
    if (!address) return emptyWasteBreakdown();
    return getCachedWastedVoteBreakdownForAddressSet(new Set([String(address).toLowerCase()]));
}

async function getCachedDelegateDutyForAddress(address) {
    if (!address) return emptyDelegateDutyBreakdown();
    return getCachedDelegateDutyForAddressSet(new Set([String(address).toLowerCase()]));
}

async function getCachedWastedVoteBreakdownForAddressSet(checkedAddresses) {
    const totals = emptyWasteBreakdown();
    if (!checkedAddresses.size) return totals;

    const cache = await loadWastedVotesCache();
    if (!cache?.proposals || typeof cache.proposals !== 'object') {
        totals.cacheVisible = false;
        return totals;
    }

    for (const proposal of Object.values(cache.proposals)) {
        if (isCanceledCachedProposal(proposal)) continue;
        if (!Array.isArray(proposal?.zeroWallets)) continue;
        const delegateVotes = getEffectiveVoteByVoter(proposal.voteEvents || []);
        for (const wallet of proposal.zeroWallets) {
            const voter = String(wallet?.voter || '').toLowerCase();
            if (!checkedAddresses.has(voter)) continue;
            const snapshotBalance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
            const representationStatus = getCachedRepresentationStatus(wallet, delegateVotes);
            totals.events.push(buildCachedVoteAttemptDetail(proposal, wallet, delegateVotes, representationStatus));
            if (!snapshotBalance.isZero() && representationStatus === 'wasted') {
                totals.total = totals.total.add(snapshotBalance);
                if (getCachedWasteReason(wallet) === 'delegate_not_voted') {
                    totals.delegateMissed = totals.delegateMissed.add(snapshotBalance);
                } else {
                    totals.noRights = totals.noRights.add(snapshotBalance);
                }
            }
        }
    }

    return totals;
}

async function getCachedDelegateDutyForAddressSet(checkedAddresses) {
    const totals = emptyDelegateDutyBreakdown();
    if (!checkedAddresses.size) return totals;

    const cache = await loadWastedVotesCache();
    if (!cache?.proposals || typeof cache.proposals !== 'object') {
        totals.cacheVisible = false;
        return totals;
    }

    for (const proposal of Object.values(cache.proposals)) {
        if (isCanceledCachedProposal(proposal)) continue;
        const duty = proposal?.delegateDuty;
        if (!duty || typeof duty !== 'object') continue;
        for (const delegateRow of duty.absentDelegates || []) {
            collectDelegateDutyDetails(totals, proposal, delegateRow, 'absent', checkedAddresses);
        }
        for (const delegateRow of duty.votedDelegates || []) {
            collectDelegateDutyDetails(totals, proposal, delegateRow, 'voted', checkedAddresses);
        }
    }

    return totals;
}

function isCanceledCachedProposal(proposal) {
    if (isCanceledAfterPassingCachedProposal(proposal)) return false;

    const rawState = proposal?.proposal?.state ?? proposal?.state;
    const state = Number(rawState);
    if (Number.isFinite(state) && state === 2) return true;

    const stateName = String(proposal?.stateName || proposal?.proposal?.stateName || '').toLowerCase();
    if (stateName === 'canceled' || stateName === 'cancelled') return true;

    return Boolean(proposal?.proposal?.canceled || proposal?.canceled);
}

function isCanceledAfterPassingCachedProposal(proposal) {
    const proposalData = proposal?.proposal || proposal || {};
    const state = Number(proposalData.state ?? proposal?.state);
    if (state !== 2 || proposalData.canceled === false) return false;

    const forVotes = ethers.BigNumber.from(proposalData.forVotes || '0');
    const againstVotes = ethers.BigNumber.from(proposalData.againstVotes || '0');
    const eta = ethers.BigNumber.from(proposalData.eta || '0');
    return forVotes.gt(againstVotes) && eta.isZero();
}

function collectDelegateDutyDetails(totals, proposal, delegateRow, dutyStatus, checkedAddresses) {
    const delegateeAddress = String(delegateRow?.delegatee || '').toLowerCase();
    if (delegateeAddress && checkedAddresses.has(delegateeAddress)) {
        const delegatedPower = ethers.BigNumber.from(delegateRow.delegatedPower || '0');
        totals.events.push({
            proposalId: proposal?.id ?? proposal?.proposal?.id ?? '',
            title: proposal?.title || '',
            role: 'delegatee',
            delegatee: delegateRow.delegatee || ZERO_ADDRESS,
            delegatedPower: delegatedPower.toString(),
            delegatorCount: Number(delegateRow.delegatorCount || delegateRow.delegators?.length || 0),
            delegators: buildDelegateDutyDelegatorDetails(proposal, delegateRow),
            dutyStatus,
            support: dutyStatus === 'voted' ? Number(delegateRow.support) : null,
            votes: dutyStatus === 'voted' ? String(delegateRow.votes || '0') : '0',
        });

        totals.total = totals.total.add(delegatedPower);
        if (dutyStatus === 'voted') {
            totals.fulfilled = totals.fulfilled.add(delegatedPower);
            totals.fulfilledCount += 1;
        } else {
            totals.missed = totals.missed.add(delegatedPower);
            totals.missedCount += 1;
        }
    }

    for (const delegator of delegateRow?.delegators || []) {
        const delegatorAddress = String(delegator?.delegator || '').toLowerCase();
        if (!checkedAddresses.has(delegatorAddress)) continue;

        const balance = ethers.BigNumber.from(delegator.balance || '0');
        totals.events.push({
            proposalId: proposal?.id ?? proposal?.proposal?.id ?? '',
            title: proposal?.title || '',
            role: 'delegator',
            delegatee: delegateRow.delegatee || ZERO_ADDRESS,
            delegatedPower: balance.toString(),
            delegatorCount: 1,
            delegators: [],
            dutyStatus,
            support: dutyStatus === 'voted' ? Number(delegateRow.support) : null,
            votes: dutyStatus === 'voted' ? String(delegateRow.votes || '0') : '0',
        });

        totals.total = totals.total.add(balance);
        if (dutyStatus === 'voted') {
            totals.fulfilled = totals.fulfilled.add(balance);
            totals.fulfilledCount += 1;
        } else {
            totals.missed = totals.missed.add(balance);
            totals.missedCount += 1;
        }
    }
}

function buildDelegateDutyDelegatorDetails(proposal, delegateRow) {
    const attemptsByVoter = new Map();
    for (const wallet of proposal?.zeroWallets || []) {
        const voter = String(wallet?.voter || '').toLowerCase();
        if (!voter || attemptsByVoter.has(voter)) continue;
        attemptsByVoter.set(voter, wallet);
    }

    return (delegateRow?.delegators || []).map((delegator) => {
        const delegatorAddress = String(delegator?.delegator || '');
        const attempt = attemptsByVoter.get(delegatorAddress.toLowerCase());
        return {
            delegator: delegatorAddress,
            balance: String(delegator?.balance || '0'),
            attempted: Boolean(attempt),
            support: attempt ? Number(attempt.support) : null,
            source: attempt?.source || '',
            transactionHash: attempt?.transactionHash || '',
        };
    });
}

function emptyWasteBreakdown() {
    return {
        total: ethers.BigNumber.from(0),
        noRights: ethers.BigNumber.from(0),
        delegateMissed: ethers.BigNumber.from(0),
        cacheVisible: true,
        events: [],
    };
}

function emptyDelegateDutyBreakdown() {
    return {
        total: ethers.BigNumber.from(0),
        missed: ethers.BigNumber.from(0),
        fulfilled: ethers.BigNumber.from(0),
        missedCount: 0,
        fulfilledCount: 0,
        cacheVisible: true,
        events: [],
    };
}

function sumCachedWasteBreakdowns(breakdowns) {
    return (breakdowns || []).reduce((acc, breakdown) => {
        const safe = breakdown || emptyWasteBreakdown();
        acc.total = acc.total.add(safe.total || 0);
        acc.noRights = acc.noRights.add(safe.noRights || 0);
        acc.delegateMissed = acc.delegateMissed.add(safe.delegateMissed || 0);
        acc.cacheVisible = acc.cacheVisible && safe.cacheVisible !== false;
        acc.events = acc.events.concat(safe.events || []);
        return acc;
    }, emptyWasteBreakdown());
}

function sumCachedDelegateDutyBreakdowns(breakdowns) {
    return (breakdowns || []).reduce((acc, breakdown) => {
        const safe = breakdown || emptyDelegateDutyBreakdown();
        acc.total = acc.total.add(safe.total || 0);
        acc.missed = acc.missed.add(safe.missed || 0);
        acc.fulfilled = acc.fulfilled.add(safe.fulfilled || 0);
        acc.missedCount += Number(safe.missedCount || 0);
        acc.fulfilledCount += Number(safe.fulfilledCount || 0);
        acc.cacheVisible = acc.cacheVisible && safe.cacheVisible !== false;
        acc.events = acc.events.concat(safe.events || []);
        return acc;
    }, emptyDelegateDutyBreakdown());
}

function getCombinedMissedBreakdown(wasteBreakdown, delegateDuty) {
    const directEvents = Array.isArray(wasteBreakdown?.events) ? wasteBreakdown.events : [];
    const dutyEvents = Array.isArray(delegateDuty?.events) ? delegateDuty.events : [];
    const cacheVisible = wasteBreakdown?.cacheVisible !== false && delegateDuty?.cacheVisible !== false;
    const directByProposal = new Map();
    let total = ethers.BigNumber.from(0);

    for (const event of directEvents) {
        if (event?.representationStatus !== 'wasted') continue;
        const amount = ethers.BigNumber.from(event.snapshotBalance || '0');
        if (amount.isZero()) continue;
        const key = getMissedProposalKey(event);
        const current = directByProposal.get(key) || ethers.BigNumber.from(0);
        if (amount.gt(current)) directByProposal.set(key, amount);
    }

    for (const amount of directByProposal.values()) {
        total = total.add(amount);
    }

    if (!directEvents.length && wasteBreakdown?.total) {
        total = ethers.BigNumber.from(wasteBreakdown.total || 0);
    }

    for (const event of dutyEvents) {
        if (event?.dutyStatus === 'voted') continue;
        const amount = ethers.BigNumber.from(event.delegatedPower || '0');
        if (amount.isZero()) continue;

        if (event.role === 'delegator') {
            const directAmount = directByProposal.get(getMissedProposalKey(event)) || ethers.BigNumber.from(0);
            if (directAmount.isZero()) {
                total = total.add(amount);
            } else if (amount.gt(directAmount)) {
                total = total.add(amount.sub(directAmount));
            }
            continue;
        }

        total = total.add(amount);
    }

    if (!dutyEvents.length && delegateDuty?.missed) {
        total = total.add(delegateDuty.missed || 0);
    }

    return { total, cacheVisible };
}

function getMissedProposalKey(event) {
    return String(event?.proposalId || '').trim() || 'unknown';
}

function buildCachedVoteAttemptDetail(proposal, wallet, delegateVotes, representationStatus) {
    const voter = String(wallet?.voter || '');
    const snapshotDelegate = String(wallet?.snapshotDelegate || ZERO_ADDRESS);
    const delegateVote = isThirdPartyDelegate(voter, snapshotDelegate)
        ? delegateVotes.get(snapshotDelegate.toLowerCase())
        : null;
    const delegateVoted = Boolean(delegateVote && !ethers.BigNumber.from(delegateVote.votes || '0').isZero());

    return {
        proposalId: proposal?.id ?? proposal?.proposal?.id ?? '',
        title: proposal?.title || '',
        support: Number(wallet?.support),
        snapshotBalance: String(wallet?.snapshotBalance || '0'),
        snapshotDelegate,
        transactionHash: wallet?.transactionHash || '',
        source: wallet?.source || 'VoteCast',
        representationStatus,
        wasteReason: representationStatus === 'wasted' ? getCachedWasteReason(wallet) : 'none',
        delegateVoted,
        delegateSupport: delegateVoted ? Number(delegateVote.support) : null,
        delegateVotes: delegateVoted ? String(delegateVote.votes || '0') : '0',
        delegateVoter: delegateVoted ? String(delegateVote.voter || snapshotDelegate) : '',
    };
}

function getWastedVotesCacheWarning(rows = currentRows) {
    const validRows = rows.filter((row) => row.address && !row.error);
    if (!validRows.length) return '';
    const hasMissingCache = validRows.some((row) => row.cachedWaste?.cacheVisible === false);
    if (!hasMissingCache) return '';
    if (window.location.protocol === 'file:') {
        return 'Checked wallets. Open this page through the local server to read cached missed-vote history.';
    }
    return 'Checked wallets. No wasted-votes index cache is visible yet. Open Wasted Votes first and let it index.';
}

function getCacheUnavailableText() {
    if (window.location.protocol === 'file:') return 'Use the local server URL, not file://';
    return 'Run the Wasted Votes index first';
}

function getCachedRepresentationStatus(wallet, delegateVotes) {
    const snapshotBalance = ethers.BigNumber.from(wallet.snapshotBalance || '0');
    if (snapshotBalance.isZero()) return 'empty';

    if (wallet.representationStatus) return wallet.representationStatus;

    const voter = String(wallet.voter || '');
    const snapshotDelegate = String(wallet.snapshotDelegate || ZERO_ADDRESS);
    if (isThirdPartyDelegate(voter, snapshotDelegate)) {
        const delegateVote = delegateVotes.get(snapshotDelegate.toLowerCase());
        if (delegateVote && !ethers.BigNumber.from(delegateVote.votes || '0').isZero()) {
            return Number(delegateVote.support) === Number(wallet.support) ? 'represented' : 'misaligned';
        }
    }

    return 'wasted';
}

function getCachedWasteReason(wallet) {
    if (wallet?.wasteReason === 'delegate_not_voted' || wallet?.wasteReason === 'no_voting_rights') {
        return wallet.wasteReason;
    }

    const voter = String(wallet?.voter || '');
    const snapshotDelegate = String(wallet?.snapshotDelegate || ZERO_ADDRESS);
    return isThirdPartyDelegate(voter, snapshotDelegate) ? 'delegate_not_voted' : 'no_voting_rights';
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

async function loadWastedVotesCache() {
    const candidates = [];
    for (const key of WASTED_VOTES_CACHE_KEYS) {
        const indexedCache = await readCacheFromIndexedDb(key);
        addWastedCacheCandidate(candidates, indexedCache, 'indexed', key);

        try {
            const cache = JSON.parse(localStorage.getItem(key) || 'null');
            addWastedCacheCandidate(candidates, cache, 'local', key);
        } catch {
            // Try the next cache version.
        }
    }

    if (candidates.length) {
        candidates.sort(compareWastedCacheCandidates);
        return candidates[0].cache;
    }

    // Only seed an empty browser. Existing Governance history is updated by the
    // shared, user-confirmed flow after its automatic JSON safety backup.
    const staticCache = await loadStaticWastedVotesCache();
    if (!staticCache) return null;
    await writeCacheToIndexedDb(getCacheKeyForCache(staticCache), staticCache).catch(() => {});
    return staticCache;
}

function addWastedCacheCandidate(candidates, cache, source, key) {
    if (!cache?.proposals || typeof cache.proposals !== 'object') return;
    const proposalCount = Object.keys(cache.proposals).length;
    if (!proposalCount) return;
    candidates.push({
        cache,
        key: key || getCacheKeyForCache(cache),
        source,
        score: getCacheUsefulnessScore(cache),
        proposalCount,
        updatedAt: Number(cache.updatedAt || 0),
    });
}

function compareWastedCacheCandidates(a, b) {
    return (b.score - a.score)
        || (b.proposalCount - a.proposalCount)
        || (b.updatedAt - a.updatedAt);
}

function getCacheKeyForCache(cache) {
    const version = Number(cache?.version);
    if (Number.isFinite(version) && version > 0) return `cultWastedVotes:v${version}`;
    return WASTED_VOTES_CACHE_KEYS[0];
}

async function loadStaticWastedVotesCache() {
    if (window.location.protocol === 'file:') return null;

    try {
        const response = await fetch(STATIC_CACHE_URL, { cache: 'no-cache' });
        if (!response.ok) return null;
        const payload = await response.json();
        const cache = payload?.cache || payload;
        if (!cache?.proposals || typeof cache.proposals !== 'object') return null;
        return cache;
    } catch {
        return null;
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

function getCacheUsefulnessScore(cache) {
    return Object.values(cache?.proposals || {}).reduce((score, proposal) => {
        let nextScore = score + 1;
        if (Array.isArray(proposal?.zeroWallets)) nextScore += 2;
        if (hasUsefulDelegateDuty(proposal)) nextScore += 20;
        if (proposal?.snapshotHolderCount !== undefined && proposal?.snapshotReadyDcultSupply !== undefined) nextScore += 5;
        if (proposal?.snapshotGuardianDcultSupply !== undefined) nextScore += 2;
        return nextScore;
    }, 0);
}

function hasUsefulDelegateDuty(proposal) {
    const duty = proposal?.delegateDuty;
    if (!duty || typeof duty !== 'object') return false;
    return proposal?.delegateDutyIndexed === true
        || Number(duty.activeDelegateCount || 0) > 0
        || (Array.isArray(duty.absentDelegates) && duty.absentDelegates.length > 0)
        || (Array.isArray(duty.votedDelegates) && duty.votedDelegates.length > 0);
}

function renderRow(row) {
    if (row.error) {
        return `
            <article class="checker-row is-error">
                <div class="checker-wallet">
                    <span class="wallet-address">${escapeHtml(row.input)}</span>
                    <span class="event-meta">${escapeHtml(row.error)}</span>
                </div>
                <span class="status-flag ${row.statusClass}">${escapeHtml(row.status)}</span>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Needed</span>
                    <span class="wallet-detail-value ${row.votingRightsClass || ''}">${escapeHtml(row.votingRights)}</span>
                </div>
            </article>
        `;
    }

    const delegationLabel = getDelegationLabelHtml(row);
    const wasteBreakdown = row.cachedWaste || emptyWasteBreakdown();
    const delegateDuty = row.cachedDelegateDuty || emptyDelegateDutyBreakdown();
    const cacheVisible = wasteBreakdown.cacheVisible !== false;
    const dutyCacheVisible = delegateDuty.cacheVisible !== false;
    const totalMissed = getCombinedMissedBreakdown(wasteBreakdown, delegateDuty);
    const historyDetails = renderWalletHistoryDetails(wasteBreakdown, delegateDuty, cacheVisible, dutyCacheVisible);
    const roleFlags = getDelegateDutyRoleFlags(row);

    return `
        <div class="checker-wallet-entry">
            <article class="checker-row ${row.rowClass || ''}">
                <div class="checker-wallet">
                    ${renderAddressLink(row.address)}
                    <span class="event-meta">${row.ens ? escapeHtml(row.ens) : 'Wallet'}</span>
                </div>
                <div class="checker-status-cell">
                    <span class="checker-status-flags">
                        <span class="status-flag ${row.statusClass}">${escapeHtml(row.status)}</span>
                        ${renderDelegateDutyRoleFlags(roleFlags)}
                    </span>
                    <span class="event-meta">${delegationLabel}</span>
                </div>
                <div class="wallet-detail checker-needed-detail">
                    <span class="wallet-detail-label">Needed</span>
                    <span class="wallet-detail-value">${escapeHtml(row.nextStep || 'No action needed')}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Voting Rights</span>
                    <span class="wallet-detail-value ${row.votingRightsClass || ''}">${escapeHtml(row.votingRights)}</span>
                    <span class="value-subline">${formatTokenAmount(row.dCultBalance || 0, 2)} dCULT</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Total Missed</span>
                    <span class="wallet-detail-value">${escapeHtml(totalMissed.cacheVisible ? `${formatTokenAmount(totalMissed.total, 0)} dCULT` : 'Cache unavailable')}</span>
                    <span class="value-subline">direct or delegated</span>
                </div>
                <a class="tx-icon-link" href="${addressUrl(row.address)}" target="_blank" rel="noopener noreferrer" title="View wallet on Etherscan" aria-label="View wallet on Etherscan">
                    ${renderExternalLinkIcon()}
                </a>
            </article>
            ${historyDetails}
        </div>
    `;
}

function renderWalletHistoryDetails(wasteBreakdown, delegateDuty, cacheVisible, dutyCacheVisible) {
    const totalMissed = getCombinedMissedBreakdown(wasteBreakdown, delegateDuty);
    const totalMissedValue = totalMissed.cacheVisible
        ? `${formatTokenAmount(totalMissed.total, 0)} dCULT`
        : 'Cache unavailable';
    const wasteValue = cacheVisible ? `${formatTokenAmount(wasteBreakdown.total, 0)} dCULT` : 'Cache unavailable';
    const wasteSubline = cacheVisible
        ? `No-rights attempts ${formatTokenAmount(wasteBreakdown.noRights, 0)} dCULT / delegatee-missed attempts ${formatTokenAmount(wasteBreakdown.delegateMissed, 0)} dCULT`
        : getCacheUnavailableText();
    const dutyValue = dutyCacheVisible
        ? `${formatInteger(delegateDuty.missedCount)} missed / ${formatInteger(delegateDuty.events.length)} tracked`
        : 'Cache unavailable';
    const dutySubline = dutyCacheVisible
        ? `Missed ${formatTokenAmount(delegateDuty.missed, 0)} dCULT / fulfilled ${formatTokenAmount(delegateDuty.fulfilled, 0)} dCULT`
        : getCacheUnavailableText();
    const proofDetails = cacheVisible ? renderVoteAttemptDetails(wasteBreakdown.events || []) : '';
    const delegateDutyDetails = dutyCacheVisible ? renderDelegateDutyDetails(delegateDuty.events || []) : '';

    return `
        <details class="checker-history-details">
            <summary class="advanced-options-summary proposal-detail-summary">Show missed vote history</summary>
            <div class="checker-history-summary">
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Total Missed</span>
                    <span class="wallet-detail-value">${escapeHtml(totalMissedValue)}</span>
                    <span class="value-subline">Direct attempts plus delegated-power duty, deduped by proposal where applicable</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Direct Vote-Attempt Waste</span>
                    <span class="wallet-detail-value">${escapeHtml(wasteValue)}</span>
                    <span class="value-subline">${escapeHtml(wasteSubline)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Delegatee Duty</span>
                    <span class="wallet-detail-value">${escapeHtml(dutyValue)}</span>
                    <span class="value-subline">${escapeHtml(dutySubline)}</span>
                </div>
            </div>
            ${proofDetails}
            ${delegateDutyDetails}
        </details>
    `;
}

function renderDelegateDutyDetails(events) {
    const visibleEvents = (events || [])
        .slice()
        .sort(sortVoteAttemptDetailsDesc)
        .slice(0, MAX_DELEGATE_DUTY_DETAILS);

    if (!visibleEvents.length) return '';

    const omitted = events.length > visibleEvents.length
        ? `<span class="event-meta">${formatInteger(events.length - visibleEvents.length)} older entries hidden</span>`
        : '';

    return `
        <details class="checker-proof-details">
            <summary>Delegated-power duty (${formatInteger(events.length)})</summary>
            <div class="checker-proof-list">
                ${visibleEvents.map(renderDelegateDutyDetail).join('')}
                ${omitted}
            </div>
        </details>
    `;
}

function renderDelegateDutyDetail(event) {
    const fulfilled = event.dutyStatus === 'voted';
    const delegateeRole = event.role === 'delegatee';
    const statusLabel = fulfilled ? 'Fulfilled' : 'Missed Duty';
    const statusClass = fulfilled ? 'status-active' : 'status-attention';
    const rowClass = fulfilled ? 'is-ready' : 'is-attention';
    const action = fulfilled ? `Voted ${supportLabel(event.support)} (${formatTokenAmount(event.votes, 0)} dCULT)` : 'Did not vote';
    const powerLabel = delegateeRole ? 'Represented Power' : 'Your Attached Power';
    const proposalSubline = delegateeRole ? 'This wallet was responsible delegatee at snapshot' : 'Your dCULT was delegated at snapshot';
    const relationLabel = delegateeRole ? 'Represented Wallets' : 'Responsible Delegatee';
    const relationValue = delegateeRole
        ? formatInteger(event.delegatorCount || 0)
        : renderAddressLink(event.delegatee);
    const representedWallets = delegateeRole ? renderRepresentedDelegatorDetails(event.delegators || []) : '';

    return `
        <div class="checker-proof-item">
            <article class="checker-proof-row ${rowClass}">
                <div class="wallet-detail">
                    <span class="wallet-detail-label">Proposal</span>
                    <span class="wallet-detail-value">#${escapeHtml(event.proposalId || '?')} ${escapeHtml(event.title || '')}</span>
                    <span class="value-subline">${escapeHtml(proposalSubline)}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">${escapeHtml(powerLabel)}</span>
                    <span class="wallet-detail-value">${formatTokenAmount(event.delegatedPower, 0)} dCULT</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">${escapeHtml(relationLabel)}</span>
                    <span class="wallet-detail-value">${relationValue}</span>
                </div>
                <div class="wallet-detail">
                    <span class="wallet-detail-label">${delegateeRole ? 'Your Action' : 'Delegatee Action'}</span>
                    <span class="wallet-detail-value">${escapeHtml(action)}</span>
                </div>
                <span class="status-flag ${statusClass}">${escapeHtml(statusLabel)}</span>
                <a class="tx-icon-link" href="${addressUrl(event.delegatee)}" target="_blank" rel="noopener noreferrer" title="View delegatee on Etherscan" aria-label="View delegatee on Etherscan">
                    ${renderExternalLinkIcon()}
                </a>
            </article>
            ${representedWallets}
        </div>
    `;
}

function renderRepresentedDelegatorDetails(delegators) {
    if (!delegators.length) return '';

    return `
        <details class="checker-nested-details">
            <summary>Show represented wallets (${formatInteger(delegators.length)})</summary>
            <div class="delegator-list checker-duty-delegator-list">
                ${delegators.map(renderRepresentedDelegatorRow).join('')}
            </div>
        </details>
    `;
}

function renderRepresentedDelegatorRow(delegator) {
    const attempted = Boolean(delegator.attempted);
    const attemptLabel = attempted
        ? `${delegator.source || 'VoteCast'} - intended ${supportLabel(delegator.support)}`
        : 'No direct vote attempt tracked';
    const txLink = attempted && delegator.transactionHash
        ? `<a class="tx-icon-link" href="${txUrl(delegator.transactionHash)}" target="_blank" rel="noopener noreferrer" title="View vote attempt transaction" aria-label="View vote attempt transaction">${renderExternalLinkIcon()}</a>`
        : `<a class="tx-icon-link" href="${addressUrl(delegator.delegator)}" target="_blank" rel="noopener noreferrer" title="View delegator on Etherscan" aria-label="View delegator on Etherscan">${renderExternalLinkIcon()}</a>`;

    return `
        <article class="delegator-row checker-duty-delegator-row">
            <div class="wallet-detail">
                ${renderAddressLink(delegator.delegator)}
                <div class="event-meta">Delegator</div>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Attached dCULT</span>
                <span class="wallet-detail-value">${formatTokenAmount(delegator.balance, 0)} dCULT</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Vote Attempt</span>
                <span class="wallet-detail-value">${escapeHtml(attemptLabel)}</span>
            </div>
            ${txLink}
        </article>
    `;
}

function renderVoteAttemptDetails(events) {
    const visibleEvents = (events || [])
        .slice()
        .sort(sortVoteAttemptDetailsDesc)
        .slice(0, MAX_VOTE_ATTEMPT_DETAILS);

    if (!visibleEvents.length) return '';

    const omitted = events.length > visibleEvents.length
        ? `<span class="event-meta">${formatInteger(events.length - visibleEvents.length)} older entries hidden</span>`
        : '';

    return `
        <details class="checker-proof-details">
            <summary>Vote-attempt proof (${formatInteger(events.length)})</summary>
            <div class="checker-proof-list">
                ${visibleEvents.map(renderVoteAttemptDetail).join('')}
                ${omitted}
            </div>
        </details>
    `;
}

function renderVoteAttemptDetail(event) {
    const status = getVoteAttemptStatus(event);
    const delegateLabel = getAttemptDelegateLabel(event);
    const delegateAction = getAttemptDelegateAction(event);
    const txLink = event.transactionHash
        ? `<a class="tx-icon-link" href="${txUrl(event.transactionHash)}" target="_blank" rel="noopener noreferrer" title="View vote transaction" aria-label="View vote transaction">${renderExternalLinkIcon()}</a>`
        : '';

    return `
        <article class="checker-proof-row ${status.rowClass}">
            <div class="wallet-detail">
                <span class="wallet-detail-label">Proposal</span>
                <span class="wallet-detail-value">#${escapeHtml(event.proposalId || '?')} ${escapeHtml(event.title || '')}</span>
                <span class="value-subline">${escapeHtml(event.source || 'VoteCast')} - intended ${supportLabel(event.support)}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Snapshot dCULT</span>
                <span class="wallet-detail-value">${formatTokenAmount(event.snapshotBalance, 0)} dCULT</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Snapshot Fallback</span>
                <span class="wallet-detail-value">${delegateLabel}</span>
            </div>
            <div class="wallet-detail">
                <span class="wallet-detail-label">Snapshot Fallback Action</span>
                <span class="wallet-detail-value">${delegateAction}</span>
            </div>
            <span class="status-flag ${status.className}">${escapeHtml(status.label)}</span>
            ${txLink}
        </article>
    `;
}

function getVoteAttemptStatus(event) {
    if (event.representationStatus === 'represented') {
        return { label: 'Represented', className: 'status-active', rowClass: 'is-ready' };
    }
    if (event.representationStatus === 'misaligned') {
        return { label: 'Misaligned', className: 'status-delegated', rowClass: 'is-attention' };
    }
    if (event.representationStatus === 'empty') {
        return { label: getInactiveVoteAttemptReason(event), className: 'status-muted', rowClass: 'is-muted' };
    }
    if (event.wasteReason === 'delegate_not_voted') {
        return { label: 'Delegatee did not vote', className: 'status-attention', rowClass: 'is-attention' };
    }
    return { label: getNoRightsVoteAttemptReason(event), className: 'status-attention', rowClass: 'is-attention' };
}

function getInactiveVoteAttemptReason(event) {
    const reasons = ['No dCULT'];
    if (!hasSnapshotDelegate(event)) reasons.push('not delegated');
    return reasons.join(' / ');
}

function getNoRightsVoteAttemptReason(event) {
    const snapshotDelegate = String(event?.snapshotDelegate || ZERO_ADDRESS).toLowerCase();
    if (!snapshotDelegate || snapshotDelegate === ZERO_ADDRESS) return 'Not delegated';
    return 'No voting weight';
}

function hasSnapshotDelegate(event) {
    const snapshotDelegate = String(event?.snapshotDelegate || ZERO_ADDRESS).toLowerCase();
    return Boolean(snapshotDelegate && snapshotDelegate !== ZERO_ADDRESS);
}

function getAttemptDelegateLabel(event) {
    const delegatee = String(event.snapshotDelegate || ZERO_ADDRESS);
    if (delegatee.toLowerCase() === ZERO_ADDRESS) return 'None';
    if (event.delegateVoter && event.delegateVoter.toLowerCase() === delegatee.toLowerCase()) {
        return renderAddressLink(delegatee);
    }
    return renderAddressLink(delegatee);
}

function getAttemptDelegateAction(event) {
    const delegatee = String(event.snapshotDelegate || ZERO_ADDRESS);
    if (delegatee.toLowerCase() === ZERO_ADDRESS) return 'No delegate set';
    if (!event.delegateVoted) return 'Did not vote';
    return `Voted ${supportLabel(event.delegateSupport)} (${formatTokenAmount(event.delegateVotes, 0)} dCULT)`;
}

function sortVoteAttemptDetailsDesc(a, b) {
    return Number(b.proposalId || 0) - Number(a.proposalId || 0);
}

function getDelegationLabelHtml(row) {
    if (row.isGuardian) return 'Guardian rights';
    if (row.isSelfDelegated && !row.hasDcult) return 'Current: self-delegated, no dCULT';
    if (row.isSelfDelegated) return 'Current: self-delegated';
    if (!row.hasDcult) return 'Current: no dCULT';
    if (!row.delegatee || row.delegatee.toLowerCase() === ZERO_ADDRESS) return 'Current: no delegate set';
    const delegatee = ethers.utils.getAddress(row.delegatee);
    return `Current: delegated to ${renderAddressLink(delegatee)}`;
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runNext() {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
        await runNext();
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
    await Promise.all(workers);
    return results;
}

function setStatus(message, danger = false) {
    el.checkerStatus.textContent = message;
    el.checkerStatus.hidden = !message || message === 'Ready.';
    el.checkerStatus.classList.toggle('danger-text', danger);
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

function setBusy(isBusy) {
    el.checkBtn.disabled = isBusy;
    el.clearBtn.disabled = isBusy;
    el.walletInput.disabled = isBusy;
}

function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
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

function formatIntegerString(value) {
    const sign = value.startsWith('-') ? '-' : '';
    const unsigned = sign ? value.slice(1) : value;
    return `${sign}${unsigned.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function shortAddress(address) {
    if (!address) return 'None';
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

function addressUrl(address) {
    return `https://etherscan.io/address/${address}`;
}

function txUrl(txHash) {
    return `https://etherscan.io/tx/${txHash}`;
}

function supportLabel(support) {
    const value = Number(support);
    if (value === 1) return 'For';
    if (value === 0) return 'Against';
    if (value === 2) return 'Abstain';
    return 'Unknown';
}

function shortError(error) {
    const message = String(error?.reason || error?.message || error || 'Unknown error');
    return message.length > 110 ? `${message.slice(0, 107)}...` : message;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderExternalLinkIcon() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d="M224,104a8,8,0,0,1-16,0V59.31l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.69,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/>
        </svg>
    `;
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
        // Fall through to default theme.
    }

    applyTheme('default', false);
}

function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'default';
    const currentIndex = THEME_SEQUENCE.indexOf(current);
    const nextTheme = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length] || 'default';
    applyTheme(nextTheme, true);
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

    root.dataset.theme = theme;
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'standard', name: theme }));
}

function shuffleTheme() {
    const colors = {
        color1: getRandomColor(),
        color2: getRandomColor(),
        btn: getRandomColor(),
    };
    applyRandomTheme(colors, true);
}

function applyRandomTheme(colors, persist) {
    const root = document.documentElement;
    root.style.setProperty('--background-image', `radial-gradient(circle, ${colors.color1}, ${colors.color2})`);
    root.style.setProperty('--btn-bg', colors.btn);
    root.style.setProperty('--menu-bg', colors.btn);
    root.dataset.theme = 'random';
    if (persist) localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ type: 'random', colors }));
}

function getRandomColor() {
    const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    return `#${hex}`;
}
