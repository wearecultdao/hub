// =========================================================================
// app.js - Version 3.17 (GitHub API for Last Update)
// =========================================================================

// === Imports ===
import {
  CULT_TOKEN_ADDRESS,
  DCULT_TOKEN_ADDRESS,
  GOVERNOR_BRAVO_ADDRESS,
  GOVERNOR_BRAVO_2_ADDRESS,
  GOVERNOR_BRAVO_ABI,
GOVERNOR_BRAVO_2_ABI,
  DCULT_ABI,
  CULT_TOKEN_ABI,
  UNISWAP_PAIR_ADDRESS,
  UNISWAP_PAIR_ABI,
  TREASURY_ADDRESS,
  TREASURY_ABI, 
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
const API_BASE_URL = "https://api.cultdao.io/";
let canceledSet = new Set();
const INITIAL_PAST_PROPOSAL_COUNT = 10;
const LOAD_MORE_BATCH_SIZE = 50;
let displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT;
let executionTxMap = new Map();
let fundingTxMap = new Map();
let proposalInvesteeMap = new Map(); 

let activeTimers = {};
let averageBlockTime = 12;

let trackedWallets = [];
let trackedWalletsData = new Map();
let cultPriceUSD = 0;


// --- DOM Elements ---
const connectBtn = document.getElementById('connect-wallet-btn');
const dappContent = document.getElementById('dapp-content');
const walletDropdown = document.getElementById('wallet-dropdown');

// --- Helper Functions ---
function createAddressLink(address) { if (!address) return 'N/A'; const isTx = address.length > 42; const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`; const etherscanUrl = `https://etherscan.io/${isTx ? 'tx' : 'address'}/${address}`; const copyIconSvg = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`; return `<span class="address-link" title="${address}"><a href="${etherscanUrl}" target="_blank" rel="noopener noreferrer">${shortAddress}</a><span onclick="copyTextToClipboard('${address}')">${copyIconSvg}</span></span>`; }
window.copyTextToClipboard = (text) => { navigator.clipboard.writeText(text).then(() => showCustomAlert("Copied to clipboard!")).catch(err => console.error('Failed to copy text: ', err)); }

function showCustomAlert(message) {
    const overlay = document.getElementById('custom-alert-overlay');
    const messageEl = document.getElementById('custom-alert-message');
    messageEl.innerHTML = message;
    overlay.style.display = 'flex';
}

async function calculateAverageBlockTime() {
    try {
        const sampleSize = 100;
        const latestBlock = await provider.getBlock('latest');
        const pastBlock = await provider.getBlock(latestBlock.number - sampleSize);
        
        if (!latestBlock || !pastBlock) {
             console.warn("Could not fetch blocks to calculate average time. Falling back to default.");
             return 12;
        }
        const timeDifference = latestBlock.timestamp - pastBlock.timestamp;
        const average = timeDifference / sampleSize;
        console.log(`Calculated average block time over last ${sampleSize} blocks: ${average.toFixed(2)}s`);
        return average;
    } catch (error) {
        console.error("Error calculating average block time:", error);
        return 12;
    }
}

async function fetchAndDisplayRepoUpdate() {
    const dateEl = document.getElementById('repo-update-date');
    if (!dateEl) return;

    const repoUrl = 'https://api.github.com/repos/wearecultdao/hub';

    try {
        const response = await fetch(repoUrl);
        if (!response.ok) {
            throw new Error(`GitHub API failed with status ${response.status}`);
        }
        const data = await response.json();
        const lastPushDate = new Date(data.pushed_at);

        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = lastPushDate.toLocaleDateString(undefined, options);

    } catch (error) {
        console.error("Failed to fetch GitHub repo update date:", error);
        dateEl.textContent = 'N/A';
    }
}


// --- Wallet Tracking Functions ---
function loadTrackedWallets() {
    const savedWallets = localStorage.getItem('trackedWallets');
    if (savedWallets) {
        try { trackedWallets = JSON.parse(savedWallets); } catch (e) { console.error("Failed to parse tracked wallets:", e); trackedWallets = []; }
    }
}

function saveTrackedWallets() {
    localStorage.setItem('trackedWallets', JSON.stringify(trackedWallets));
}

async function fetchTrackedWalletData(address) {
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider);

    try {
        const [cultBalanceRaw, dcultBalanceRaw, delegatee, isGuardian, pendingRewardsRaw] = await Promise.all([
            cultContract.balanceOf(address),
            dCultContract.balanceOf(address),
            dCultContract.delegates(address),
            dCultContract.checkHighestStaker(0, address),
            dCultContract.pendingCULT(0, address)
        ]);

        const cultFormatted = parseFloat(ethers.utils.formatUnits(cultBalanceRaw, 18));
        const dcultFormatted = parseFloat(ethers.utils.formatUnits(dcultBalanceRaw, 18));
        const pendingCult = parseFloat(ethers.utils.formatUnits(pendingRewardsRaw, 18));

        let delegationStatus = "N/A";
        if (delegatee.toLowerCase() === address.toLowerCase()) delegationStatus = "Self-Delegated (Active)";
        else if (delegatee === ethers.constants.AddressZero) delegationStatus = "Not Delegated (Inactive)";
        else delegationStatus = `Delegated to ${createAddressLink(delegatee)}`;

        let votingRights = "None (No dCULT)";
        if (isGuardian) votingRights = `<span class="value the-many">Guardian</span>`;
        else if (dcultBalanceRaw.gt(0)) votingRights = `<span class="value the-many">The Many</span>`;

        // Apply the same logic as updateTotalHoldingsDisplay: sum CULT, dCULT, and pending CULT, then multiply by USD price
        const totalHoldings = cultFormatted + dcultFormatted + pendingCult;
        const totalUsd = totalHoldings * cultPriceUSD;

        return { 
            address, 
            cultBalance: cultFormatted, 
            dcultBalance: dcultFormatted, 
            totalHoldings: totalHoldings, 
            totalUsd: totalUsd, 
            delegationStatus, 
            votingRights 
        };
    } catch (error) {
        console.error(`Error fetching data for ${address}:`, error);
        return { 
            address, 
            cultBalance: "Error", 
            dcultBalance: "Error", 
            totalHoldings: "Error", 
            totalUsd: "Error", 
            delegationStatus: "Error", 
            votingRights: "Error" 
        };
    }
}

async function handleAddWalletInput() {
    const inputField = document.getElementById('track-wallet-input');
    const rawInput = inputField.value;

    const potentialWallets = rawInput.split(';').map(w => w.trim()).filter(w => w);

    if (potentialWallets.length === 0) {
        showCustomAlert("Please enter one or more wallet addresses or ENS names, separated by semicolons.");
        return;
    }

    await Promise.all(potentialWallets.map(wallet => addTrackedWallet(wallet)));

    inputField.value = '';
}

async function addTrackedWallet(addressOrEns) {
    if (!provider) return;

    let resolvedAddress = addressOrEns;
    if (addressOrEns.endsWith('.eth')) {
        try {
            showCustomAlert(`Resolving ENS: ${addressOrEns}...`);
            resolvedAddress = await provider.resolveName(addressOrEns);
            if (!resolvedAddress) { showCustomAlert(`Could not resolve ENS name "${addressOrEns}".`); return; }
        } catch (error) { console.error("ENS resolution failed:", error); showCustomAlert(`Failed to resolve ENS name "${addressOrEns}".`); return; }
    }

    if (!ethers.utils.isAddress(resolvedAddress)) { showCustomAlert(`"${addressOrEns}" is not a valid address or ENS name.`); return; }

    const lowerCaseAddress = resolvedAddress.toLowerCase();
    if (trackedWallets.includes(lowerCaseAddress)) { showCustomAlert(`${resolvedAddress.substring(0,6)}... is already being tracked.`); return; }

    showCustomAlert(`Adding ${resolvedAddress.substring(0, 6)}...`);
    
    trackedWallets.push(lowerCaseAddress); 
    saveTrackedWallets(); 
    
    const data = await fetchTrackedWalletData(resolvedAddress);
    trackedWalletsData.set(lowerCaseAddress, data);
    
    await renderTrackedWallets();
    document.getElementById('custom-alert-overlay').style.display = 'none';
}

function removeTrackedWallet(addressToRemove) {
    trackedWallets = trackedWallets.filter(addr => addr !== addressToRemove.toLowerCase());
    trackedWalletsData.delete(addressToRemove.toLowerCase());
    saveTrackedWallets();
    renderTrackedWallets();
    showCustomAlert(`Removed wallet from tracked list.`);
}

function clearAllTrackedWallets() {
    if (confirm("Are you sure you want to clear all tracked wallets?")) {
        trackedWallets = [];
        trackedWalletsData.clear();
        saveTrackedWallets();
        renderTrackedWallets();
        showCustomAlert("All tracked wallets cleared.");
    }
}

async function renderTrackedWallets() {
    const listContainer = document.getElementById('tracked-wallets-list');
    const combinedCultEl = document.getElementById('combined-tracked-cult');
    const combinedDcultEl = document.getElementById('combined-tracked-dcult');
    const combinedTotalEl = document.getElementById('combined-tracked-total');
    const combinedUsdEl = document.getElementById('combined-tracked-usd');

    listContainer.innerHTML = ''; 

    if (trackedWallets.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; opacity: 0.6; padding: 20px;">No wallets being tracked yet.</p>';
        combinedCultEl.textContent = "0.00";
        combinedDcultEl.textContent = "0.00";
        combinedTotalEl.textContent = "0.00";
        combinedUsdEl.textContent = "$0.00";
        return;
    }

    let totalCult = 0, totalDcult = 0, totalCombinedHoldings = 0, totalCombinedUsd = 0;

    for (const address of trackedWallets) {
        const walletData = trackedWalletsData.get(address);
        if (!walletData) continue;

        if (typeof walletData.cultBalance === 'number') totalCult += walletData.cultBalance;
        if (typeof walletData.dcultBalance === 'number') totalDcult += walletData.dcultBalance;
        if (typeof walletData.totalHoldings === 'number') totalCombinedHoldings += walletData.totalHoldings;
        if (typeof walletData.totalUsd === 'number') totalCombinedUsd += walletData.totalUsd;

        const walletEl = document.createElement('div');
        walletEl.className = 'info-grid';
walletEl.style.cssText = `display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 16px; padding: 15px; border: 1px solid var(--color-tracked); border-radius: 8px; background-color: var(--color-bg-tracked);`;   
   
        walletEl.innerHTML = `
            <div class="info-item"><h3>Wallet</h3><span class="value">${createAddressLink(walletData.address)}</span></div>
            <div class="info-item"><h3>Delegation Status</h3><span class="value">${walletData.delegationStatus}</span></div>
            <div class="info-item"><h3>Voting Rights</h3>${walletData.votingRights}</div>
            <div class="info-item"><h3>CULT Balance</h3><span class="value">${formatNumber(walletData.cultBalance)}</span></div>
            <div class="info-item"><h3>dCULT Balance</h3><span class="value">${formatNumber(walletData.dcultBalance)}</span></div>
            <div class="info-item"><h3>Total Holdings</h3><span class="value">${formatNumber(walletData.totalHoldings)}</span></div>
            <div class="info-item"><h3>Value (USD)</h3><span class="value">$${formatNumber(walletData.totalUsd)}</span></div>
            <div class="info-item"></div> <!-- Spacer -->
            <div class="info-item"></div> <!-- Spacer -->
            <div class="info-item" style="text-align: right;">
                <button class="btn2 remove-tracked-wallet-btn" data-wallet-address="${walletData.address}" style="background: none; border: 1px solid var(--color-red); color: var(--color-red); padding: 5px 10px; font-size: 0.8rem;">Remove</button>
            </div>
        `;
        listContainer.appendChild(walletEl);
    }

    combinedCultEl.textContent = formatNumber(totalCult);
    combinedDcultEl.textContent = formatNumber(totalDcult);
    combinedTotalEl.textContent = formatNumber(totalCombinedHoldings);
    combinedUsdEl.textContent = `$${formatNumber(totalCombinedUsd)}`;
}




// --- Core Application Logic ---
async function connectWallet() { if (typeof window.ethereum === 'undefined') return alert('Please install MetaMask.'); try { provider = new ethers.providers.Web3Provider(window.ethereum); await provider.send("eth_requestAccounts", []); signer = provider.getSigner(); userAddress = await signer.getAddress(); connectBtn.textContent = `${userAddress.substring(0, 6)}...${userAddress.substring(userAddress.length - 4)}`; connectBtn.disabled = false; dappContent.style.display = 'block'; document.getElementById('etherscan-link').href = `https://etherscan.io/address/${userAddress}`; document.getElementById('p-proposerWallet').innerHTML = createAddressLink(userAddress); initializeApp(); } catch (error) { console.error("Failed to connect wallet:", error); } }
function disconnectWallet() { location.reload(); }
function copyUserAddressToClipboard() { if (userAddress) { copyTextToClipboard(userAddress); walletDropdown.classList.remove('show'); } }

async function initializeApp() { 
    if (!signer) return; 
    averageBlockTime = await calculateAverageBlockTime();
    const proposalSection = document.getElementById('submit-proposal-section'); 
    proposalSection.classList.add('checking-eligibility'); 
    
    loadTrackedWallets();
    
    await updateBalances();
    await updateDelegationStatus();
    await updateClaimableRewards();
    await updateDelegationCounter();
    await initialLoad(); // Loads proposals, sets allProposals
    
    // Update cultPriceUSD before fetching wallet data
    await updateDaoMetrics(); // Sets cultPriceUSD
    
    // Fetch wallet data with updated cultPriceUSD
    await Promise.all([
        updateGuardianThreshold(),
        checkUserRights(),
        Promise.all(trackedWallets.map(address => fetchTrackedWalletData(address).then(data => trackedWalletsData.set(address, data))))
    ]);
    
    await renderTrackedWallets();
    
    proposalSection.classList.remove('checking-eligibility');
}

async function updateGuardianThreshold() {
    const thresholdEl = document.getElementById('top50staker');
    if (!thresholdEl) return;
    try {
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
        const stakerData = await dCultContract.highestStakerInPool(0, 0);
        const thresholdAmount = ethers.utils.formatUnits(stakerData.deposited, 18);
        thresholdEl.textContent = formatNumber(parseFloat(thresholdAmount));
    } catch (error) {
        console.error("Error fetching guardian threshold:", error);
        thresholdEl.textContent = "Error";
    }
}

// --- UI UPDATE FUNCTIONS ---
async function updateBalances() { try { const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); [userCultBalanceRaw, userDcultBalanceRaw] = await Promise.all([cultContract.balanceOf(userAddress), dCultContract.balanceOf(userAddress)]); userDCultBalance = userDcultBalanceRaw; const cultFormatted = ethers.utils.formatUnits(userCultBalanceRaw, 18); document.getElementById('cult-balance').textContent = parseFloat(cultFormatted).toFixed(2); document.getElementById('available-cult').textContent = `Available: ${cultFormatted}`; const dcultFormatted = ethers.utils.formatUnits(userDcultBalanceRaw, 18); document.getElementById('dcult-balance').textContent = parseFloat(dcultFormatted).toFixed(2); document.getElementById('available-dcult').textContent = `Available: ${dcultFormatted}`; document.getElementById('wallet-address').innerHTML = createAddressLink(userAddress); } catch (error) { console.error("Error updating balances:", error); } }
async function updateDelegationStatus() {
    const delegateSection = document.getElementById('delegate-section');
    const statusEl = document.getElementById('delegation-status');
    const top50Notice = document.getElementById('top50-notice');
    delegateSection.style.display = 'flex'; 
    try {
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
        const [delegatee, isGuardian] = await Promise.all([
            dCultContract.delegates(userAddress),
            dCultContract.checkHighestStaker(0, userAddress)
        ]);

        if (delegatee.toLowerCase() === userAddress.toLowerCase()) {
            statusEl.textContent = "Self-Delegated (Active)";
        } else {
            statusEl.textContent = "Not Delegated (Inactive)";
        }

        if (isGuardian) {
            top50Notice.textContent = "Guardians (Top 50 Stakers) cannot delegate.";
            top50Notice.style.display = 'block';
        } else {
            top50Notice.style.display = 'none';
        }
    } catch (error) {
        console.error("Error fetching delegation status:", error);
        statusEl.textContent = "Error";
    }
}
async function checkUserRights() { const proposalSection = document.getElementById('submit-proposal-section'); const notice = document.getElementById('proposal-eligibility-notice'); const rightsLabelEl = document.getElementById('rights-label'); const rightsValueEl = document.getElementById('proposal-rights'); try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); const isGuardian = await dCultContract.checkHighestStaker(0, userAddress); proposalSection.classList.remove('checking-eligibility'); rightsValueEl.classList.remove('guardian', 'the-many'); if (isGuardian) { proposalSection.classList.remove('dimmed-section'); notice.style.display = 'none'; rightsLabelEl.textContent = "Proposal Rights"; rightsValueEl.textContent = "Guardian"; rightsValueEl.classList.add('the-many'); } else { rightsLabelEl.textContent = "Voting Rights"; if (userDCultBalance.gt(0)) { rightsValueEl.textContent = "The Many"; rightsValueEl.classList.add('the-many'); } else { rightsValueEl.textContent = "None (No dCULT)"; } proposalSection.classList.add('dimmed-section'); notice.style.display = 'block'; notice.innerHTML = `Only Guardians (Top 50 Stakers) can submit proposals.`; } } catch (error) { console.error("An unexpected error occurred while checking user rights:", error); proposalSection.classList.remove('checking-eligibility'); proposalSection.classList.add('dimmed-section'); notice.textContent = 'Error checking proposal eligibility.'; notice.style.display = 'block'; rightsValueEl.textContent = "Error"; } }
async function updateClaimableRewards() { const claimableEl = document.getElementById('claimable-rewards'); try { const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); if (userDCultBalance.isZero()) { claimableEl.textContent = "0.0000"; return; } const pendingRewardsRaw = await dCultContract.pendingCULT(0, userAddress); userPendingRewardsRaw = pendingRewardsRaw; const rewardsFormatted = ethers.utils.formatUnits(pendingRewardsRaw, 18); claimableEl.textContent = parseFloat(rewardsFormatted).toFixed(2); } catch (error) { console.error("Error fetching claimable rewards:", error); claimableEl.textContent = "Error"; } }
async function updateDelegationCounter() {
    const pushButton = document.getElementById('push-delegates-btn');
    try {
        const response = await fetch(`${API_BASE_URL}delegate/counter`);
        const apiResponse = await response.json();
        const count = apiResponse.data || 0;
        
        document.getElementById('delegate-counter').textContent = count;
        
        if (count > 0) {
            pushButton.style.display = 'inline-block';
        } else {
            pushButton.style.display = 'none';
        }

    } catch(e) {
        console.error("Could not fetch delegate counter:", e);
        document.getElementById('delegate-counter').textContent = "N/A";
        pushButton.style.display = 'none';
    }
}
// --- DAO METRICS ---
async function fetchUniswapPoolData(provider) { const pair = new ethers.Contract(UNISWAP_PAIR_ADDRESS, UNISWAP_PAIR_ABI, provider); const token0 = await pair.token0(); const [reserve0, reserve1] = await pair.getReserves(); const cultAddress = CULT_TOKEN_ADDRESS.toLowerCase(); const isCultToken0 = token0.toLowerCase() === cultAddress; const cultReserve = isCultToken0 ? reserve0 : reserve1; const ethReserve = isCultToken0 ? reserve1 : reserve0; const cultFormatted = parseFloat(ethers.utils.formatUnits(cultReserve, 18)); const ethFormatted = parseFloat(ethers.utils.formatUnits(ethReserve, 18)); const price = ethFormatted > 0 ? ethFormatted / cultFormatted : 0; return { cultInLP: cultFormatted, ethInLP: ethFormatted, price }; }
function formatBigNumber(numberBN) { return parseFloat(ethers.utils.formatUnits(numberBN, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function formatNumber(num) { return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function updateTotalHoldingsDisplay(walletCult, dcult, pendingCult, cultUsdPrice) { const totalCult = walletCult + dcult + pendingCult; const totalUsd = totalCult * cultUsdPrice; const holdingsEl = document.getElementById('total-cult-holdings'); const usdEl = document.getElementById('total-cult-usd'); if (holdingsEl) holdingsEl.textContent = formatNumber(totalCult); if (usdEl) usdEl.textContent = `$${formatNumber(totalUsd)}`; }
// THIS FUNCTION IS MODIFIED to make the liquidity lock metrics clickable.
async function updateDaoMetrics() { 
    const uniqueProposals = Array.from(new Map(allProposals.map(p => [p.id, p])).values()); 
    if (!provider) return; 
    try { 
        const poolData = await fetchUniswapPoolData(provider); 
        const governor = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); 
        const cult = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider); 
        const dcult = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); 
        const [cultSupply, dcultSupply, burned1, burned2, treasuryCultRaw] = await Promise.all([cult.totalSupply(), dcult.totalSupply(), cult.balanceOf(DEAD_WALLET_1), cult.balanceOf(DEAD_WALLET_2), cult.balanceOf(TREASURY_ADDRESS)]); 
        const totalBurned = burned1.add(burned2); 
        const circulatingSupply = cultSupply.sub(totalBurned); 
        const stakedPercent = dcultSupply.mul(10000).div(cultSupply).toNumber() / 100; 
        const stakedVsCircPercent = circulatingSupply.isZero() ? 0 : dcultSupply.mul(10000).div(circulatingSupply).toNumber() / 100; 
        const burnPercent = totalBurned.mul(10000).div(cultSupply).toNumber() / 100; 
        const cultLpPercentTotal = (poolData.cultInLP / parseFloat(ethers.utils.formatUnits(cultSupply, 18))) * 100; 
        const cultLpPercentCirc = (poolData.cultInLP / parseFloat(ethers.utils.formatUnits(circulatingSupply, 18))) * 100; 
        const circSupplyPercent = circulatingSupply.mul(10000).div(cultSupply).toNumber() / 100; 
        const cultPriceEth = poolData.price; 
        const treasuryCultFormatted = parseFloat(ethers.utils.formatUnits(treasuryCultRaw, 18)); 
        const treasuryValueEth = treasuryCultFormatted * cultPriceEth; 
        let ethPriceUSD = 0; 
        try { 
            const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'); 
            if(priceRes.ok) { 
                const priceData = await priceRes.json(); 
                ethPriceUSD = priceData?.ethereum?.usd || 0; 
            } else { 
                throw new Error(`API failed: ${priceRes.status}`); 
            } 
        } catch (e) { 
            console.warn("Could not fetch ETH price.", e); 
        } 
        const treasuryValueUsd = treasuryValueEth * ethPriceUSD; 
        const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; }; 
        const cultUsdPrice = cultPriceEth * ethPriceUSD; 
                cultPriceUSD = cultPriceEth * ethPriceUSD; 

        const liquidityUsd = (poolData.ethInLP * ethPriceUSD) + (poolData.cultInLP * cultUsdPrice); 
        const marketCapUsd = parseFloat(ethers.utils.formatUnits(circulatingSupply, 18)) * cultUsdPrice; 
        const liquidityToMcap = marketCapUsd > 0 ? (liquidityUsd / marketCapUsd) * 100 : 0; 
        if (ethPriceUSD > 0) { 
            safeSet('metric-cult-price-usd', `$${cultUsdPrice.toFixed(8)}`); 
            safeSet('metric-staked-value-usd', `$${formatNumber(parseFloat(ethers.utils.formatUnits(dcultSupply, 18)) * cultUsdPrice)}`); 
            safeSet('metric-treasury-value-usd', `$${formatNumber(treasuryValueUsd)}`); 
            safeSet('metric-liquidity', `$${formatNumber(liquidityUsd)}`); 
            safeSet('metric-mcap', `$${formatNumber(marketCapUsd)}`); 
            safeSet('metric-liq-mcap', `${liquidityToMcap.toFixed(2)}%`); 
        } else { 
            ['metric-cult-price-usd', 'metric-staked-value-usd', 'metric-treasury-value-usd', 'metric-liquidity', 'metric-mcap'].forEach(id => safeSet(id, 'API Error')); 
        } 
        
        // --- CHANGE IS HERE ---
        try {
            const unicryptLockerUrl = 'https://app.uncx.network/lockers/univ2/chain/1/address/0x5281e311734869c64ca60ef047fd87759397efe6';
            const lockedLiqEl = document.getElementById('metric-locked-liq');
            const unlockLiqEl = document.getElementById('metric-unlock-liq');

            if (lockedLiqEl) {
                lockedLiqEl.innerHTML = `<a href="${unicryptLockerUrl}" target="_blank" rel="noopener noreferrer">99.82%</a>`;
            }
            if (unlockLiqEl) {
                unlockLiqEl.innerHTML = `<a href="${unicryptLockerUrl}" target="_blank" rel="noopener noreferrer">Nov 20, 2286</a>`;
            }
        } catch (error) {}
        // --- END OF CHANGE ---

        const skippedPassedProposals = uniqueProposals.filter(p => p.forVotes?.gt?.(p.againstVotes || 0) && canceledSet.has(p.id.toString()) && (!p.eta || p.eta.isZero?.())); 
        const passedProposals = uniqueProposals.filter(p => [4, 5, 7].includes(p.state)).length; 
        const executedProposals = passedProposals - skippedPassedProposals.length; 
        safeSet('metric-skipped-passed-proposals', skippedPassedProposals.length); 
        safeSet('metric-cult-supply', formatBigNumber(cultSupply)); 
        safeSet('metric-cult-burned', formatBigNumber(totalBurned)); 
        safeSet('metric-cult-staked', formatBigNumber(dcultSupply)); 
        safeSet('metric-cult-circulating', formatBigNumber(circulatingSupply)); 
        safeSet('metric-cult-circulating-percent', `${circSupplyPercent.toFixed(1)}%`); 
        safeSet('metric-staked-percent', `${stakedPercent.toFixed(1)}%`); 
        safeSet('metric-staked-vs-circ-percent', `${stakedVsCircPercent.toFixed(1)}%`); 
        safeSet('metric-cult-burned-percent', `${burnPercent.toFixed(1)}%`); 
        safeSet('metric-cult-lp', formatNumber(poolData.cultInLP)); 
        safeSet('metric-eth-lp', formatNumber(poolData.ethInLP)); 
        safeSet('metric-lp-percent-total', `${cultLpPercentTotal.toFixed(2)}%`); 
        safeSet('metric-lp-percent-circ', `${cultLpPercentCirc.toFixed(2)}%`); 
        safeSet('metric-eth-burned', (executedProposals * 2.5).toFixed(2)); 
        safeSet('metric-eth-funded', (executedProposals * 13).toFixed(2)); 
        safeSet('metric-eth-total-disbursed', (executedProposals * 15.5).toFixed(2)); 
        safeSet('metric-treasury-cult', formatBigNumber(treasuryCultRaw)); 
        safeSet('metric-treasury-value-eth', treasuryValueEth.toFixed(2)); 
        safeSet('metric-total-proposals', uniqueProposals.length); 
        safeSet('metric-active-proposals', uniqueProposals.filter(p => p.state === 1).length); 
        safeSet('metric-passed-proposals', passedProposals); 
        safeSet('metric-executed-proposals', executedProposals); 
        safeSet('metric-defeated-proposals', uniqueProposals.filter(p => p.state === 3).length); 
        safeSet('metric-cancelled-proposals', canceledSet.size); 
        const ethToCult = cultPriceEth > 0 ? 1 / cultPriceEth : 0; 
        safeSet('metric-cult-price-eth', `1 CULT = ${cultPriceEth < 1e-3 ? cultPriceEth.toExponential(2) : cultPriceEth.toFixed(18)} ETH`); 
        safeSet('metric-eth-price-cult', `1 ETH = ${ethToCult.toLocaleString(undefined, { maximumFractionDigits: 0 })} CULT`); 
        setTimeout(() => { 
            const setBar = (id, percent) => { const el = document.getElementById(id); if (el) el.style.width = `${percent.toFixed(1)}%`; }; 
            setBar('bar-burned', burnPercent); 
            setBar('bar-circulating', circSupplyPercent); 
            setBar('bar-staked', stakedPercent); 
            setBar('bar-staked-vs-circ', stakedVsCircPercent); 
            setBar('bar-lp-percent-total', cultLpPercentTotal); 
            setBar('bar-lp-percent-circ', cultLpPercentCirc); 
        }, 100); 
        try { 
            const walletCult = parseFloat(ethers.utils.formatUnits(userCultBalanceRaw || 0, 18)); 
            const dcultVal = parseFloat(ethers.utils.formatUnits(userDcultBalanceRaw || 0, 18)); 
            const pendingCult = parseFloat(ethers.utils.formatUnits(userPendingRewardsRaw || 0, 18)); 
            updateTotalHoldingsDisplay(walletCult, dcultVal, pendingCult, cultUsdPrice); 
        } catch (e) { 
            console.warn("Could not calculate total CULT holdings:", e); 
        } 
    } catch (err) { 
        console.error("Failed to load DAO metrics:", err); 
    } 
}
// --- TIMER FUNCTIONS ---
function formatTimeRemaining(seconds) {
    if (seconds <= 0) return "Voting Ended";

    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const dDisplay = d > 0 ? d + "d " : "";
    const hDisplay = h > 0 ? h + "h " : "";
    const mDisplay = m > 0 ? m + "m " : "";
    const sDisplay = s + "s";
    
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

async function startProposalTimer(proposalId, endBlock) {
    const timerEl = document.getElementById(`timer-${proposalId}`);
    if (!timerEl || !provider) return;

    try {
        const currentBlockNumber = await provider.getBlockNumber();
        const blocksRemaining = endBlock - currentBlockNumber;
        
        if (blocksRemaining <= 0) {
            timerEl.textContent = "Voting Ended";
            return;
        }

        let secondsRemaining = blocksRemaining * averageBlockTime; 

        if (activeTimers[proposalId]) {
            clearInterval(activeTimers[proposalId]);
        }

        const intervalId = setInterval(() => {
            secondsRemaining -= 1;
            if (secondsRemaining <= 0) {
                timerEl.textContent = "Voting Ended";
                clearInterval(intervalId);
                delete activeTimers[proposalId];
            } else {
                timerEl.textContent = formatTimeRemaining(secondsRemaining);
            }
        }, 1000);

        activeTimers[proposalId] = intervalId;

    } catch (error) {
        console.error(`Failed to start timer for proposal ${proposalId}:`, error);
        timerEl.textContent = "Error";
    }
}


// --- DATA LOADING ---
async function initialLoad() {
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider);
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, provider);

    for (const timerId of Object.values(activeTimers)) {
        clearInterval(timerId);
    }
    activeTimers = {};

    const activeListDiv = document.getElementById('active-proposal-list');
    activeListDiv.innerHTML = '<p>Loading active proposals...</p>';
    document.getElementById('past-proposal-list').innerHTML = '<p>Loading recent proposals...</p>';
    document.getElementById('load-more-btn').style.display = 'none';
    allProposals = [];
    displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT;
    try {
        const proposalCount = await governorContract.proposalCount();
        const total = proposalCount.toNumber();

        const executedFilter = governorContract.filters.ProposalExecuted();
        const canceledFilter = governorContract.filters.ProposalCanceled();
        const treasuryTransferFilter = cultContract.filters.Transfer(TREASURY_ADDRESS, null);

        const [executedEvents, treasuryDisbursements, canceledEvents] = await Promise.all([
            governorContract.queryFilter(executedFilter, 0, 'latest'),
            cultContract.queryFilter(treasuryTransferFilter, 0, 'latest'),
            governorContract.queryFilter(canceledFilter, 0, 'latest')
        ]);
        
        executionTxMap = new Map(executedEvents.filter(e => e.args).map(e => [e.args.id.toString(), e.transactionHash]));
        
        fundingTxMap.clear();
        for (const event of treasuryDisbursements) {
            if (event.args.to.toLowerCase() !== DEAD_WALLET_1.toLowerCase()) {
                 fundingTxMap.set(event.args.to.toLowerCase(), event.transactionHash);
            }
        }
        
        canceledSet = new Set(canceledEvents.filter(e => e.args).map(e => e.args.id.toString()));

        const initialProposals = await fetchProposalBatch(total, Math.max(1, total - INITIAL_PAST_PROPOSAL_COUNT + 1));
        let activeProposals = initialProposals.filter(p => p.state === 1);
        allProposals = initialProposals.filter(p => p.state !== 1).sort((a, b) => b.id - a.id);
        
     /*   if (activeProposals.length === 0 && allProposals.length > 0) {
            console.log("TESTING: No real active proposals found. Creating a fake one for timer display.");
            let fakeActiveProposal = { ...allProposals[0] };
            const currentBlock = await provider.getBlockNumber();
            fakeActiveProposal.endBlock = ethers.BigNumber.from(currentBlock + 200);
            activeProposals.push(fakeActiveProposal);
        }
*/
        renderProposals(activeProposals, activeListDiv, { isActiveList: true });
        
        for (const proposal of activeProposals) {
            startProposalTimer(proposal.id, proposal.endBlock.toNumber());
            updateVoteCounterForProposal(proposal.id);
        }

        refreshPastProposalView();
        await loadAllProposalsInBackground(total - initialProposals.length);
    } catch (e) {
        console.error("Could not load proposals:", e);
    }
}

