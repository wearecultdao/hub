// --- START OF FINAL app.js ---

import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.0.5/+esm';
// =========================================================================
// app.js - Version 0.8 fl0ri0
// =========================================================================

// === Imports ===
O ki8import {
  CULT_TOKEN_ADDRESS, DCULT_TOKEN_ADDRESS, GOVERNOR_BRAVO_ADDRESS,
  GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_ABI, GOVERNOR_BRAVO_2_ABI,
  DCULT_ABI, CULT_TOKEN_ABI, UNISWAP_PAIR_ADDRESS, UNISWAP_PAIR_ABI,
  TREASURY_ADDRESS, TREASURY_ABI, DEAD_WALLET_1, DEAD_WALLET_2
} from './contracts.js';

// --- Constants & Config ---
const ETH_TO_BURN_PER_PROPOSAL = 2.5;
const ETH_TO_FUND_PER_PROPOSAL = 13;
const API_BASE_URL = "https://api.cultdao.io/";
const INITIAL_PAST_PROPOSAL_COUNT = 10;
const LOAD_MORE_BATCH_SIZE = 50;
const PROPOSAL_STATES = { PENDING: 0, ACTIVE: 1, CANCELED: 2, DEFEATED: 3, SUCCEEDED: 4, QUEUED: 5, EXPIRED: 6, EXECUTED: 7 };
const PROPOSAL_STATE_NAMES = ['Pending', 'Active', 'Canceled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];
const SUPPORTED_CURRENCIES = {
    usd: 'USD', eur: 'EUR', gbp: 'GBP', jpy: 'JPY', aud: 'AUD',
    cad: 'CAD', chf: 'CHF', btc: 'BTC', eth: 'ETH', xau: 'Gold', xag: 'Silver'
};
const DOMPURIFY_CONFIG = { ADD_ATTR: ['target'] };


// --- Global State ---
let provider, signer, userAddress;
let userCultBalanceRaw, userPendingRewardsRaw, userDcultBalanceRaw;
let allProposals = [];
let userDCultBalance = ethers.BigNumber.from(0);
let canceledSet = new Set();
let displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT;
let executionTxMap = new Map();
let fundingTxMap = new Map();
let activeTimers = {};
let averageBlockTime = 12;
let trackedWallets = [];
let trackedWalletsData = new Map();
let preferredCurrency = 'usd';
let priceData = { ethInFiat: 0, cultInEth: 0, baseEthInUsd: 0 };
let onChainDataCache = null;
let alertQueue = [];
let isAlertShowing = false;
let isUserGuardian = false;
let noticeTimeout;
let openProposalsState = new Set(); 

// --- DOM Elements ---
const connectBtn = document.getElementById('connect-wallet-btn');
const dappContent = document.getElementById('dapp-content');
const walletDropdown = document.getElementById('wallet-dropdown');
const currencyWidget = document.getElementById('currency-widget');
const currencySelectorBtn = document.getElementById('currency-selector-btn');
const currencyDropdown = document.getElementById('currency-dropdown');

// --- Helper Functions ---
function createAddressLink(address) {
    if (!address) return 'N/A';
    const isTx = address.length > 42;
    const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    const etherscanUrl = `https://etherscan.io/${isTx ? 'tx' : 'address'}/${address}`;
    const copyIconSvg = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`;
    return `<span class="address-link" title="${address}"><a href="${etherscanUrl}" target="_blank" rel="noopener noreferrer">${shortAddress}</a><span class="copy-action" data-copy-address="${address}">${copyIconSvg}</span></span>`;
}
window.copyTextToClipboard = (text) => { navigator.clipboard.writeText(text).then(() => showCustomAlert("Copied to clipboard!")).catch(err => console.error('Failed to copy text: ', err)); }
function processAlertQueue() {
    if (isAlertShowing || alertQueue.length === 0) return;
    isAlertShowing = true;
    const message = alertQueue.shift();
    const overlay = document.getElementById('custom-alert-overlay');
    const messageEl = document.getElementById('custom-alert-message');
    messageEl.innerHTML = DOMPurify.sanitize(message, DOMPURIFY_CONFIG);
    overlay.style.display = 'flex';
}
function showCustomAlert(message) { alertQueue.push(message); processAlertQueue(); }
function setMetric(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function formatCurrency(value, currencyCode = 'usd') { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function formatNumber(num, digits = 2) { return Number(num).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }); }
function formatBigNumber(numberBN) { return parseFloat(ethers.utils.formatUnits(numberBN, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
async function calculateAverageBlockTime() { try { const latestBlock = await provider.getBlock('latest'); const pastBlock = await provider.getBlock(latestBlock.number - 100); if (!latestBlock || !pastBlock) return 12; return (latestBlock.timestamp - pastBlock.timestamp) / 100; } catch (error) { console.error("Error calculating average block time:", error); return 12; } }
async function fetchAndDisplayRepoUpdate() { try { const response = await fetch('https://api.github.com/repos/wearecultdao/hub'); const data = await response.json(); setMetric('repo-update-date', new Date(data.pushed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })); } catch (error) { console.error("Failed to fetch GitHub repo update date:", error); setMetric('repo-update-date', 'N/A'); } }

// --- Wallet Tracking Functions ---
function loadTrackedWallets() { const savedWallets = localStorage.getItem('trackedWallets'); if (savedWallets) { try { trackedWallets = JSON.parse(savedWallets); } catch (e) { console.error("Failed to parse tracked wallets:", e); trackedWallets = []; } } }
function saveTrackedWallets() { localStorage.setItem('trackedWallets', JSON.stringify(trackedWallets)); }
async function fetchTrackedWalletData(address) {
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider);
    try {
        const [cultBalanceRaw, dcultBalanceRaw, delegatee, isGuardian, pendingRewardsRaw] = await Promise.all([
            cultContract.balanceOf(address), dCultContract.balanceOf(address),
            dCultContract.delegates(address), dCultContract.checkHighestStaker(0, address),
            dCultContract.pendingCULT(0, address)
        ]);
        const cultFormatted = parseFloat(ethers.utils.formatUnits(cultBalanceRaw, 18));
        const dcultFormatted = parseFloat(ethers.utils.formatUnits(dcultBalanceRaw, 18));
        const pendingCult = parseFloat(ethers.utils.formatUnits(pendingRewardsRaw, 18));
        const delegationStatus = (delegatee.toLowerCase() === address.toLowerCase()) ? "Self-Delegated (Active)" : (delegatee === ethers.constants.AddressZero) ? "Not Delegated (Inactive)" : `Delegated to ${createAddressLink(delegatee)}`;
        const votingRights = isGuardian ? `<span class="value the-many">Guardian</span>` : dcultBalanceRaw.gt(0) ? `<span class="value the-many">The Many</span>` : "None (No dCULT)";
        const totalHoldings = cultFormatted + dcultFormatted + pendingCult;
        return { address, cultBalance: cultFormatted, dcultBalance: dcultFormatted, totalHoldings, delegationStatus, votingRights };
    } catch (error) {
        console.error(`Error fetching data for ${address}:`, error);
        return { address, cultBalance: "Error", dcultBalance: "Error", totalHoldings: "Error", delegationStatus: "Error", votingRights: "Error" };
    }
}
async function renderTrackedWallets() {
    const listContainer = document.getElementById('tracked-wallets-list');
    const clearBtn = document.getElementById('clear-tracked-wallets-btn');
    if (clearBtn) {
        clearBtn.style.display = trackedWallets.length > 0 ? 'inline-block' : 'none';
    }
    listContainer.innerHTML = '';
    if (trackedWallets.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; opacity: 0.6; padding: 20px;">No wallets being tracked yet.</p>';
        setMetric('combined-tracked-cult', "0.00");
        setMetric('combined-tracked-dcult', "0.00");
        setMetric('combined-tracked-total', "0.00");
        setMetric('combined-tracked-value', formatCurrency(0, preferredCurrency));
        return;
    }
    let totalCult = 0, totalDcult = 0, totalCombinedHoldings = 0;
    for (const address of trackedWallets) {
        const walletData = trackedWalletsData.get(address);
        if (!walletData) continue;
        if (typeof walletData.cultBalance === 'number') totalCult += walletData.cultBalance;
        if (typeof walletData.dcultBalance === 'number') totalDcult += walletData.dcultBalance;
        if (typeof walletData.totalHoldings === 'number') totalCombinedHoldings += walletData.totalHoldings;
        const cultInFiat = priceData.cultInEth * priceData.ethInFiat;
        const totalValueFiat = walletData.totalHoldings * cultInFiat;
        const walletEl = document.createElement('div');
        walletEl.className = 'info-grid';
        walletEl.style.cssText = `display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 16px; padding: 15px; border-radius: 8px; background-color: var(--color-bg-tracked);`;
        walletEl.innerHTML = DOMPurify.sanitize(`
            <div class="info-item"><h3>Wallet</h3><span class="value">${createAddressLink(walletData.address)}</span></div>
            <div class="info-item"><h3>Delegation Status</h3><span class="value">${walletData.delegationStatus}</span></div>
            <div class="info-item"><h3>Voting Rights</h3>${walletData.votingRights}</div>
            <div class="info-item"><h3>CULT Balance</h3><span class="value">${formatNumber(walletData.cultBalance)}</span></div>
            <div class="info-item"><h3>dCULT Balance</h3><span class="value">${formatNumber(walletData.dcultBalance)}</span></div>
            <div class="info-item"><h3>Total Holdings</h3><span class="value">${formatNumber(walletData.totalHoldings)}</span></div>
            <div class="info-item"><h3>Value (${preferredCurrency.toUpperCase()})</h3><span class="value">${priceData.ethInFiat > 0 ? formatCurrency(totalValueFiat, preferredCurrency) : 'API Error'}</span></div>
            <div class="info-item"></div><div class="info-item"></div>
            <div class="info-item" style="text-align: right;">
            <button class="btn3 remove-tracked-wallet-btn" data-wallet-address="${walletData.address}">Remove</button>
            </div>`, { ...DOMPURIFY_CONFIG, ADD_ATTR: ['data-wallet-address'] });
        listContainer.appendChild(walletEl);
    }
    setMetric('combined-tracked-cult', formatNumber(totalCult));
    setMetric('combined-tracked-dcult', formatNumber(totalDcult));
    setMetric('combined-tracked-total', formatNumber(totalCombinedHoldings));
    const combinedValueFiat = totalCombinedHoldings * priceData.cultInEth * priceData.ethInFiat;
    setMetric('combined-tracked-value', priceData.ethInFiat > 0 ? formatCurrency(combinedValueFiat, preferredCurrency) : 'API Error');
}

// --- Core Application Logic ---
async function connectWallet() { if (typeof window.ethereum === 'undefined') return alert('Please install MetaMask.'); try { provider = new ethers.providers.Web3Provider(window.ethereum); await provider.send("eth_requestAccounts", []); signer = provider.getSigner(); userAddress = await signer.getAddress(); onChainDataCache = null; connectBtn.textContent = `${userAddress.substring(0, 6)}...`; connectBtn.disabled = false; dappContent.style.display = 'block'; document.getElementById('etherscan-link').href = `https://etherscan.io/address/${userAddress}`; document.getElementById('p-proposerWallet').innerHTML = createAddressLink(userAddress); await initializeApp(); } catch (error) { console.error("Failed to connect wallet:", error); } }
function disconnectWallet() { location.reload(); }
function copyUserAddressToClipboard() { if (userAddress) { copyTextToClipboard(userAddress); walletDropdown.classList.remove('show'); } }

async function initializeApp() { 
    if (!signer) return; 
    const savedCurrency = localStorage.getItem('preferredCurrency');
    const browserCurrency = (Intl.NumberFormat().resolvedOptions().currency || 'usd').toLowerCase();
    preferredCurrency = savedCurrency || (Object.keys(SUPPORTED_CURRENCIES).includes(browserCurrency) ? browserCurrency : 'usd');
    
    currencySelectorBtn.textContent = SUPPORTED_CURRENCIES[preferredCurrency];

    averageBlockTime = await calculateAverageBlockTime();
    loadTrackedWallets();
    await updateBalances();
    await Promise.all([updateDelegationStatus(), updateClaimableRewards(), updateDelegationCounter()]);
    await initialLoad(); 
    await Promise.all([ updateGuardianThreshold(), checkUserRights() ]);
    await refreshAllTrackedWalletData();

    setTimeout(() => {
        const activeProposalsDetails = document.getElementById('details-active-proposals');
        if (activeProposalsDetails) {
            const activeProposalsCountText = document.getElementById('metric-active-proposals').textContent;
            const activeProposalsCount = parseInt(activeProposalsCountText, 10);
            if (!isNaN(activeProposalsCount) && activeProposalsCount > 0) {
                activeProposalsDetails.open = true;
            }
        }
    }, 800);
}
async function handleAddWalletInput() {
  const inputField = document.getElementById('track-wallet-input');
  const potentialWallets = inputField.value
    .split(';')
    .map(w => w.trim())
    .filter(w => isValidInput(w)); 

  if (potentialWallets.length === 0)
    return showCustomAlert("Please enter valid wallet addresses or ENS names only.");

  await Promise.all(potentialWallets.map(addTrackedWallet));
  inputField.value = '';
}
function isValidInput(input) {
  return /^0x[a-fA-F0-9]{40}$/.test(input) || /^[a-zA-Z0-9\-]+\.eth$/.test(input);
}
async function addTrackedWallet(addressOrEns) { if (!provider) return; let resolvedAddress = addressOrEns; try { if (addressOrEns.endsWith('.eth')) { showCustomAlert(`Resolving ENS: ${addressOrEns}...`); resolvedAddress = await provider.resolveName(addressOrEns); if (!resolvedAddress) throw new Error("Could not resolve ENS name."); } if (!ethers.utils.isAddress(resolvedAddress)) throw new Error("Invalid address or ENS name."); const lowerCaseAddress = resolvedAddress.toLowerCase(); if (trackedWallets.includes(lowerCaseAddress)) { showCustomAlert(`${resolvedAddress.substring(0,6)}... is already tracked.`); return; } showCustomAlert(`Adding ${resolvedAddress.substring(0, 6)}...`); trackedWallets.push(lowerCaseAddress); saveTrackedWallets(); const data = await fetchTrackedWalletData(resolvedAddress); trackedWalletsData.set(lowerCaseAddress, data); await renderTrackedWallets(); document.getElementById('custom-alert-overlay').style.display = 'none'; isAlertShowing = false; processAlertQueue(); } catch(error) { showCustomAlert(`Failed to add wallet "${addressOrEns}": ${error.message}`); } }
function removeTrackedWallet(addressToRemove) { trackedWallets = trackedWallets.filter(addr => addr !== addressToRemove.toLowerCase()); trackedWalletsData.delete(addressToRemove.toLowerCase()); saveTrackedWallets(); renderTrackedWallets(); showCustomAlert(`Removed wallet from tracked list.`); }
function clearAllTrackedWallets() { if (confirm("Are you sure you want to clear all tracked wallets?")) { trackedWallets = []; trackedWalletsData.clear(); saveTrackedWallets(); renderTrackedWallets(); showCustomAlert("All tracked wallets cleared."); } }
async function refreshAllTrackedWalletData() { await Promise.all(trackedWallets.map(address => fetchTrackedWalletData(address).then(data => trackedWalletsData.set(address, data)))); await renderTrackedWallets(); }
async function updateGuardianThreshold() { try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); const stakerData = await dCultContract.highestStakerInPool(0, 0); const thresholdAmount = ethers.utils.formatUnits(stakerData.deposited, 18); setMetric('top50staker', formatNumber(parseFloat(thresholdAmount))); } catch (error) { console.error("Error fetching guardian threshold:", error); setMetric('top50staker', "Error"); } }
async function updateBalances() { try { const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); [userCultBalanceRaw, userDcultBalanceRaw] = await Promise.all([cultContract.balanceOf(userAddress), dCultContract.balanceOf(userAddress)]); userDCultBalance = userDcultBalanceRaw; const cultFormatted = ethers.utils.formatUnits(userCultBalanceRaw, 18); setMetric('cult-balance', formatNumber(parseFloat(cultFormatted))); setMetric('available-cult', `Available: ${cultFormatted}`); const dcultFormatted = ethers.utils.formatUnits(userDcultBalanceRaw, 18); setMetric('dcult-balance', formatNumber(parseFloat(dcultFormatted))); setMetric('available-dcult', `Available: ${dcultFormatted}`); document.getElementById('wallet-address').innerHTML = createAddressLink(userAddress); } catch (error) { console.error("Error updating balances:", error); } }

