/**
 * Batch Processing Types
 *
 * Batch processing allows automated bulk operations — feed a list of items
 * + prompt template, execute in parallel sessions, collect structured output.
 */

// ── Data Source ──────────────────────────────────────────────────────────────

export type BatchSourceType = 'csv' | 'json' | 'jsonl'

export interface BatchSource {
  type: BatchSourceType
  path: string
  /** Field name used as unique item identifier */
  idField: string
}

// ── Execution Config ─────────────────────────────────────────────────────────

export interface BatchExecution {
  maxConcurrency?: number
  retryOnFailure?: boolean
  maxRetries?: number
  permissionMode?: string
  model?: string
  llmConnection?: string
}

// ── Action ───────────────────────────────────────────────────────────────────

export interface BatchPromptAction {
  type: 'prompt'
  /** Prompt template with $BATCH_ITEM_{FIELD} variable interpolation */
  prompt: string
  labels?: string[]
  mentions?: string[]
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface BatchOutputConfig {
  /** Output file path (.jsonl) */
  path: string
  /** JSON Schema for structured output validation */
  schema?: Record<string, unknown>
}

// ── Batch Config (stored in batches.json) ────────────────────────────────────

export interface BatchConfig {
  /** Auto-generated hex ID if omitted */
  id?: string
  name: string
  enabled?: boolean
  workingDirectory?: string
  source: BatchSource
  execution?: BatchExecution
  action: BatchPromptAction
  output?: BatchOutputConfig
}

export interface BatchesFileConfig {
  version?: number
  batches: BatchConfig[]
}

// ── Runtime State ────────────────────────────────────────────────────────────

export type BatchItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type BatchStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed'

export interface BatchItem {
  id: string
  data: Record<string, string>
  status: BatchItemStatus
  sessionId?: string
  error?: string
  retryCount: number
  startedAt?: string
  completedAt?: string
}

export interface BatchState {
  batchId: string
  status: BatchStatus
  items: Record<string, BatchItem>
  startedAt?: string
  completedAt?: string
  error?: string
}

export interface BatchProgress {
  batchId: string
  name: string
  status: BatchStatus
  total: number
  pending: number
  running: number
  completed: number
  failed: number
}

// ── Batch Context (passed to session tools) ──────────────────────────────────

export interface BatchContext {
  batchId: string
  itemId: string
  outputPath: string
  outputSchema?: Record<string, unknown>
}