async function loadAllProposalsInBackground(startingId) { if (startingId <= 0) return; let currentId = startingId; while (currentId > 0) { const batchEndId = Math.max(0, currentId - LOAD_MORE_BATCH_SIZE + 1); const newProposals = await fetchProposalBatch(currentId, batchEndId); const newPastProposals = newProposals.filter(p => p.state !== 1); const proposalMap = new Map(allProposals.map(p => [p.id, p])); for (const proposal of newPastProposals) { proposalMap.set(proposal.id, proposal); } allProposals = Array.from(proposalMap.values()).sort((a, b) => b.id - a.id); currentId = batchEndId - 1; } console.log("All historical proposals loaded in background."); refreshPastProposalView(); }
async function fetchProposalBatch(startId, endId) { const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, provider); const promises = []; const filter = governorContract.filters.ProposalCreated(); const events = await governorContract.queryFilter(filter, 0, 'latest'); const descriptionMap = new Map(events.map(e => [e.args.id.toString(), e.args.description])); for (let i = startId; i >= endId && i > 0; i--) { promises.push((async () => { try { const pData = await governorContract.proposals(i); if (pData.proposer === '0x0000000000000000000000000000000000000000') return null; const state = await governorContract.state(i); const actions = await governorContract.getActions(i); const description = descriptionMap.get(i.toString()) || "Description not found in event logs."; return { ...pData, id: i, state, actions, description }; } catch (err) { return null; } })()); } const results = await Promise.all(promises); return results.filter(p => p !== null); }