function showAndFadeNotice(message) {
    const noticeContainer = document.getElementById('top50-notice-container');
    const noticeText = document.getElementById('top50-notice');
    if (!noticeContainer || !noticeText) return;

    if (noticeTimeout) clearTimeout(noticeTimeout);

    noticeText.innerHTML = DOMPurify.sanitize(message);
    noticeContainer.style.opacity = '1';
    noticeContainer.style.display = 'flex';

    noticeTimeout = setTimeout(() => {
        noticeContainer.style.transition = 'opacity 3.5s ease-out';
        noticeContainer.style.opacity = '0';
        setTimeout(() => {
            if (noticeContainer.style.opacity === '0') {
                 noticeContainer.style.display = 'none';
                 noticeContainer.style.transition = ''; 
            }
        }, 5000); 
    }, 180000);
}

async function updateDelegationStatus() {
    try {
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
        const [delegatee, isGuardian] = await Promise.all([
            dCultContract.delegates(userAddress),
            dCultContract.checkHighestStaker(0, userAddress)
        ]);
        
        isUserGuardian = isGuardian; 

        const isSelfDelegated = delegatee.toLowerCase() === userAddress.toLowerCase();
        setMetric('delegation-status', isSelfDelegated ? "Self-Delegated (Active)" : "Not Delegated (Inactive)");

        const delegateBtn = document.getElementById('delegate-btn');
        const signDelegationBtn = document.getElementById('sign-delegation-btn');
        const delegateSection = document.getElementById('delegate-section');
        const noticeContainer = document.getElementById('top50-notice-container');
        
        delegateSection.style.display = 'flex';
        noticeContainer.style.display = 'none'; 

        if (isUserGuardian) {
            showAndFadeNotice("Guardians (Top 50 Stakers) cannot delegate.");
            delegateBtn.style.display = 'none';
            signDelegationBtn.style.display = 'none';
        } else {
            if (userDCultBalance.gt(0) && !isSelfDelegated) {
                showAndFadeNotice("To participate in DAO votings you still need to delegate your staked Cult.");
            } else if (isSelfDelegated && userDCultBalance.isZero()) {
                showAndFadeNotice("Your Delegation Status is active but you do not stake any Cult. Stake some to participate in DAO votings.");
            }
            
            if (userDCultBalance.gt(0)) {
                delegateBtn.style.display = 'inline-block';
                signDelegationBtn.style.display = 'inline-block';
            } else {
                delegateBtn.style.display = 'none';
                signDelegationBtn.style.display = 'none';
            }
        }
    } catch (error) {
        console.error("Error fetching delegation status:", error);
        setMetric('delegation-status', "Error");
    }
}
async function checkUserRights() {
    const proposalSection = document.getElementById('submit-proposal-section');
    const notice = document.getElementById('proposal-eligibility-notice');
    try {
        isUserGuardian = await new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider).checkHighestStaker(0, userAddress);
        
        proposalSection.classList.remove('dimmed-section');
        notice.style.display = 'none';
        setMetric('rights-label', isUserGuardian ? "Proposal Rights" : "Voting Rights");
        const rightsValueEl = document.getElementById('proposal-rights');
        rightsValueEl.classList.remove('the-many');

        if (isUserGuardian) {
            rightsValueEl.textContent = "Guardian";
            rightsValueEl.classList.add('the-many');
        } else {
            if (userDCultBalance.gt(0)) {
                rightsValueEl.textContent = "The Many";
                rightsValueEl.classList.add('the-many');
            } else {
                rightsValueEl.textContent = "None (No dCULT)";
            }
            proposalSection.classList.add('dimmed-section');
            notice.textContent = "Only Guardians (Top 50 Stakers) can submit proposals.";
            notice.style.display = 'block';
        }
    } catch (error) {
        console.error("Error checking user rights:", error);
        proposalSection.classList.add('dimmed-section');
        notice.textContent = 'Error checking eligibility.';
        notice.style.display = 'block';
        setMetric('proposal-rights', "Error");
    }
}
async function updateClaimableRewards() { try { const claimBtn = document.getElementById('claim-rewards-btn'); const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); if (userDCultBalance.isZero()) { setMetric('claimable-rewards', "0.00"); claimBtn.style.display = 'none'; return; } const pendingRewardsRaw = await dCultContract.pendingCULT(0, userAddress); userPendingRewardsRaw = pendingRewardsRaw; setMetric('claimable-rewards', formatNumber(parseFloat(ethers.utils.formatUnits(pendingRewardsRaw, 18)))); claimBtn.style.display = pendingRewardsRaw.gt(0) ? 'inline-block' : 'none'; } catch (error) { console.error("Error fetching claimable rewards:", error); setMetric('claimable-rewards', "Error"); } }
async function updateDelegationCounter() { try { const response = await fetch(`${API_BASE_URL}delegate/counter`); const { data: count = 0 } = await response.json(); setMetric('delegate-counter', count); document.getElementById('push-delegates-btn').style.display = (count > 0) ? 'inline-block' : 'none'; } catch(e) { console.error("Could not fetch delegate counter:", e); setMetric('delegate-counter', "N/A"); document.getElementById('push-delegates-btn').style.display = 'none'; } }

