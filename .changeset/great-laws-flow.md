---
'better-auth-solana': patch
---

Avoid leaving behind partial SIWS user, wallet, and account records when `/siws/verify` fails before session creation.