// --- RENDER & DISPLAY FUNCTIONS ---
function displayMoreProposals() { displayedPastProposalsCount += LOAD_MORE_BATCH_SIZE; refreshPastProposalView(); }
function refreshPastProposalView() {
    const searchTerm = document.getElementById('search-proposals').value.toLowerCase();
    const showExecuted = document.getElementById('filter-executed').checked;
    const showDefeated = document.getElementById('filter-defeated').checked;
    const hideCancelled = document.getElementById('filter-hide-cancelled').checked;

    const pastProposalList = document.getElementById('past-proposal-list');
    const loadMoreBtn = document.getElementById('load-more-btn');

    let filteredProposals = allProposals;

    if (hideCancelled) {
        filteredProposals = filteredProposals.filter(p => p.state !== 2);
    }

    if (searchTerm) {
        filteredProposals = filteredProposals.filter(p => {
            const idMatch = p.id.toString().includes(searchTerm);
            const proposerMatch = p.proposer.toLowerCase().includes(searchTerm);
            const descriptionMatch = p.description.toLowerCase().includes(searchTerm);
            return idMatch || proposerMatch || descriptionMatch;
        });
    }

    if (showExecuted) {
        filteredProposals = filteredProposals.filter(p => p.state === 7);
    } else if (showDefeated) {
        filteredProposals = filteredProposals.filter(p => p.state === 3);
    }

    const proposalsToDisplay = filteredProposals.slice(0, displayedPastProposalsCount);
renderProposals(proposalsToDisplay, pastProposalList, { isActiveList: false, searchTerm: searchTerm });

    if (proposalsToDisplay.length < filteredProposals.length) {
        loadMoreBtn.style.display = 'block';
    } else {
        loadMoreBtn.style.display = 'none';
    }
}

