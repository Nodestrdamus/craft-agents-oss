import { join } from 'path'
import { readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.CREATE,
  RPC_CHANNELS.skills.SAVE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
  RPC_CHANNELS.skills.GET_GLOBAL,
  RPC_CHANNELS.skills.CREATE_GLOBAL,
  RPC_CHANNELS.skills.SAVE_GLOBAL,
  RPC_CHANNELS.skills.DELETE_GLOBAL,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, workingDirectory)
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Create a new skill in a workspace
  server.handle(RPC_CHANNELS.skills.CREATE, async (_ctx, workspaceId: string, skillSlug: string, input: { name: string; description: string; content: string; globs?: string[]; alwaysAllow?: string[]; icon?: string; requiredSources?: string[] }) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createSkill } = await import('@craft-agent/shared/skills')
    const skill = createSkill(workspace.rootPath, skillSlug, input)
    deps.platform.logger?.info(`Created skill: ${skillSlug} in workspace ${workspaceId}`)
    return skill
  })

  // Save (update) a skill in a workspace
  server.handle(RPC_CHANNELS.skills.SAVE, async (_ctx, workspaceId: string, skillSlug: string, input: { name: string; description: string; content: string; globs?: string[]; alwaysAllow?: string[]; icon?: string; requiredSources?: string[] }) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveSkill } = await import('@craft-agent/shared/skills')
    const skill = saveSkill(workspace.rootPath, skillSlug, input)
    deps.platform.logger?.info(`Saved skill: ${skillSlug} in workspace ${workspaceId}`)
    return skill
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })

  // ---- Global Skills (cross-workspace, ~/.agents/skills/) ----

  // Get all global skills
  server.handle(RPC_CHANNELS.skills.GET_GLOBAL, async () => {
    const { loadGlobalSkills } = await import('@craft-agent/shared/skills')
    const skills = loadGlobalSkills()
    deps.platform.logger?.info(`SKILLS_GET_GLOBAL: Loaded ${skills.length} global skills`)
    return skills
  })

  // Create a new global skill
  server.handle(RPC_CHANNELS.skills.CREATE_GLOBAL, async (_ctx, skillSlug: string, input: { name: string; description: string; content: string; globs?: string[]; alwaysAllow?: string[]; icon?: string; requiredSources?: string[] }) => {
    const { createGlobalSkill } = await import('@craft-agent/shared/skills')
    const skill = createGlobalSkill(skillSlug, input)
    deps.platform.logger?.info(`Created global skill: ${skillSlug}`)
    return skill
  })

  // Save (update) a global skill
  server.handle(RPC_CHANNELS.skills.SAVE_GLOBAL, async (_ctx, skillSlug: string, input: { name: string; description: string; content: string; globs?: string[]; alwaysAllow?: string[]; icon?: string; requiredSources?: string[] }) => {
    const { saveGlobalSkill } = await import('@craft-agent/shared/skills')
    const skill = saveGlobalSkill(skillSlug, input)
    deps.platform.logger?.info(`Saved global skill: ${skillSlug}`)
    return skill
  })

  // Delete a global skill
  server.handle(RPC_CHANNELS.skills.DELETE_GLOBAL, async (_ctx, skillSlug: string) => {
    const { deleteGlobalSkill } = await import('@craft-agent/shared/skills')
    deleteGlobalSkill(skillSlug)
    deps.platform.logger?.info(`Deleted global skill: ${skillSlug}`)
  })
}
