# Changelog

## 2026-06-21

### Summary

This update keeps the hub usable when the gasless signature API is not available from the current website. If gasless delegation or voting cannot be reached, the hub now hides those signature buttons and tells users that direct on-chain actions still work. Direct wallet transactions, voting through the CULT Governor contract, staking, claiming, and proposal actions remain available.

It also fixes a display bug in past proposals where Payment TX links could be wrong when multiple proposals paid the same wallet. Payment transactions are now matched to the right proposal more carefully.

### Fixed

- Added a browser-origin health check for `https://api.cultdao.io/delegate/counter` before showing or using gasless/batch signature actions.
  - Why: the API now uses a stricter origin allowlist. On non-allowlisted origins, API calls can fail with fetch/CORS errors or HTTP 500, which made gasless delegation and voting look usable when they were not.

- Hid API-backed signature controls when the API is unavailable from the current origin.
  - Affected controls: `Delegate (Sig)`, `Push Delegates`, proposal `Approve (Sig)`, `Reject (Sig)`, and `Push Votes`.
  - Why: these actions require API reads or writes for signature collection and batch submission.

- Kept direct on-chain actions available when the API is unavailable.
  - Preserved controls: `Delegate (TX)`, direct proposal `Approve` / `Reject`, proposal submit, cancel, queue, execute, stake, unstake, and claim.
  - Why: these actions use the connected wallet and contracts directly, so they do not depend on the gasless signature API.

- Added defensive API guards inside gasless/batch click handlers.
  - Guarded endpoints: `POST /delegate/signature`, `GET /delegate/signatures`, `POST /proposal/signature`, and `GET /proposal/signatures/{proposalId}`.
  - Why: even if the API status changes after page load, blocked origins should show a concise message instead of triggering broken wallet/API flows.

- Added a concise user-facing status notice for unavailable gasless signatures.
  - Message: "Gasless signatures are only available through the official CULT frontend at the moment. Direct on-chain delegation and CULT Governor voting still work."
  - The notice now uses the same close button and auto-hide timing as the existing hub notices.
  - Why: users should understand that only signature-based gasless actions are unavailable, while direct contract actions remain usable.

- Fixed Payment TX display for proposals that share the same investee wallet.
  - Why: payment transactions were previously keyed only by recipient address. If multiple proposals paid the same wallet, the later transaction could overwrite the earlier one, causing repeated or incorrect Payment TX links.
  - The hub now maps payment transactions by proposal ID from `InvesteeFunded` events when available, then falls back to matching treasury transfers by execution transaction, then to chronological same-recipient matching.

### Notes

- No contract addresses or ABIs were changed.
