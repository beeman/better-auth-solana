# better-auth-solana

This is a template for creating a modern TypeScript library or package using [Bun](https://bun.sh/). It comes pre-configured with essential tools for development, testing, linting, and publishing.

## Features

*   **Bun-first development**: Leverages Bun for lightning-fast installs, runs, and tests.
*   **TypeScript support**: Write type-safe code from the start.
*   **Linting & Formatting**: Enforced with [Biome](https://biomejs.dev/) for consistent code style.
*   **Bundling**: Uses [tsdown](https://tsdown.js.org/) for efficient bundling into ESM and CJS formats, with type declarations.
*   **Testing**: Built-in unit testing with `bun test`.
*   **Versioning & Publishing**: Managed with [Changesets](https://github.com/changesets/changesets) for streamlined releases to npm.
*   **GitHub Actions**: Continuous Integration (CI) workflows for automated build, test, lint, and publish processes.

## Getting Started

To use this template, you typically would use a scaffolding tool like `bunx create-something -t better-auth-solana`.

### Installation

If you're using this template directly (e.g., after cloning), you can install dependencies with Bun:

```bash
bun install
```

### Development

*   **Build**: `bun run build`
*   **Type Check**: `bun run check-types`
*   **Lint**: `bun run lint`
*   **Lint & Fix**: `bun run lint:fix`
*   **Test**: `bun test`
*   **Test (Watch Mode)**: `bun run test:watch`

### Publishing

This template uses Changesets for versioning and publishing.

1.  **Add a changeset**:
    ```bash
    bun changeset
    ```
    Follow the prompts to describe your changes. This will create a markdown file in `.changeset/`.

2.  **Version packages**:
    ```bash
    bun run version
    ```
    This command reads the changeset files, updates package versions, updates `CHANGELOG.md`, and deletes the used changeset files. It also runs `bun lint:fix`.

3.  **Publish to npm**:
    ```bash
    bun run release
    ```
    This command builds the package and publishes it to npm. Ensure you are logged into npm (`npm login`) or have `NPM_TOKEN` configured in your CI environment.

## Project Structure

```
.
├── src/             # Source code for your library
│   └── index.ts     # Main entry point for your library
├── test/            # Unit tests
│   └── index.test.ts # Example test file
├── tsdown.config.ts   # Configuration for tsdown (bundling)
├── biome.json       # Biome linter/formatter configuration
├── package.json     # Project metadata and scripts
└── ... (other config files and GitHub workflows)
```

## License

MIT – see [LICENSE](./LICENSE).