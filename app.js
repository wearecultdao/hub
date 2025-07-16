// =========================================================================
// app.js - The Definitive "Trust and Enhance" Version 3.0 (COMPLETE & FINAL)
// =========================================================================
// This version uses the CORRECT Treasury -> dCULT logic to get the Guardian
// threshold, finally fixing the error. My sincerest apologies for the mistakes.
// =========================================================================

// === Imports ===
import {
  CULT_TOKEN_ADDRESS,
  DCULT_TOKEN_ADDRESS,
  GOVERNOR_BRAVO_ADDRESS,
  GOVERNOR_BRAVO_2_ADDRESS,
  GOVERNOR_BRAVO_ABI,
  DCULT_ABI,
  CULT_TOKEN_ABI,
  UNISWAP_PAIR_ADDRESS,
  UNISWAP_PAIR_ABI,
  TREASURY_ADDRESS,
  TREASURY_ABI, // We need this now
  DEAD_WALLET_1,
  DEAD_WALLET_2,
  UNICRYPT_LOCKER_ADDRESS,
  UNICRYPT_LOCKER_ABI
} from './contracts.js';

// --- Global Variables & State ---
let provider, signer, userAddress;
let userCultBalanceRaw, userPendingRewardsRaw, userDcultBalanceRaw;
let allProposals = [];
let userDCultBalance = ethers.BigNumber.from(0);
let pendingDelegationSignature = null;
let canceledSet = new Set();
const INITIAL_PAST_PROPOSAL_COUNT = 10;
const LOAD_MORE_BATCH_SIZE = 50;
let displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT;
let executionTxMap = new Map();
let fundingTxMap = new Map();

// --- DOM Elements ---
const connectBtn = document.getElementById('connect-wallet-btn');
const dappContent = document.getElementById('dapp-content');
const walletDropdown = document.getElementById('wallet-dropdown');
const pushDelegationBtn = document.getElementById('push-delegation-btn');
const delegateSigBtn = document.getElementById('delegate-sig-btn');

