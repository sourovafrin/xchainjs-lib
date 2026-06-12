---
'@xchainjs/zcash-js': minor
'@xchainjs/xchain-zcash': patch
'@xchainjs/xchain-utxo-providers': patch
---

Made the Zcash consensus branch ID dynamic instead of hardcoded. `signAndFinalize` now accepts an optional `consensusBranchId` parameter, and the exported `DEFAULT_CONSENSUS_BRANCH_ID` has been updated to NU6.2 (0x5437f330). The Zcash keystore client fetches the live branch ID from the blockbook node (`backend.consensus.nextblock`) before signing, so transactions stay valid across network upgrades without requiring a library update. The Blockbook provider now also skips non-address inputs when mapping transactions, uses a shorter rate-limit pause between transaction fetches, and prefixes its error messages for easier debugging.
