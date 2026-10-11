---
'better-auth-solana': patch
---

Fix valid Solana sign-ins returning HTTP 500 on Better Auth 1.7 by looking up accounts through the public database adapter.
