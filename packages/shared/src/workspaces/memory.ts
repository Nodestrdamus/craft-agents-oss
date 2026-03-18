/**
 * Workspace-level Memory
 *
 * Shared memory that persists across sessions within a workspace.
 * Unlike per-session memory (which is conversation-scoped), workspace memory
 * is available to all sessions and agents in the workspace.
 *
 * Storage: ~/.craft-agent/workspaces/{slug}/memory/
 *   ├── MEMORY.md           - Index file (loaded into context)
 *   └── {topic}.md          - Individual memory files with frontmatter
 *
 * Memory files use the same frontmatter format as Claude Code auto-memory:
 * ---
 * name: {name}
 * description: {one-line description}
 * type: {user|feedback|project|reference}
 * ---
 * {content}
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from 'fs'
import { join, basename } from 'path'
import { debug } from '../utils/debug.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceMemoryType = 'user' | 'feedback' | 'project' | 'reference'

export interface WorkspaceMemoryEntry {
  /** Filename without extension (e.g., "project_auth-migration") */
  slug: string
  /** Display name from frontmatter */
  name: string
  /** One-line description from frontmatter */
  description: string
  /** Memory type */
  type: WorkspaceMemoryType
  /** Full markdown content (without frontmatter) */
  content: string
}

export interface WorkspaceMemoryIndex {
  /** Workspace slug */
  workspaceSlug: string
  /** All memory entries */
  entries: WorkspaceMemoryEntry[]
  /** Raw content of MEMORY.md index */
  indexContent: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMemoryDir(workspacePath: string): string {
  return join(workspacePath, 'memory')
}

function ensureMemoryDir(workspacePath: string): string {
  const dir = getMemoryDir(workspacePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    debug(`[workspace-memory] Created memory directory: ${dir}`)
  }
  return dir
}

/**
 * Parse frontmatter from a memory markdown file.
 * Returns { meta, content } where meta has name/description/type.
 */
function parseFrontmatter(raw: string): {
  meta: { name?: string; description?: string; type?: string }
  content: string
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { meta: {}, content: raw }
  }

  const frontmatterBlock = match[1]!
  const content = (match[2] ?? '').trim()
  const meta: Record<string, string> = {}

  for (const line of frontmatterBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      meta[key] = value
    }
  }

  return { meta, content }
}

/**
 * Serialize a memory entry to markdown with frontmatter.
 */
function serializeMemory(entry: Omit<WorkspaceMemoryEntry, 'slug'>): string {
  return `---
name: ${entry.name}
description: ${entry.description}
type: ${entry.type}
---

${entry.content}
`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all workspace memory entries.
 */
export function listWorkspaceMemory(workspacePath: string): WorkspaceMemoryEntry[] {
  const dir = getMemoryDir(workspacePath)
  if (!existsSync(dir)) return []

  const entries: WorkspaceMemoryEntry[] = []

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')

    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8')
        const { meta, content } = parseFrontmatter(raw)
        entries.push({
          slug: basename(file, '.md'),
          name: meta.name || basename(file, '.md'),
          description: meta.description || '',
          type: (meta.type as WorkspaceMemoryType) || 'project',
          content,
        })
      } catch (err) {
        debug(`[workspace-memory] Error reading memory file ${file}:`, err)
      }
    }
  } catch (err) {
    debug(`[workspace-memory] Error listing memory dir:`, err)
  }

  return entries
}

/**
 * Get a single workspace memory entry by slug.
 */
export function getWorkspaceMemory(workspacePath: string, slug: string): WorkspaceMemoryEntry | null {
  const filePath = join(getMemoryDir(workspacePath), `${slug}.md`)
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const { meta, content } = parseFrontmatter(raw)
    return {
      slug,
      name: meta.name || slug,
      description: meta.description || '',
      type: (meta.type as WorkspaceMemoryType) || 'project',
      content,
    }
  } catch (err) {
    debug(`[workspace-memory] Error reading memory ${slug}:`, err)
    return null
  }
}

/**
 * Save a workspace memory entry. Creates or overwrites.
 */
export function saveWorkspaceMemory(
  workspacePath: string,
  slug: string,
  entry: Omit<WorkspaceMemoryEntry, 'slug'>
): void {
  const dir = ensureMemoryDir(workspacePath)
  const filePath = join(dir, `${slug}.md`)
  const content = serializeMemory(entry)

  writeFileSync(filePath, content, 'utf-8')
  debug(`[workspace-memory] Saved memory: ${slug}`)
}

/**
 * Delete a workspace memory entry.
 */
export function deleteWorkspaceMemory(workspacePath: string, slug: string): boolean {
  const filePath = join(getMemoryDir(workspacePath), `${slug}.md`)
  if (!existsSync(filePath)) return false

  try {
    unlinkSync(filePath)
    debug(`[workspace-memory] Deleted memory: ${slug}`)
    return true
  } catch (err) {
    debug(`[workspace-memory] Error deleting memory ${slug}:`, err)
    return false
  }
}

/**
 * Read the MEMORY.md index file content.
 * Returns empty string if no index exists.
 */
export function readMemoryIndex(workspacePath: string): string {
  const indexPath = join(getMemoryDir(workspacePath), 'MEMORY.md')
  if (!existsSync(indexPath)) return ''

  try {
    return readFileSync(indexPath, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Write the MEMORY.md index file.
 */
export function writeMemoryIndex(workspacePath: string, content: string): void {
  const dir = ensureMemoryDir(workspacePath)
  writeFileSync(join(dir, 'MEMORY.md'), content, 'utf-8')
  debug(`[workspace-memory] Updated MEMORY.md index`)
}

/**
 * Get the full workspace memory context for injection into system prompt.
 * Returns a formatted string with the memory index + summary of entries.
 * Returns empty string if no memories exist.
 */
export function getWorkspaceMemoryContext(workspacePath: string): string {
  const entries = listWorkspaceMemory(workspacePath)
  const indexContent = readMemoryIndex(workspacePath)

  if (entries.length === 0 && !indexContent) return ''

  const parts: string[] = [
    '\n## Workspace Memory',
    '',
    'This workspace has shared memory available to all sessions. Memory files are stored at:',
    `\`${getMemoryDir(workspacePath)}/\``,
    '',
  ]

  if (indexContent) {
    parts.push('### Memory Index (MEMORY.md)')
    parts.push('')
    // Truncate at 200 lines per the standard memory convention
    const lines = indexContent.split('\n')
    if (lines.length > 200) {
      parts.push(lines.slice(0, 200).join('\n'))
      parts.push(`\n... (${lines.length - 200} more lines truncated)`)
    } else {
      parts.push(indexContent)
    }
    parts.push('')
  }

  if (entries.length > 0) {
    parts.push(`### Available Memories (${entries.length})`)
    parts.push('')
    for (const entry of entries) {
      parts.push(`- **${entry.name}** (\`${entry.slug}.md\`, ${entry.type}): ${entry.description}`)
    }
    parts.push('')
    parts.push('Read individual memory files with the Read tool when they are relevant to the current task.')
  }

  return parts.join('\n')
}