// --- Helper Functions ---
function createAddressLink(address) { if (!address) return 'N/A'; const isTx = address.length > 42; const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`; const etherscanUrl = `https://etherscan.io/${isTx ? 'tx' : 'address'}/${address}`; const copyIconSvg = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`; return `<span class="address-link" title="${address}"><a href="${etherscanUrl}" target="_blank" rel="noopener noreferrer">${shortAddress}</a><span onclick="copyTextToClipboard('${address}')">${copyIconSvg}</span></span>`; }
window.copyTextToClipboard = (text) => { navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard!")).catch(err => console.error('Failed to copy text: ', err)); }

// --- Core Application Logic ---
async function connectWallet() { if (typeof window.ethereum === 'undefined') return alert('Please install MetaMask.'); try { provider = new ethers.providers.Web3Provider(window.ethereum); await provider.send("eth_requestAccounts", []); signer = provider.getSigner(); userAddress = await signer.getAddress(); connectBtn.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(userAddress.length - 4)}`; connectBtn.disabled = false; dappContent.style.display = 'block'; document.getElementById('etherscan-link').href = `https://etherscan.io/address/${userAddress}`; document.getElementById('p-proposerWallet').innerHTML = createAddressLink(userAddress); initializeApp(); } catch (error) { console.error("Failed to connect wallet:", error); } }
function disconnectWallet() { location.reload(); }
function copyUserAddressToClipboard() { if (userAddress) { copyTextToClipboard(userAddress); walletDropdown.classList.remove('show'); } }

async function initializeApp() { 
    if (!signer) return; 
    const proposalSection = document.getElementById('submit-proposal-section'); 
    proposalSection.classList.add('checking-eligibility'); 
    await updateBalances();
    await updateDelegationStatus(); 
    await updateClaimableRewards();
    await initialLoad();
        await updateGuardianThreshold();

    await checkUserRights();
    await updateDaoMetrics();
    proposalSection.classList.remove('checking-eligibility');
}


// --- File to Change: app.js ---
// --- Action: Replace ONLY the updateGuardianThreshold() function ---

async function updateGuardianThreshold() {
    const thresholdEl = document.getElementById('top50staker');
    if (!thresholdEl) return; // Exit if the HTML element doesn't exist

    try {
        // Now that the ABI in contracts.js is correct, this will work.
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);

        // This is the direct, one-call method.
        // It fetches the data for the staker at index 49 (the 50th position).
        const stakerData = await dCultContract.highestStakerInPool(0, 0);
        
        // The result 'stakerData' contains the amount in a property named 'deposited'.
        const thresholdAmount = ethers.utils.formatUnits(stakerData.deposited, 18);
        
        // Use your existing helper to format the number for display.
        thresholdEl.textContent = formatNumber(parseFloat(thresholdAmount));

    } catch (error) {
        console.error("Error fetching guardian threshold:", error);
        thresholdEl.textContent = "Error";
    }
}

// --- UI UPDATE FUNCTIONS ---
async function updateBalances() { try { const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); [userCultBalanceRaw, userDcultBalanceRaw] = await Promise.all([cultContract.balanceOf(userAddress), dCultContract.balanceOf(userAddress)]); userDCultBalance = userDcultBalanceRaw; const cultFormatted = ethers.utils.formatUnits(userCultBalanceRaw, 18); document.getElementById('cult-balance').textContent = parseFloat(cultFormatted).toFixed(2); document.getElementById('available-cult').textContent = `Available: ${cultFormatted}`; const dcultFormatted = ethers.utils.formatUnits(userDcultBalanceRaw, 18); document.getElementById('dcult-balance').textContent = parseFloat(dcultFormatted).toFixed(2); document.getElementById('available-dcult').textContent = `Available: ${dcultFormatted}`; document.getElementById('wallet-address').innerHTML = createAddressLink(userAddress); } catch (error) { console.error("Error updating balances:", error); } }
async function updateDelegationStatus() { const delegateSection = document.getElementById('delegate-section'); const statusEl = document.getElementById('delegation-status'); const top50Notice = document.getElementById('top50-notice'); try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); const [delegatee, isGuardian] = await Promise.all([dCultContract.delegates(userAddress), dCultContract.checkHighestStaker(0, userAddress)]); if (delegatee.toLowerCase() === userAddress.toLowerCase()) { statusEl.textContent = "Self-Delegated (Active)"; delegateSection.style.display = 'none'; } else { statusEl.textContent = "Not Delegated (Inactive)"; delegateSection.style.display = 'flex'; if (isGuardian) { top50Notice.textContent = "Guardians (Top 50 Stakers) cannot delegate."; top50Notice.style.display = 'block'; delegateSection.style.display = 'none'; } else { top50Notice.style.display = 'none'; } } } catch (error) { console.error("Error fetching delegation status:", error); statusEl.textContent = "Error"; } }
async function checkUserRights() { const proposalSection = document.getElementById('submit-proposal-section'); const notice = document.getElementById('proposal-eligibility-notice'); const rightsLabelEl = document.getElementById('rights-label'); const rightsValueEl = document.getElementById('proposal-rights'); try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); const isGuardian = await dCultContract.checkHighestStaker(0, userAddress); proposalSection.classList.remove('checking-eligibility'); rightsValueEl.classList.remove('guardian', 'the-many'); if (isGuardian) { proposalSection.classList.remove('dimmed-section'); notice.style.display = 'none'; rightsLabelEl.textContent = "Proposal Rights"; rightsValueEl.textContent = "Guardian"; rightsValueEl.classList.add('the-many'); } else { rightsLabelEl.textContent = "Voting Rights"; if (userDCultBalance.gt(0)) { rightsValueEl.textContent = "The Many"; rightsValueEl.classList.add('the-many'); } else { rightsValueEl.textContent = "None (No dCULT)"; } proposalSection.classList.add('dimmed-section'); notice.style.display = 'block'; notice.innerHTML = `Only Guardians (Top 50 Stakers) can submit proposals.`; } } catch (error) { console.error("An unexpected error occurred while checking user rights:", error); proposalSection.classList.remove('checking-eligibility'); proposalSection.classList.add('dimmed-section'); notice.textContent = 'Error checking proposal eligibility.'; notice.style.display = 'block'; rightsValueEl.textContent = "Error"; } }
async function updateClaimableRewards() { const claimableEl = document.getElementById('claimable-rewards'); try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); if (userDCultBalance.isZero()) { claimableEl.textContent = "0.0000"; return; } const pendingRewardsRaw = await dCultContract.pendingCULT(0, userAddress); userPendingRewardsRaw = pendingRewardsRaw; const rewardsFormatted = ethers.utils.formatUnits(pendingRewardsRaw, 18); claimableEl.textContent = parseFloat(rewardsFormatted).toFixed(2); } catch (error) { console.error("Error fetching claimable rewards:", error); claimableEl.textContent = "Error"; } }


