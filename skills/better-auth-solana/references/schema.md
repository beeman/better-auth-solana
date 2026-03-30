# Schema And Table Expectations

## Required Tables

`better-auth-solana` relies on the normal Better Auth persistence model plus one extra model.

Require these tables or equivalent adapter models:

- `account`
- `session`
- `solanaWallet`
- `user`
- `verification`

The package reads and writes `solanaWallet` directly and uses Better Auth internals for the others.

## `solanaWallet` Model

The package exports `solanaWalletSchema` from `better-auth-solana/schema`. Its required fields are:

- `address`
- `createdAt`
- `isPrimary`
- `userId`

The package merges that schema through `siws({ schema })`, so custom overrides must preserve those fields.

## Drizzle Shape

Most Better Auth adapters also keep a primary key column such as `id`, even though the package's custom schema only requires the four fields above.

Use this as the baseline Drizzle shape:

```ts
export const solanaWallet = sqliteTable(
  'solana_wallet',
  {
    address: text('address').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    id: text('id').primaryKey(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).default(false).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('solana_wallet_userId_idx').on(table.userId)],
)
```

Extra columns are acceptable, for example a human-readable wallet label.

## Persistence Rules

- Mark the first wallet row created for a user as `isPrimary: true`.
- Mark later wallet rows for that user as `isPrimary: false`.
- Persist one SIWS account row per wallet address with `providerId: 'siws'`.
- Persist one wallet row per address and associate it with the Better Auth user.
- Reject linking a wallet to a different authenticated user when that wallet is already linked elsewhere.
- Reuse the same user, account, and wallet rows when the same address signs in again.

## Other Better Auth Tables

Keep the standard Better Auth tables available because SIWS depends on them:

- `account` stores the SIWS account row. The package uses `accountId` equal to the wallet address and `providerId` equal to `siws`.
- `session` stores the Better Auth session created by `/siws/verify`.
- `user` stores the Better Auth user created or reused by SIWS.
- `verification` stores the serialized SIWS challenge under `siws:${walletAddress}` until it expires or is consumed.

## Index And Constraint Notes

- Index `userId` on `solanaWallet`.
- Prefer a unique `address` constraint when the application can enforce one-wallet-per-address at the database layer.
- Preserve any existing app-specific columns and indexes that do not break the required fields above.

## Example Extended Table

Use this anonymized extension pattern when the app needs extra wallet metadata without breaking the package contract:

```ts
export const solanaWallet = sqliteTable(
  'solana_wallet',
  {
    address: text('address').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    id: text('id').primaryKey(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).default(false).notNull(),
    label: text('label'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('solana_wallet_userId_idx').on(table.userId),
    uniqueIndex('solana_wallet_address_idx').on(table.address),
  ],
)
```

The package only depends on `address`, `createdAt`, `isPrimary`, and `userId`. Extra fields such as `label` are application-owned.