function renderProposals(proposals, targetElement, { isActiveList = false, searchTerm = '' } = {}) {
    targetElement.innerHTML = '';
    if (proposals.length === 0) {
        targetElement.innerHTML = `<p>No ${isActiveList ? 'pending' : 'matching'} proposals at the moment.</p>`;
        return [];
    }

    const renderedProposalIds = [];
    const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const highlight = (text, term) => term ? text.replace(new RegExp(escapeRegExp(term), 'gi'), `<mark>$&</mark>`) : text;
    const proposalStates = ['Pending', 'Active', 'Cancelled', 'Defeated', 'Succeeded', 'Queued', 'Expired', 'Executed'];

    proposals.forEach(proposal => {
        let proposalTitle = `Proposal #${proposal.id.toString()}`;
        try { const descData = JSON.parse(proposal.description); if (descData.projectName) { proposalTitle += `: ${descData.projectName}`; } } catch (e) {}
        const stateStr = proposalStates[proposal.state];
        
        const executionTxHash = executionTxMap.get(proposal.id.toString());
        const totalVotes = proposal.forVotes.add(proposal.againstVotes);

        let descriptionHtml = '';
        let technicalDetailsHtml;
        let fundingTxHash; 

        try {
            const data = JSON.parse(proposal.description);
            
            const investeeWallet = data.wallet || data.investeeWallet; 
            if (investeeWallet && ethers.utils.isAddress(investeeWallet)) {
                fundingTxHash = fundingTxMap.get(investeeWallet.toLowerCase());
            }

            const isOldProposal = proposal.id <= 162;

            if (isOldProposal) {
                const technicalKeys = new Set(['range', 'rate', 'time', 'checkbox1', 'checkbox2']);
                const mainDetailsParts = [];
                const techDetailsParts = [];

                Object.entries(data).forEach(([key, value]) => {
                    if (value === null || value === undefined || value === '') return;
                    const prettyKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    
                    // --- START OF FIX (OLD PROPOSAL) ---
                    let prettyValue = value.toString().replace(/\n/g, '<br>'); // 1. Get the raw text
                    if (ethers.utils.isAddress(value.toString()) && value.toString().length === 42) {
                        prettyValue = createAddressLink(value.toString()); // 2. Overwrite if it's an address
                    } else if (value.toString().startsWith('http')) {
                        prettyValue = `<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>`; // 2. Overwrite if it's a link
                    }
                    prettyValue = highlight(prettyValue, searchTerm); // 3. NOW highlight the final result
                    // --- END OF FIX (OLD PROPOSAL) ---
                    
                    const itemHtml = `<div class="description-item"><strong>${prettyKey}:</strong><br>${prettyValue}</div>`;

                    if (technicalKeys.has(key.toLowerCase())) {
                        techDetailsParts.push(itemHtml);
                    } else {
                        mainDetailsParts.push(itemHtml);
                    }
                });

                descriptionHtml = mainDetailsParts.join('');
                const originalTechDetails = (proposal.actions && proposal.actions.targets.length > 0) ? proposal.actions.targets.map((target, i) => { const value = ethers.utils.formatEther(proposal.actions.values[i] || '0'); return `<div class="action-item"><p><strong>Target:</strong> ${createAddressLink(target)}</p><p><strong>Value:</strong> ${value} ETH</p><p><strong>Signature:</strong> ${proposal.actions.signatures[i] || 'N/A'}</p><p><strong>Calldata:</strong> ${proposal.actions.calldatas[i]}</p></div>` }).join('') : `<h4>No Actions (Text-only Proposal)</h4>`;
                
                technicalDetailsHtml = originalTechDetails + techDetailsParts.join('');

            } else {
                descriptionHtml = Object.entries(data).map(([key, value]) => {
                    if (!value) return '';
                    const prettyKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    
                    // --- START OF FIX (NEW PROPOSAL) ---
                    let prettyValue = value.toString().replace(/\n/g, '<br>'); // 1. Get raw text
                    if (ethers.utils.isAddress(value.toString()) && value.toString().length === 42) {
                        prettyValue = createAddressLink(value.toString()); // 2. Overwrite if address
                    } else if (value.toString().startsWith('http')) {
                        prettyValue = `<a href="${value}" target="_blank" rel="noopener noreferrer">${value}</a>`; // 2. Overwrite if link
                    }
                    prettyValue = highlight(prettyValue, searchTerm); // 3. NOW highlight the final result
                    // --- END OF FIX (NEW PROPOSAL) ---

                    return `<div class="description-item"><strong>${prettyKey}:</strong><br>${prettyValue}</div>`;
                }).join('');
                technicalDetailsHtml = (proposal.actions && proposal.actions.targets.length > 0) ? proposal.actions.targets.map((target, i) => { const value = ethers.utils.formatEther(proposal.actions.values[i] || '0'); return `<div class="action-item"><p><strong>Target:</strong> ${createAddressLink(target)}</p><p><strong>Value:</strong> ${value} ETH</p><p><strong>Signature:</strong> ${proposal.actions.signatures[i] || 'N/A'}</p><p><strong>Calldata:</strong> ${proposal.actions.calldatas[i]}</p></div>` }).join('') : `<h4>No Actions (Text-only Proposal)</h4>`;
            }
        } catch (e) {
            descriptionHtml = `<div class="description-item">${highlight(proposal.description, searchTerm)}</div>`;
            technicalDetailsHtml = (proposal.actions && proposal.actions.targets.length > 0) ? proposal.actions.targets.map((target, i) => { const value = ethers.utils.formatEther(proposal.actions.values[i] || '0'); return `<div class="action-item"><p><strong>Target:</strong> ${createAddressLink(target)}</p><p><strong>Value:</strong> ${value} ETH</p><p><strong>Signature:</strong> ${proposal.actions.signatures[i] || 'N/A'}</p><p><strong>Calldata:</strong> ${proposal.actions.calldatas[i]}</p></div>` }).join('') : `<h4>No Actions (Text-only Proposal)</h4>`;
        }

        const executionLinkHtml = executionTxHash ? `<div class="details-item"><strong>Execution TX:</strong><br>${createAddressLink(executionTxHash)}</div>` : '';
        const fundingLinkHtml = fundingTxHash ? `<div class="details-item"><strong>Payment TX:</strong><br>${createAddressLink(fundingTxHash)}</div>` : '';
        
        const timerHtml = isActiveList 
            ? `<div style="margin-top: 0px; margin-bottom: 8px; display: flex; align-items: center;">
                 <span style="opacity: 0.7; margin-right: 6px; font-size: 0.9rem;">Ends in:</span>
                 <span id="timer-${proposal.id}" style="font-family: var(--font-mono); color: var(--color-green); font-size: 0.9rem;">Calculating...</span>
               </div>` 
            : ''; 
        
        let actionButtonsHtml = '';
        if (isActiveList) {
            renderedProposalIds.push(proposal.id);
            const pushButtonId = `push-votes-btn-${proposal.id}`;
            const counterId = `vote-counter-${proposal.id}`;
            actionButtonsHtml = `
                <div class="button-group" style="margin-top:20px;border-top:1px dashed var(--color-border);padding-top:20px;">
                    <button class="btn2 vote-for-btn" data-proposal-id="${proposal.id}">Approve</button>
                    <button class="btn2 vote-against-btn" data-proposal-id="${proposal.id}">Reject</button>
                    <button class="btn2 vote-for-sig-btn" data-proposal-id="${proposal.id}" style="border-style:dashed;">Approve by (Sig)</button>
                    <button class="btn2 vote-against-sig-btn" data-proposal-id="${proposal.id}" style="border-style:dashed;">Reject by (Sig)</button>
                    <button id="${pushButtonId}" class="btn2 push-votes-btn" data-proposal-id="${proposal.id}" style="border-color: var(--color-blue); display: none;">
                        Push <span id="${counterId}">0</span> pending Votes
                    </button>
                    <button class="btn2 cancel-btn" data-proposal-id="${proposal.id}">Cancel</button>
                    <button class="btn2 queue-btn" data-proposal-id="${proposal.id}">Queue</button>
                    <button class="btn2 execute-btn" data-proposal-id="${proposal.id}">Execute</button>
                </div>`;
        }
        
        const proposalEl = document.createElement('div');
        proposalEl.className = 'proposal';

        proposalEl.innerHTML = `
            <div class="proposal-title">
                <h3>${highlight(proposalTitle, searchTerm)}</h3>
                <span class="proposal-status status-${stateStr.toLowerCase()}">${stateStr}</span>
            </div>

            ${timerHtml}

            <div class="button-group" style="margin-top: ${isActiveList ? '0px' : '12px'};">
                <button class="btn-expand view-details-btn" data-proposal-id="${proposal.id}">Show Details ▼</button>
            </div>
            
            <div class="proposal-details" id="details-${proposal.id}">
                <div class="details-section" style="margin-top:20px">
                    <div class="details-grid">
                        <div class="details-item"><strong>For Votes:</strong><br>${parseFloat(ethers.utils.formatUnits(proposal.forVotes, 18)).toLocaleString()}</div>
                        <div class="details-item"><strong>Against Votes:</strong><br>${parseFloat(ethers.utils.formatUnits(proposal.againstVotes, 18)).toLocaleString()}</div>
                        <div class="details-item"><strong>Total Votes:</strong><br>${parseFloat(ethers.utils.formatUnits(totalVotes, 18)).toLocaleString()}</div>
                        <div class="details-item"><strong>Proposer:</strong><br>${createAddressLink(proposal.proposer)}</div>
                        <div class="details-item"><strong>Start Block:</strong><br>${proposal.startBlock.toString()}</div>
                        <div class="details-item"><strong>End Block:</strong><br>${proposal.endBlock.toString()}</div>
                        <div class="details-item"><strong>ETA:</strong><br>${proposal.eta.isZero()?'Not Queued':new Date(proposal.eta.toNumber()*1000).toLocaleString()}</div>
                        ${executionLinkHtml}${fundingLinkHtml}
                    </div>
                </div>
                <div class="details-section"><h4></h4>${descriptionHtml}</div>
                ${actionButtonsHtml}
                <details style="margin-top:0px;">
                    <summary>Technical Data</summary>
                    <div class="details-section">${technicalDetailsHtml}</div>
                </details>
            </div>`;
        
        targetElement.appendChild(proposalEl);
    });

    return renderedProposalIds;
}