// --- CURRENCY & METRICS ---
async function fetchUniswapPoolData(provider) { const pair = new ethers.Contract(UNISWAP_PAIR_ADDRESS, UNISWAP_PAIR_ABI, provider); const token0 = await pair.token0(); const [reserve0, reserve1] = await pair.getReserves(); const isCultToken0 = token0.toLowerCase() === CULT_TOKEN_ADDRESS.toLowerCase(); const cultReserve = isCultToken0 ? reserve0 : reserve1; const ethReserve = isCultToken0 ? reserve1 : reserve0; const cultFormatted = parseFloat(ethers.utils.formatUnits(cultReserve, 18)); const ethFormatted = parseFloat(ethers.utils.formatUnits(ethReserve, 18)); const price = ethFormatted > 0 ? ethFormatted / cultFormatted : 0; return { cultInLP: cultFormatted, ethInLP: ethFormatted, price }; }
async function handleCurrencyChange(newCurrency) {
    if (!newCurrency || !SUPPORTED_CURRENCIES[newCurrency]) return;
    preferredCurrency = newCurrency;
    localStorage.setItem('preferredCurrency', preferredCurrency);
    currencySelectorBtn.textContent = SUPPORTED_CURRENCIES[newCurrency];
    showCustomAlert(`Fetching prices in ${SUPPORTED_CURRENCIES[newCurrency]}...`);
    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=${preferredCurrency}`);
        priceData.ethInFiat = response.ok ? (await response.json())?.ethereum?.[preferredCurrency] || 0 : 0;
        recalculateAndRenderAllFiatValues();
        await refreshAllTrackedWalletData();
        document.getElementById('custom-alert-overlay').style.display = 'none';
        isAlertShowing = false;
        processAlertQueue();
    } catch (e) {
        console.error("Failed to update currency:", e);
        showCustomAlert(`Could not fetch price for ${SUPPORTED_CURRENCIES[newCurrency]}.`);
    }
}
function recalculateAndRenderAllFiatValues() {
    if (!onChainDataCache) return;
    const isApiError = priceData.baseEthInUsd === 0;
    const currency = preferredCurrency.toUpperCase();
    const errorMsg = 'API Error';


    const elements = [
        { id: 'total-cult-value', labelId: 'total-cult-value-label', label: 'Total Value', value: onChainDataCache.userTotalHoldingsValueUsd },
        { id: 'metric-staked-value', labelId: 'metric-staked-value-label', label: 'Staked Value', value: onChainDataCache.stakedValueUsd },
        { id: 'metric-treasury-value', labelId: 'metric-treasury-value-label', label: 'Treasury Value', value: onChainDataCache.treasuryValueUsd },
        { id: 'metric-liquidity', labelId: 'metric-liquidity-label', label: 'Liquidity', value: onChainDataCache.liquidityUsd },
        { id: 'metric-mcap', labelId: 'metric-mcap-label', label: 'Market Cap', value: onChainDataCache.marketCapUsd },
        { id: 'metric-cult-price', labelId: 'metric-cult-price-label', label: 'CULT Price', value: onChainDataCache.cultInUsd },
    ];

    elements.forEach(({ id, labelId, label, value }) => {
        const labelEl = document.getElementById(labelId);
        if (labelEl) labelEl.textContent = `${label} (${currency})`;
        
        const valueEl = document.getElementById(id);
        if (valueEl) {
            if (isApiError) {
                valueEl.textContent = errorMsg;
                return;
            }

            const fiatValue = value / priceData.baseEthInUsd * priceData.ethInFiat;

            if (id === 'metric-cult-price') {
                valueEl.textContent = new Intl.NumberFormat(undefined, { 
                    style: 'currency', 
                    currency: preferredCurrency.toUpperCase(), 
                    minimumFractionDigits: 10, 
                    maximumFractionDigits: 10 
                }).format(fiatValue);
            } else {
                valueEl.textContent = formatCurrency(fiatValue, preferredCurrency);
            }
        }
    });
}
async function fetchOnChainAndPriceData() {
    document.querySelectorAll('#dao-metrics-section .value, #combined-tracked-value, #total-cult-value').forEach(el => el.textContent = '...');
    try {
        const poolData = await fetchUniswapPoolData(provider);
        const cult = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider);
        const dcult = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
        const allCurrencies = Object.keys(SUPPORTED_CURRENCIES).join(',');
        const [cultSupply, dcultSupply, burned1, burned2, treasuryCultRaw, ethPriceResUsd] = await Promise.all([
            cult.totalSupply(), dcult.totalSupply(), cult.balanceOf(DEAD_WALLET_1),
            cult.balanceOf(DEAD_WALLET_2), cult.balanceOf(TREASURY_ADDRESS),
            fetch(`https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=${allCurrencies}`)
        ]);
        
        const priceApiResponse = ethPriceResUsd.ok ? await ethPriceResUsd.json() : null;
        priceData.baseEthInUsd = priceApiResponse?.ethereum?.usd || 0;
        priceData.ethInFiat = priceApiResponse?.ethereum?.[preferredCurrency] || priceData.baseEthInUsd;
        priceData.cultInEth = poolData.price;
        
        if (priceData.baseEthInUsd === 0) throw new Error("Base USD price fetch failed.");

        const cultInUsd = priceData.cultInEth * priceData.baseEthInUsd;
        const totalBurnedBN = burned1.add(burned2);
        const circulatingSupplyBN = cultSupply.sub(totalBurnedBN);
                
        const walletCult = parseFloat(ethers.utils.formatUnits(userCultBalanceRaw || 0, 18));
        const dcultVal = parseFloat(ethers.utils.formatUnits(userDcultBalanceRaw || 0, 18));
        const pendingCult = parseFloat(ethers.utils.formatUnits(userPendingRewardsRaw || 0, 18));
        setMetric('total-cult-holdings', formatNumber(walletCult + dcultVal + pendingCult));

        onChainDataCache = {
            cultSupply, dcultSupply, totalBurnedBN, circulatingSupplyBN, cultInUsd,
            treasuryCult: parseFloat(ethers.utils.formatUnits(treasuryCultRaw, 18)),
            stakedCult: parseFloat(ethers.utils.formatUnits(dcultSupply, 18)),
            cultInLP: poolData.cultInLP, ethInLP: poolData.ethInLP,
            liquidityUsd: (poolData.ethInLP * priceData.baseEthInUsd) + (poolData.cultInLP * cultInUsd),
            marketCapUsd: parseFloat(ethers.utils.formatUnits(circulatingSupplyBN, 18)) * cultInUsd,
            treasuryValueUsd: parseFloat(ethers.utils.formatUnits(treasuryCultRaw, 18)) * cultInUsd,
            stakedValueUsd: parseFloat(ethers.utils.formatUnits(dcultSupply, 18)) * cultInUsd,
            userTotalHoldingsValueUsd: (walletCult + dcultVal + pendingCult) * cultInUsd
        };
        currencyWidget.style.display = 'block';
        return true;
    } catch (err) {
        console.error("Failed to load DAO metrics:", err);
        priceData.baseEthInUsd = 0;
        recalculateAndRenderAllFiatValues();
        currencyWidget.style.display = 'none';
        return false;
    }
}

function renderStaticMetrics() {
    if (!onChainDataCache) return;
    
    const uniqueProposals = Array.from(new Map(allProposals.map(p => [p.id, p])).values());
    const skippedPassedProposals = uniqueProposals.filter(p => p.forVotes?.gt?.(p.againstVotes || 0) && canceledSet.has(p.id.toString()) && (!p.eta || p.eta.isZero?.()));
    const passedProposals = uniqueProposals.filter(p => [4, 5, 7].includes(p.state)).length;
    const executedProposals = passedProposals - skippedPassedProposals.length;
    
    const activeProposalsCount = uniqueProposals.filter(p => p.state === PROPOSAL_STATES.PENDING || p.state === PROPOSAL_STATES.ACTIVE).length;
    setMetric('metric-active-proposals', activeProposalsCount);

    setMetric('metric-total-proposals', uniqueProposals.length);
    setMetric('metric-passed-proposals', passedProposals);
    setMetric('metric-executed-proposals', executedProposals);
    setMetric('metric-defeated-proposals', uniqueProposals.filter(p => p.state === 3).length);
    setMetric('metric-cancelled-proposals', canceledSet.size);
    setMetric('metric-skipped-passed-proposals', skippedPassedProposals.length);

    setMetric('metric-eth-burned', (executedProposals * ETH_TO_BURN_PER_PROPOSAL).toFixed(2));
    setMetric('metric-eth-funded', (executedProposals * ETH_TO_FUND_PER_PROPOSAL).toFixed(2));
    setMetric('metric-eth-total-disbursed', (executedProposals * (ETH_TO_BURN_PER_PROPOSAL + ETH_TO_FUND_PER_PROPOSAL)).toFixed(2));

    setMetric('metric-cult-supply', formatBigNumber(onChainDataCache.cultSupply));
    setMetric('metric-cult-burned', formatBigNumber(onChainDataCache.totalBurnedBN));
    setMetric('metric-cult-staked', formatBigNumber(onChainDataCache.dcultSupply));
    setMetric('metric-cult-circulating', formatBigNumber(onChainDataCache.circulatingSupplyBN));
    setMetric('metric-treasury-cult', formatNumber(onChainDataCache.treasuryCult, 0));

    setMetric('metric-treasury-value-eth', `${(onChainDataCache.treasuryValueUsd / priceData.baseEthInUsd).toFixed(2)} ETH`);
    setMetric('metric-cult-lp', formatNumber(onChainDataCache.cultInLP));
    setMetric('metric-eth-lp', formatNumber(onChainDataCache.ethInLP));
    setMetric('metric-liq-mcap', `${(onChainDataCache.liquidityUsd / onChainDataCache.marketCapUsd * 100).toFixed(2)}%`);
    setMetric('metric-cult-price-eth', `1 CULT = ${priceData.cultInEth < 1e-3 ? priceData.cultInEth.toExponential(2) : priceData.cultInEth.toFixed(18)} ETH`);
    setMetric('metric-eth-price-cult', `1 ETH = ${formatNumber(1 / priceData.cultInEth, 0)} CULT`);
    
    const stakedPercent = onChainDataCache.dcultSupply.mul(10000).div(onChainDataCache.cultSupply).toNumber() / 100;
    const circSupplyBN = onChainDataCache.circulatingSupplyBN;
    const stakedVsCircPercent = circSupplyBN.isZero() ? 0 : onChainDataCache.dcultSupply.mul(10000).div(circSupplyBN).toNumber() / 100;
    const burnPercent = onChainDataCache.totalBurnedBN.mul(10000).div(onChainDataCache.cultSupply).toNumber() / 100;
    const circSupplyPercent = circSupplyBN.mul(10000).div(onChainDataCache.cultSupply).toNumber() / 100;
    const cultLpPercentTotal = (onChainDataCache.cultInLP / parseFloat(ethers.utils.formatUnits(onChainDataCache.cultSupply, 18))) * 100;
    const cultLpPercentCirc = (onChainDataCache.cultInLP / parseFloat(ethers.utils.formatUnits(circSupplyBN, 18))) * 100;
    setMetric('metric-staked-percent', `${stakedPercent.toFixed(1)}%`);
    setMetric('metric-staked-vs-circ-percent', `${stakedVsCircPercent.toFixed(1)}%`);
    setMetric('metric-cult-burned-percent', `${burnPercent.toFixed(1)}%`);
    setMetric('metric-cult-circulating-percent', `${circSupplyPercent.toFixed(1)}%`);
    setMetric('metric-lp-percent-total', `${cultLpPercentTotal.toFixed(2)}%`);
    setMetric('metric-lp-percent-circ', `${cultLpPercentCirc.toFixed(2)}%`);
    
    setTimeout(() => { 
        const setBar = (id, percent) => { const el = document.getElementById(id); if (el) el.style.width = `${percent.toFixed(1)}%`; }; 
        setBar('bar-burned', burnPercent); setBar('bar-circulating', circSupplyPercent); setBar('bar-staked', stakedPercent); 
        setBar('bar-staked-vs-circ', stakedVsCircPercent); setBar('bar-lp-percent-total', cultLpPercentTotal); setBar('bar-lp-percent-circ', cultLpPercentCirc); 
    }, 100);

    try {
        const unicryptLockerUrl = 'https://app.uncx.network/lockers/univ2/chain/1/address/0x5281e311734869c64ca60ef047fd87759397efe6';
        document.getElementById('metric-locked-liq').innerHTML = `<a href="${unicryptLockerUrl}" target="_blank" rel="noopener noreferrer">99.82%</a>`;
        document.getElementById('metric-unlock-liq').innerHTML = `<a href="${unicryptLockerUrl}" target="_blank" rel="noopener noreferrer">Nov 20, 2286</a>`;
    } catch (e) { /* silent fail */ }
}

// --- TIMER FUNCTIONS ---
function formatTimeRemaining(seconds) { if (seconds <= 0) return "Voting Ended"; const d = Math.floor(seconds / (3600*24)); const h = Math.floor((seconds % (3600*24)) / 3600); const m = Math.floor((seconds % 3600) / 60); const s = Math.floor(seconds % 60); return `${d > 0 ? d + "d " : ""}${h > 0 ? h + "h " : ""}${m > 0 ? m + "m " : ""}${s}s`; }
async function startProposalTimer(proposalId, endBlock) { const timerEl = document.querySelector(`.proposal[data-proposal-id='${proposalId}'] .proposal-timer`); if (!timerEl || !provider) return; try { const currentBlockNumber = await provider.getBlockNumber(); const blocksRemaining = endBlock - currentBlockNumber; if (blocksRemaining <= 0) { timerEl.textContent = "Voting Ended"; return; } let secondsRemaining = blocksRemaining * averageBlockTime; if (activeTimers[proposalId]) clearInterval(activeTimers[proposalId]); const intervalId = setInterval(() => { secondsRemaining -= 1; if (secondsRemaining <= 0) { timerEl.textContent = "Voting Ended"; clearInterval(intervalId); delete activeTimers[proposalId]; } else { timerEl.textContent = formatTimeRemaining(secondsRemaining); } }, 1000); activeTimers[proposalId] = intervalId; } catch (error) { console.error(`Failed to start timer for proposal ${proposalId}:`, error); timerEl.textContent = "Error"; } }

// --- DATA LOADING & RENDERING ---
async function initialLoad() { 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); 
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); 
    Object.values(activeTimers).forEach(clearInterval); 
    activeTimers = {}; 
    document.getElementById('active-proposal-list').innerHTML = '<p>...</p>'; 
    document.getElementById('past-proposal-list').innerHTML = '<p>...</p>'; 
    document.getElementById('load-more-btn').style.display = 'none'; 
    allProposals = []; 
    displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT; 
    
    try { 
        const proposalCount = await governorContract.proposalCount(); 
        const total = proposalCount.toNumber(); 
        const [executedEvents, treasuryDisbursements, canceledEvents] = await Promise.all([ 
            governorContract.queryFilter(governorContract.filters.ProposalExecuted(), 0, 'latest'), 
            cultContract.queryFilter(cultContract.filters.Transfer(TREASURY_ADDRESS, null), 0, 'latest'), 
            governorContract.queryFilter(governorContract.filters.ProposalCanceled(), 0, 'latest') 
        ]); 
        executionTxMap = new Map(executedEvents.filter(e => e.args).map(e => [e.args.id.toString(), e.transactionHash])); 
        fundingTxMap = new Map(); 
        treasuryDisbursements.forEach(event => { if (event.args.to.toLowerCase() !== DEAD_WALLET_1.toLowerCase()) fundingTxMap.set(event.args.to.toLowerCase(), event.transactionHash); }); 
        canceledSet = new Set(canceledEvents.filter(e => e.args).map(e => e.args.id.toString()));
        
        const initialProposals = await fetchProposalBatch(total, Math.max(1, total - INITIAL_PAST_PROPOSAL_COUNT + 1)); 
        allProposals = initialProposals; 
        
        const activeAndPendingProposals = allProposals.filter(p => p.state === PROPOSAL_STATES.PENDING || p.state === PROPOSAL_STATES.ACTIVE);
        const pastProposals = allProposals.filter(p => p.state !== PROPOSAL_STATES.PENDING && p.state !== PROPOSAL_STATES.ACTIVE).sort((a, b) => b.id - a.id);

        renderProposals(activeAndPendingProposals, document.getElementById('active-proposal-list'), { isActiveList: true });
        renderProposals(pastProposals.slice(0, displayedPastProposalsCount), document.getElementById('past-proposal-list'), { isActiveList: false });
        document.getElementById('load-more-btn').style.display = pastProposals.length > displayedPastProposalsCount ? 'block' : 'none';

        activeAndPendingProposals.forEach(proposal => { 
            if (proposal.state === PROPOSAL_STATES.ACTIVE) {
                startProposalTimer(proposal.id, proposal.endBlock.toNumber()); 
            }
            updateVoteCounterForProposal(proposal.id); 
        }); 
        
        if (await fetchOnChainAndPriceData()) { 
            renderStaticMetrics(); 
            recalculateAndRenderAllFiatValues(); 
        } 
        
        await loadAllProposalsInBackground(total - allProposals.length); 

    } catch (e) { 
        console.error("Could not load proposals:", e); 
    } 
}

async function loadAllProposalsInBackground(startingId) { 
    if (startingId <= 0) return; 
    let currentId = startingId; 
    while (currentId > 0) { 
        const batchEndId = Math.max(0, currentId - LOAD_MORE_BATCH_SIZE + 1); 
        const newProposals = await fetchProposalBatch(currentId, batchEndId); 
        const proposalMap = new Map(allProposals.map(p => [p.id, p])); 
        newProposals.forEach(p => proposalMap.set(p.id, p)); 
        allProposals = Array.from(proposalMap.values()).sort((a, b) => b.id - a.id); 
        currentId = batchEndId - 1; 
    } 
    console.log("All historical proposals loaded in background."); 
    renderStaticMetrics(); 
    refreshPastProposalView(); 
}
async function fetchProposalBatch(startId, endId) { const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); const promises = []; const events = await governorContract.queryFilter(governorContract.filters.ProposalCreated(), 0, 'latest'); const descriptionMap = new Map(events.map(e => [e.args.id.toString(), e.args.description])); for (let i = startId; i >= endId && i > 0; i--) { promises.push((async () => { try { const pData = await governorContract.proposals(i); if (pData.proposer === '0x0000000000000000000000000000000000000000') return null; const state = await governorContract.state(i); const actions = await governorContract.getActions(i); const description = descriptionMap.get(i.toString()) || "Description not found."; return { ...pData, id: i, state, actions, description }; } catch (err) { return null; } })()); } const results = await Promise.all(promises); return results.filter(p => p !== null); }
function displayMoreProposals() { 
    displayedPastProposalsCount += LOAD_MORE_BATCH_SIZE; 
    const pastProposals = allProposals.filter(p => p.state !== PROPOSAL_STATES.PENDING && p.state !== PROPOSAL_STATES.ACTIVE).sort((a, b) => b.id - a.id);
    renderProposals(pastProposals.slice(0, displayedPastProposalsCount), document.getElementById('past-proposal-list'), { isActiveList: false });
    document.getElementById('load-more-btn').style.display = pastProposals.length > displayedPastProposalsCount ? 'block' : 'none';
}
function refreshPastProposalView() { 
    const searchTerm = document.getElementById('search-proposals').value.toLowerCase(); 
    const showExecuted = document.getElementById('filter-executed').checked; 
    const showDefeated = document.getElementById('filter-defeated').checked; 
    const hideCancelled = document.getElementById('filter-hide-cancelled').checked; 
    let pastProposals = allProposals.filter(p => p.state !== PROPOSAL_STATES.PENDING && p.state !== PROPOSAL_STATES.ACTIVE).sort((a, b) => b.id - a.id);
    if (hideCancelled) pastProposals = pastProposals.filter(p => p.state !== PROPOSAL_STATES.CANCELED); if (searchTerm) pastProposals = pastProposals.filter(p => p.id.toString().includes(searchTerm) || p.proposer.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm)); if (showExecuted) pastProposals = pastProposals.filter(p => p.state === PROPOSAL_STATES.EXECUTED); else if (showDefeated) pastProposals = pastProposals.filter(p => p.state === PROPOSAL_STATES.DEFEATED); 
    const proposalsToDisplay = pastProposals.slice(0, displayedPastProposalsCount); renderProposals(proposalsToDisplay, document.getElementById('past-proposal-list'), { isActiveList: false, searchTerm }); 
    document.getElementById('load-more-btn').style.display = proposalsToDisplay.length < pastProposals.length ? 'block' : 'none'; 
}
function getProposalActionsHtml(proposal) {
    let buttonsHtml = '';
    const canVote = userDCultBalance.gt(0);

    if (proposal.state === PROPOSAL_STATES.ACTIVE) {
        if (canVote) {
             buttonsHtml += `
                <button class="btn2 vote-for-btn">Approve</button>
                <button class="btn2 vote-against-btn">Reject</button>
                <button class="btn2 vote-for-sig-btn" style="border-style:dashed;">Approve (Sig)</button>
                <button class="btn2 vote-against-sig-btn" style="border-style:dashed;">Reject (Sig)</button>
            `;
        }
        buttonsHtml += `<button class="btn2 push-votes-btn" style="border-color: var(--color-blue); display: none;">Push <span class="vote-counter">0</span> Votes</button>`;
    }

    if ((proposal.state === PROPOSAL_STATES.PENDING || proposal.state === PROPOSAL_STATES.ACTIVE) && isUserGuardian && proposal.proposer.toLowerCase() === userAddress.toLowerCase()) {
        buttonsHtml += `<button class="btn2 cancel-btn">Cancel</button>`;
    } else if (proposal.state === PROPOSAL_STATES.SUCCEEDED) {
        buttonsHtml += `<button class="btn2 queue-btn">Queue</button>`;
    } else if (proposal.state === PROPOSAL_STATES.QUEUED) {
        buttonsHtml += `<button class="btn2 execute-btn">Execute</button>`;
    }

    return `<div class="button-group" style="margin-top:20px;padding-top:20px;">${buttonsHtml}</div>`;
}
function renderProposals(proposals, targetElement, { isActiveList = false, searchTerm = '' } = {}) {
    targetElement.innerHTML = '';
    if (proposals.length === 0) {
        targetElement.innerHTML = `<p>No ${isActiveList ? 'current' : 'matching'} proposals found.</p>`;
        return;
    }
    const template = document.getElementById('proposal-template');
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlight = (text, term) => term ? text.replace(new RegExp(escapeRegExp(term), 'gi'), `<mark>$&</mark>`) : text;
    proposals.forEach(proposal => {
        const proposalEl = template.content.cloneNode(true);
        const stateStr = PROPOSAL_STATE_NAMES[proposal.state];
        const totalVotes = proposal.forVotes.add(proposal.againstVotes);
        let proposalTitle = `Proposal #${proposal.id}`, descriptionHtml = '', technicalDetailsHtml = '', fundingTxHash;
        try {
            const data = JSON.parse(proposal.description);
            if (data.projectName) proposalTitle += `: ${data.projectName}`;
            const investeeWallet = data.wallet || data.investeeWallet;
            if (investeeWallet && ethers.utils.isAddress(investeeWallet)) {
                fundingTxHash = fundingTxMap.get(investeeWallet.toLowerCase());
            }
            const technicalKeys = new Set(['range', 'rate', 'time', 'checkbox1', 'checkbox2']);
            const mainDetailsParts = [];
            const techDetailsParts = [];
            Object.entries(data).forEach(([key, value]) => {
                if (value === null || value === undefined || value === '') return;
                const prettyKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                let prettyValue = value.toString().replace(/\n/g, '<br>');
                if (ethers.utils.isAddress(value.toString()) && value.toString().length === 42) {
                    prettyValue = createAddressLink(value.toString());
                } else if (value.toString().startsWith('http')) {
                    prettyValue = `<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>`;
                }
                prettyValue = highlight(prettyValue, searchTerm);
                const itemHtml = `<div class="description-item"><strong>${prettyKey}:</strong><br>${prettyValue}</div>`;
                if (proposal.id <= 162 && technicalKeys.has(key.toLowerCase())) {
                    techDetailsParts.push(itemHtml);
                } else {
                    mainDetailsParts.push(itemHtml);
                }
            });
            descriptionHtml = mainDetailsParts.join('');
            technicalDetailsHtml = techDetailsParts.join('');
        } catch (e) {
            descriptionHtml = `<div class="description-item">${highlight(proposal.description, searchTerm)}</div>`;
        }
        const onChainTechnicalDetails = (proposal.actions && proposal.actions.targets.length > 0) ? proposal.actions.targets.map((target, i) => { const value = ethers.utils.formatEther(proposal.actions.values[i] || '0'); return `<div class="action-item"><p><strong>Target:</strong> ${createAddressLink(target)}</p><p><strong>Value:</strong> ${value} ETH</p><p><strong>Signature:</strong> ${proposal.actions.signatures[i] || 'N/A'}</p><p><strong>Calldata:</strong> ${proposal.actions.calldatas[i]}</p></div>` }).join('') : `<h4>No Actions (Text-only Proposal)</h4>`;
        const propDiv = proposalEl.querySelector('.proposal');
        propDiv.dataset.proposalId = proposal.id;
        propDiv.querySelector('.proposal-name-title').innerHTML = highlight(proposalTitle, searchTerm);
        const statusEl = propDiv.querySelector('.proposal-status');
        statusEl.textContent = stateStr;
        statusEl.className = `proposal-status status-${stateStr.toLowerCase()}`;
        propDiv.querySelector('.prop-for-votes').textContent = formatNumber(parseFloat(ethers.utils.formatUnits(proposal.forVotes, 18)), 0);
        propDiv.querySelector('.prop-against-votes').textContent = formatNumber(parseFloat(ethers.utils.formatUnits(proposal.againstVotes, 18)), 0);
        propDiv.querySelector('.prop-total-votes').textContent = formatNumber(parseFloat(ethers.utils.formatUnits(totalVotes, 18)), 0);
        propDiv.querySelector('.prop-proposer').innerHTML = createAddressLink(proposal.proposer);
        propDiv.querySelector('.prop-start-block').textContent = proposal.startBlock.toString();
        propDiv.querySelector('.prop-end-block').textContent = proposal.endBlock.toString();
        propDiv.querySelector('.prop-eta').textContent = proposal.eta.isZero() ? 'Not Queued' : new Date(proposal.eta.toNumber() * 1000).toLocaleString();
        const executionTxHash = executionTxMap.get(proposal.id.toString());
        const execTxEl = propDiv.querySelector('.prop-execution-tx');
        if (executionTxHash) {
            execTxEl.style.display = 'block';
            execTxEl.querySelector('.prop-execution-tx-link').innerHTML = createAddressLink(executionTxHash);
        }
        const fundTxEl = propDiv.querySelector('.prop-funding-tx');
        if (fundingTxHash) {
            fundTxEl.style.display = 'block';
            fundTxEl.querySelector('.prop-funding-tx-link').innerHTML = createAddressLink(fundingTxHash);
        }

        propDiv.querySelector('.prop-description-container').innerHTML = DOMPurify.sanitize(descriptionHtml, DOMPURIFY_CONFIG);
        propDiv.querySelector('.prop-technical-data').innerHTML = DOMPurify.sanitize(onChainTechnicalDetails + technicalDetailsHtml, DOMPURIFY_CONFIG);

        if (isActiveList) {
            if (proposal.state === PROPOSAL_STATES.ACTIVE) {
                propDiv.querySelector('.proposal-timer-container').style.display = 'flex';
                propDiv.querySelector('.proposal-timer').id = `timer-${proposal.id}`;
            }
            const actionButtonsHtml = getProposalActionsHtml(proposal);
            const actionsContainer = propDiv.querySelector('.proposal-actions-container');
            actionsContainer.innerHTML = DOMPurify.sanitize(actionButtonsHtml, { ADD_ATTR: ['style'] });
        }
        targetElement.appendChild(proposalEl);
    });

    openProposalsState.forEach(id => {
        const proposalEl = targetElement.querySelector(`.proposal[data-proposal-id='${id}']`);
        if (proposalEl) {
            const detailsEl = proposalEl.querySelector('.proposal-details');
            if (detailsEl) {
                detailsEl.style.display = 'block';
                const button = proposalEl.querySelector('.view-details-btn');
                if (button) button.innerHTML = 'Hide Details ▲';
            }
        }
    });
}

