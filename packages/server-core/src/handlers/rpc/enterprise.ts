/**
 * Enterprise RBAC RPC Handlers
 *
 * Admin-only endpoints for managing users, teams, roles, and enterprise config.
 * All handlers require admin role (enforced via CHANNEL_PERMISSIONS).
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  getUsers,
  getUser,
  setUserRole,
  deactivateUser,
  getTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember,
  loadEnterpriseConfig,
  saveEnterpriseConfig,
  readAuditLog,
} from '@craft-agent/shared/enterprise'
import type { EnterpriseRole, EnterpriseConfig } from '@craft-agent/shared/enterprise'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.enterprise.GET_USERS,
  RPC_CHANNELS.enterprise.GET_USER,
  RPC_CHANNELS.enterprise.SET_USER_ROLE,
  RPC_CHANNELS.enterprise.DEACTIVATE_USER,
  RPC_CHANNELS.enterprise.GET_TEAMS,
  RPC_CHANNELS.enterprise.GET_TEAM,
  RPC_CHANNELS.enterprise.CREATE_TEAM,
  RPC_CHANNELS.enterprise.UPDATE_TEAM,
  RPC_CHANNELS.enterprise.DELETE_TEAM,
  RPC_CHANNELS.enterprise.ADD_TEAM_MEMBER,
  RPC_CHANNELS.enterprise.REMOVE_TEAM_MEMBER,
  RPC_CHANNELS.enterprise.GET_CONFIG,
  RPC_CHANNELS.enterprise.UPDATE_CONFIG,
  RPC_CHANNELS.enterprise.GET_AUDIT_LOG,
] as const

/**
 * Helper to extract performer info from context.
 * In a real implementation, this would come from the authenticated context
 * attached during the auth middleware phase.
 */
function getPerformer(ctx: any): { userId: string; email: string } {
  // When enterprise auth context is available on the connection
  if (ctx.authContext?.user) {
    return { userId: ctx.authContext.user.id, email: ctx.authContext.user.email }
  }
  // Static token fallback (admin CLI)
  return { userId: 'system', email: 'system@local' }
}

export function registerEnterpriseHandlers(server: RpcServer, deps: HandlerDeps): void {
  // ---- Users ----

  server.handle(RPC_CHANNELS.enterprise.GET_USERS, async () => {
    return getUsers()
  })

  server.handle(RPC_CHANNELS.enterprise.GET_USER, async (_ctx, userId: string) => {
    const user = getUser(userId)
    if (!user) throw new Error(`User not found: ${userId}`)
    return user
  })

  server.handle(RPC_CHANNELS.enterprise.SET_USER_ROLE, async (ctx, userId: string, role: EnterpriseRole) => {
    const performer = getPerformer(ctx)
    return setUserRole(userId, role, performer)
  })

  server.handle(RPC_CHANNELS.enterprise.DEACTIVATE_USER, async (ctx, userId: string) => {
    const performer = getPerformer(ctx)
    deactivateUser(userId, performer)
    return { success: true }
  })

  // ---- Teams ----

  server.handle(RPC_CHANNELS.enterprise.GET_TEAMS, async () => {
    return getTeams()
  })

  server.handle(RPC_CHANNELS.enterprise.GET_TEAM, async (_ctx, teamId: string) => {
    const team = getTeam(teamId)
    if (!team) throw new Error(`Team not found: ${teamId}`)
    return team
  })

  server.handle(RPC_CHANNELS.enterprise.CREATE_TEAM, async (ctx, input: {
    name: string
    description?: string
    workspaceIds?: string[]
    entraGroupMappings?: string[]
  }) => {
    const performer = getPerformer(ctx)
    return createTeam(input, performer)
  })

  server.handle(RPC_CHANNELS.enterprise.UPDATE_TEAM, async (ctx, teamId: string, input: {
    name?: string
    description?: string
    workspaceIds?: string[]
  }) => {
    const performer = getPerformer(ctx)
    return updateTeam(teamId, input, performer)
  })

  server.handle(RPC_CHANNELS.enterprise.DELETE_TEAM, async (ctx, teamId: string) => {
    const performer = getPerformer(ctx)
    deleteTeam(teamId, performer)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.enterprise.ADD_TEAM_MEMBER, async (ctx, teamId: string, userId: string, role: EnterpriseRole) => {
    const performer = getPerformer(ctx)
    addTeamMember(teamId, userId, role, performer)
    return { success: true }
  })

  server.handle(RPC_CHANNELS.enterprise.REMOVE_TEAM_MEMBER, async (ctx, teamId: string, userId: string) => {
    const performer = getPerformer(ctx)
    removeTeamMember(teamId, userId, performer)
    return { success: true }
  })

  // ---- Config ----

  server.handle(RPC_CHANNELS.enterprise.GET_CONFIG, async () => {
    return loadEnterpriseConfig()
  })

  server.handle(RPC_CHANNELS.enterprise.UPDATE_CONFIG, async (_ctx, config: Partial<EnterpriseConfig>) => {
    const current = loadEnterpriseConfig()
    const updated = { ...current, ...config }
    saveEnterpriseConfig(updated)
    deps.platform.logger?.info('[enterprise] Config updated')
    return updated
  })

  // ---- Audit ----

  server.handle(RPC_CHANNELS.enterprise.GET_AUDIT_LOG, async (_ctx, limit?: number, offset?: number) => {
    return readAuditLog(limit ?? 100, offset ?? 0)
  })
}