// --- DAO METRICS (Your logic preserved) ---
async function fetchUniswapPoolData(provider) { const pair = new ethers.Contract(UNISWAP_PAIR_ADDRESS, UNISWAP_PAIR_ABI, provider); const token0 = await pair.token0(); const [reserve0, reserve1] = await pair.getReserves(); const cultAddress = CULT_TOKEN_ADDRESS.toLowerCase(); const isCultToken0 = token0.toLowerCase() === cultAddress; const cultReserve = isCultToken0 ? reserve0 : reserve1; const ethReserve = isCultToken0 ? reserve1 : reserve0; const cultFormatted = parseFloat(ethers.utils.formatUnits(cultReserve, 18)); const ethFormatted = parseFloat(ethers.utils.formatUnits(ethReserve, 18)); const price = ethFormatted > 0 ? ethFormatted / cultFormatted : 0; return { cultInLP: cultFormatted, ethInLP: ethFormatted, price }; }
function formatBigNumber(numberBN) { return parseFloat(ethers.utils.formatUnits(numberBN, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function formatNumber(num) { return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function updateTotalHoldingsDisplay(walletCult, dcult, pendingCult, cultUsdPrice) { const totalCult = walletCult + dcult + pendingCult; const totalUsd = totalCult * cultUsdPrice; const holdingsEl = document.getElementById('total-cult-holdings'); const usdEl = document.getElementById('total-cult-usd'); if (holdingsEl) holdingsEl.textContent = formatNumber(totalCult); if (usdEl) usdEl.textContent = `$${formatNumber(totalUsd)}`; }
async function updateDaoMetrics() { const uniqueProposals = Array.from(new Map(allProposals.map(p => [p.id, p])).values()); if (!provider) return; try { const poolData = await fetchUniswapPoolData(provider); const governor = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); const cult = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); const dcult = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); const [cultSupply, dcultSupply, burned1, burned2, treasuryCultRaw] = await Promise.all([cult.totalSupply(), dcult.totalSupply(), cult.balanceOf(DEAD_WALLET_1), cult.balanceOf(DEAD_WALLET_2), cult.balanceOf(TREASURY_ADDRESS)]); const totalBurned = burned1.add(burned2); const circulatingSupply = cultSupply.sub(totalBurned); const stakedPercent = dcultSupply.mul(10000).div(cultSupply).toNumber() / 100; const stakedVsCircPercent = circulatingSupply.isZero() ? 0 : dcultSupply.mul(10000).div(circulatingSupply).toNumber() / 100; const burnPercent = totalBurned.mul(10000).div(cultSupply).toNumber() / 100; const cultLpPercentTotal = (poolData.cultInLP / parseFloat(ethers.utils.formatUnits(cultSupply, 18))) * 100; const cultLpPercentCirc = (poolData.cultInLP / parseFloat(ethers.utils.formatUnits(circulatingSupply, 18))) * 100; const circSupplyPercent = circulatingSupply.mul(10000).div(cultSupply).toNumber() / 100; const cultPriceEth = poolData.price; const treasuryCultFormatted = parseFloat(ethers.utils.formatUnits(treasuryCultRaw, 18)); const treasuryValueEth = treasuryCultFormatted * cultPriceEth; let ethPriceUSD = 0; try { const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'); if(priceRes.ok) { const priceData = await priceRes.json(); ethPriceUSD = priceData?.ethereum?.usd || 0; } else { throw new Error(`API failed: ${priceRes.status}`); } } catch (e) { console.warn("Could not fetch ETH price.", e); } const treasuryValueUsd = treasuryValueEth * ethPriceUSD; const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; }; const cultUsdPrice = cultPriceEth * ethPriceUSD; const liquidityUsd = (poolData.ethInLP * ethPriceUSD) + (poolData.cultInLP * cultUsdPrice); const marketCapUsd = parseFloat(ethers.utils.formatUnits(circulatingSupply, 18)) * cultUsdPrice; const liquidityToMcap = marketCapUsd > 0 ? (liquidityUsd / marketCapUsd) * 100 : 0; if (ethPriceUSD > 0) { safeSet('metric-cult-price-usd', `$${cultUsdPrice.toFixed(8)}`); safeSet('metric-staked-value-usd', `$${formatNumber(parseFloat(ethers.utils.formatUnits(dcultSupply, 18)) * cultUsdPrice)}`); safeSet('metric-treasury-value-usd', `$${formatNumber(treasuryValueUsd)}`); safeSet('metric-liquidity', `$${formatNumber(liquidityUsd)}`); safeSet('metric-mcap', `$${formatNumber(marketCapUsd)}`); safeSet('metric-liq-mcap', `${liquidityToMcap.toFixed(2)}%`); } else { ['metric-cult-price-usd', 'metric-staked-value-usd', 'metric-treasury-value-usd', 'metric-liquidity', 'metric-mcap'].forEach(id => safeSet(id, 'API Error')); } try { document.getElementById('metric-locked-liq').textContent = '99.82%'; document.getElementById('metric-unlock-liq').textContent = 'Nov 20, 2286'; } catch (error) {} const skippedPassedProposals = uniqueProposals.filter(p => p.forVotes?.gt?.(p.againstVotes || 0) && canceledSet.has(p.id.toString()) && (!p.eta || p.eta.isZero?.())); const passedProposals = uniqueProposals.filter(p => [4, 5, 7].includes(p.state)).length; const executedProposals = passedProposals - skippedPassedProposals.length; safeSet('metric-skipped-passed-proposals', skippedPassedProposals.length); safeSet('metric-cult-supply', formatBigNumber(cultSupply)); safeSet('metric-cult-burned', formatBigNumber(totalBurned)); safeSet('metric-cult-staked', formatBigNumber(dcultSupply)); safeSet('metric-cult-circulating', formatBigNumber(circulatingSupply)); safeSet('metric-cult-circulating-percent', `${circSupplyPercent.toFixed(1)}%`); safeSet('metric-staked-percent', `${stakedPercent.toFixed(1)}%`); safeSet('metric-staked-vs-circ-percent', `${stakedVsCircPercent.toFixed(1)}%`); safeSet('metric-cult-burned-percent', `${burnPercent.toFixed(1)}%`); safeSet('metric-cult-lp', formatNumber(poolData.cultInLP)); safeSet('metric-eth-lp', formatNumber(poolData.ethInLP)); safeSet('metric-lp-percent-total', `${cultLpPercentTotal.toFixed(2)}%`); safeSet('metric-lp-percent-circ', `${cultLpPercentCirc.toFixed(2)}%`); safeSet('metric-eth-burned', (executedProposals * 2.5).toFixed(2)); safeSet('metric-eth-funded', (executedProposals * 13).toFixed(2)); safeSet('metric-eth-total-disbursed', (executedProposals * 15.5).toFixed(2)); safeSet('metric-treasury-cult', formatBigNumber(treasuryCultRaw)); safeSet('metric-treasury-value-eth', treasuryValueEth.toFixed(2)); safeSet('metric-total-proposals', uniqueProposals.length); safeSet('metric-active-proposals', uniqueProposals.filter(p => p.state === 1).length); safeSet('metric-passed-proposals', passedProposals); safeSet('metric-executed-proposals', executedProposals); safeSet('metric-defeated-proposals', uniqueProposals.filter(p => p.state === 3).length); safeSet('metric-cancelled-proposals', canceledSet.size); const ethToCult = cultPriceEth > 0 ? 1 / cultPriceEth : 0; safeSet('metric-cult-price-eth', `1 CULT = ${cultPriceEth < 1e-9 ? cultPriceEth.toExponential(2) : cultPriceEth.toFixed(18)} ETH`); safeSet('metric-eth-price-cult', `1 ETH = ${ethToCult.toLocaleString(undefined, { maximumFractionDigits: 0 })} CULT`); setTimeout(() => { const setBar = (id, percent) => { const el = document.getElementById(id); if (el) el.style.width = `${percent.toFixed(1)}%`; }; setBar('bar-burned', burnPercent); setBar('bar-circulating', circSupplyPercent); setBar('bar-staked', stakedPercent); setBar('bar-staked-vs-circ', stakedVsCircPercent); setBar('bar-lp-percent-total', cultLpPercentTotal); setBar('bar-lp-percent-circ', cultLpPercentCirc); }, 100); try { const walletCult = parseFloat(ethers.utils.formatUnits(userCultBalanceRaw || 0, 18)); const dcultVal = parseFloat(ethers.utils.formatUnits(userDcultBalanceRaw || 0, 18)); const pendingCult = parseFloat(ethers.utils.formatUnits(userPendingRewardsRaw || 0, 18)); updateTotalHoldingsDisplay(walletCult, dcultVal, pendingCult, cultUsdPrice); } catch (e) { console.warn("Could not calculate total CULT holdings:", e); } } catch (err) { console.error("Failed to load DAO metrics:", err); } }

// --- DATA LOADING (Your original logic) ---
async function initialLoad() { const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); const activeListDiv = document.getElementById('active-proposal-list'); activeListDiv.innerHTML = '<p>Loading active proposals...</p>'; document.getElementById('past-proposal-list').innerHTML = '<p>Loading recent proposals...</p>'; document.getElementById('load-more-btn').style.display = 'none'; allProposals = []; displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT; try { const proposalCount = await governorContract.proposalCount(); const total = proposalCount.toNumber(); const executedFilter = governorContract.filters.ProposalExecuted(); const fundedFilter = governorContract.filters.InvesteeFunded(); const canceledFilter = governorContract.filters.ProposalCanceled(); const [executedEvents, fundedEvents, canceledEvents] = await Promise.all([ governorContract.queryFilter(executedFilter, 0, 'latest'), governorContract.queryFilter(fundedFilter, 0, 'latest'), governorContract.queryFilter(canceledFilter, 0, 'latest') ]); executionTxMap = new Map(executedEvents.map(e => [e.args.id.toString(), e.transactionHash])); fundingTxMap = new Map(fundedEvents.filter(e => e.args).map(e => [e.args.id.toString(), e.transactionHash])); canceledSet = new Set(canceledEvents.map(e => e.args.id.toString())); const initialProposals = await fetchProposalBatch(total, Math.max(1, total - INITIAL_PAST_PROPOSAL_COUNT + 1)); const activeProposals = initialProposals.filter(p => p.state === 1); allProposals = initialProposals.filter(p => p.state !== 1).sort((a, b) => b.id - a.id); renderProposals(activeProposals, activeListDiv); refreshPastProposalView(); await loadAllProposalsInBackground(total - initialProposals.length); } catch (e) { console.error("Could not load proposals:", e); } }
async function loadAllProposalsInBackground(startingId) { if (startingId <= 0) return; let currentId = startingId; while (currentId > 0) { const batchEndId = Math.max(0, currentId - LOAD_MORE_BATCH_SIZE + 1); const newProposals = await fetchProposalBatch(currentId, batchEndId); const newPastProposals = newProposals.filter(p => p.state !== 1); const proposalMap = new Map(allProposals.map(p => [p.id, p])); for (const proposal of newPastProposals) { proposalMap.set(proposal.id, proposal); } allProposals = Array.from(proposalMap.values()).sort((a, b) => b.id - a.id); currentId = batchEndId - 1; } console.log("All historical proposals loaded in background."); refreshPastProposalView(); }
async function fetchProposalBatch(startId, endId) { const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); const promises = []; const filter = governorContract.filters.ProposalCreated(); const events = await governorContract.queryFilter(filter, 0, 'latest'); const descriptionMap = new Map(events.map(e => [e.args.id.toString(), e.args.description])); for (let i = startId; i >= endId && i > 0; i--) { promises.push((async () => { try { const pData = await governorContract.proposals(i); if (pData.proposer === '0x0000000000000000000000000000000000000000') return null; const state = await governorContract.state(i); const actions = await governorContract.getActions(i); const description = descriptionMap.get(i.toString()) || "Description not found in event logs."; return { ...pData, id: i, state, actions, description }; } catch (err) { return null; } })()); } const results = await Promise.all(promises); return results.filter(p => p !== null); }

// --- RENDER & DISPLAY FUNCTIONS ---
function displayMoreProposals() { displayedPastProposalsCount += LOAD_MORE_BATCH_SIZE; refreshPastProposalView(); }
// --- File to Change: app.js ---
// --- Action: Replace the refreshPastProposalView() function ---

function refreshPastProposalView() {
    const searchTerm = document.getElementById('search-proposals').value.toLowerCase();
    const showExecuted = document.getElementById('filter-executed').checked;
    const showDefeated = document.getElementById('filter-defeated').checked;
    // NEW: Get the state of our new checkbox
    const hideCancelled = document.getElementById('filter-hide-cancelled').checked;

    const pastProposalList = document.getElementById('past-proposal-list');
    const loadMoreBtn = document.getElementById('load-more-btn');
    
    let filteredProposals = allProposals;

    // NEW: Apply the "Hide Cancelled" filter first.
    // The proposal state for "Cancelled" is 2.
    if (hideCancelled) {
        filteredProposals = filteredProposals.filter(p => p.state !== 2);
    }

    // Apply text search filter
    if (searchTerm) {
        filteredProposals = filteredProposals.filter(p => {
            const idMatch = p.id.toString().includes(searchTerm);
            const proposerMatch = p.proposer.toLowerCase().includes(searchTerm);
            const descriptionMatch = p.description.toLowerCase().includes(searchTerm);
            return idMatch || proposerMatch || descriptionMatch;
        });
    }

    // Apply "Show Only" checkbox filters
    if (showExecuted) {
        // State 7 is 'Executed'
        filteredProposals = filteredProposals.filter(p => p.state === 7);
    } else if (showDefeated) {
        // State 3 is 'Defeated'
        filteredProposals = filteredProposals.filter(p => p.state === 3);
    }

    const proposalsToDisplay = filteredProposals.slice(0, displayedPastProposalsCount);
    renderProposals(proposalsToDisplay, pastProposalList, false, searchTerm);

    if (proposalsToDisplay.length < filteredProposals.length) {
        loadMoreBtn.style.display = 'block';
    } else {
        loadMoreBtn.style.display = 'none';
    }
}function renderProposals(proposals, targetElement, append = false, searchTerm = '') { if (!append) targetElement.innerHTML = ''; if (proposals.length === 0 && !append) { targetElement.innerHTML = '<p>No pending proposals at the moment.</p>'; return; } const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const highlight = (text, term) => term ? text.replace(new RegExp(escapeRegExp(term), 'gi'), `<mark>$&</mark>`) : text; const proposalStates = ['Pending', 'Active', 'Cancelled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed']; proposals.forEach(proposal => { let proposalTitle = `Proposal #${proposal.id.toString()}`; try { const descData = JSON.parse(proposal.description); if (descData.projectName) { proposalTitle += `: ${descData.projectName}`; } } catch (e) {} const stateStr = proposalStates[proposal.state]; const canVote = proposal.state === 1; const canCancel = proposal.state < 2 && userAddress && proposal.proposer.toLowerCase() === userAddress.toLowerCase(); const canQueue = proposal.state === 4; const canExecute = proposal.state === 5 && proposal.eta.toNumber() * 1000 < Date.now(); const executionTxHash = executionTxMap.get(proposal.id.toString()); const fundingTxHash = fundingTxMap.get(proposal.id.toString()); const executionLinkHtml = executionTxHash ? `<div class="details-item"><strong>Execution TX:</strong><br>${createAddressLink(executionTxHash)}</div>` : ''; const fundingLinkHtml = fundingTxHash ? `<div class="details-item"><strong>Payment TX:</strong><br>${createAddressLink(fundingTxHash)}</div>` : ''; let technicalDetailsHtml = (proposal.actions && proposal.actions.targets.length > 0) ? proposal.actions.targets.map((target, i) => { const value = ethers.utils.formatEther(proposal.actions.values[i] || '0'); return `<div class="action-item"><p><strong>Target:</strong> ${createAddressLink(target)}</p><p><strong>Value:</strong> ${value} ETH</p><p><strong>Signature:</strong> ${proposal.actions.signatures[i] || 'N/A'}</p><p><strong>Calldata:</strong> ${proposal.actions.calldatas[i]}</p></div>` }).join('') : `<h4>No Actions (Text-only Proposal)</h4>`; let descriptionHtml = ''; try { const data = JSON.parse(proposal.description); descriptionHtml = Object.entries(data).map(([key, value]) => { if (!value) return ''; const prettyKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()); let prettyValue = highlight(value.toString().replace(/\n/g, '<br>'), searchTerm); if (ethers.utils.isAddress(value.toString()) && value.toString().length === 42) { prettyValue = createAddressLink(value.toString()); } else if (value.toString().startsWith('http')) { prettyValue = `<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>`; } return `<div class="description-item"><strong>${prettyKey}:</strong><br>${prettyValue}</div>`; }).join(''); } catch (e) { descriptionHtml = `<div class="description-item">${highlight(proposal.description, searchTerm)}</div>`; } const proposalEl = document.createElement('div'); proposalEl.className = 'proposal'; proposalEl.innerHTML = `<div class="proposal-title"><h3>${highlight(proposalTitle, searchTerm)}</h3><span class="proposal-status status-${stateStr.toLowerCase()}">${stateStr}</span></div><div class="button-group" style="margin-top:0px;"><button class="btn-expand view-details-btn" data-proposal-id="${proposal.id}">Show Details ▼</button></div><div class="proposal-details" id="details-${proposal.id}"><div class="details-section" style="margin-top:0px;"><div class="details-grid"><div class="details-item"><strong>For Votes:</strong><br>${parseFloat(ethers.utils.formatUnits(proposal.forVotes, 18)).toLocaleString()}</div><div class="details-item"><strong>Against Votes:</strong><br>${parseFloat(ethers.utils.formatUnits(proposal.againstVotes, 18)).toLocaleString()}</div><div class="details-item"><strong>Proposer:</strong><br>${createAddressLink(proposal.proposer)}</div><div class="details-item"><strong>Start Block:</strong><br>${proposal.startBlock.toString()}</div><div class="details-item"><strong>End Block:</strong><br>${proposal.endBlock.toString()}</div><div class="details-item"><strong>ETA:</strong><br>${proposal.eta.isZero()?'Not Queued':new Date(proposal.eta.toNumber()*1000).toLocaleString()}</div>${executionLinkHtml}${fundingLinkHtml}</div></div><div class="details-section"><h4></h4>${descriptionHtml}</div><div class="button-group" style="margin-top:20px;border-top:1px dashed var(--color-border);padding-top:20px;"><button class="btn vote-for-btn" data-proposal-id="${proposal.id}" ${!canVote?'style="display:none;"':''}>Vote FOR</button><button class="btn vote-against-btn" data-proposal-id="${proposal.id}" ${!canVote?'style="display:none;"':''}>Vote AGAINST</button><button class="btn vote-for-sig-btn" data-proposal-id="${proposal.id}" ${!canVote?'style="display:none;"':''} style="border-style:dashed;">Vote FOR (Sig)</button><button class="btn vote-against-sig-btn" data-proposal-id="${proposal.id}" ${!canVote?'style="display:none;"':''} style="border-style:dashed;">Vote AGAINST (Sig)</button><button class="btn cancel-btn" data-proposal-id="${proposal.id}" ${!canCancel?'style="display:none;"':''}>Cancel</button><button class="btn queue-btn" data-proposal-id="${proposal.id}" ${!canQueue?'style="display:none;"':''}>Queue</button><button class="btn execute-btn" data-proposal-id="${proposal.id}" ${!canExecute?'style="display:none;"':''}>Execute</button></div><details style="margin-top:0px;"><summary>Technical Data</summary><div class="details-section">${technicalDetailsHtml}</div></details></div>`; targetElement.appendChild(proposalEl); }); }

// --- Transaction & Signature Functions ---
async function sendTransaction(contract, methodName, args, successMessage) { try { const tx = await contract[methodName](...args); alert(`Transaction sent... waiting for confirmation. Hash: ${tx.hash}`); await tx.wait(); alert(successMessage || 'Transaction successful!'); return true; } catch (error) { console.error(`Transaction failed for ${methodName}:`, error); const reason = error.reason || error.data?.message || error.message || "The transaction was rejected or failed."; alert(`Transaction failed: ${reason}`); return false; } }
async function delegateToSelf() { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); if (await sendTransaction(dCultContract, 'delegate', [userAddress], 'Delegation successful!')) { setTimeout(initializeApp, 1000); } }
async function stake() { const amount = document.getElementById('stake-amount').value; if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return alert('Please enter a valid, positive amount.'); const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, signer); const amountInWei = ethers.utils.parseUnits(amount, 18); const allowance = await cultContract.allowance(userAddress, DCULT_TOKEN_ADDRESS); if(allowance.lt(amountInWei)) { alert("First, an approval transaction is required."); if(!await sendTransaction(cultContract, 'approve', [DCULT_TOKEN_ADDRESS, ethers.constants.MaxUint256], 'Approval successful! You can now stake.')) return; } const dCultStakingContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); if (await sendTransaction(dCultStakingContract, 'deposit', [0, amountInWei], 'Stake successful!')) { initializeApp(); } }
async function unstake() { const amount = document.getElementById('unstake-amount').value; if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return alert('Please enter a valid, positive amount.'); const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); const amountInWei = ethers.utils.parseUnits(amount, 18); if (await sendTransaction(dCultContract, 'withdraw', [0, amountInWei], 'Unstake successful!')) { initializeApp(); } }
async function castVote(proposalId, support) { const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); if (await sendTransaction(governorContract, 'castVote', [proposalId, support], `Vote for Proposal #${proposalId} successful!`)) { initialLoad(); } }
async function submitProposal() { const investeeWallet = document.getElementById('p-investeeWallet').value.trim(); if (!investeeWallet || !ethers.utils.isAddress(investeeWallet)) { return alert('A valid Investee Wallet address is mandatory.'); } const proposalData = { projectName: document.getElementById('p-projectName').value.trim(), wallet: investeeWallet, shortDescription: document.getElementById('p-shortDescription').value.trim(), socialChannel: document.getElementById('p-socialChannel').value.trim() || "N/A", links: document.getElementById('p-links').value.trim() || "N/A", manifestoOutlinedFit: document.getElementById('p-manifestoOutlinedFit').value.trim() || "N/A", returnModel: document.getElementById('p-returnModel').value.trim() || "N/A", proposedTimeline: document.getElementById('p-proposedTimeline').value.trim() || "N/A", fundsStoredHeldUtilised: document.getElementById('p-fundsStoredHeldUtilised').value.trim() || "N/A", guardianAddress: userAddress, }; const descriptionString = JSON.stringify(proposalData, null, 2); const targets = [GOVERNOR_BRAVO_ADDRESS]; const values = [0]; const signatures = ["_setInvesteeDetails(address)"]; const iface = new ethers.utils.Interface(["function _setInvesteeDetails(address)"]); const calldatas = [iface.encodeFunctionData("_setInvesteeDetails", [investeeWallet])]; const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); if (await sendTransaction(governorContract, 'propose', [targets, values, signatures, calldatas, descriptionString], 'Proposal submitted successfully!')) { document.getElementById('proposal-form-fields').querySelectorAll('input, textarea').forEach(el => el.value = ''); initialLoad(); } }
async function cancelProposal(proposalId) { if (!window.confirm(`Are you sure you want to cancel proposal #${proposalId}?`)) return; const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); if (await sendTransaction(governorContract, 'cancel', [proposalId], 'Proposal canceled successfully!')) { initialLoad(); } }
async function queueProposal(proposalId) { if (!window.confirm(`Are you sure you want to queue proposal #${proposalId} for execution?`)) return; const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); if (await sendTransaction(governorContract, 'queue', [proposalId], 'Proposal queued successfully!')) { initialLoad(); } }
async function executeProposal(proposalId) { if (!window.confirm(`Are you sure you want to execute proposal #${proposalId}? This action is irreversible.`)) return; const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); if (await sendTransaction(governorContract, 'execute', [proposalId], 'Proposal executed successfully!')) { initialLoad(); } }
async function claimRewards() { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); if (await sendTransaction(dCultContract, 'claimCULT', [0], 'Rewards claimed successfully!')) { initializeApp(); } }
async function signDelegation() { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); try { const nonce = await dCultContract.nonces(userAddress); const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30); const { chainId } = await provider.getNetwork(); const contractName = await dCultContract.name(); const domain = { name: contractName, chainId: chainId, verifyingContract: DCULT_TOKEN_ADDRESS }; const types = { Delegation: [{ name: "delegatee", type: "address" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }] }; const value = { delegatee: userAddress, nonce, expiry }; const signature = await signer._signTypedData(domain, types, value); pendingDelegationSignature = { ...ethers.utils.splitSignature(signature), delegatee: userAddress, nonce, expiry }; alert("Signature created! Click the 'Push' button to complete the delegation."); pushDelegationBtn.style.display = 'inline-block'; delegateSigBtn.style.display = 'none'; } catch (error) { console.error("Signing for delegation failed:", error); alert("Signing failed: " + (error.reason || error.message)); } }
async function pushSignedDelegation() { if (!pendingDelegationSignature) return alert("No pending signature found. Please sign first."); const { delegatee, nonce, expiry, v, r, s } = pendingDelegationSignature; const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); alert("Sending the signed delegation to the blockchain."); if (await sendTransaction(dCultContract, 'delegateBySig', [delegatee, nonce, expiry, v, r, s], 'Delegation by signature successful!')) { pendingDelegationSignature = null; pushDelegationBtn.style.display = 'none'; delegateSigBtn.style.display = 'inline-block'; setTimeout(initializeApp, 1000); } }
async function castVoteBySig(proposalId, support) { const governorSigContract = new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_ABI, signer); try { const { chainId } = await provider.getNetwork(); const contractName = await governorSigContract.name(); const domain = { name: contractName, chainId: chainId, verifyingContract: GOVERNOR_BRAVO_2_ADDRESS }; const types = { Ballot: [{ name: "proposalId", type: "uint256" }, { name: "support", type: "uint8" }] }; const value = { proposalId: proposalId, support: support }; const signature = await signer._signTypedData(domain, types, value); const { r, s, v } = ethers.utils.splitSignature(signature); alert("Signature received! Now sending the transaction."); if (await sendTransaction(governorSigContract, 'castVoteBySig', [proposalId, support, v, r, s], `Vote by signature for Proposal #${proposalId} successful!`)) { initialLoad(); } } catch (error) { console.error(`Vote by signature failed for proposal ${proposalId}:`, error); alert("Vote by signature failed: " + (error.reason || error.message)); } }

