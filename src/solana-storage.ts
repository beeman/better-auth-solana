import type { DBAdapter } from '@better-auth/core/db/adapter'
import type { BetterAuthPluginDBSchema } from 'better-auth/db'
import { z } from 'zod'
import type { SIWSWalletRecord } from './shared.ts'

export const solanaWalletModelName = 'solanaWallet'

export const solanaWalletSchema = {
  [solanaWalletModelName]: {
    fields: {
      address: {
        required: true,
        type: 'string',
      },
      cluster: {
        required: true,
        type: 'string',
      },
      createdAt: {
        required: true,
        type: 'date',
      },
      isPrimary: {
        defaultValue: false,
        type: 'boolean',
      },
      userId: {
        index: true,
        references: {
          field: 'id',
          model: 'user',
        },
        required: true,
        type: 'string',
      },
    },
  },
} satisfies BetterAuthPluginDBSchema

const solanaWalletRecordSchema = z.object({
  address: z.string().min(1),
  cluster: z.string().min(1),
  createdAt: z.union([z.date(), z.string().datetime()]),
  isPrimary: z.boolean().optional().default(false),
  userId: z.string().min(1),
})

type SIWSAdapter = Pick<DBAdapter, 'create' | 'findOne'>

export function parseSIWSWalletRecord(value: unknown): SIWSWalletRecord | null {
  const result = solanaWalletRecordSchema.safeParse(value)

  return result.success ? result.data : null
}

export async function createSIWSWallet(args: {
  adapter: SIWSAdapter
  address: string
  cluster: string
  isPrimary: boolean
  userId: string
}) {
  const wallet = await args.adapter.create({
    data: {
      address: args.address,
      cluster: args.cluster,
      createdAt: new Date(),
      isPrimary: args.isPrimary,
      userId: args.userId,
    },
    model: solanaWalletModelName,
  })
  const parsedWallet = parseSIWSWalletRecord(wallet)

  if (!parsedWallet) {
    throw new Error('Failed to parse SIWS wallet record')
  }

  return parsedWallet
}

export async function findSIWSWalletByAddress(args: { adapter: SIWSAdapter; address: string }) {
  const wallet = await args.adapter.findOne({
    model: solanaWalletModelName,
    where: [{ field: 'address', operator: 'eq', value: args.address }],
  })

  return parseSIWSWalletRecord(wallet)
}

export async function findSIWSWalletByAddressAndCluster(args: {
  adapter: SIWSAdapter
  address: string
  cluster: string
}) {
  const wallet = await args.adapter.findOne({
    model: solanaWalletModelName,
    where: [
      { field: 'address', operator: 'eq', value: args.address },
      { field: 'cluster', operator: 'eq', value: args.cluster },
    ],
  })

  return parseSIWSWalletRecord(wallet)
}

export async function findSIWSWalletByUserId(args: { adapter: SIWSAdapter; userId: string }) {
  const wallet = await args.adapter.findOne({
    model: solanaWalletModelName,
    where: [{ field: 'userId', operator: 'eq', value: args.userId }],
  })

  return parseSIWSWalletRecord(wallet)
}