// --- Transaction & Signature Functions ---
async function sendTransaction(contract, methodName, args) { 
    try { 
        const tx = await contract[methodName](...args); 
        showCustomAlert(`Transaction sent... waiting for confirmation. <br><a href="https://etherscan.io/tx/${tx.hash}" target="_blank">View on Etherscan</a>`); 
        
        const receipt = await tx.wait();
        
        document.getElementById('custom-alert-overlay').style.display = 'none';
        return receipt; 

    } catch (error) { 
        console.error(`Transaction failed for ${methodName}:`, error); 
        const reason = error.reason || error.data?.message || error.message || "The transaction was rejected or failed."; 
        showCustomAlert(`Transaction failed: ${reason}`); 
        return null;
    } 
}

async function delegateToSelf() { 
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); 
    const receipt = await sendTransaction(dCultContract, 'delegate', [userAddress]);
    if (receipt) {
        showCustomAlert('Delegation successful! Refreshing...');
        setTimeout(initializeApp, 1000); 
    }
}


async function stake() { 
    const amount = document.getElementById('stake-amount').value; 
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showCustomAlert('Please enter a valid, positive amount.'); 
    const cultContract = new ethers.Contract(CULT_TOKEN_ADDRESS, CULT_TOKEN_ABI, signer); 
    const amountInWei = ethers.utils.parseUnits(amount, 18); 
    const allowance = await cultContract.allowance(userAddress, DCULT_TOKEN_ADDRESS); 
    
    if(allowance.lt(amountInWei)) { 
        showCustomAlert("First, an approval transaction is required."); 
        const approvalReceipt = await sendTransaction(cultContract, 'approve', [DCULT_TOKEN_ADDRESS, ethers.constants.MaxUint256]);
        if (!approvalReceipt) return;
        showCustomAlert('Approval successful! You can now stake.');
    } 
    
    const dCultStakingContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); 
    const depositReceipt = await sendTransaction(dCultStakingContract, 'deposit', [0, amountInWei]);
    if (depositReceipt) {
        showCustomAlert('Stake successful! Refreshing...');
        initializeApp(); 
    }
}