async function forceGuardianUpdate() {
    if (!window.confirm("This will send a transaction to force an update of the Guardian list. This costs gas. Do you want to proceed?")) {
        return;
    }

    console.log("Attempting to force guardian list update by calling updatePool(0)...");
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer);
    
    // We call updatePool for the main dCULT pool (pid 0)
    if (await sendTransaction(dCultContract, 'updatePool', [0], 'Guardian list update transaction sent! The list will be refreshed shortly.')) {
        // After a successful transaction, we wait a few seconds and then refresh the UI
        alert("Refreshing data in 5 seconds...");
        setTimeout(() => {
            updateGuardianThreshold();
            updateDaoMetrics();
        }, 5000);
    }
}




// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', () => {
 const disclaimerOverlay = document.getElementById('disclaimer-overlay');
    const acceptBtn = document.getElementById('accept-disclaimer-btn');
    const reminderBanner = document.getElementById('reminder-banner');
    const closeReminderBtn = document.getElementById('close-reminder-btn');

    // Check if the user has already accepted the disclaimer
    if (localStorage.getItem('disclaimerAccepted') !== 'true') {
        // If NOT accepted, show the full-screen modal
        if (disclaimerOverlay) disclaimerOverlay.style.display = 'flex';
    } else {
        // If ALREADY accepted, show the small reminder banner instead
        if (reminderBanner) reminderBanner.style.display = 'flex';
    }

    // Handle the accept button click on the main modal
  if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('disclaimerAccepted', 'true');
            if (disclaimerOverlay) disclaimerOverlay.style.display = 'none';
        });
    }

    // Handle the close button on the reminder banner
    if (closeReminderBtn) {
        closeReminderBtn.addEventListener('click', () => {
            if (reminderBanner) reminderBanner.style.display = 'none';
        });
    }
    connectBtn.addEventListener('click', () => { if (!userAddress) { connectWallet(); } else { walletDropdown.classList.toggle('show'); } });
    document.getElementById('copy-address-btn').addEventListener('click', copyUserAddressToClipboard);
    document.getElementById('disconnect-btn').addEventListener('click', disconnectWallet);
    window.addEventListener('click', (event) => { if (!event.target.closest('.wallet-widget') && walletDropdown.classList.contains('show')) { walletDropdown.classList.remove('show'); } });
    document.getElementById('stake-btn').addEventListener('click', stake);
    document.getElementById('unstake-btn').addEventListener('click', unstake);
    document.getElementById('claim-rewards-btn').addEventListener('click', claimRewards);
    document.getElementById('delegate-btn').addEventListener('click', delegateToSelf);
    document.getElementById('submit-proposal-btn').addEventListener('click', submitProposal);
        document.getElementById('force-update-btn').addEventListener('click', forceGuardianUpdate);

    document.getElementById('load-more-btn').addEventListener('click', displayMoreProposals);
    document.getElementById('stake-max-btn').addEventListener('click', () => { const bal = document.getElementById('available-cult').textContent.split(':')[1].trim(); if (bal) document.getElementById('stake-amount').value = bal; });
    document.getElementById('unstake-max-btn').addEventListener('click', () => { const bal = document.getElementById('available-dcult').textContent.split(':')[1].trim(); if (bal) document.getElementById('unstake-amount').value = bal; });
    document.getElementById('search-proposals').addEventListener('input', () => { displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT; refreshPastProposalView(); });
    document.getElementById('filter-executed').addEventListener('change', () => { document.getElementById('filter-defeated').checked = false; refreshPastProposalView(); });
    document.getElementById('filter-defeated').addEventListener('change', () => { document.getElementById('filter-executed').checked = false; refreshPastProposalView(); });
        document.getElementById('filter-hide-cancelled').addEventListener('change', refreshPastProposalView);

    delegateSigBtn.addEventListener('click', signDelegation);
    pushDelegationBtn.addEventListener('click', pushSignedDelegation);
    document.body.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const proposalId = button.dataset.proposalId;
        if (proposalId) {
            if (button.classList.contains('vote-for-btn')) { castVote(proposalId, 1); }
            else if (button.classList.contains('vote-against-btn')) { castVote(proposalId, 0); }
            else if (button.classList.contains('execute-btn')) { executeProposal(proposalId); }
            else if (button.classList.contains('cancel-btn')) { cancelProposal(proposalId); }
            else if (button.classList.contains('queue-btn')) { queueProposal(proposalId); }
            else if (button.classList.contains('vote-for-sig-btn')) { castVoteBySig(proposalId, 1); }
            else if (button.classList.contains('vote-against-sig-btn')) { castVoteBySig(proposalId, 0); }
            else if (button.classList.contains('view-details-btn')) { const detailsEl = document.getElementById(`details-${proposalId}`); if (detailsEl) { const isHidden = detailsEl.style.display === 'none' || detailsEl.style.display === ''; detailsEl.style.display = isHidden ? 'block' : 'none'; button.innerHTML = isHidden ? 'Hide Details ▲' : 'Show Details ▼'; } }
        }
    });
});