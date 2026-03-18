/**
 * Data source adapter for batch processing.
 * Loads items from CSV, JSON, or JSONL files.
 */

import { readFileSync } from 'fs'
import type { BatchSource } from './types.ts'

export interface LoadedItem {
  id: string
  data: Record<string, string>
}

/**
 * Load batch items from a data source file.
 * All values are coerced to strings for prompt template interpolation.
 */
export function loadBatchData(source: BatchSource): LoadedItem[] {
  const content = readFileSync(source.path, 'utf-8')

  switch (source.type) {
    case 'json':
      return loadJson(content, source.idField)
    case 'jsonl':
      return loadJsonl(content, source.idField)
    case 'csv':
      return loadCsv(content, source.idField)
    default:
      throw new Error(`Unsupported batch source type: ${source.type}`)
  }
}

function loadJson(content: string, idField: string): LoadedItem[] {
  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed)) {
    throw new Error('JSON batch source must be an array of objects')
  }
  return parsed.map((obj, i) => toLoadedItem(obj, idField, i))
}

function loadJsonl(content: string, idField: string): LoadedItem[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line, i) => {
      const obj = JSON.parse(line)
      return toLoadedItem(obj, idField, i)
    })
}

function loadCsv(content: string, idField: string): LoadedItem[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row')
  }

  const headers = parseCsvLine(lines[0]!)
  if (!headers.includes(idField)) {
    throw new Error(`ID field "${idField}" not found in CSV headers: ${headers.join(', ')}`)
  }

  return lines.slice(1).map((line, i) => {
    const values = parseCsvLine(line)
    const data: Record<string, string> = {}
    headers.forEach((h, j) => {
      data[h] = values[j] ?? ''
    })
    const id = data[idField]
    if (!id) {
      throw new Error(`Empty ID field "${idField}" at row ${i + 1}`)
    }
    return { id, data }
  })
}

/** Simple CSV line parser supporting quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)
  return fields
}

function toLoadedItem(obj: unknown, idField: string, index: number): LoadedItem {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error(`Batch item at index ${index} is not an object`)
  }
  const record = obj as Record<string, unknown>
  const id = String(record[idField] ?? '')
  if (!id) {
    throw new Error(`Missing or empty ID field "${idField}" at index ${index}`)
  }
  const data: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    data[key] = String(value ?? '')
  }
  return { id, data }
}

/**
 * Validate that all item IDs are unique within a dataset.
 */
export function validateUniqueIds(items: LoadedItem[]): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate item ID: "${item.id}"`)
    }
    seen.add(item.id)
  }
}
