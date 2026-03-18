/**
 * Notes / Knowledge Base Types
 *
 * Persistent knowledge management alongside chat — notes, documents, wiki-links.
 * Inspired by hunterassembly/orchestra fork.
 *
 * Storage: ~/.craft-agent/workspaces/{slug}/notes/{id}.json
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

export interface Note {
  id: string
  title: string
  /** TipTap-compatible JSON content (prosemirror document) */
  content: TipTapDocument
  /** Plain text extract for search indexing */
  plainText: string
  tags: string[]
  workspaceId: string
  createdBy: string
  createdAt: number
  updatedAt: number
  /** Soft-delete support */
  archivedAt?: number
}

/**
 * Simplified TipTap document structure.
 * Full TipTap JSON is a ProseMirror document tree.
 */
export interface TipTapDocument {
  type: 'doc'
  content: TipTapNode[]
}

export interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  text?: string
  marks?: TipTapMark[]
}

export interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Wiki-link types
// ---------------------------------------------------------------------------

/** A parsed wiki-link reference found in content */
export interface WikiLink {
  /** The target note title or ID */
  target: string
  /** Optional display text (for [[target|display text]]) */
  displayText?: string
  /** Whether this link resolves to an existing note */
  resolved: boolean
}

/** Backlink: a note that references this note */
export interface Backlink {
  noteId: string
  noteTitle: string
  /** Context snippet around the wiki-link */
  context: string
}

// ---------------------------------------------------------------------------
// API / Input types
// ---------------------------------------------------------------------------

export interface CreateNoteInput {
  title: string
  content?: TipTapDocument
  tags?: string[]
  /** If provided, initialize content from plain text (converted to TipTap) */
  plainText?: string
}

export interface UpdateNoteInput {
  title?: string
  content?: TipTapDocument
  tags?: string[]
  plainText?: string
}

export interface NoteListOptions {
  /** Filter by tag */
  tag?: string
  /** Search query (matches title and plainText) */
  query?: string
  /** Include archived notes */
  includeArchived?: boolean
  /** Sort field */
  sortBy?: 'title' | 'createdAt' | 'updatedAt'
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
  /** Pagination offset */
  offset?: number
  /** Pagination limit (default 50) */
  limit?: number
}

export interface NoteListResult {
  notes: NoteSummary[]
  total: number
}

/** Lightweight note for list views */
export interface NoteSummary {
  id: string
  title: string
  tags: string[]
  /** First ~200 chars of plain text */
  excerpt: string
  createdBy: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface NoteSearchResult {
  noteId: string
  noteTitle: string
  /** Matching snippet with highlighted terms */
  snippet: string
  /** Match score (higher is better) */
  score: number
}
