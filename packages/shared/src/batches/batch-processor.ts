/**
 * BatchProcessor — Core orchestrator for batch processing.
 *
 * Manages the lifecycle of batch executions: loading data, dispatching
 * items to parallel sessions, tracking progress, handling retries,
 * and persisting state.
 */

import { loadBatchData, validateUniqueIds, type LoadedItem } from './data-source.ts'
import { BatchStateManager } from './batch-state-manager.ts'
import { BATCH_ITEM_ENV_PREFIX, DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_RETRIES } from './constants.ts'
import type {
  BatchConfig,
  BatchContext,
  BatchItem,
  BatchProgress,
  BatchState,
  BatchStatus,
} from './types.ts'

export interface BatchProcessorCallbacks {
  /** Called to create and start a batch session */
  onExecutePrompt: (opts: {
    prompt: string
    workspaceId: string
    isBatch: boolean
    batchContext: BatchContext
    workingDirectory?: string
    permissionMode?: string
    model?: string
    llmConnection?: string
    labels?: string[]
    mentions?: string[]
  }) => Promise<string> // returns sessionId

  /** Called to emit batch progress events */
  onProgress: (progress: BatchProgress) => void

  /** Called when a batch reaches terminal state */
  onComplete: (batchId: string, status: BatchStatus) => void
}

export class BatchProcessor {
  private readonly stateManager: BatchStateManager
  private readonly activeStates = new Map<string, BatchState>()
  private readonly sessionToItem = new Map<string, { batchId: string; itemId: string }>()
  private readonly batchItems = new Map<string, Map<string, LoadedItem>>()

