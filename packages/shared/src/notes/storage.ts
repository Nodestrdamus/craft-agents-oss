/**
 * Notes Storage
 *
 * File-based CRUD for workspace notes.
 * Each note is stored as a JSON file in ~/.craft-agent/workspaces/{slug}/notes/{id}.json
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { debug } from '../utils/debug.ts'
import type {
  Note,
  NoteSummary,
  NoteListOptions,
  NoteListResult,
  NoteSearchResult,
  CreateNoteInput,
  UpdateNoteInput,
  TipTapDocument,
  WikiLink,
  Backlink,
} from './types.ts'

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getNotesDir(workspacePath: string): string {
  return join(workspacePath, 'notes')
}

function ensureNotesDir(workspacePath: string): string {
  const dir = getNotesDir(workspacePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    debug(`[notes] Created notes directory: ${dir}`)
  }
  return dir
}

function noteFilePath(workspacePath: string, noteId: string): string {
  return join(getNotesDir(workspacePath), `${noteId}.json`)
}

// ---------------------------------------------------------------------------
// TipTap helpers
// ---------------------------------------------------------------------------

/**
 * Extract plain text from a TipTap document tree.
 */
function extractPlainText(doc: TipTapDocument): string {
  const parts: string[] = []

  function walk(nodes: TipTapDocument['content']) {
    for (const node of nodes) {
      if (node.text) {
        parts.push(node.text)
      }
      if (node.content) {
        walk(node.content)
      }
      // Add newlines after block nodes
      if (['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'tableRow'].includes(node.type)) {
        parts.push('\n')
      }
    }
  }

  walk(doc.content)
  return parts.join('').trim()
}

/**
 * Convert plain text to a minimal TipTap document.
 */
function plainTextToTipTap(text: string): TipTapDocument {
  const paragraphs = text.split(/\n\n+/)
  return {
    type: 'doc',
    content: paragraphs.map(p => ({
      type: 'paragraph',
      content: p.trim() ? [{ type: 'text', text: p.trim() }] : [],
    })),
  }
}

/**
 * Parse wiki-links from plain text. Matches [[target]] and [[target|display]].
 */
export function parseWikiLinks(text: string): WikiLink[] {
  const regex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
  const links: WikiLink[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    links.push({
      target: match[1]!.trim(),
      displayText: match[2]?.trim(),
      resolved: false, // Caller resolves
    })
  }

  return links
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Create a new note in the workspace.
 */
export function createNote(
  workspacePath: string,
  workspaceId: string,
  input: CreateNoteInput,
  createdBy: string
): Note {
  ensureNotesDir(workspacePath)

  const id = randomUUID()
  const now = Date.now()

  let content: TipTapDocument
  let plainText: string

  if (input.content) {
    content = input.content
    plainText = extractPlainText(input.content)
  } else if (input.plainText) {
    content = plainTextToTipTap(input.plainText)
    plainText = input.plainText
  } else {
    content = { type: 'doc', content: [] }
    plainText = ''
  }

  const note: Note = {
    id,
    title: input.title,
    content,
    plainText,
    tags: input.tags ?? [],
    workspaceId,
    createdBy,
    createdAt: now,
    updatedAt: now,
  }

  const filePath = noteFilePath(workspacePath, id)
  writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8')
  debug(`[notes] Created note: ${id} (${input.title})`)

  return note
}

/**
 * Get a note by ID.
 */
export function getNote(workspacePath: string, noteId: string): Note | null {
  const filePath = noteFilePath(workspacePath, noteId)
  if (!existsSync(filePath)) return null

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Note
  } catch (err) {
    debug(`[notes] Error reading note ${noteId}:`, err)
    return null
  }
}

/**
 * Update a note. Returns the updated note or null if not found.
 */
export function updateNote(
  workspacePath: string,
  noteId: string,
  input: UpdateNoteInput
): Note | null {
  const note = getNote(workspacePath, noteId)
  if (!note) return null

  if (input.title !== undefined) {
    note.title = input.title
  }

  if (input.content) {
    note.content = input.content
    note.plainText = extractPlainText(input.content)
  } else if (input.plainText !== undefined) {
    note.content = plainTextToTipTap(input.plainText)
    note.plainText = input.plainText
  }

  if (input.tags !== undefined) {
    note.tags = input.tags
  }

  note.updatedAt = Date.now()

  const filePath = noteFilePath(workspacePath, noteId)
  writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8')
  debug(`[notes] Updated note: ${noteId}`)

  return note
}

/**
 * Delete a note (hard delete).
 */
export function deleteNote(workspacePath: string, noteId: string): boolean {
  const filePath = noteFilePath(workspacePath, noteId)
  if (!existsSync(filePath)) return false

  try {
    unlinkSync(filePath)
    debug(`[notes] Deleted note: ${noteId}`)
    return true
  } catch (err) {
    debug(`[notes] Error deleting note ${noteId}:`, err)
    return false
  }
}

/**
 * Archive a note (soft delete).
 */
export function archiveNote(workspacePath: string, noteId: string): Note | null {
  const note = getNote(workspacePath, noteId)
  if (!note) return null

  note.archivedAt = Date.now()
  note.updatedAt = Date.now()

  const filePath = noteFilePath(workspacePath, noteId)
  writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8')
  debug(`[notes] Archived note: ${noteId}`)

  return note
}

/**
 * Unarchive a note.
 */
export function unarchiveNote(workspacePath: string, noteId: string): Note | null {
  const note = getNote(workspacePath, noteId)
  if (!note) return null

  delete note.archivedAt
  note.updatedAt = Date.now()

  const filePath = noteFilePath(workspacePath, noteId)
  writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8')
  debug(`[notes] Unarchived note: ${noteId}`)

  return note
}

// ---------------------------------------------------------------------------
// List & Search
// ---------------------------------------------------------------------------

/**
 * Load all notes from disk (in-memory for now; future: indexing).
 */
function loadAllNotes(workspacePath: string): Note[] {
  const dir = getNotesDir(workspacePath)
  if (!existsSync(dir)) return []

  const notes: Note[] = []
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'))
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8')
        notes.push(JSON.parse(raw) as Note)
      } catch (err) {
        debug(`[notes] Error reading note file ${file}:`, err)
      }
    }
  } catch (err) {
    debug(`[notes] Error listing notes dir:`, err)
  }
  return notes
}

function noteToSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    excerpt: note.plainText.slice(0, 200),
    createdBy: note.createdBy,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    archivedAt: note.archivedAt,
  }
}

/**
 * List notes with filtering, sorting, and pagination.
 */
export function listNotes(workspacePath: string, options: NoteListOptions = {}): NoteListResult {
  let notes = loadAllNotes(workspacePath)

  // Filter archived
  if (!options.includeArchived) {
    notes = notes.filter(n => !n.archivedAt)
  }

  // Filter by tag
  if (options.tag) {
    const tag = options.tag.toLowerCase()
    notes = notes.filter(n => n.tags.some(t => t.toLowerCase() === tag))
  }

  // Search query
  if (options.query) {
    const query = options.query.toLowerCase()
    notes = notes.filter(n =>
      n.title.toLowerCase().includes(query) ||
      n.plainText.toLowerCase().includes(query)
    )
  }

  const total = notes.length

  // Sort
  const sortBy = options.sortBy ?? 'updatedAt'
  const sortOrder = options.sortOrder ?? 'desc'
  notes.sort((a, b) => {
    let cmp: number
    if (sortBy === 'title') {
      cmp = a.title.localeCompare(b.title)
    } else {
      cmp = (a[sortBy] ?? 0) - (b[sortBy] ?? 0)
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  // Paginate
  const offset = options.offset ?? 0
  const limit = options.limit ?? 50
  const page = notes.slice(offset, offset + limit)

  return {
    notes: page.map(noteToSummary),
    total,
  }
}

/**
 * Full-text search across workspace notes.
 */
export function searchNotes(workspacePath: string, query: string, limit = 20): NoteSearchResult[] {
  const notes = loadAllNotes(workspacePath).filter(n => !n.archivedAt)
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(Boolean)

  const results: NoteSearchResult[] = []

  for (const note of notes) {
    const titleLower = note.title.toLowerCase()
    const textLower = note.plainText.toLowerCase()

    // Score: title match = 10pts per term, body match = 1pt per term
    let score = 0
    for (const term of queryTerms) {
      if (titleLower.includes(term)) score += 10
      if (textLower.includes(term)) score += 1
    }

    if (score === 0) continue

    // Extract snippet around first match
    let snippet = ''
    const firstMatchIdx = textLower.indexOf(queryTerms[0]!)
    if (firstMatchIdx >= 0) {
      const start = Math.max(0, firstMatchIdx - 50)
      const end = Math.min(note.plainText.length, firstMatchIdx + 150)
      snippet = (start > 0 ? '...' : '') + note.plainText.slice(start, end) + (end < note.plainText.length ? '...' : '')
    } else {
      snippet = note.plainText.slice(0, 200)
    }

    results.push({
      noteId: note.id,
      noteTitle: note.title,
      snippet,
      score,
    })
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Wiki-link resolution
// ---------------------------------------------------------------------------

/**
 * Get backlinks for a note — all notes that reference this note via [[wiki-links]].
 */
export function getNoteBacklinks(workspacePath: string, noteId: string): Backlink[] {
  const targetNote = getNote(workspacePath, noteId)
  if (!targetNote) return []

  const allNotes = loadAllNotes(workspacePath).filter(n => !n.archivedAt && n.id !== noteId)
  const backlinks: Backlink[] = []
  const targetTitle = targetNote.title.toLowerCase()

  for (const note of allNotes) {
    const wikiLinks = parseWikiLinks(note.plainText)
    const hasLink = wikiLinks.some(link =>
      link.target.toLowerCase() === targetTitle || link.target === noteId
    )

    if (hasLink) {
      // Find context around the wiki-link
      const linkIdx = note.plainText.toLowerCase().indexOf(`[[${targetTitle}`)
      const idxAlt = note.plainText.indexOf(`[[${noteId}`)
      const idx = linkIdx >= 0 ? linkIdx : idxAlt
      const start = Math.max(0, idx - 40)
      const end = Math.min(note.plainText.length, idx + 120)
      const context = note.plainText.slice(start, end)

      backlinks.push({
        noteId: note.id,
        noteTitle: note.title,
        context,
      })
    }
  }

  return backlinks
}

/**
 * Resolve wiki-links in a note's text, marking which targets exist.
 */
export function resolveWikiLinks(workspacePath: string, text: string): WikiLink[] {
  const allNotes = loadAllNotes(workspacePath).filter(n => !n.archivedAt)
  const titleMap = new Map(allNotes.map(n => [n.title.toLowerCase(), n.id]))
  const idSet = new Set(allNotes.map(n => n.id))

  const links = parseWikiLinks(text)
  for (const link of links) {
    link.resolved = titleMap.has(link.target.toLowerCase()) || idSet.has(link.target)
  }
  return links
}

/**
 * Save a chat message or agent output as a new note.
 */
export function saveMessageAsNote(
  workspacePath: string,
  workspaceId: string,
  title: string,
  messageText: string,
  createdBy: string,
  tags: string[] = ['from-chat']
): Note {
  return createNote(workspacePath, workspaceId, {
    title,
    plainText: messageText,
    tags,
  }, createdBy)
}