async function unstake() { 
    const amount = document.getElementById('unstake-amount').value; 
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showCustomAlert('Please enter a valid, positive amount.'); 
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); 
    const amountInWei = ethers.utils.parseUnits(amount, 18); 
    const receipt = await sendTransaction(dCultContract, 'withdraw', [0, amountInWei]);
    if (receipt) {
        showCustomAlert('Unstake successful! Refreshing...');
        initializeApp(); 
    }
}


async function castVote(proposalId, support) { 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    const receipt = await sendTransaction(governorContract, 'castVote', [proposalId, support]);
    if (receipt) {
        showCustomAlert(`Vote for Proposal #${proposalId} successful! Refreshing...`);
        initialLoad(); 
    }
}

async function signVote(proposalId, support) {
    try {
        const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider);
        const delegatedPower = await dCultContract.getVotes(userAddress);
        if (delegatedPower.isZero()) {
            return showCustomAlert("You must delegate your voting power to yourself before you can vote by signature.");
        }

        const { chainId } = await provider.getNetwork();

        const domain = {
            name: "Cult Governor Bravo",
            chainId: chainId,
            verifyingContract: GOVERNOR_BRAVO_ADDRESS
        };

        const types = {
            Ballot: [
                { name: "proposalId", type: "uint256" },
                { name: "support", type: "uint8" }
            ]
        };

        const value = { proposalId: Number(proposalId), support: support };

        const signature = await signer._signTypedData(domain, types, value);
        
        const { r, s, v } = ethers.utils.splitSignature(signature);

        const VOTE_API_ENDPOINT = `${API_BASE_URL}proposal/signature`;

        const reqData = {
            proposalId: Number(proposalId),
            support: support,
            walletAddress: userAddress,
            signature: { v, r, s, proposalId: Number(proposalId), support },
        };
        
        showCustomAlert("Submitting vote signature to the community pool...");
        const response = await fetch(VOTE_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "API request for vote signature failed");
        }

        const voteType = support === 1 ? "Approved" : "Rejected";
        showCustomAlert(`Vote Signature for Proposal #${proposalId} ${voteType}!`);
        
        await updateVoteCounterForProposal(proposalId);

    } catch (error) {
        console.error(`Signing vote for proposal ${proposalId} failed:`, error);
        showCustomAlert("Vote signature failed: " + (error.message || "User denied signature."));
    }
}



