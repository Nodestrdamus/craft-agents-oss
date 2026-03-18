/**
 * Workspace Memory RPC Handlers
 *
 * CRUD operations for workspace-level shared memory.
 * Memory persists across sessions within a workspace.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  listWorkspaceMemory,
  getWorkspaceMemory,
  saveWorkspaceMemory,
  deleteWorkspaceMemory,
  readMemoryIndex,
  writeMemoryIndex,
  type WorkspaceMemoryEntry,
} from '@craft-agent/shared/workspaces'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaceMemory.LIST,
  RPC_CHANNELS.workspaceMemory.GET,
  RPC_CHANNELS.workspaceMemory.SAVE,
  RPC_CHANNELS.workspaceMemory.DELETE,
  RPC_CHANNELS.workspaceMemory.GET_INDEX,
  RPC_CHANNELS.workspaceMemory.SET_INDEX,
] as const

export function registerWorkspaceMemoryHandlers(server: RpcServer, deps: HandlerDeps): void {
  // List all memory entries for a workspace
  server.handle(RPC_CHANNELS.workspaceMemory.LIST, async (_ctx, workspacePath: string) => {
    return listWorkspaceMemory(workspacePath)
  })

  // Get a single memory entry
  server.handle(RPC_CHANNELS.workspaceMemory.GET, async (_ctx, workspacePath: string, slug: string) => {
    const entry = getWorkspaceMemory(workspacePath, slug)
    if (!entry) throw new Error(`Workspace memory not found: ${slug}`)
    return entry
  })

  // Save (create or update) a memory entry
  server.handle(RPC_CHANNELS.workspaceMemory.SAVE, async (_ctx, workspacePath: string, slug: string, entry: Omit<WorkspaceMemoryEntry, 'slug'>) => {
    saveWorkspaceMemory(workspacePath, slug, entry)
    deps.platform.logger?.info(`[workspace-memory] Saved: ${slug}`)
    return { success: true }
  })

  // Delete a memory entry
  server.handle(RPC_CHANNELS.workspaceMemory.DELETE, async (_ctx, workspacePath: string, slug: string) => {
    const deleted = deleteWorkspaceMemory(workspacePath, slug)
    if (deleted) {
      deps.platform.logger?.info(`[workspace-memory] Deleted: ${slug}`)
    }
    return { success: deleted }
  })

  // Read the MEMORY.md index
  server.handle(RPC_CHANNELS.workspaceMemory.GET_INDEX, async (_ctx, workspacePath: string) => {
    return { content: readMemoryIndex(workspacePath) }
  })

  // Write the MEMORY.md index
  server.handle(RPC_CHANNELS.workspaceMemory.SET_INDEX, async (_ctx, workspacePath: string, content: string) => {
    writeMemoryIndex(workspacePath, content)
    return { success: true }
  })
}
