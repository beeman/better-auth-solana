# AGENTS.md

This repository contains the `better-auth-solana` package, a Bun-based Better Auth plugin for Solana sign-in.

The package publishes three public entrypoints:

- `better-auth-solana`
- `better-auth-solana/client`
- `better-auth-solana/schema`

Treat exported runtime behavior, exported types, the schema contract, and the published bundle shape as public API. Changes in those areas need the same care as any other breaking surface.

## Repository Workflow

Use Bun for all local work.

- `bun install`
- `bun run build`
- `bun run check-types`
- `bun run test`
- `bun run test:watch`
- `bun run compatibility`
- `bun run ci`
- `bun run lint:fix`

When linting fails, run `bun run lint:fix` first. It applies the repo's automatic fixes and is often faster than reading the diagnostics and making each change manually.

`bun run ci` is the standard pre-merge check. Leave the repository passing before you consider the work complete.

## Package Structure

Keep the package shape stable and intentional.

- `src/index.ts` is the server/plugin entrypoint.
- `src/client.ts` serves as the browser-safe client entrypoint.
- `src/schema.ts` provides the schema entrypoint.
- `dist/` is generated output from `bun run build`. Do not edit generated files by hand.

Tests and examples that validate package behavior should import from the public entrypoints whenever possible. Prefer exercising the package the way a consumer would use it instead of reaching through deep internal paths.

## Better Auth Integration Boundary

Build this library against Better Auth public exports.

- Use public `better-auth`, `better-auth/api`, `better-auth/client`, `better-auth/cookies`, `better-auth/db`, and other documented public entrypoints.
- Keep `@better-auth/core` out of `package.json`.
- Do not add runtime helpers, adapter access, or new integration paths that depend on `@better-auth/core`.
- Do not treat Better Auth internals as extension points for new features in this package.

If Better Auth typing still requires a `declare module '@better-auth/core'` augmentation, keep it isolated to the augmentation itself. That is a narrow typing exception, not permission to add runtime imports or a package dependency.

## Client Bundle Contract

Everything reachable from `src/client.ts` must stay browser-safe.

- Keep the client entrypoint free of server-only and heavy runtime imports.
- Do not allow the published client bundle to pull in `@better-auth/core`, `better-auth`, or `zod`.
- Preserve the split between server/plugin code and client helpers so consumers can use `better-auth-solana/client` in browser and Expo environments without server baggage.

`test/client-bundle.test.ts` is the guardrail for this contract. If a change touches the client entrypoint, keep that test meaningful and passing.

## Dependency Management

Dependency policy in this repo is enforced, not advisory.

- `bunfig.toml` sets `exact = true`, so Bun saves exact versions by default.
- `bunfig.toml` also sets `minimumReleaseAge = 432000`, which means new packages must be at least 5 days old before they are accepted.
- `syncpack.config.ts` and `bun run syncpack:lint` enforce pinned `devDependencies`.
- `lefthook.yaml` runs the Syncpack check in pre-commit, and CI runs it again.

Use pinned versions for `devDependencies`. Use dependency ranges only where the package contract needs them, such as `dependencies` and `peerDependencies`.

When changing supported peer versions:

- update `peerDependencies` in `package.json`
- update the `compatibility-peers` matrix in `.github/workflows/ci.yaml`
- keep the `floor` and `current` compatibility lanes aligned with the supported peer story

If peer dependency floors or current versions move, update both places in the same change. This includes the versions exercised by the `compatibility-peers` job.

Keep `bun.lock` in sync with intentional dependency changes only. Compatibility installs should avoid rewriting repository state, which is why CI uses `bun add --no-save` for compatibility lanes.

## Ordering And Style

Prefer deterministic, machine-friendly ordering.

- Alphabetize imports, exports, object keys, workflow jobs, and machine-ordered lists unless runtime or user-facing order must differ.
- Let Biome do the routine sorting work where possible.
- Keep source edits small and focused. This package is a library, so small structural changes can have outsized downstream effects.

## Release Expectations

Public-facing changes need a changeset.

- Add or update a changeset for behavior, API, type-surface, compatibility, or packaging changes.
- Keep packaging changes compatible with `publint` and the published entrypoint contract.
- Leave the repository passing `bun run ci` before handing off release-ready work.

Publishing is driven from `main`, but release readiness is prepared on the branch by keeping changesets, package metadata, and validation green.
