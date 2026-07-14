// Proposal-level governance analysis shared with the Hub's Past Proposals cards.

const DATA_URL = 'governance/historical-cult-governance-data.json';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const donutModes = {
    voteSplit: 'token',
    tokenTurnout: 'ready',
    walletTurnout: 'percent',
    wastedWallets: 'total',
    delegateDuty: 'delegatees',
};

const openMetrics = new Set();
const openEvidence = new Set();
const expandedDelegatees = new Set();
const revealedCards = new Set();
let datasetPromise;
let dataset;

export function hydrateProposalGovernanceCards(root = document) {
    const cards = root.matches?.('.proposal.has-governance-insights')
        ? [root]
        : Array.from(root.querySelectorAll?.('.proposal.has-governance-insights') || []);
    cards.forEach((card) => bindCardSections(card, String(card.dataset.proposalId || '')));

    return loadDataset()
        .then(() => {
            cards.forEach(hydrateCard);
        })
        .catch((error) => {
            console.warn('Unable to load proposal governance insights:', error);
            for (const card of cards) {
                renderUnavailable(card);
            }
        });
}

function loadDataset() {
    if (datasetPromise) return datasetPromise;
    datasetPromise = fetch(DATA_URL, { cache: 'no-cache' })
        .then((response) => {
            if (!response.ok) throw new Error(`Historical governance data returned ${response.status}`);
            return response.json();
        })
        .then(buildDataset);
    return datasetPromise;
}

function buildDataset(payload) {
    const cachedRows = Object.values(payload?.proposals || {});
    const rows = cachedRows.map(summarizeCachedProposal).sort((a, b) => b.id - a.id);
    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    const recurrence = new Map();
    const delegatorDuty = new Map();

    for (const row of rows) {
        for (const wallet of row.zeroWallets) {
            if (wallet.representationStatus !== 'wasted') continue;
            const address = String(wallet.voter || '').toLowerCase();
            if (!address) continue;
            if (!recurrence.has(address)) recurrence.set(address, new Set());
            recurrence.get(address).add(String(row.id));
        }

        if (!isDelegateDutyReportable(row)) continue;
        collectDelegatorDuty(delegatorDuty, row.delegateDuty.absentDelegates, false);
        collectDelegatorDuty(delegatorDuty, row.delegateDuty.votedDelegates, true);
    }

    dataset = {
        rows,
        rowsById,
        repeatWastedVoters: new Set(
            Array.from(recurrence.entries())
                .filter(([, proposals]) => proposals.size > 1)
                .map(([address]) => address),
        ),
        delegatorDuty,
    };
    return dataset;
}

