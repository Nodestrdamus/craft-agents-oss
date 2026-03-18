/**
 * RPC handlers for batch processing operations.
 */

import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { BatchConfig, BatchesFileConfig, BatchProgress, BatchState } from '@craft-agent/shared/batches'
import { BATCHES_CONFIG_FILE } from '@craft-agent/shared/batches'

// Per-workspace config mutex: serializes read-modify-write cycles
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

function generateBatchId(): string {
  return Math.random().toString(16).slice(2, 8)
}

async function readBatchesConfig(workspaceRoot: string): Promise<BatchesFileConfig> {
  const path = join(workspaceRoot, BATCHES_CONFIG_FILE)
  if (!existsSync(path)) return { version: 1, batches: [] }
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as BatchesFileConfig
}

async function writeBatchesConfig(workspaceRoot: string, config: BatchesFileConfig): Promise<void> {
  // Backfill missing IDs
  for (const batch of config.batches) {
    if (!batch.id) batch.id = generateBatchId()
  }
  const path = join(workspaceRoot, BATCHES_CONFIG_FILE)
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.batches.LIST,
  RPC_CHANNELS.batches.START,
  RPC_CHANNELS.batches.PAUSE,
  RPC_CHANNELS.batches.RESUME,
  RPC_CHANNELS.batches.GET_STATUS,
  RPC_CHANNELS.batches.GET_STATE,
  RPC_CHANNELS.batches.SET_ENABLED,
  RPC_CHANNELS.batches.DUPLICATE,
  RPC_CHANNELS.batches.DELETE,
  RPC_CHANNELS.batches.TEST,
] as const

export function registerBatchHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // List all batches with progress
  server.handle(RPC_CHANNELS.batches.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = await readBatchesConfig(workspace.rootPath)
    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)

    const results: (BatchConfig & { progress?: BatchProgress })[] = []
    for (const batch of config.batches) {
      const progress = processor?.getProgress(batch.id!, batch.name)
      results.push({ ...batch, progress: progress ?? undefined })
    }
    return results
  })

  // Start a batch
  server.handle(RPC_CHANNELS.batches.START, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = await readBatchesConfig(workspace.rootPath)
    const batch = config.batches.find(b => b.id === batchId)
    if (!batch) throw new Error(`Batch not found: ${batchId}`)

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    if (!processor) throw new Error('Batch processor not available')

    log.info(`[Batches] Starting batch ${batchId} (${batch.name})`)
    await processor.start(batch)
    return { ok: true }
  })

  // Pause a batch
  server.handle(RPC_CHANNELS.batches.PAUSE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    if (!processor) throw new Error('Batch processor not available')

    log.info(`[Batches] Pausing batch ${batchId}`)
    processor.pause(batchId)
    return { ok: true }
  })

  // Resume a paused batch
  server.handle(RPC_CHANNELS.batches.RESUME, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = await readBatchesConfig(workspace.rootPath)
    const batch = config.batches.find(b => b.id === batchId)
    if (!batch) throw new Error(`Batch not found: ${batchId}`)

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    if (!processor) throw new Error('Batch processor not available')

    log.info(`[Batches] Resuming batch ${batchId}`)
    await processor.resume(batch)
    return { ok: true }
  })

  // Get batch progress summary
  server.handle(RPC_CHANNELS.batches.GET_STATUS, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = await readBatchesConfig(workspace.rootPath)
    const batch = config.batches.find(b => b.id === batchId)

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    return processor?.getProgress(batchId, batch?.name ?? batchId) ?? null
  })

  // Get full batch state with all items
  server.handle(RPC_CHANNELS.batches.GET_STATE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    return processor?.getState(batchId) ?? null
  })

  // Enable/disable a batch in config
  server.handle(RPC_CHANNELS.batches.SET_ENABLED, async (_ctx, workspaceId: string, batchId: string, enabled: boolean) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    await withConfigMutex(workspace.rootPath, async () => {
      const config = await readBatchesConfig(workspace.rootPath)
      const batch = config.batches.find(b => b.id === batchId)
      if (!batch) throw new Error(`Batch not found: ${batchId}`)
      batch.enabled = enabled
      await writeBatchesConfig(workspace.rootPath, config)
    })
    return { ok: true }
  })

  // Duplicate a batch config
  server.handle(RPC_CHANNELS.batches.DUPLICATE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    let newId: string = ''
    await withConfigMutex(workspace.rootPath, async () => {
      const config = await readBatchesConfig(workspace.rootPath)
      const batch = config.batches.find(b => b.id === batchId)
      if (!batch) throw new Error(`Batch not found: ${batchId}`)

      newId = generateBatchId()
      const clone: BatchConfig = {
        ...JSON.parse(JSON.stringify(batch)),
        id: newId,
        name: `${batch.name} (copy)`,
        enabled: false,
      }
      config.batches.push(clone)
      await writeBatchesConfig(workspace.rootPath, config)
    })
    return { ok: true, newId }
  })

  // Delete a batch config and its state file
  server.handle(RPC_CHANNELS.batches.DELETE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    processor?.deleteState(batchId)

    await withConfigMutex(workspace.rootPath, async () => {
      const config = await readBatchesConfig(workspace.rootPath)
      config.batches = config.batches.filter(b => b.id !== batchId)
      await writeBatchesConfig(workspace.rootPath, config)
    })

    log.info(`[Batches] Deleted batch ${batchId}`)
    return { ok: true }
  })

  // Test a batch with sample items
  server.handle(RPC_CHANNELS.batches.TEST, async (_ctx, workspaceId: string, batchId: string, sampleSize?: number) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = await readBatchesConfig(workspace.rootPath)
    const batch = config.batches.find(b => b.id === batchId)
    if (!batch) throw new Error(`Batch not found: ${batchId}`)

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    if (!processor) throw new Error('Batch processor not available')

    log.info(`[Batches] Testing batch ${batchId} with ${sampleSize ?? 3} samples`)
    const status = await processor.test(batch, sampleSize ?? 3)
    return { ok: true, status }
  })
}
