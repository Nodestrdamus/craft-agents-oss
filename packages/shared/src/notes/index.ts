/**
 * Notes / Knowledge Base Module
 *
 * Re-exports types and storage functions for workspace notes.
 */

// Types
export type {
  Note,
  NoteSummary,
  NoteListOptions,
  NoteListResult,
  NoteSearchResult,
  CreateNoteInput,
  UpdateNoteInput,
  TipTapDocument,
  TipTapNode,
  TipTapMark,
  WikiLink,
  Backlink,
} from './types.ts'

// Storage functions
export {
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
  parseWikiLinks,
  saveMessageAsNote,
} from './storage.ts'