function collectDelegatorDuty(result, delegateRows, fulfilled) {
    for (const delegateRow of delegateRows || []) {
        for (const delegatorRow of delegateRow.delegators || []) {
            const address = String(delegatorRow.delegator || '').toLowerCase();
            if (!address) continue;
            if (!result.has(address)) {
                result.set(address, {
                    missed: bn(0),
                    fulfilled: bn(0),
                    missedCount: 0,
                    fulfilledCount: 0,
                    trackedCount: 0,
                });
            }
            const summary = result.get(address);
            const balance = bn(delegatorRow.balance);
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

function summarizeCachedProposal(cached) {
    const proposal = cached?.proposal || {};
    const voteEvents = Array.isArray(cached?.voteEvents) ? cached.voteEvents : [];
    const zeroWallets = dedupeWallets(classifyZeroWallets(cached?.zeroWallets || [], voteEvents));
    const wastedWallets = zeroWallets.filter((wallet) => wallet.representationStatus === 'wasted');
    const noRightsWallets = wastedWallets.filter((wallet) => wallet.wasteReason === 'no_voting_rights');
    const missedDelegateWallets = wastedWallets.filter((wallet) => wallet.wasteReason === 'delegate_not_voted');
    const alignedWallets = zeroWallets.filter((wallet) => wallet.representationStatus === 'represented');
    const misalignedWallets = zeroWallets.filter((wallet) => wallet.representationStatus === 'misaligned');
    const actualFor = bn(proposal.forVotes);
    const actualAgainst = bn(proposal.againstVotes);
    const actualTotal = actualFor.add(actualAgainst).add(bn(proposal.abstainVotes));
    const wastedFor = sumBalances(wastedWallets.filter((wallet) => Number(wallet.support) === 1));
    const wastedAgainst = sumBalances(wastedWallets.filter((wallet) => Number(wallet.support) === 0));
    const wastedAbstain = sumBalances(wastedWallets.filter((wallet) => Number(wallet.support) === 2));
    const adjustedVotes = getAdjustedVotes(actualFor, actualAgainst, zeroWallets);
    const leadingSide = actualFor.eq(actualAgainst) ? 'Tie' : actualFor.gt(actualAgainst) ? 'For' : 'Against';
    const adjustedLeadingSide = adjustedVotes.forVotes.eq(adjustedVotes.againstVotes)
        ? 'Tie'
        : adjustedVotes.forVotes.gt(adjustedVotes.againstVotes) ? 'For' : 'Against';
    const margin = actualFor.gte(actualAgainst) ? actualFor.sub(actualAgainst) : actualAgainst.sub(actualFor);

    return {
        id: Number(cached?.id || proposal.id || 0),
        title: cached?.title || `Proposal #${proposal.id || ''}`,
        proposal,
        voteEvents,
        zeroWallets,
        voterWalletCount: new Set(voteEvents.map((event) => String(event.voter || '').toLowerCase()).filter(Boolean)).size,
        wastedWalletCount: wastedWallets.length,
        misalignedWalletCount: misalignedWallets.length,
        wastedFor,
        wastedAgainst,
        wastedAbstain,
        wastedTotal: wastedFor.add(wastedAgainst).add(wastedAbstain),
        noRightsWasteTotal: sumBalances(noRightsWallets),
        delegateMissedWasteTotal: sumBalances(missedDelegateWallets),
        alignedDelegatedTotal: sumBalances(alignedWallets),
        misalignedDelegatedTotal: sumBalances(misalignedWallets),
        actualFor,
        actualAgainst,
        actualTotal,
        adjustedLeadingSide,
        leadingSide,
        margin,
        couldSwing: leadingSide !== 'Tie' && adjustedLeadingSide !== 'Tie' && leadingSide !== adjustedLeadingSide,
        snapshotTotalSupply: bn(cached?.snapshotTotalSupply),
        snapshotReadyDcultSupply: bn(cached?.snapshotReadyDcultSupply),
        snapshotGuardianDcultSupply: bn(cached?.snapshotGuardianDcultSupply),
        snapshotGuardianReadyDcultSupply: bn(cached?.snapshotGuardianReadyDcultSupply),
        snapshotHolderCount: Number(cached?.snapshotHolderCount || 0),
        snapshotReadyHolderCount: Number(cached?.snapshotReadyHolderCount || 0),
        snapshotGuardianHolderCount: Number(cached?.snapshotGuardianHolderCount || 0),
        snapshotGuardianReadyHolderCount: Number(cached?.snapshotGuardianReadyHolderCount || 0),
        delegateDuty: normalizeDelegateDuty(cached?.delegateDuty),
    };
}

function classifyZeroWallets(wallets, voteEvents) {
    const delegateVotes = getEffectiveVotes(voteEvents);
    return (wallets || []).map((wallet) => {
        const snapshotBalance = bn(wallet.snapshotBalance);
        const voter = String(wallet.voter || '');
        const snapshotDelegate = String(wallet.snapshotDelegate || ZERO_ADDRESS);
        if (snapshotBalance.isZero()) {
            return { ...wallet, representationStatus: 'empty', wasteReason: 'none', delegateSupport: null, delegateVotes: '0', delegateVoter: '' };
        }
        if (isThirdPartyDelegate(voter, snapshotDelegate)) {
            const delegateVote = delegateVotes.get(snapshotDelegate.toLowerCase());
            if (delegateVote && !bn(delegateVote.votes).isZero()) {
                const sameDirection = Number(delegateVote.support) === Number(wallet.support);
                return {
                    ...wallet,
                    representationStatus: sameDirection ? 'represented' : 'misaligned',
                    wasteReason: 'none',
                    delegateSupport: Number(delegateVote.support),
                    delegateVotes: String(delegateVote.votes || '0'),
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

function getEffectiveVotes(voteEvents) {
    const result = new Map();
    for (const event of voteEvents || []) {
        const key = String(event.voter || '').toLowerCase();
        if (!key) continue;
        const existing = result.get(key);
        const hasVotes = !bn(event.votes).isZero();
        const existingHasVotes = existing && !bn(existing.votes).isZero();
        if (!existing || (hasVotes && !existingHasVotes)) result.set(key, event);
    }
    return result;
}

function dedupeWallets(wallets) {
    const result = new Map();
    for (const wallet of wallets || []) {
        const voter = String(wallet?.voter || '').toLowerCase();
        if (voter && !result.has(voter)) result.set(voter, wallet);
    }
    return Array.from(result.values());
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
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        delegatedPower: String(row.delegatedPower || '0'),
        votes: String(row.votes || '0'),
        delegatorCount: Number(row.delegatorCount || 0),
        delegators: Array.isArray(row.delegators) ? row.delegators : [],
    }));
}

function hydrateCard(card) {
    const proposalId = String(card.dataset.proposalId || '');
    const row = dataset.rowsById.get(proposalId);
    if (!row) {
        renderUnavailable(card);
        return;
    }

    card.querySelector('.proposal-impact-icons').innerHTML = renderImpactIcons(row);
    card.querySelector('.proposal-governance-donuts').innerHTML = renderDonutDashboard(row);
    card.querySelector('.proposal-governance-metrics-content').innerHTML = renderGovernanceMetrics(row);
    card.querySelector('.proposal-governance-evidence-content').innerHTML = renderEvidence(row);
    const evidenceDisclosure = card.querySelector('.proposal-governance-evidence-disclosure');
    if (evidenceDisclosure) evidenceDisclosure.hidden = !hasGovernanceEvidence(row);
    bindDisclosureState(card, proposalId);
}

function bindDisclosureState(card, proposalId) {
    for (const disclosure of card.querySelectorAll('[data-insight-section]')) {
        const state = disclosure.dataset.insightSection === 'metrics' ? openMetrics : openEvidence;
        disclosure.open = state.has(proposalId);
        if (disclosure.dataset.insightBound === 'true') continue;
        disclosure.dataset.insightBound = 'true';
        disclosure.addEventListener('toggle', () => {
            if (disclosure.open) state.add(proposalId);
            else state.delete(proposalId);
        });
    }
}

function bindCardSections(card, proposalId) {
    const titleRow = card.querySelector('.proposal-title');
    const sections = card.querySelector('.proposal-card-sections');
    const toggle = card.querySelector('.proposal-sections-toggle');
    if (!titleRow || !sections || !toggle) return;

    sections.id = `proposal-sections-${proposalId}`;
    toggle.hidden = false;
    toggle.setAttribute('aria-controls', sections.id);

    const setRevealed = (revealed) => {
        sections.hidden = !revealed;
        card.classList.toggle('is-sections-revealed', revealed);
        titleRow.classList.toggle('is-sections-revealed', revealed);
        toggle.setAttribute('aria-expanded', String(revealed));
        toggle.setAttribute('aria-label', `${revealed ? 'Hide' : 'Show'} proposal sections`);
        if (revealed) revealedCards.add(proposalId);
        else revealedCards.delete(proposalId);
    };

    if (card.dataset.sectionsBound !== 'true') {
        card.dataset.sectionsBound = 'true';
        titleRow.classList.add('is-sections-toggle');
        card.addEventListener('click', (event) => {
            if (event.target.closest('a')) return;
            const clickedTitle = Boolean(event.target.closest('.proposal-title'));
            const clickedCollapsedSurface = sections.hidden && !event.target.closest('.proposal-card-sections');
            if (!clickedTitle && !clickedCollapsedSurface) return;
            setRevealed(sections.hidden);
        });
    }

    setRevealed(revealedCards.has(proposalId));
}

function renderUnavailable(card) {
    const message = '<p class="proposal-insight-empty">No indexed governance analysis is available for this proposal yet.</p>';
    const donuts = card.querySelector('.proposal-governance-donuts');
    if (donuts) donuts.innerHTML = '';
    const metrics = card.querySelector('.proposal-governance-metrics-content');
    const evidence = card.querySelector('.proposal-governance-evidence-content');
    if (metrics) metrics.innerHTML = message;
    if (evidence) evidence.innerHTML = message;
}

function renderGovernanceMetrics(row) {
    const duty = getReportableDuty(row);
    const participatingWallets = getParticipatingWalletCount(row, duty);
    const eligibleSupply = subtractFloor(row.snapshotTotalSupply, row.snapshotGuardianDcultSupply);
    const readyEligibleSupply = subtractFloor(row.snapshotReadyDcultSupply, row.snapshotGuardianReadyDcultSupply);
    const eligibleWallets = getEligibleHolderWallets(row);
    const readyEligibleWallets = getEligibleReadyHolderWallets(row);

    return `
        <div class="proposal-governance-metrics">
            ${metric('Actual For', `${formatToken(row.actualFor)} dCULT`, 'value-for')}
            ${metric('Actual Against', `${formatToken(row.actualAgainst)} dCULT`, 'value-against')}
            ${metric('Actual Total', `${formatToken(row.actualTotal)} dCULT`)}
            ${metric('Snapshot dCULT', `${formatToken(row.snapshotTotalSupply)} dCULT`)}
            ${metric('Protocol-Ineligible dCULT', `${formatToken(row.snapshotGuardianDcultSupply)} dCULT`)}
            ${metric('Token Turnout', `${formatPercentBn(row.actualTotal, readyEligibleSupply, 2)} eligible ready / ${formatPercentBn(row.actualTotal, eligibleSupply, 2)} eligible`)}
            ${metric('Participating / Ready / Eligible Wallets', `${formatInteger(participatingWallets)} / ${formatInteger(readyEligibleWallets)} / ${formatInteger(eligibleWallets)}`)}
            ${metric('Wallet Turnout', `${formatCountPercent(participatingWallets, readyEligibleWallets, 2)} eligible ready / ${formatCountPercent(participatingWallets, eligibleWallets, 2)} eligible holder`)}
            ${metric('Margin', `${formatToken(row.margin)} dCULT`)}
            ${metric('Wasted Votes', `${formatToken(row.wastedTotal)} dCULT`)}
            ${metric('No Rights Waste', `${formatToken(row.noRightsWasteTotal)} dCULT`)}
            ${metric('Delegatee No-Vote Waste', `${formatToken(row.delegateMissedWasteTotal)} dCULT`)}
            ${metric('Wasted Abstain', `${formatToken(row.wastedAbstain)} dCULT`)}
            ${metric('Aligned Delegated', `${formatToken(row.alignedDelegatedTotal)} dCULT`, 'value-for')}
            ${metric('Misaligned Delegated', `${formatToken(row.misalignedDelegatedTotal)} dCULT`)}
            ${metricHtml('Third-Party Delegatees', `<span>${formatInteger(duty.votedDelegateCount)} / ${formatInteger(duty.activeDelegateCount)} delegatees</span><span class="proposal-value-subline">${formatInteger(duty.votedDelegatorCount)} / ${formatInteger(duty.activeDelegatorCount)} wallets represented</span>`)}
            ${metric('Absent Delegatee Power', `${formatToken(duty.absentDelegatedPower)} dCULT`)}
            ${metric('Wasted Wallets', `${formatInteger(row.wastedWalletCount)} / ${formatInteger(participatingWallets)}`)}
            ${metric('Misaligned Wallets', `${formatInteger(row.misalignedWalletCount)} / ${formatInteger(row.voterWalletCount)}`)}
        </div>
    `;
}

function metric(label, value, valueClass = '') {
    return `<div class="proposal-governance-metric"><h4>${escapeHtml(label)}</h4><span class="${escapeHtml(valueClass)}">${escapeHtml(value)}</span></div>`;
}

function metricHtml(label, valueHtml) {
    return `<div class="proposal-governance-metric"><h4>${escapeHtml(label)}</h4><span>${valueHtml}</span></div>`;
}

function renderDonutDashboard(row) {
    const duty = getReportableDuty(row);
    const participatingWallets = getParticipatingWalletCount(row, duty);
    const donuts = [
        getVoteSplitDonut(row, duty),
        getTokenTurnoutDonut(row),
        getWalletTurnoutDonut(row, participatingWallets),
        getWastedWalletDonut(row, participatingWallets),
        getDelegateDutyDonut(duty),
    ];
    return donuts.map(renderDonutItem).join('');
}

function getVoteSplitDonut(row, duty) {
    if (donutModes.voteSplit === 'wallet') {
        const split = getWalletVoteSplit(row, duty);
        const total = split.forVotes + split.againstVotes;
        const winner = getCountWinner(split.forVotes, split.againstVotes, 'Yes', 'No');
        return {
            label: 'Vote split', stateKey: 'voteSplit', options: [['token', 'Token'], ['wallet', 'Wallet']],
            center: winner,
            caption: `Y ${formatCountPercent(split.forVotes, total, 0)} / N ${formatCountPercent(split.againstVotes, total, 0)}`,
            tooltip: [`Vote split (wallets)`, `Yes: ${formatInteger(split.forVotes)} wallets`, `No: ${formatInteger(split.againstVotes)} wallets`],
            segments: [{ className: 'is-yes', value: split.forVotes }, { className: 'is-no', value: split.againstVotes }],
        };
    }
    const winner = getBnWinner(row.actualFor, row.actualAgainst, 'Yes', 'No');
    const total = row.actualFor.add(row.actualAgainst);
    return {
        label: 'Vote split', stateKey: 'voteSplit', options: [['token', 'Token'], ['wallet', 'Wallet']],
        center: winner,
        caption: `Y ${formatPercentBn(row.actualFor, total, 0)} / N ${formatPercentBn(row.actualAgainst, total, 0)}`,
        tooltip: ['Vote split (token weight)', `Yes: ${formatDcultBillions(row.actualFor)}`, `No: ${formatDcultBillions(row.actualAgainst)}`],
        segments: [{ className: 'is-yes', value: row.actualFor }, { className: 'is-no', value: row.actualAgainst }],
    };
}

function getTokenTurnoutDonut(row) {
    const eligible = donutModes.tokenTurnout === 'eligible';
    const denominator = eligible
        ? subtractFloor(row.snapshotTotalSupply, row.snapshotGuardianDcultSupply)
        : subtractFloor(row.snapshotReadyDcultSupply, row.snapshotGuardianReadyDcultSupply);
    const votes = minBn(row.actualTotal, denominator);
    const unused = subtractFloor(denominator, votes);
    return {
        label: 'Token turnout', stateKey: 'tokenTurnout', options: [['ready', 'Ready'], ['eligible', 'Elig.']],
        center: formatPercentBn(row.actualTotal, denominator, 1),
        caption: `${formatPercentBn(row.actualTotal, denominator, 1)} turnout`,
        tooltip: [`Token turnout (${eligible ? 'eligible' : 'ready eligible'} dCULT)`, `Actual votes: ${formatDcultBillions(row.actualTotal)}`, `Denominator: ${formatDcultBillions(denominator)}`],
        segments: [{ className: 'is-focus', value: votes }, { className: 'is-unused', value: unused }],
    };
}

function getWalletTurnoutDonut(row, participatingWallets) {
    const ready = getEligibleReadyHolderWallets(row);
    const participating = Math.max(0, Number(participatingWallets || 0));
    const shown = Math.min(participating, ready);
    return {
        label: 'Wallet turnout', stateKey: 'walletTurnout', options: [['percent', '%'], ['wallets', '#']],
        center: donutModes.walletTurnout === 'wallets' ? `${formatCompactCount(participating)}/${formatCompactCount(ready)}` : formatCountPercent(participating, ready, 1),
        caption: `${formatCountPercent(participating, ready, 1)} ready`,
        tooltip: ['Wallet turnout (ready eligible wallets)', `Participating: ${formatInteger(participating)}`, `Ready eligible: ${formatInteger(ready)}`],
        segments: [{ className: 'is-focus', value: shown }, { className: 'is-unused', value: Math.max(0, ready - shown) }],
    };
}

function getWastedWalletDonut(row, participatingWallets) {
    if (donutModes.wastedWallets === 'repeat') {
        const wasted = row.zeroWallets.filter((wallet) => wallet.representationStatus === 'wasted');
        const repeat = wasted.filter((wallet) => dataset.repeatWastedVoters.has(String(wallet.voter || '').toLowerCase())).length;
        return {
            label: 'Wasted wallets', stateKey: 'wastedWallets', options: [['total', 'Total'], ['repeat', 'Repeat']],
            center: `${formatCompactCount(repeat)}/${formatCompactCount(wasted.length)}`,
            caption: `${formatCountPercent(repeat, wasted.length, 1)} repeat`,
            tooltip: ['Wasted wallets (repeat split)', `Repeat: ${formatInteger(repeat)}`, `One-time: ${formatInteger(wasted.length - repeat)}`],
            segments: [{ className: 'is-repeat', value: repeat }, { className: 'is-muted', value: wasted.length - repeat }],
        };
    }
    const wasted = row.wastedWalletCount;
    const participants = Math.max(0, Number(participatingWallets || 0));
    const shown = Math.min(wasted, participants);
    return {
        label: 'Wasted wallets', stateKey: 'wastedWallets', options: [['total', 'Total'], ['repeat', 'Repeat']],
        center: `${formatCompactCount(wasted)}/${formatCompactCount(participants)}`,
        caption: `${formatCountPercent(wasted, participants, 1)} wasted`,
        tooltip: ['Wasted wallets (total)', `Wasted: ${formatInteger(wasted)}`, `Participating: ${formatInteger(participants)}`],
        segments: [{ className: 'is-wasted', value: shown }, { className: 'is-clean', value: Math.max(0, participants - shown) }],
    };
}

function getDelegateDutyDonut(duty) {
    const wallets = donutModes.delegateDuty === 'wallets';
    const voted = wallets ? duty.votedDelegatorCount : duty.votedDelegateCount;
    const active = wallets ? duty.activeDelegatorCount : duty.activeDelegateCount;
    return {
        label: 'Third-party duty', stateKey: 'delegateDuty', options: [['delegatees', 'Deleg.'], ['wallets', 'Wallets']],
        center: `${formatCompactCount(voted)}/${formatCompactCount(active)}`,
        caption: `${formatCountPercent(voted, active, 1)} represented`,
        tooltip: [`Third-party duty (${wallets ? 'represented wallets' : 'delegatees'})`, `Delegatees: ${formatInteger(duty.votedDelegateCount)} / ${formatInteger(duty.activeDelegateCount)}`, `Wallets: ${formatInteger(duty.votedDelegatorCount)} / ${formatInteger(duty.activeDelegatorCount)}`],
        segments: [{ className: 'is-represented', value: voted }, { className: 'is-absent', value: Math.max(0, active - voted) }],
    };
}

function renderDonutItem(item) {
    return `
        <div class="hub-proposal-donut" title="${escapeHtml(item.tooltip.join('\n'))}">
            <div class="hub-proposal-donut-head">
                <span class="hub-proposal-donut-label">${escapeHtml(item.label)}</span>
                <span class="hub-proposal-donut-mode">
                    ${renderDonutToggle(item.stateKey, item.options)}
                    ${item.options.map(([value, label]) => `<span class="${donutModes[item.stateKey] === value ? 'is-active' : ''}">${escapeHtml(label)}</span>`).join('<i>/</i>')}
                </span>
            </div>
            ${renderMiniDonut(item.segments, item.center)}
            <span class="hub-proposal-donut-caption">${escapeHtml(item.caption)}</span>
        </div>
    `;
}

function renderDonutToggle(stateKey, options) {
    const current = donutModes[stateKey];
    const next = options.find(([value]) => value !== current) || options[0];
    return `<button class="hub-proposal-donut-switch ${options[1]?.[0] === current ? 'is-on' : ''}" type="button" data-proposal-donut="${escapeHtml(stateKey)}" data-proposal-donut-mode="${escapeHtml(next[0])}" aria-label="Switch ${escapeHtml(stateKey)} to ${escapeHtml(next[1])}"><span></span></button>`;
}

function renderMiniDonut(segments, center) {
    const normalized = normalizeSegments(segments);
    let offset = 0;
    const circles = normalized.map((segment) => {
        const circle = `<circle class="hub-proposal-donut-segment ${segment.className}" cx="24" cy="24" r="17" pathLength="100" stroke-dasharray="${round(segment.percent)} ${round(100 - segment.percent)}" stroke-dashoffset="${round(-offset)}"></circle>`;
        offset += segment.percent;
        return circle;
    }).join('');
    return `<div class="hub-proposal-donut-visual"><svg viewBox="0 0 48 48" aria-hidden="true"><circle class="hub-proposal-donut-track" cx="24" cy="24" r="17"></circle>${circles}</svg><strong>${escapeHtml(center)}</strong></div>`;
}

function normalizeSegments(segments) {
    const rows = segments.map((segment) => ({ ...segment, numberValue: Math.max(0, valueNumber(segment.value)) })).filter((segment) => segment.numberValue > 0);
    const total = rows.reduce((sum, segment) => sum + segment.numberValue, 0);
    return total ? rows.map((segment) => ({ ...segment, percent: (segment.numberValue / total) * 100 })) : [];
}

function renderEvidence(row) {
    return `
        <div class="proposal-evidence-sections">
            ${renderZeroWeightWallets(row.zeroWallets)}
            ${renderDelegateDuty(row)}
        </div>
    `;
}

function hasGovernanceEvidence(row) {
    if (row.zeroWallets.length > 0) return true;
    if (!isDelegateDutyReportable(row)) return false;
    const duty = row.delegateDuty;
    return duty.activeDelegateCount > 0
        || duty.votedDelegateCount > 0
        || duty.absentDelegateCount > 0
        || duty.activeDelegatorCount > 0
        || duty.votedDelegates.length > 0
        || duty.absentDelegates.length > 0
        || !bn(duty.activeDelegatedPower).isZero();
}

function renderZeroWeightWallets(wallets) {
    return `
        <section class="proposal-evidence-section">
            <div class="proposal-evidence-heading"><h4>Zero-Weight Voters</h4><span>${formatInteger(wallets.length)} wallet${wallets.length === 1 ? '' : 's'}</span></div>
            ${wallets.length ? `<div class="proposal-wallet-list">${wallets.map(renderWalletRow).join('')}</div>` : '<p class="proposal-insight-empty">No zero-weight wallets for this proposal.</p>'}
        </section>
    `;
}

function renderWalletRow(wallet) {
    const impact = getWalletImpact(wallet);
    const currentReady = String(wallet.currentDelegate || '').toLowerCase() === String(wallet.voter || '').toLowerCase();
    return `
        <article class="proposal-wallet-row ${impact.rowClass}">
            <div>${renderAddress(wallet.voter)}<small>${escapeHtml(wallet.source || 'VoteCast')}</small></div>
            <div><small>Vote Intent</small><strong class="support-${supportSlug(wallet.support)}">${escapeHtml(supportLabel(wallet.support))}</strong><em>${escapeHtml(impact.label)}</em></div>
            <div><small>Snapshot dCULT</small><strong>${formatToken(wallet.snapshotBalance)}</strong></div>
            <div><small>Delegated Then</small><strong>${renderDelegateLabel(wallet.voter, wallet.snapshotDelegate)}</strong></div>
            <div><small>Now</small><strong class="${currentReady ? 'value-for' : 'value-against'}">${renderDelegateLabel(wallet.voter, wallet.currentDelegate)}</strong></div>
            ${externalLink(`https://etherscan.io/tx/${wallet.transactionHash}`, 'View vote transaction')}
        </article>
    `;
}

function renderDelegateDuty(row) {
    if (!isDelegateDutyReportable(row)) {
        return `
            <section class="proposal-evidence-section">
                <div class="proposal-evidence-heading"><h4>Third-Party Delegatee Duty</h4><span>Not counted</span></div>
                <p class="proposal-insight-empty">Canceled proposals are excluded from delegatee-duty reports.</p>
            </section>
        `;
    }
    const duty = row.delegateDuty;
    const delegateRows = [
        ...duty.absentDelegates.map((entry) => ({ ...entry, dutyStatus: 'absent' })),
        ...duty.votedDelegates.map((entry) => ({ ...entry, dutyStatus: 'voted' })),
    ];
    return `
        <section class="proposal-evidence-section">
            <div class="proposal-evidence-heading"><h4>Third-Party Delegatee Duty</h4><span>${formatInteger(duty.votedDelegateCount)} / ${formatInteger(duty.activeDelegateCount)} voted</span></div>
            ${delegateRows.length ? `<div class="proposal-delegate-list">${delegateRows.map((entry) => renderDelegateRow(row.id, entry)).join('')}</div>` : '<p class="proposal-insight-empty">No third-party delegated voting power at this proposal snapshot.</p>'}
        </section>
    `;
}

function renderDelegateRow(proposalId, entry) {
    const voted = entry.dutyStatus === 'voted';
    const key = `${proposalId}:${String(entry.delegatee || '').toLowerCase()}`;
    const expanded = expandedDelegatees.has(key);
    const action = voted ? `Voted ${supportLabel(entry.support)} (${formatToken(entry.votes)} dCULT)` : 'Did not vote';
    return `
        <div class="proposal-delegate-item">
            <article class="proposal-delegate-row ${voted ? 'is-represented' : 'is-wasted'}">
                <div>${renderAddress(entry.delegatee)}<small>Delegatee</small></div>
                <div><small>Delegatee Action</small><strong>${escapeHtml(action)}</strong><em>${voted ? 'Fulfilled Duty' : 'Missed Duty'}</em></div>
                <div><small>Attached Power</small><strong>${formatToken(entry.delegatedPower)}</strong></div>
                <div><small>Represented Wallets</small><strong>${formatInteger(entry.delegatorCount)}</strong></div>
                <div class="proposal-row-actions">
                    <button type="button" class="proposal-delegate-toggle" data-proposal-id="${proposalId}" data-delegatee="${escapeHtml(entry.delegatee)}" aria-label="${expanded ? 'Hide' : 'Show'} represented wallets">${expanded ? '&minus;' : '+'}</button>
                    ${externalLink(`https://etherscan.io/address/${entry.delegatee}`, 'View delegatee')}
                </div>
            </article>
            ${expanded ? renderDelegators(entry.delegators) : ''}
        </div>
    `;
}

function renderDelegators(delegators) {
    if (!delegators?.length) return '<p class="proposal-insight-empty proposal-delegator-empty">No represented-wallet details are cached.</p>';
    return `<div class="proposal-delegator-list">${delegators.map((entry) => {
        const duty = dataset.delegatorDuty.get(String(entry.delegator || '').toLowerCase()) || { missed: bn(0), fulfilled: bn(0), missedCount: 0, trackedCount: 0 };
        return `
            <article class="proposal-delegator-row">
                <div>${renderAddress(entry.delegator)}<small>Represented wallet</small></div>
                <div><small>Attached dCULT</small><strong>${formatToken(entry.balance)}</strong></div>
                <div><small>Delegatee Duty</small><strong>${formatInteger(duty.missedCount)} missed / ${formatInteger(duty.trackedCount)} tracked</strong><em>Missed ${formatToken(duty.missed)} / fulfilled ${formatToken(duty.fulfilled)} dCULT</em></div>
                ${externalLink(`https://etherscan.io/address/${entry.delegator}`, 'View represented wallet')}
            </article>
        `;
    }).join('')}</div>`;
}

function renderImpactIcons(row) {
    const icons = [];
    if (row.couldSwing) {
        const direction = row.adjustedLeadingSide === 'For' ? 'up' : 'down';
        const outcome = row.adjustedLeadingSide === 'For' ? 'For / Yes' : 'Against / No';
        icons.push(`<span class="proposal-impact-icon swing-yes" title="Wasted votes would have flipped outcome to ${outcome}" role="img" aria-label="Wasted votes would have flipped outcome to ${outcome}">${renderDirectionIcon(direction)}</span>`);
    }
    const duty = getReportableDuty(row);
    const absentPower = bn(duty.absentDelegatedPower);
    if (row.leadingSide !== 'Tie' && absentPower.gt(row.margin)) {
        const dominates = absentPower.gt(row.actualTotal);
        const label = `Absent delegated representation could have ${dominates ? 'dominated' : 'flipped'} this proposal`;
        icons.push(`<span class="proposal-impact-icon swing-duty ${dominates ? 'is-dominate' : 'is-flip'}" title="${escapeHtml(label)}" role="img" aria-label="${escapeHtml(label)}">${dominates ? renderSolidUserIcon() : renderDashedUserIcon()}</span>`);
    }
    return icons.join('');
}

function renderDirectionIcon(direction) {
    const arrow = direction === 'up'
        ? '<line x1="160" y1="96" x2="96" y2="160"/><polyline points="112 96 160 96 160 144"/>'
        : '<line x1="160" y1="160" x2="96" y2="96"/><polyline points="160 112 160 160 112 160"/>';
    return `<svg class="direction-icon" viewBox="0 0 256 256" aria-hidden="true"><circle cx="128" cy="128" r="96"/>${arrow}</svg>`;
}

function renderDashedUserIcon() {
    return '<svg class="duty-impact-icon" viewBox="0 0 256 256" aria-hidden="true"><circle cx="128" cy="120" r="40"/><path d="M104,35a95.51,95.51,0,0,1,48,0"/><path d="M35.49,102.3a95.54,95.54,0,0,1,24-41.56"/><path d="M152,221a95.51,95.51,0,0,1-48,0"/><path d="M196.51,60.73a95.54,95.54,0,0,1,24,41.58"/><path d="M220.52,153.7a96,96,0,0,1-28.32,45.67,72,72,0,0,0-128.4,0A96,96,0,0,1,35.48,153.7"/></svg>';
}

function renderSolidUserIcon() {
    return '<svg class="duty-impact-icon" viewBox="0 0 256 256" aria-hidden="true"><circle cx="128" cy="128" r="92"/><circle cx="128" cy="108" r="36"/><path d="M63.8,194.8a72,72,0,0,1,128.4,0"/></svg>';
}

function getWalletVoteSplit(row, duty) {
    const supportByWallet = new Map();
    for (const [wallet, event] of getEffectiveVotes(row.voteEvents)) {
        if (bn(event.votes).isZero()) continue;
        const support = Number(event.support);
        if (support === 0 || support === 1) supportByWallet.set(wallet, support);
    }
    for (const delegateRow of duty.votedDelegates) {
        const support = Number(delegateRow.support);
        if (support !== 0 && support !== 1) continue;
        for (const delegator of delegateRow.delegators) {
            const address = String(delegator.delegator || '').toLowerCase();
            if (address && !supportByWallet.has(address)) supportByWallet.set(address, support);
        }
    }
    let forVotes = 0;
    let againstVotes = 0;
    for (const support of supportByWallet.values()) {
        if (support === 1) forVotes += 1;
        if (support === 0) againstVotes += 1;
    }
    return { forVotes, againstVotes };
}

function getParticipatingWalletCount(row, duty) {
    const wallets = new Set(row.voteEvents.map((event) => String(event.voter || '').toLowerCase()).filter(Boolean));
    for (const delegateRow of duty.votedDelegates) {
        for (const delegator of delegateRow.delegators) {
            const address = String(delegator.delegator || '').toLowerCase();
            if (address) wallets.add(address);
        }
    }
    return wallets.size;
}

function getReportableDuty(row) {
    return isDelegateDutyReportable(row) ? row.delegateDuty : normalizeDelegateDuty();
}

function isDelegateDutyReportable(row) {
    return Number(row?.proposal?.state) !== 2 || isCanceledAfterPassing(row);
}

function isCanceledAfterPassing(row) {
    const proposal = row?.proposal || row;
    if (Number(proposal?.state) !== 2 || proposal?.canceled === false) return false;
    return bn(proposal.forVotes).gt(proposal.againstVotes || 0) && bn(proposal.eta).isZero();
}

function getEligibleHolderWallets(row) {
    return Math.max(0, row.snapshotHolderCount - row.snapshotGuardianHolderCount);
}

function getEligibleReadyHolderWallets(row) {
    return Math.max(0, row.snapshotReadyHolderCount - row.snapshotGuardianReadyHolderCount);
}

function getAdjustedVotes(actualFor, actualAgainst, wallets) {
    return wallets.reduce((result, wallet) => {
        const balance = bn(wallet.snapshotBalance);
        if (balance.isZero()) return result;
        if (wallet.representationStatus === 'misaligned') {
            if (Number(wallet.delegateSupport) === 1) result.forVotes = subtractFloor(result.forVotes, balance);
            if (Number(wallet.delegateSupport) === 0) result.againstVotes = subtractFloor(result.againstVotes, balance);
        }
        if (wallet.representationStatus === 'wasted' || wallet.representationStatus === 'misaligned') {
            if (Number(wallet.support) === 1) result.forVotes = result.forVotes.add(balance);
            if (Number(wallet.support) === 0) result.againstVotes = result.againstVotes.add(balance);
        }
        return result;
    }, { forVotes: bn(actualFor), againstVotes: bn(actualAgainst) });
}

function getWalletImpact(wallet) {
    if (bn(wallet.snapshotBalance).isZero() || wallet.representationStatus === 'empty') {
        const hasDelegate = String(wallet.snapshotDelegate || ZERO_ADDRESS).toLowerCase() !== ZERO_ADDRESS;
        return { rowClass: 'is-empty', label: `No snapshot dCULT${hasDelegate ? '' : ' / not delegated at snapshot'}` };
    }
    if (wallet.representationStatus === 'represented') return { rowClass: 'is-represented', label: `Delegatee voted ${supportLabel(wallet.delegateSupport)}` };
    if (wallet.representationStatus === 'misaligned') return { rowClass: 'is-misaligned', label: `Delegatee voted ${supportLabel(wallet.delegateSupport)}` };
    if (wallet.wasteReason === 'delegate_not_voted') return { rowClass: 'is-wasted', label: 'Delegatee did not vote' };
    const delegate = String(wallet.snapshotDelegate || ZERO_ADDRESS).toLowerCase();
    const voter = String(wallet.voter || '').toLowerCase();
    if (delegate === ZERO_ADDRESS) return { rowClass: 'is-wasted', label: 'Not delegated at snapshot' };
    if (delegate === voter) return { rowClass: 'is-wasted', label: 'Self-delegated, zero vote weight' };
    return { rowClass: 'is-wasted', label: 'No voting weight at snapshot' };
}

function renderAddress(address) {
    const value = String(address || '');
    const safeAddress = escapeHtml(value);
    return `
        <span class="address-link" title="${safeAddress}">
            <a class="wallet-address" href="https://etherscan.io/address/${safeAddress}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortAddress(value))}</a>
            <span class="copy-action" data-copy-address="${safeAddress}" title="Copy address" aria-label="Copy address">${renderCopyIcon()}</span>
        </span>
    `;
}

function renderDelegateLabel(voter, delegatee) {
    const value = String(delegatee || ZERO_ADDRESS);
    if (value.toLowerCase() === ZERO_ADDRESS) return 'None';
    if (value.toLowerCase() === String(voter || '').toLowerCase()) return 'Self';
    return renderAddress(value);
}

function externalLink(url, label) {
    return `<a class="tx-icon-link proposal-evidence-external" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${renderExternalLinkIcon()}</a>`;
}

function renderCopyIcon() {
    return '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';
}

function renderExternalLinkIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,104a8,8,0,0,1-16,0V59.31l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.69,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"></path></svg>';
}

function supportLabel(support) {
    if (Number(support) === 1) return 'For';
    if (Number(support) === 0) return 'Against';
    if (Number(support) === 2) return 'Abstain';
    return `Side ${support}`;
}

function supportSlug(support) {
    if (Number(support) === 1) return 'for';
    if (Number(support) === 0) return 'against';
    return 'abstain';
}

function isThirdPartyDelegate(voter, delegatee) {
    const normalized = String(delegatee || ZERO_ADDRESS).toLowerCase();
    return normalized !== ZERO_ADDRESS && normalized !== String(voter || '').toLowerCase();
}

function sumBalances(wallets) {
    return wallets.reduce((sum, wallet) => sum.add(bn(wallet.snapshotBalance)), bn(0));
}

function subtractFloor(value, amount) {
    const left = bn(value);
    const right = bn(amount);
    return left.gt(right) ? left.sub(right) : bn(0);
}

function minBn(left, right) {
    const a = bn(left);
    const b = bn(right);
    return a.lte(b) ? a : b;
}

function getBnWinner(left, right, leftLabel, rightLabel) {
    const a = bn(left);
    const b = bn(right);
    return a.eq(b) ? 'Tie' : a.gt(b) ? leftLabel : rightLabel;
}

function getCountWinner(left, right, leftLabel, rightLabel) {
    return Number(left) === Number(right) ? 'Tie' : Number(left) > Number(right) ? leftLabel : rightLabel;
}

function valueNumber(value) {
    if (ethers.BigNumber.isBigNumber(value)) return Number(ethers.utils.formatUnits(value, 18));
    return Number(value || 0);
}

function bn(value) {
    return ethers.BigNumber.from(value || '0');
}

function formatToken(value, fractionDigits = 0) {
    const [whole, fraction = ''] = ethers.utils.formatUnits(bn(value), 18).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (!fractionDigits) return grouped;
    return `${grouped}.${fraction.padEnd(fractionDigits, '0').slice(0, fractionDigits)}`;
}

function formatDcultBillions(value) {
    return `${(valueNumber(value) / 1_000_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B dCULT`;
}

function formatInteger(value) {
    return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatCompactCount(value) {
    const number = Number(value || 0);
    if (Math.abs(number) >= 1_000_000) return `${formatDecimal(number / 1_000_000, 1)}M`;
    if (Math.abs(number) >= 1_000) return `${formatDecimal(number / 1_000, 1)}K`;
    return formatInteger(number);
}

function formatCountPercent(top, bottom, digits = 2) {
    const denominator = Number(bottom || 0);
    return `${formatDecimal(denominator ? (Number(top || 0) / denominator) * 100 : 0, digits)}%`;
}

function formatPercentBn(top, bottom, digits = 2) {
    const numerator = bn(top);
    const denominator = bn(bottom);
    if (denominator.isZero()) return `${formatDecimal(0, digits)}%`;
    const scale = bn(10).pow(digits);
    const scaled = numerator.mul(100).mul(scale).div(denominator);
    const whole = scaled.div(scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (!digits) return `${whole}%`;
    return `${whole}.${scaled.mod(scale).toString().padStart(digits, '0')}%`;
}

function formatDecimal(value, digits) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function shortAddress(address) {
    const value = String(address || '');
    return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || 'N/A';
}

function round(value) {
    return Number(value || 0).toFixed(3).replace(/\.?0+$/, '');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('click', (event) => {
    const donutButton = event.target.closest('[data-proposal-donut]');
    if (donutButton) {
        event.preventDefault();
        const key = donutButton.dataset.proposalDonut;
        if (Object.prototype.hasOwnProperty.call(donutModes, key)) donutModes[key] = donutButton.dataset.proposalDonutMode;
        for (const card of document.querySelectorAll('.proposal.has-governance-insights')) hydrateCard(card);
        return;
    }

    const clickedDelegateButton = event.target.closest('.proposal-delegate-toggle');
    const delegateRow = event.target.closest('.proposal-delegate-row');
    const clickedRowControl = event.target.closest('a, button, .copy-action, .hub-identity-edit, .hub-identity-label-indicator');
    const delegateButton = clickedDelegateButton || (delegateRow && !clickedRowControl
        ? delegateRow.querySelector('.proposal-delegate-toggle')
        : null);
    if (!delegateButton) return;
    event.preventDefault();
    const key = `${delegateButton.dataset.proposalId}:${String(delegateButton.dataset.delegatee || '').toLowerCase()}`;
    if (expandedDelegatees.has(key)) expandedDelegatees.delete(key);
    else expandedDelegatees.add(key);
    const card = delegateButton.closest('.proposal.has-governance-insights');
    if (card) hydrateCard(card);
});
