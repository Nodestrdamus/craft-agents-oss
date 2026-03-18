/**
 * Persists batch execution state to disk as JSON files.
 * One file per batch: batch-state-{id}.json
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { BatchState, BatchItem, BatchItemStatus, BatchStatus } from './types.ts'

export class BatchStateManager {
  constructor(private readonly workspaceRoot: string) {}

  private stateFilePath(batchId: string): string {
    return join(this.workspaceRoot, `batch-state-${batchId}.json`)
  }

  load(batchId: string): BatchState | null {
    const path = this.stateFilePath(batchId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as BatchState
    } catch {
      return null
    }
  }

  save(state: BatchState): void {
    const path = this.stateFilePath(state.batchId)
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
  }

  delete(batchId: string): void {
    const path = this.stateFilePath(batchId)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  /**
   * Create initial state from loaded items.
   */
  createInitialState(batchId: string, itemIds: string[], itemData: Map<string, Record<string, string>>): BatchState {
    const items: Record<string, BatchItem> = {}
    for (const id of itemIds) {
      items[id] = {
        id,
        data: itemData.get(id) ?? {},
        status: 'pending',
        retryCount: 0,
      }
    }
    return {
      batchId,
      status: 'running',
      items,
      startedAt: new Date().toISOString(),
    }
  }

  /**
   * Update a single item's status within a batch state.
   */
  updateItemStatus(
    state: BatchState,
    itemId: string,
    status: BatchItemStatus,
    extra?: { sessionId?: string; error?: string }
  ): void {
    const item = state.items[itemId]
    if (!item) return

    item.status = status
    if (extra?.sessionId) item.sessionId = extra.sessionId
    if (extra?.error) item.error = extra.error

    if (status === 'running') {
      item.startedAt = new Date().toISOString()
    } else if (status === 'completed' || status === 'failed') {
      item.completedAt = new Date().toISOString()
    }
  }

  /**
   * Check if all items in a batch have reached a terminal state.
   */
  isComplete(state: BatchState): boolean {
    return Object.values(state.items).every(
      item => item.status === 'completed' || item.status === 'failed' || item.status === 'skipped'
    )
  }

  /**
   * Get progress summary for a batch state.
   */
  getProgress(state: BatchState): { total: number; pending: number; running: number; completed: number; failed: number } {
    const items = Object.values(state.items)
    return {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      running: items.filter(i => i.status === 'running').length,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length,
    }
  }
}