// --- Transaction & Signature Functions ---
async function sendTransaction(contract, methodName, args) {
    try {
        const tx = await contract[methodName](...args);
        showCustomAlert(`Transaction sent... <a href="https://etherscan.io/tx/${tx.hash}" target="_blank">View on Etherscan</a>`);
        return tx; 
    } catch (error) {
        document.getElementById('custom-alert-overlay').style.display = 'none';
        isAlertShowing = false;
        processAlertQueue();
        const reason = error.reason || error.data?.message || error.message || "Transaction rejected.";
        showCustomAlert(`Transaction failed: ${reason}`);
        return null;
    }
}
async function delegateToSelf() { 
    openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
    const tx = await sendTransaction(new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer), 'delegate', [userAddress]);
    if (tx) { 
        await tx.wait();
        showCustomAlert('Delegation successful!'); 
        setTimeout(initializeApp, 4000); 
    } 
}
async function stake() {
    openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
    const amountInput = document.getElementById('stake-amount');
    const amount = amountInput.value;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showCustomAlert('Please enter a valid amount.');
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, signer);
    const amountInWei = ethers.utils.parseUnits(amount, 18);
    const allowance = await cultContract.allowance(userAddress, DCULT_TOKEN_ADDRESS);
    if (allowance.lt(amountInWei)) {
        showCustomAlert("Approval transaction required first.");
        const approveTx = await sendTransaction(cultContract, 'approve', [DCULT_TOKEN_ADDRESS, ethers.constants.MaxUint256]);
        if (!approveTx) return;
        await approveTx.wait();
        showCustomAlert('Approval successful! You can now stake.');
    }
    const stakeTx = await sendTransaction(new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer), 'deposit', [0, amountInWei]);
    if (stakeTx) {
        await stakeTx.wait();
        showCustomAlert('Stake successful!');
        amountInput.value = '';
        setTimeout(initializeApp, 4000);
    }
}
async function unstake() {
    openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
    const amountInput = document.getElementById('unstake-amount');
    const amount = amountInput.value;
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showCustomAlert('Please enter a valid amount.');
    const unstakeTx = await sendTransaction(new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer), 'withdraw', [0, ethers.utils.parseUnits(amount, 18)]);
    if(unstakeTx) {
        await unstakeTx.wait();
        showCustomAlert('Unstake successful!');
        amountInput.value = '';
        setTimeout(initializeApp, 4000);
    }
}
async function castVote(proposalId, support) { 
    openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
    const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer), 'castVote', [proposalId, support]);
    if (tx) {
        await tx.wait();
        showCustomAlert(`Vote for Proposal #${proposalId} successful!`); 
        setTimeout(initialLoad, 4000); 
    } 
}

