# CULT DAO HUB

**YOU ARE ENTERING SOVEREIGN TERRITORY.**

The CULT DAO Hub 2.0 is a community-built, open-source interface for exploring and participating in the CULT DAO ecosystem. It brings the original Hub, Portfolio Tracker, Governance Dashboard, Delegation Checker, and Burntracker into one static site while preserving the original on-chain workflows.

No account. No custody. Your wallet shows every transaction before you approve it.

---

## 💡 Features

The six task-focused entries are:

- **Staking & Returns** – stake CULT, unstake dCULT, claim returns, and manage delegation.
- **Portfolio** – inspect Ethereum, Base, and Polygon wallets, collections, Safe ownership, and assets.
- **Proposals** – browse proposals; vote, propose, cancel, queue, or execute through the preserved Hub workflow.
- **Delegation** – check voting readiness, delegation state, voting rights, and cached vote history without connecting a wallet.
- **Analytics** – explore DAO, governance, Guardian, participation, and delegatee data.
- **Burns & Contributions** – follow CULT burns, contributions, supply changes, and return distributions.

---

## 🛡️ Safety & Data

- The Hub detects the connected wallet network and offers a one-click switch to **Ethereum mainnet** when another network is active.
- Transaction and signature actions remain unavailable until Ethereum mainnet is active.
- Always verify the contract, method, amount, and network in your wallet before confirming.
- Wallet collections, labels, descriptions, preferences, caches, and update backups remain in your browser unless you explicitly export them.
- Historical dataset replacements are opt-in and backup-first when local data already exists.

This is community software, not financial advice. Read the transaction your wallet presents and use it at your own risk.

---

## 🚀 Run Locally

The Hub is a static site. There is no build step and no package installation.

### Prerequisite

Install [Python 3](https://www.python.org/downloads/) or use any static HTTP server.

### Start the site

```bash
git clone https://github.com/wearecultdao/hub.git
cd hub
python3 -m http.server 8000
```

On Windows PowerShell, use `python -m http.server 8000` if `python3` is unavailable.

Open [http://localhost:8000](http://localhost:8000), and stop the server with `Ctrl+C`.

---

## 🌐 Publish

Deploy the repository root as a static site. All internal routes and assets are relative, so the Hub works from a GitHub Pages project path such as `/hub/`.

---

## 🤝 Contribute

Fork it. Inspect it. Improve it. Adapt it.

---

## ❤️ Support

If this Hub empowers you, consider sending some fuel:

- ETH: `0xB3b1185749dbE4c208c13cA1fa0E93A75C766066`
- BTC: `bc1q7ud6qdw62wj5897r68eyk9m20h7wqgnvuju5nu`

---

## 📜 License

Open-source. Free for all. Forever.

Released under the [MIT License](LICENSE).
