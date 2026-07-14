# Changelog

## 2026-07-14 — Ethereum network safety

### Added

- Consistent connected-network detection across Hub, Portfolio, Delegation, Analytics, and Burn routes.
- A one-click wallet prompt to switch from another active chain to Ethereum mainnet.
- Live recovery when the wallet emits `chainChanged`, including automatic Hub and Analytics reinitialization.
- UI and transaction-boundary guards that prevent Hub transactions and signatures on the wrong chain.

## 2026-07-13 — Hub 2.0.0

### Summary

Hub 2.0 brings the CULT DAO community tools into one static, open-source experience while keeping the established Hub workflows familiar.

### Added

- Six task-focused entries for Staking & Returns, Portfolio, Proposals, Delegation, Analytics, and Burns & Contributions.
- Shared navigation, wallet continuity, currency preferences, themes, and editable address labels.
- A dedicated Delegation Checker route and expanded governance analytics.
- Portfolio collections across Ethereum, Base, and Polygon.
- CULT burn, contribution, supply, and returns tracking.
- Browser-local data exports and backup-first historical dataset updates.

### Preserved

- CULT and dCULT staking, unstaking, returns, and delegation workflows.
- Direct and gasless governance voting.
- Proposal submission, cancellation, queueing, and execution.
- The original contract addresses, ABIs, and community-owned static deployment model.

### Notes

- Use Ethereum mainnet for transaction actions.
- No build step or package installation is required.