  // For test batches
  private readonly testResolvers = new Map<string, (status: BatchStatus) => void>()
  private readonly configOverrides = new Map<string, BatchConfig>()

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceId: string,
    private readonly callbacks: BatchProcessorCallbacks,
  ) {
    this.stateManager = new BatchStateManager(workspaceRoot)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async start(config: BatchConfig): Promise<void> {
    const batchId = config.id!
    const effectiveConfig = this.configOverrides.get(batchId) ?? config

    // Load data from source
    const items = loadBatchData(effectiveConfig.source)
    validateUniqueIds(items)

    // Store items in memory
    const itemMap = new Map<string, LoadedItem>()
    const dataMap = new Map<string, Record<string, string>>()
    for (const item of items) {
      itemMap.set(item.id, item)
      dataMap.set(item.id, item.data)
    }
    this.batchItems.set(batchId, itemMap)

    // Create initial state
    const state = this.stateManager.createInitialState(
      batchId,
      items.map(i => i.id),
      dataMap,
    )
    this.activeStates.set(batchId, state)
    this.stateManager.save(state)

    // Start dispatching
    await this.dispatchNext(batchId, effectiveConfig)
  }

  pause(batchId: string): void {
    const state = this.activeStates.get(batchId)
    if (!state) return

    state.status = 'paused'
    this.stateManager.save(state)
    this.emitProgress(batchId)
  }

  async resume(config: BatchConfig): Promise<void> {
    const batchId = config.id!
    let state = this.activeStates.get(batchId) ?? this.stateManager.load(batchId)
    if (!state) throw new Error(`No state found for batch ${batchId}`)

    // Reset running items back to pending (crash recovery)
    for (const item of Object.values(state.items)) {
      if (item.status === 'running') {
        item.status = 'pending'
      }
    }

    state.status = 'running'
    this.activeStates.set(batchId, state)
    this.stateManager.save(state)

    // Reload data if not in memory
    if (!this.batchItems.has(batchId)) {
      const items = loadBatchData(config.source)
      const itemMap = new Map<string, LoadedItem>()
      for (const item of items) itemMap.set(item.id, item)
      this.batchItems.set(batchId, itemMap)
    }

    await this.dispatchNext(batchId, config)
  }

  stop(batchId: string): void {
    this.activeStates.delete(batchId)
    this.batchItems.delete(batchId)
    // Remove session-to-item mappings for this batch
    for (const [sessionId, mapping] of this.sessionToItem) {
      if (mapping.batchId === batchId) {
        this.sessionToItem.delete(sessionId)
      }
    }
  }

  async test(config: BatchConfig, sampleSize: number = 3): Promise<BatchStatus> {
    const batchId = config.id! + '__test'

    // Load all data, sample deterministically
    const items = loadBatchData(config.source)
    const sampled = items.slice(0, Math.min(sampleSize, items.length))

    // Create virtual config for test
    const testConfig: BatchConfig = {
      ...config,
      id: batchId,
      output: config.output
        ? { ...config.output, path: config.output.path.replace('.jsonl', '.test.jsonl') }
        : undefined,
    }
    this.configOverrides.set(batchId, testConfig)

    // Store sampled items
    const itemMap = new Map<string, LoadedItem>()
    const dataMap = new Map<string, Record<string, string>>()
    for (const item of sampled) {
      itemMap.set(item.id, item)
      dataMap.set(item.id, item.data)
    }
    this.batchItems.set(batchId, itemMap)

    // Create state
    const state = this.stateManager.createInitialState(batchId, sampled.map(i => i.id), dataMap)
    this.activeStates.set(batchId, state)

    // Create promise that resolves when test completes
    const promise = new Promise<BatchStatus>((resolve) => {
      this.testResolvers.set(batchId, resolve)
    })

    await this.dispatchNext(batchId, testConfig)
    return promise
  }

  dispose(): void {
    // Save all running batches as paused
    for (const [batchId, state] of this.activeStates) {
      if (state.status === 'running') {
        state.status = 'paused'
        this.stateManager.save(state)
      }
    }
    this.activeStates.clear()
    this.batchItems.clear()
    this.sessionToItem.clear()
    this.testResolvers.clear()
    this.configOverrides.clear()
  }

  // ── Session Completion Callback ──────────────────────────────────────────

  async onSessionComplete(sessionId: string, reason: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const mapping = this.sessionToItem.get(sessionId)
    if (!mapping) return

    const { batchId, itemId } = mapping
    const state = this.activeStates.get(batchId)
    if (!state) return

    const item = state.items[itemId]
    if (!item) return

    const config = this.configOverrides.get(batchId) ?? this.getConfigForBatch(batchId)

    if (reason === 'completed') {
      this.stateManager.updateItemStatus(state, itemId, 'completed', { sessionId })
    } else {
      // Check retry
      const maxRetries = config?.execution?.maxRetries ?? DEFAULT_MAX_RETRIES
      const shouldRetry = config?.execution?.retryOnFailure !== false && item.retryCount < maxRetries

      if (shouldRetry) {
        item.retryCount++
        this.stateManager.updateItemStatus(state, itemId, 'pending', { error: `Retry ${item.retryCount}/${maxRetries}` })
      } else {
        this.stateManager.updateItemStatus(state, itemId, 'failed', { sessionId, error: reason })
      }
    }

    this.sessionToItem.delete(sessionId)
    this.stateManager.save(state)
    this.emitProgress(batchId)

    // Check completion
    if (this.stateManager.isComplete(state)) {
      const progress = this.stateManager.getProgress(state)
      state.status = progress.failed > 0 ? 'failed' : 'completed'
      state.completedAt = new Date().toISOString()
      this.stateManager.save(state)

      this.callbacks.onComplete(batchId, state.status)

      // Resolve test promise if applicable
      const testResolver = this.testResolvers.get(batchId)
      if (testResolver) {
        testResolver(state.status)
        this.testResolvers.delete(batchId)
        this.configOverrides.delete(batchId)
        this.stop(batchId)
      }
    } else if (state.status === 'running') {
      // Dispatch more items
      await this.dispatchNext(batchId, config)
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────

  getState(batchId: string): BatchState | null {
    return this.activeStates.get(batchId) ?? this.stateManager.load(batchId)
  }

  getProgress(batchId: string, name: string): BatchProgress | null {
    const state = this.getState(batchId)
    if (!state) return null

    const p = this.stateManager.getProgress(state)
    return {
      batchId,
      name,
      status: state.status,
      ...p,
    }
  }

  deleteState(batchId: string): void {
    this.stop(batchId)
    this.stateManager.delete(batchId)
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async dispatchNext(batchId: string, config: BatchConfig | undefined): Promise<void> {
    const state = this.activeStates.get(batchId)
    if (!state || state.status !== 'running') return
    if (!config) return

    const maxConcurrency = config.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
    const items = Object.values(state.items)
    const runningCount = items.filter(i => i.status === 'running').length
    const available = maxConcurrency - runningCount

    if (available <= 0) return

    const pendingItems = items.filter(i => i.status === 'pending').slice(0, available)
    for (const item of pendingItems) {
      await this.dispatchItem(batchId, item, config)
    }
  }

  private async dispatchItem(batchId: string, item: BatchItem, config: BatchConfig): Promise<void> {
    const state = this.activeStates.get(batchId)
    if (!state) return

    // Build prompt from template with variable expansion
    const prompt = this.expandPromptTemplate(config.action.prompt, item.data)

    const batchContext: BatchContext = {
      batchId,
      itemId: item.id,
      outputPath: config.output?.path ?? '',
      outputSchema: config.output?.schema,
    }

    try {
      this.stateManager.updateItemStatus(state, item.id, 'running')
      this.stateManager.save(state)

      const sessionId = await this.callbacks.onExecutePrompt({
        prompt,
        workspaceId: this.workspaceId,
        isBatch: true,
        batchContext,
        workingDirectory: config.workingDirectory,
        permissionMode: config.execution?.permissionMode,
        model: config.execution?.model,
        llmConnection: config.execution?.llmConnection,
        labels: config.action.labels,
        mentions: config.action.mentions,
      })

      // Track session → item mapping
      this.sessionToItem.set(sessionId, { batchId, itemId: item.id })
      this.stateManager.updateItemStatus(state, item.id, 'running', { sessionId })
      this.stateManager.save(state)
    } catch (error) {
      this.stateManager.updateItemStatus(state, item.id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      this.stateManager.save(state)
    }

    this.emitProgress(batchId)
  }

  private expandPromptTemplate(template: string, data: Record<string, string>): string {
    let result = template
    for (const [key, value] of Object.entries(data)) {
      const envVar = `$${BATCH_ITEM_ENV_PREFIX}${key.toUpperCase()}`
      result = result.replaceAll(envVar, value)
    }
    return result
  }

  private emitProgress(batchId: string): void {
    const state = this.activeStates.get(batchId)
    if (!state) return

    const p = this.stateManager.getProgress(state)
    const config = this.configOverrides.get(batchId) ?? this.getConfigForBatch(batchId)

    this.callbacks.onProgress({
      batchId,
      name: config?.name ?? batchId,
      status: state.status,
      ...p,
    })
  }

  // Hook for subclasses or external config resolution
  private _configResolver?: (batchId: string) => BatchConfig | undefined
  setConfigResolver(resolver: (batchId: string) => BatchConfig | undefined): void {
    this._configResolver = resolver
  }

  private getConfigForBatch(batchId: string): BatchConfig | undefined {
    return this._configResolver?.(batchId)
  }
}