async function signVote(proposalId, support) {
    try {
        if ((await new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider).getVotes(userAddress)).isZero()) {
            return showCustomAlert("You must delegate voting power to yourself first.");
        }
        
        const { chainId } = await provider.getNetwork();

        const msgParams = {
            domain: {
                name: "Cult Governor Bravo",
                chainId,
                verifyingContract: GOVERNOR_BRAVO_ADDRESS,
            },
            message: {
                proposalId: proposalId.toString(), 
                support: support,
            },
            primaryType: "Ballot",
            types: {
                EIP712Domain: [
                    { name: "name", type: "string" },
                    { name: "chainId", type: "uint256" },
                    { name: "verifyingContract", type: "address" },
                ],
                Ballot: [
                    { name: "proposalId", type: "uint256" },
                    { name: "support", type: "uint8" },
                ],
            },
        };

        const signature = await provider.send('eth_signTypedData_v4', [userAddress, JSON.stringify(msgParams)]);
        const reqData = { proposalId: Number(proposalId), support, walletAddress: userAddress, signature: { ...ethers.utils.splitSignature(signature), proposalId: Number(proposalId), support } };
        
        showCustomAlert("Submitting vote signature...");
        const response = await fetch(`${API_BASE_URL}proposal/signature`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqData) });
        
        document.getElementById('custom-alert-overlay').style.display = 'none';
        isAlertShowing = false;
        processAlertQueue();

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API returned status ${response.status}: ${errorText || 'Unknown API Error'}`);
        }
        
        showCustomAlert(`Vote Signature for Proposal #${proposalId} Submitted!`);
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        setTimeout(initialLoad, 4000);

    } catch (error) {
        if (document.getElementById('custom-alert-overlay').style.display === 'flex') {
            document.getElementById('custom-alert-overlay').style.display = 'none';
            isAlertShowing = false;
            processAlertQueue();
        }
        showCustomAlert("Vote signature failed: " + (error.message || "User denied. Check console for details."));
        console.error("signVote error:", error);
    }
}

