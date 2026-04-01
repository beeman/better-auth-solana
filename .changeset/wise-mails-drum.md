---
'better-auth-solana': minor
---

Add `createSIWSMessage(...)` and `formatSIWSMessage(...)` to `better-auth-solana/client`.

These helpers expose the package's canonical SIWS message formatter for raw `signMessage` flows while keeping
`createSIWSInput(...)` unchanged for wallet libraries that accept structured SIWS input.