async function pushAllVotesForProposal(proposalId) {
    try {
        const VOTES_API_ENDPOINT = `${API_BASE_URL}proposal/signatures/${proposalId}`;
        showCustomAlert(`Fetching pending votes for Proposal #${proposalId}...`);
        const response = await fetch(VOTES_API_ENDPOINT);
        if (!response.ok) throw new Error("Failed to fetch vote signatures from API.");
        
        const apiResponse = await response.json();
        const signaturesFromApi = apiResponse.data;

        if (!signaturesFromApi || signaturesFromApi.length === 0) {
            return showCustomAlert("No pending vote signatures to submit for this proposal.");
        }

        console.log(`Submitting a batch of ${signaturesFromApi.length} vote signatures to the Governor 2 contract.`);
        
        const governorSignerContract = new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_2_ABI, signer);
        
        const receipt = await sendTransaction(governorSignerContract, 'castVoteBySigs', [signaturesFromApi]);
        
        if (receipt) {
            showCustomAlert(`Vote batch for Proposal #${proposalId} submitted successfully! Refreshing...`);
            setTimeout(initialLoad, 2000);
        }

    } catch(e) {
        console.error(`Failed to push votes for proposal ${proposalId}:`, e);
        showCustomAlert("Failed to push votes: " + e.message);
    }
}

async function updateVoteCounterForProposal(proposalId) {
    const pushButton = document.getElementById(`push-votes-btn-${proposalId}`);
    const counterEl = document.getElementById(`vote-counter-${proposalId}`);
    if (!pushButton || !counterEl) return;

    try {
        const VOTE_COUNTER_ENDPOINT = `${API_BASE_URL}proposal/signatures/${proposalId}`;
        const response = await fetch(VOTE_COUNTER_ENDPOINT);
        const apiResponse = await response.json();
        const signatures = apiResponse.data || [];
        const count = signatures.length;
        
        counterEl.textContent = count;
        
        if (count > 0) {
            pushButton.style.display = 'inline-block';
        } else {
            pushButton.style.display = 'none';
        }
    } catch(e) {
        console.error(`Could not fetch vote counter for proposal ${proposalId}:`, e);
        counterEl.textContent = "N/A";
        pushButton.style.display = 'none';
    }
}

async function submitProposal() { 
    const investeeWallet = document.getElementById('p-investeeWallet').value.trim(); 
    if (!investeeWallet || !ethers.utils.isAddress(investeeWallet)) { return showCustomAlert('A valid Investee Wallet address is mandatory.'); } 
    const proposalData = { projectName: document.getElementById('p-projectName').value.trim(), wallet: investeeWallet, shortDescription: document.getElementById('p-shortDescription').value.trim(), socialChannel: document.getElementById('p-socialChannel').value.trim() || "N/A", links: document.getElementById('p-links').value.trim() || "N/A", manifestoOutlinedFit: document.getElementById('p-manifestoOutlinedFit').value.trim() || "N/A", returnModel: document.getElementById('p-returnModel').value.trim() || "N/A", proposedTimeline: document.getElementById('p-proposedTimeline').value.trim() || "N/A", fundsStoredHeldUtilised: document.getElementById('p-fundsStoredHeldUtilised').value.trim() || "N/A", guardianAddress: userAddress }; 
    const descriptionString = JSON.stringify(proposalData, null, 2); 
    const targets = [GOVERNOR_BRAVO_ADDRESS]; 
    const values = [0]; 
    const signatures = ["_setInvesteeDetails(address)"]; 
    const iface = new ethers.utils.Interface(["function _setInvesteeDetails(address)"]); 
    const calldatas = [iface.encodeFunctionData("_setInvesteeDetails", [investeeWallet])]; 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    
    const receipt = await sendTransaction(governorContract, 'propose', [targets, values, signatures, calldatas, descriptionString]);
    if (receipt) {
        showCustomAlert('Proposal submitted successfully! Refreshing...');
        document.getElementById('proposal-form-fields').querySelectorAll('input, textarea').forEach(el => el.value = ''); 
        initialLoad(); 
    }
}

async function cancelProposal(proposalId) { 
    if (!window.confirm(`Are you sure you want to cancel proposal #${proposalId}?`)) return; 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    const receipt = await sendTransaction(governorContract, 'cancel', [proposalId]);
    if (receipt) {
        showCustomAlert('Proposal canceled successfully! Refreshing...');
        initialLoad(); 
    }
}


async function queueProposal(proposalId) { 
    if (!window.confirm(`Are you sure you want to queue proposal #${proposalId} for execution?`)) return; 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    const receipt = await sendTransaction(governorContract, 'queue', [proposalId]);
    if (receipt) {
        showCustomAlert('Proposal queued successfully! Refreshing...');
        initialLoad(); 
    }
}

async function executeProposal(proposalId) { 
    if (!window.confirm(`Are you sure you want to execute proposal #${proposalId}? This action is irreversible.`)) return; 
    const governorContract = new ethers.Contract(GOVERNOR_BRAVO_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    const receipt = await sendTransaction(governorContract, 'execute', [proposalId]);
    if (receipt) {
        showCustomAlert('Proposal executed successfully! Refreshing...');
        initialLoad(); 
    }
}

async function claimRewards() { 
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer); 
    const receipt = await sendTransaction(dCultContract, 'claimCULT', [0]);
    if (receipt) {
        showCustomAlert('Rewards claimed successfully! Refreshing...');
        initializeApp(); 
    }
}


