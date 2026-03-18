/**
 * Notes / Knowledge Base RPC Handlers
 *
 * CRUD operations for workspace notes with wiki-link support.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  archiveNote,
  unarchiveNote,
  listNotes,
  searchNotes,
  getNoteBacklinks,
  resolveWikiLinks,
  saveMessageAsNote,
  type CreateNoteInput,
  type UpdateNoteInput,
  type NoteListOptions,
} from '@craft-agent/shared/notes'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.notes.CREATE,
  RPC_CHANNELS.notes.GET,
  RPC_CHANNELS.notes.UPDATE,
  RPC_CHANNELS.notes.DELETE,
  RPC_CHANNELS.notes.ARCHIVE,
  RPC_CHANNELS.notes.UNARCHIVE,
  RPC_CHANNELS.notes.LIST,
  RPC_CHANNELS.notes.SEARCH,
  RPC_CHANNELS.notes.GET_BACKLINKS,
  RPC_CHANNELS.notes.RESOLVE_WIKI_LINKS,
  RPC_CHANNELS.notes.SAVE_FROM_CHAT,
] as const

function getPerformer(ctx: any): string {
  return ctx.authContext?.user?.email ?? 'system@local'
}

export function registerNotesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Create a new note
  server.handle(RPC_CHANNELS.notes.CREATE, async (ctx, workspacePath: string, workspaceId: string, input: CreateNoteInput) => {
    const createdBy = getPerformer(ctx)
    const note = createNote(workspacePath, workspaceId, input, createdBy)
    deps.platform.logger?.info(`[notes] Created: ${note.id} (${note.title})`)
    return note
  })

  // Get a note by ID
  server.handle(RPC_CHANNELS.notes.GET, async (_ctx, workspacePath: string, noteId: string) => {
    const note = getNote(workspacePath, noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    return note
  })

  // Update a note
  server.handle(RPC_CHANNELS.notes.UPDATE, async (_ctx, workspacePath: string, noteId: string, input: UpdateNoteInput) => {
    const note = updateNote(workspacePath, noteId, input)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    return note
  })

  // Delete a note (hard delete)
  server.handle(RPC_CHANNELS.notes.DELETE, async (_ctx, workspacePath: string, noteId: string) => {
    const deleted = deleteNote(workspacePath, noteId)
    if (!deleted) throw new Error(`Note not found: ${noteId}`)
    return { success: true }
  })

  // Archive a note (soft delete)
  server.handle(RPC_CHANNELS.notes.ARCHIVE, async (_ctx, workspacePath: string, noteId: string) => {
    const note = archiveNote(workspacePath, noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    return note
  })

  // Unarchive a note
  server.handle(RPC_CHANNELS.notes.UNARCHIVE, async (_ctx, workspacePath: string, noteId: string) => {
    const note = unarchiveNote(workspacePath, noteId)
    if (!note) throw new Error(`Note not found: ${noteId}`)
    return note
  })

  // List notes with filtering and pagination
  server.handle(RPC_CHANNELS.notes.LIST, async (_ctx, workspacePath: string, options?: NoteListOptions) => {
    return listNotes(workspacePath, options ?? {})
  })

  // Full-text search across notes
  server.handle(RPC_CHANNELS.notes.SEARCH, async (_ctx, workspacePath: string, query: string, limit?: number) => {
    return searchNotes(workspacePath, query, limit)
  })

  // Get backlinks for a note
  server.handle(RPC_CHANNELS.notes.GET_BACKLINKS, async (_ctx, workspacePath: string, noteId: string) => {
    return getNoteBacklinks(workspacePath, noteId)
  })

  // Resolve wiki-links in text
  server.handle(RPC_CHANNELS.notes.RESOLVE_WIKI_LINKS, async (_ctx, workspacePath: string, text: string) => {
    return resolveWikiLinks(workspacePath, text)
  })

  // Save a chat message as a note
  server.handle(RPC_CHANNELS.notes.SAVE_FROM_CHAT, async (ctx, workspacePath: string, workspaceId: string, title: string, messageText: string, tags?: string[]) => {
    const createdBy = getPerformer(ctx)
    const note = saveMessageAsNote(workspacePath, workspaceId, title, messageText, createdBy, tags)
    deps.platform.logger?.info(`[notes] Saved from chat: ${note.id} (${note.title})`)
    return note
  })
}
