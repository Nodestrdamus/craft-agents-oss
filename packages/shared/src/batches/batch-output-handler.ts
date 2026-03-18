/**
 * batch_output tool handler.
 *
 * Writes structured output from a batch session to a JSONL file.
 * Uses upsert semantics — same item ID replaces previous record.
 * Per-file write queue prevents concurrent read-modify-write races.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { BatchContext } from './types.ts'

/** Per-file write queue to serialize concurrent writes */
const writeQueues = new Map<string, Promise<void>>()

function enqueue(filePath: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(filePath) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run even if previous failed
  writeQueues.set(filePath, next)
  return next
}

export interface BatchOutputResult {
  success: boolean
  error?: string
}

/**
 * Handle the batch_output tool call.
 * Writes structured data to the configured JSONL output file.
 */
export async function handleBatchOutput(
  context: BatchContext,
  data: Record<string, unknown> | string,
): Promise<BatchOutputResult> {
  if (!context.outputPath) {
    return { success: false, error: 'No output path configured for this batch' }
  }

  // Parse stringified JSON if needed (LLMs sometimes stringify)
  let record: Record<string, unknown>
  if (typeof data === 'string') {
    try {
      record = JSON.parse(data)
    } catch {
      return { success: false, error: 'Data is a string but not valid JSON' }
    }
  } else {
    record = data
  }

  // Inject metadata fields
  const outputRecord: Record<string, unknown> = {
    _item_id: context.itemId,
    _timestamp: new Date().toISOString(),
    ...record,
  }

  // Schema validation (basic — check required fields if schema present)
  if (context.outputSchema) {
    const validation = validateAgainstSchema(record, context.outputSchema)
    if (!validation.valid) {
      return { success: false, error: `Schema validation failed: ${validation.errors.join(', ')}` }
    }
  }

  // Write to JSONL with upsert semantics
  await enqueue(context.outputPath, async () => {
    const dir = dirname(context.outputPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    let lines: string[] = []
    if (existsSync(context.outputPath)) {
      lines = readFileSync(context.outputPath, 'utf-8')
        .split('\n')
        .filter(l => l.trim().length > 0)
    }

    // Remove previous record for same item (upsert)
    lines = lines.filter(line => {
      try {
        const parsed = JSON.parse(line)
        return parsed._item_id !== context.itemId
      } catch {
        return true // keep malformed lines
      }
    })

    // Append new record
    lines.push(JSON.stringify(outputRecord))

    writeFileSync(context.outputPath, lines.join('\n') + '\n', 'utf-8')
  })

  return { success: true }
}

/**
 * Basic JSON Schema validation (required fields + type checking).
 * Not a full validator — covers the common cases for batch output.
 */
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required fields
  const required = schema.required as string[] | undefined
  if (required) {
    for (const field of required) {
      if (!(field in data) || data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: ${field}`)
      }
    }
  }

  // Check property types
  const properties = schema.properties as Record<string, { type?: string }> | undefined
  if (properties) {
    for (const [field, def] of Object.entries(properties)) {
      if (field in data && def.type) {
        const value = data[field]
        const actualType = Array.isArray(value) ? 'array' : typeof value
        if (def.type !== actualType && value !== null && value !== undefined) {
          // Allow string→number coercion for common LLM outputs
          if (def.type === 'number' && typeof value === 'string' && !isNaN(Number(value))) {
            continue
          }
          errors.push(`Field "${field}" expected ${def.type}, got ${actualType}`)
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