async function pushAllVotesForProposal(proposalId) {
    try {
        const response = await fetch(`${API_BASE_URL}proposal/signatures/${proposalId}`);
        if (!response.ok) throw new Error("API fetch failed to get signatures.");
        const { data: signatures } = await response.json();

        if (!signatures || signatures.length === 0) {
            return showCustomAlert("No pending vote signatures to submit.");
        }
        
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        const contractWithSigner = new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_2_ABI, signer);
        const tx = await sendTransaction(contractWithSigner, 'castVoteBySigs', [signatures]);
        
        if (tx) {
            const proposalDiv = document.querySelector(`.proposal[data-proposal-id='${proposalId}']`);
            if (proposalDiv) {
                const pushBtn = proposalDiv.querySelector('.push-votes-btn');
                if (pushBtn) pushBtn.style.display = 'none';
            }
            await tx.wait();
            showCustomAlert(`Successfully submitted a batch of ${signatures.length} unique signatures! The app will now update.`);
            setTimeout(initialLoad, 4000);
        }

    } catch (e) {
        if (document.getElementById('custom-alert-overlay').style.display === 'flex') {
            document.getElementById('custom-alert-overlay').style.display = 'none';
            isAlertShowing = false;
            processAlertQueue();
        }
        const reason = e.reason || e.data?.message || e.message;
        if (reason && reason.includes("voter already voted")) {
             showCustomAlert("Transaction failed: The batch contained a signature from a wallet that has already voted on-chain. The API's signature list may be out of sync.");
        } else {
            showCustomAlert("Failed to push votes: " + reason);
        }
        console.error("Push votes error:", e);
    }
}