async function signDelegation() {
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, signer);
    try {
        const nonceBN = await dCultContract.nonces(userAddress);
        const nonce = nonceBN.toNumber();
        const { chainId } = await provider.getNetwork();
        const expiry = Math.floor(Date.now() / 1000) + 604800;
        const delegatee = userAddress;

        const domain = {
            name: "dCULT",
            version: "1",
            chainId: chainId,
            verifyingContract: DCULT_TOKEN_ADDRESS
        };

        const types = {
            Delegation: [
                { name: "delegatee", type: "address" },
                { name: "nonce", type: "uint256" },
                { name: "expiry", type: "uint256" }
            ]
        };

        const value = { delegatee, nonce, expiry };
        
        const signature = await signer._signTypedData(domain, types, value);
        
        const { r, s, v } = ethers.utils.splitSignature(signature);

        const reqData = {
            walletAddress: userAddress,
            signature: { delegatee, nonce, expiry, v, r, s },
        };
        
        showCustomAlert("Submitting signature to the community pool...");
        const response = await fetch(`${API_BASE_URL}delegate/signature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "API request failed");
        }

        showCustomAlert("Delegate Signature Submitted Successfully!");
        await updateDelegationCounter();

    } catch (error) {
        console.error("Signing for delegation failed:", error);
        showCustomAlert("Signing failed: " + (error.message || "User denied signature."));
    }
}

async function pushAllDelegations() {
    try {
        showCustomAlert("Fetching pending signatures from the API...");
        const response = await fetch(`${API_BASE_URL}delegate/signatures`);
        if (!response.ok) throw new Error("Failed to fetch signatures from API.");
        
        const apiResponse = await response.json();
        const signaturesFromApi = apiResponse.data;

        if (!signaturesFromApi || signaturesFromApi.length === 0) {
            return showCustomAlert("No pending delegation signatures to submit.");
        }

        console.log(`Attempting to submit a batch of ${signaturesFromApi.length} signatures to the Governor 2 contract.`);

        const governorSignerContract = new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_2_ABI, signer);
        
        const success = await sendTransaction(governorSignerContract, 'delegateBySigs', [signaturesFromApi]);
        
        if (success) {
            showCustomAlert('Delegation batch submitted successfully! Refreshing...');
            setTimeout(initializeApp, 2000);
        }

    } catch(e) {
        console.error("Failed to push delegations:", e);
        showCustomAlert("Failed to push delegations: " + e.message);
    }
}
async function castVoteBySig(proposalId, support) { 
    const dCultContract = new ethers.Contract(DCULT_TOKEN_ADDRESS, DCULT_ABI, provider); 
    const delegatedPower = await dCultContract.getVotes(userAddress); 
    if (delegatedPower.isZero()) { 
        return showCustomAlert("You must delegate your voting power to yourself before you can vote. Please use the 'Delegate (TX)' or 'Delegate (Sig)' button in the user info section first."); 
    } 
    
    const governorSigContract = new ethers.Contract(GOVERNOR_BRAVO_2_ADDRESS, GOVERNOR_BRAVO_ABI, signer); 
    
    try { 
        const { chainId } = await provider.getNetwork(); 
        const contractName = await governorSigContract.name(); 
        const domain = { name: contractName, chainId: chainId, verifyingContract: GOVERNOR_BRAVO_2_ADDRESS }; 
        const types = { Ballot: [{ name: "proposalId", type: "uint256" }, { name: "support", type: "uint8" }] }; 
        const value = { proposalId: proposalId, support: support }; 
        const signature = await signer._signTypedData(domain, types, value); 
        const { r, s, v } = ethers.utils.splitSignature(signature); 
        
        const receipt = await sendTransaction(governorSigContract, 'castVoteBySig', [proposalId, support, v, r, s]);
        if (receipt) {
            showCustomAlert(`Vote by signature for Proposal #${proposalId} successful!`);
            initialLoad(); 
        }

    } catch (error) { 
        console.error(`Vote by signature failed for proposal ${proposalId}:`, error); 
        showCustomAlert("Vote by signature failed: " + (error.reason || error.message)); 
    } 
}
// --- Event Listeners ---
window.addEventListener('DOMContentLoaded', () => {
    fetchAndDisplayRepoUpdate();

    document.getElementById('custom-alert-close').addEventListener('click', () => {
        document.getElementById('custom-alert-overlay').style.display = 'none';
    });
    
    window.addEventListener('keydown', (event) => {
    const alertOverlay = document.getElementById('custom-alert-overlay');
    if (alertOverlay.style.display === 'flex' && event.key === 'Enter') {
        event.preventDefault(); 
        document.getElementById('custom-alert-close').click(); 
    }
});
    
    
    document.getElementById('add-tracked-wallet-btn').addEventListener('click', handleAddWalletInput);
    document.getElementById('track-wallet-input').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            document.getElementById('add-tracked-wallet-btn').click();
        }
    });
    document.getElementById('clear-tracked-wallets-btn').addEventListener('click', clearAllTrackedWallets);
    document.getElementById('tracked-wallets-list').addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.remove-tracked-wallet-btn');
        if (targetBtn) {
            const addressToRemove = targetBtn.dataset.walletAddress;
            removeTrackedWallet(addressToRemove);
        }
    });

    
    
    
    const disclaimerOverlay = document.getElementById('disclaimer-overlay');
    const acceptBtn = document.getElementById('accept-disclaimer-btn');
    const reminderBanner = document.getElementById('reminder-banner');
    const closeReminderBtn = document.getElementById('close-reminder-btn');
    if (localStorage.getItem('disclaimerAccepted') !== 'true') {
        if (disclaimerOverlay) disclaimerOverlay.style.display = 'flex';
    } else {
        if (reminderBanner) reminderBanner.style.display = 'flex';
    }
    if (acceptBtn) {
        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('disclaimerAccepted', 'true');
            if (disclaimerOverlay) disclaimerOverlay.style.display = 'none';
        });
    }
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
    
    document.getElementById('load-more-btn').addEventListener('click', displayMoreProposals);
    document.getElementById('stake-max-btn').addEventListener('click', () => { const bal = document.getElementById('available-cult').textContent.split(':')[1].trim(); if (bal) document.getElementById('stake-amount').value = bal; });
    document.getElementById('unstake-max-btn').addEventListener('click', () => { const bal = document.getElementById('available-dcult').textContent.split(':')[1].trim(); if (bal) document.getElementById('unstake-amount').value = bal; });
    document.getElementById('search-proposals').addEventListener('input', () => { displayedPastProposalsCount = INITIAL_PAST_PROPOSAL_COUNT; refreshPastProposalView(); });
    document.getElementById('filter-executed').addEventListener('change', () => { document.getElementById('filter-defeated').checked = false; refreshPastProposalView(); });
    document.getElementById('filter-defeated').addEventListener('change', () => { document.getElementById('filter-executed').checked = false; refreshPastProposalView(); });
    document.getElementById('filter-hide-cancelled').addEventListener('change', refreshPastProposalView);

    document.getElementById('sign-delegation-btn').addEventListener('click', signDelegation);
    document.getElementById('push-delegates-btn').addEventListener('click', pushAllDelegations);
    
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
            else if (button.classList.contains('push-votes-btn')) {
    pushAllVotesForProposal(proposalId);
}
          else if (button.classList.contains('vote-for-sig-btn')) { 
    signVote(proposalId, 1);
}
else if (button.classList.contains('vote-against-sig-btn')) { 
    signVote(proposalId, 0);
}
            else if (button.classList.contains('view-details-btn')) { const detailsEl = document.getElementById(`details-${proposalId}`); if (detailsEl) { const isHidden = detailsEl.style.display === 'none' || detailsEl.style.display === ''; detailsEl.style.display = isHidden ? 'block' : 'none'; button.innerHTML = isHidden ? 'Hide Details ▲' : 'Show Details ▼'; } }
        }
    });
});