async function updateVoteCounterForProposal(proposalId) { const proposalDiv = document.querySelector(`.proposal[data-proposal-id='${proposalId}']`); if (!proposalDiv) return; const pushButton = proposalDiv.querySelector('.push-votes-btn'); const counterEl = proposalDiv.querySelector('.vote-counter'); if (!pushButton || !counterEl) return; try { const response = await fetch(`${API_BASE_URL}proposal/signatures/${proposalId}`); const { data: signatures = [] } = await response.json(); counterEl.textContent = signatures.length; pushButton.style.display = (signatures.length > 0) ? 'inline-block' : 'none'; } catch(e) { counterEl.textContent = "N/A"; pushButton.style.display = 'none'; } }
async function submitProposal() {
    openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
    const investeeWallet = document.getElementById('p-investeeWallet').value.trim();
    if (!ethers.utils.isAddress(investeeWallet)) return showCustomAlert('A valid Investee Wallet address is mandatory.');
    const proposalData = { projectName: document.getElementById('p-projectName').value.trim(), wallet: investeeWallet, shortDescription: document.getElementById('p-shortDescription').value.trim(), socialChannel: document.getElementById('p-socialChannel').value.trim() || "N/A", links: document.getElementById('p-links').value.trim() || "N/A", manifestoOutlinedFit: document.getElementById('p-manifestoOutlinedFit').value.trim() || "N/A", returnModel: document.getElementById('p-returnModel').value.trim() || "N/A", proposedTimeline: document.getElementById('p-proposedTimeline').value.trim() || "N/A", fundsStoredHeldUtilised: document.getElementById('p-fundsStoredHeldUtilised').value.trim() || "N/A", guardianAddress: userAddress };
    const descriptionString = JSON.stringify(proposalData, null, 2);
    const iface = new ethers.utils.Interface(["function _setInvesteeDetails(address)"]);
    const calldatas = [iface.encodeFunctionData("_setInvesteeDetails", [investeeWallet])];
    const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer), 'propose', [[GOVERNOR_BRAVO_ADDRESS], [0], ["_setInvesteeDetails(address)"], calldatas, descriptionString]);
    if (tx) {
        await tx.wait();
        showCustomAlert('Proposal submitted successfully!');
        document.getElementById('proposal-form-fields').querySelectorAll('input, textarea').forEach(el => el.value = '');
        setTimeout(initialLoad, 4000);
    }
}
async function cancelProposal(proposalId) { 
    if (window.confirm(`Cancel proposal #${proposalId}?`)) {
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer), 'cancel', [proposalId]);
        if (tx) {
            await tx.wait();
            showCustomAlert('Proposal canceled!');
            setTimeout(initialLoad, 4000);
        }
    }
}
async function queueProposal(proposalId) { 
    if (window.confirm(`Queue proposal #${proposalId}?`)) {
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer), 'queue', [proposalId]);
        if (tx) {
            await tx.wait();
            showCustomAlert('Proposal queued!');
            setTimeout(initialLoad, 4000);
        }
    }
}
async function executeProposal(proposalId) { 
    if (window.confirm(`Execute proposal #${proposalId}?`)) {
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer), 'execute', [proposalId]);
        if (tx) {
            await tx.wait();
            showCustomAlert('Proposal executed!');
            setTimeout(initialLoad, 4000);
        }
    }
}
async function claimRewards() { 
    const tx = await sendTransaction(new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer), 'claimCULT', [0]);
    if (tx) {
        await tx.wait();
        showCustomAlert('Rewards claimed!');
        setTimeout(initializeApp, 4000);
    }
}

async function signDelegation() {
    try {
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer);
        const nonce = await dCultContract.nonces(userAddress);
        const { chainId } = await provider.getNetwork();
        const expiry = Math.floor(Date.now() / 1000) + 604800;
        const domain = { name: "dCULT", version: "1", chainId, verifyingContract: DCULT_TOKEN_ADDRESS };
        const types = { Delegation: [{ name: "delegatee", type: "address" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }] };
        const value = { delegatee: userAddress, nonce: nonce.toNumber(), expiry };

        const signature = await signer._signTypedData(domain, types, value);
        const reqData = { walletAddress: userAddress, signature: { ...value, ...ethers.utils.splitSignature(signature) } };
        
        showCustomAlert("Submitting signature to community pool...");
        const response = await fetch(`${API_BASE_URL}delegate/signature`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqData) });
        
        document.getElementById('custom-alert-overlay').style.display = 'none';
        isAlertShowing = false;
        processAlertQueue();

        if (!response.ok) {
            throw new Error((await response.json()).message || "API request failed");
        }
        
        showCustomAlert("Delegate Signature Submitted!");
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        setTimeout(initialLoad, 4000);
    } catch (error) {
        if (document.getElementById('custom-alert-overlay').style.display === 'flex') {
            document.getElementById('custom-alert-overlay').style.display = 'none';
            isAlertShowing = false;
            processAlertQueue();
        }
        showCustomAlert("Signing failed: " + (error.message || "User denied."));
    }
}
async function pushAllDelegations() {
    try {
        const response = await fetch(`${API_BASE_URL}delegate/signatures`);
        if (!response.ok) throw new Error("API fetch failed.");
        const { data: signatures } = await response.json();
        
        if (!signatures || signatures.length === 0) {
            return showCustomAlert("No pending delegation signatures to submit.");
        }
        
        openProposalsState = new Set([...document.querySelectorAll('.proposal .proposal-details[style*="block"]')].map(d => d.closest('.proposal').dataset.proposalId));
        const tx = await sendTransaction(new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_2_ABI, signer), 'delegateBySigs', [signatures]);
        if (tx) {
            const pushButton = document.getElementById('push-delegates-btn');
            if (pushButton) pushButton.style.display = 'none';
            await tx.wait();
            showCustomAlert('Delegation batch submitted successfully!');
            setTimeout(initialLoad, 4000);
        }
    } catch(e) {
        showCustomAlert("Failed to push delegations: " + e.message);
    }
}

// --- Event Listeners ---
function safeAddEventListener(id, event, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(event, handler);
    } else {
        console.warn(`Element with ID '${id}' not found. Cannot add event listener.`);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    fetchAndDisplayRepoUpdate();
    
    for (const [code, label] of Object.entries(SUPPORTED_CURRENCIES)) {
        const item = document.createElement('button');
        item.className = 'dropdown-item';
        item.dataset.currency = code;
        item.textContent = label;
        currencyDropdown.appendChild(item);
    }

    safeAddEventListener('custom-alert-close', 'click', () => { 
        document.getElementById('custom-alert-overlay').style.display = 'none';
        isAlertShowing = false;
        processAlertQueue();
    });

    window.addEventListener('keydown', (e) => { 
        if (document.getElementById('custom-alert-overlay').style.display === 'flex' && e.key === 'Enter') { 
            e.preventDefault(); 
            document.getElementById('custom-alert-close').click();
        }
    });
    
    safeAddEventListener('add-tracked-wallet-btn', 'click', handleAddWalletInput);
    safeAddEventListener('track-wallet-input', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddWalletInput(); } });
    safeAddEventListener('clear-tracked-wallets-btn', 'click', clearAllTrackedWallets);
    safeAddEventListener('tracked-wallets-list', 'click', (e) => { const btn = e.target.closest('.remove-tracked-wallet-btn'); if (btn) removeTrackedWallet(btn.dataset.walletAddress); });

    safeAddEventListener('accept-disclaimer-btn', 'click', () => { 
        localStorage.setItem('disclaimerAccepted', 'true'); 
        document.getElementById('disclaimer-overlay').style.display = 'none'; 
    });
    safeAddEventListener('close-reminder-btn', 'click', () => { document.getElementById('reminder-banner').style.display = 'none'; });
    
    safeAddEventListener('close-top50-notice-btn', 'click', () => {
        const noticeContainer = document.getElementById('top50-notice-container');
        if (noticeContainer) noticeContainer.style.display = 'none';
        if (noticeTimeout) clearTimeout(noticeTimeout); 
    });

    const disclaimerOverlay = document.getElementById('disclaimer-overlay');
    if (disclaimerOverlay && localStorage.getItem('disclaimerAccepted') !== 'true') {
        disclaimerOverlay.style.display = 'flex';
    } else {
        const reminderBanner = document.getElementById('reminder-banner');
        if (reminderBanner) reminderBanner.style.display = 'flex';
    }

    safeAddEventListener('connect-wallet-btn', 'click', () => {
        if (!userAddress) {
            connectWallet();
        } else {
            currencyDropdown.classList.remove('show');
            walletDropdown.classList.toggle('show');
        }
    });
    safeAddEventListener('copy-address-btn', 'click', copyUserAddressToClipboard);
    safeAddEventListener('disconnect-btn', 'click', disconnectWallet);
    
    safeAddEventListener('currency-selector-btn', 'click', () => {
        walletDropdown.classList.remove('show');
        currencyDropdown.classList.toggle('show');
    });

    currencyDropdown.addEventListener('click', (e) => {
        const target = e.target.closest('.dropdown-item');
        if (target && target.dataset.currency) {
            handleCurrencyChange(target.dataset.currency);
            currencyDropdown.classList.remove('show');
        }
    });
    
    window.addEventListener('click', (e) => { 
        if (!e.target.closest('.wallet-widget')) {
            walletDropdown.classList.remove('show');
        }
        if (!e.target.closest('.currency-widget')) {
            currencyDropdown.classList.remove('show');
        }
    });

    safeAddEventListener('stake-btn', 'click', stake);
    safeAddEventListener('unstake-btn', 'click', unstake);
    safeAddEventListener('claim-rewards-btn', 'click', claimRewards);
    safeAddEventListener('delegate-btn', 'click', delegateToSelf);
    safeAddEventListener('submit-proposal-btn', 'click', submitProposal);
    safeAddEventListener('load-more-btn', 'click', displayMoreProposals);
    safeAddEventListener('stake-max-btn', 'click', () => { document.getElementById('stake-amount').value = document.getElementById('available-cult').textContent.split(':')[1].trim(); });
    safeAddEventListener('unstake-max-btn', 'click', () => { document.getElementById('unstake-amount').value = document.getElementById('available-dcult').textContent.split(':')[1].trim(); });
    
    ['search-proposals', 'filter-executed', 'filter-defeated', 'filter-hide-cancelled'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const eventType = el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(eventType, () => {
                if (el.id === 'filter-executed' && el.checked) document.getElementById('filter-defeated').checked = false;
                if (el.id === 'filter-defeated' && el.checked) document.getElementById('filter-executed').checked = false;
                displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT;
                refreshPastProposalView();
            });
        }
    });

    safeAddEventListener('sign-delegation-btn', 'click', signDelegation);
    safeAddEventListener('push-delegates-btn', 'click', pushAllDelegations);
    
    document.body.addEventListener('click', (e) => {
        const copyAction = e.target.closest('.copy-action');
        if (copyAction && copyAction.dataset.copyAddress) {
            copyTextToClipboard(copyAction.dataset.copyAddress);
            return;
        }

        const proposalDiv = e.target.closest('.proposal');
        if (!proposalDiv) return;
        const proposalId = proposalDiv.dataset.proposalId;
        const button = e.target.closest('button');
        if (!button || !proposalId) return;
        
        if (button.classList.contains('vote-for-btn')) castVote(proposalId, 1);
        else if (button.classList.contains('vote-against-btn')) castVote(proposalId, 0);
        else if (button.classList.contains('vote-for-sig-btn')) signVote(proposalId, 1);
        else if (button.classList.contains('vote-against-sig-btn')) signVote(proposalId, 0);
        else if (button.classList.contains('execute-btn')) executeProposal(proposalId);
        else if (button.classList.contains('cancel-btn')) cancelProposal(proposalId);
        else if (button.classList.contains('queue-btn')) queueProposal(proposalId);
        else if (button.classList.contains('push-votes-btn')) pushAllVotesForProposal(proposalId);
        else if (button.classList.contains('view-details-btn')) { 
            const detailsEl = proposalDiv.querySelector('.proposal-details');
            if (detailsEl) {
                const isHidden = detailsEl.style.display === 'none' || detailsEl.style.display === '';
                detailsEl.style.display = isHidden ? 'block' : 'none';
                button.innerHTML = isHidden ? 'Hide Details ▲' : 'Show Details ▼';
            }
        }
    });
});

window.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
      const themeToggleBtn = document.getElementById('theme-toggle');
      let isPublishTheme = true;
      function applyTheme(theme) {
        if (theme === 'publish') {
          root.style.setProperty('--background-image', 'radial-gradient(circle, #ff5252, black');
          root.style.setProperty('--btn-bg', '#333333');
          root.style.setProperty('--wallet-dropdown-bg', '#050505');
          root.style.setProperty('--ui-section-blur', 'blur(0px)');
          root.style.setProperty('--theme-name', 'publish');
        } else {
          root.style.setProperty('--background-image', 'radial-gradient(circle, #222222, black)');
          root.style.setProperty('--btn-bg', '#ff5252');
          root.style.setProperty('--wallet-dropdown-bg', '#ff5252');
          root.style.setProperty('--ui-section-blur', 'blur(0px)');
          root.style.setProperty('--theme-name', 'default');
        }
      }
      themeToggleBtn.addEventListener('click', () => {
        isPublishTheme = !isPublishTheme;
        applyTheme(isPublishTheme ? 'publish' : 'default');
      });
      applyTheme('publish');
      const shuffleBtn = document.getElementById('shuffle-theme-btn');
      function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
          color += letters[Math.floor(Math.random() * 14.2069)];
        }
        return color;
      }
      shuffleBtn.addEventListener('click', () => {
        const color1 = getRandomColor();
        const color2 = getRandomColor();
        const btnColor = getRandomColor();
        const surfaceColor = 'var(--color-details)';
        root.style.setProperty('--background-image', `radial-gradient(circle, ${color1}, ${color2})`);
        root.style.setProperty('--btn-bg', btnColor);
        root.style.setProperty('--wallet-dropdown-bg', surfaceColor);
        root.style.setProperty('--ui-section-blur', 'blur(0px)');
      });
});
document.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("reminder-banner");

  if (banner) {
    setTimeout(() => {
      banner.style.transition = "opacity 3.5s ease";
      banner.style.opacity = "0";

      setTimeout(() => {
        banner.style.display = "none";
      }, 5000);
    }, 120000); // 
  }
});
