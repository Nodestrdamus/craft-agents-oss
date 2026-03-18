/**
 * Enterprise User & Team Store
 *
 * File-based storage for users, teams, and enterprise config.
 * Stored in ~/.craft-agent/enterprise/ with append-only audit log.
 *
 * Future: migrate to Azure Table Storage or Cosmos DB.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  EnterpriseUser,
  EnterpriseTeam,
  EnterpriseConfig,
  EnterpriseRole,
  AuditEntry,
  AuditAction,
} from './types'
import { DEFAULT_ENTERPRISE_CONFIG, hasMinRole } from './types'
import type { ValidatedEntraUser } from '../auth/entra-jwt'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getEnterpriseDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return join(home, '.craft-agent', 'enterprise')
}

function ensureEnterpriseDir(): string {
  const dir = getEnterpriseDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function loadEnterpriseConfig(): EnterpriseConfig {
  const dir = getEnterpriseDir()
  const configPath = join(dir, 'config.json')
  try {
    const raw = readFileSync(configPath, 'utf8')
    return { ...DEFAULT_ENTERPRISE_CONFIG, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_ENTERPRISE_CONFIG }
  }
}

export function saveEnterpriseConfig(config: EnterpriseConfig): void {
  const dir = ensureEnterpriseDir()
  const configPath = join(dir, 'config.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function loadUsersFile(): EnterpriseUser[] {
  const dir = getEnterpriseDir()
  const usersPath = join(dir, 'users.json')
  try {
    const raw = readFileSync(usersPath, 'utf8')
    return JSON.parse(raw) as EnterpriseUser[]
  } catch {
    return []
  }
}

function saveUsersFile(users: EnterpriseUser[]): void {
  const dir = ensureEnterpriseDir()
  const usersPath = join(dir, 'users.json')
  writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8')
}

/** Get all users */
export function getUsers(): EnterpriseUser[] {
  return loadUsersFile()
}

/** Get a single user by internal ID */
export function getUser(userId: string): EnterpriseUser | null {
  return loadUsersFile().find(u => u.id === userId) ?? null
}

/** Get a user by Entra object ID */
export function getUserByEntraOid(oid: string): EnterpriseUser | null {
  return loadUsersFile().find(u => u.entraOid === oid) ?? null
}

/**
 * Provision or update a user from Entra JWT claims.
 * Called on every authenticated request when enterprise mode is enabled.
 */
export function provisionFromEntraUser(
  entraUser: ValidatedEntraUser,
  config: EnterpriseConfig,
): EnterpriseUser {
  const users = loadUsersFile()
  const existing = users.find(u => u.entraOid === entraUser.objectId)

  if (existing) {
    // Update on login
    existing.email = entraUser.email || existing.email
    existing.displayName = entraUser.displayName || existing.displayName
    existing.lastLoginAt = new Date().toISOString()

    if (config.syncGroupsOnLogin) {
      existing.entraGroups = entraUser.groups
      existing.entraRoles = entraUser.roles

      // Re-sync team memberships from group mappings
      syncTeamMemberships(existing, config)

      // Re-sync role from app role mappings
      syncRole(existing, config)
    }

    saveUsersFile(users)
    return existing
  }

  // Auto-provision new user
  if (!config.autoProvision) {
    throw new Error(`User not provisioned and auto-provisioning is disabled: ${entraUser.email}`)
  }

  const newUser: EnterpriseUser = {
    id: randomUUID(),
    entraOid: entraUser.objectId,
    email: entraUser.email,
    displayName: entraUser.displayName,
    tenantId: entraUser.tenantId,
    role: config.defaultRole,
    entraGroups: entraUser.groups,
    entraRoles: entraUser.roles,
    teams: [],
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    isActive: true,
  }

  // Apply group → team mappings
  syncTeamMemberships(newUser, config)

  // Apply app role → enterprise role mappings
  syncRole(newUser, config)

  users.push(newUser)
  saveUsersFile(users)

  appendAudit({
    action: 'user.created',
    userId: newUser.id,
    userEmail: newUser.email,
    resourceType: 'user',
    resourceId: newUser.id,
    details: { entraOid: newUser.entraOid, role: newUser.role },
  })

  return newUser
}

/** Update a user's global role */
export function setUserRole(
  userId: string,
  role: EnterpriseRole,
  performedBy: { userId: string; email: string },
): EnterpriseUser {
  const users = loadUsersFile()
  const user = users.find(u => u.id === userId)
  if (!user) throw new Error(`User not found: ${userId}`)

  const oldRole = user.role
  user.role = role
  saveUsersFile(users)

  appendAudit({
    action: 'user.role_changed',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'user',
    resourceId: userId,
    details: { oldRole, newRole: role },
  })

  return user
}

/** Deactivate a user */
export function deactivateUser(
  userId: string,
  performedBy: { userId: string; email: string },
): void {
  const users = loadUsersFile()
  const user = users.find(u => u.id === userId)
  if (!user) throw new Error(`User not found: ${userId}`)

  user.isActive = false
  saveUsersFile(users)

  appendAudit({
    action: 'user.deactivated',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'user',
    resourceId: userId,
    details: { email: user.email },
  })
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function loadTeamsFile(): EnterpriseTeam[] {
  const dir = getEnterpriseDir()
  const teamsPath = join(dir, 'teams.json')
  try {
    const raw = readFileSync(teamsPath, 'utf8')
    return JSON.parse(raw) as EnterpriseTeam[]
  } catch {
    return []
  }
}

function saveTeamsFile(teams: EnterpriseTeam[]): void {
  const dir = ensureEnterpriseDir()
  const teamsPath = join(dir, 'teams.json')
  writeFileSync(teamsPath, JSON.stringify(teams, null, 2), 'utf8')
}

export function getTeams(): EnterpriseTeam[] {
  return loadTeamsFile()
}

export function getTeam(teamId: string): EnterpriseTeam | null {
  return loadTeamsFile().find(t => t.id === teamId) ?? null
}

export function createTeam(
  input: { name: string; description?: string; workspaceIds?: string[]; entraGroupMappings?: string[] },
  performedBy: { userId: string; email: string },
): EnterpriseTeam {
  const teams = loadTeamsFile()

  const team: EnterpriseTeam = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    workspaceIds: input.workspaceIds ?? [],
    members: [],
    entraGroupMappings: input.entraGroupMappings ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  teams.push(team)
  saveTeamsFile(teams)

  // Update enterprise config with group mappings
  if (input.entraGroupMappings?.length) {
    const config = loadEnterpriseConfig()
    for (const groupId of input.entraGroupMappings) {
      config.groupMappings[groupId] = { teamId: team.id, defaultRole: 'member' }
    }
    saveEnterpriseConfig(config)
  }

  appendAudit({
    action: 'team.created',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'team',
    resourceId: team.id,
    details: { name: team.name },
  })

  return team
}

export function updateTeam(
  teamId: string,
  input: { name?: string; description?: string; workspaceIds?: string[] },
  performedBy: { userId: string; email: string },
): EnterpriseTeam {
  const teams = loadTeamsFile()
  const team = teams.find(t => t.id === teamId)
  if (!team) throw new Error(`Team not found: ${teamId}`)

  if (input.name !== undefined) team.name = input.name
  if (input.description !== undefined) team.description = input.description
  if (input.workspaceIds !== undefined) team.workspaceIds = input.workspaceIds
  team.updatedAt = new Date().toISOString()

  saveTeamsFile(teams)

  appendAudit({
    action: 'team.updated',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'team',
    resourceId: teamId,
    details: input,
  })

  return team
}

export function deleteTeam(
  teamId: string,
  performedBy: { userId: string; email: string },
): void {
  const teams = loadTeamsFile()
  const idx = teams.findIndex(t => t.id === teamId)
  if (idx === -1) throw new Error(`Team not found: ${teamId}`)

  const team = teams[idx]!
  teams.splice(idx, 1)
  saveTeamsFile(teams)

  // Remove team memberships from all users
  const users = loadUsersFile()
  let usersChanged = false
  for (const user of users) {
    const memberIdx = user.teams.findIndex(t => t.teamId === teamId)
    if (memberIdx !== -1) {
      user.teams.splice(memberIdx, 1)
      usersChanged = true
    }
  }
  if (usersChanged) saveUsersFile(users)

  // Remove group mappings pointing to this team
  const config = loadEnterpriseConfig()
  let configChanged = false
  for (const [groupId, mapping] of Object.entries(config.groupMappings)) {
    if (mapping.teamId === teamId) {
      delete config.groupMappings[groupId]
      configChanged = true
    }
  }
  if (configChanged) saveEnterpriseConfig(config)

  appendAudit({
    action: 'team.deleted',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'team',
    resourceId: teamId,
    details: { name: team.name },
  })
}

export function addTeamMember(
  teamId: string,
  userId: string,
  role: EnterpriseRole,
  performedBy: { userId: string; email: string },
): void {
  const teams = loadTeamsFile()
  const team = teams.find(t => t.id === teamId)
  if (!team) throw new Error(`Team not found: ${teamId}`)

  // Check not already a member
  if (team.members.some(m => m.userId === userId)) {
    throw new Error(`User ${userId} is already a member of team ${teamId}`)
  }

  team.members.push({ userId, role, addedAt: new Date().toISOString() })
  team.updatedAt = new Date().toISOString()
  saveTeamsFile(teams)

  // Update user's team memberships
  const users = loadUsersFile()
  const user = users.find(u => u.id === userId)
  if (user) {
    if (!user.teams.some(t => t.teamId === teamId)) {
      user.teams.push({ teamId, role })
      saveUsersFile(users)
    }
  }

  appendAudit({
    action: 'team.member_added',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'team',
    resourceId: teamId,
    details: { memberId: userId, role },
  })
}

export function removeTeamMember(
  teamId: string,
  userId: string,
  performedBy: { userId: string; email: string },
): void {
  const teams = loadTeamsFile()
  const team = teams.find(t => t.id === teamId)
  if (!team) throw new Error(`Team not found: ${teamId}`)

  const idx = team.members.findIndex(m => m.userId === userId)
  if (idx === -1) throw new Error(`User ${userId} is not a member of team ${teamId}`)

  team.members.splice(idx, 1)
  team.updatedAt = new Date().toISOString()
  saveTeamsFile(teams)

  // Update user
  const users = loadUsersFile()
  const user = users.find(u => u.id === userId)
  if (user) {
    const memberIdx = user.teams.findIndex(t => t.teamId === teamId)
    if (memberIdx !== -1) {
      user.teams.splice(memberIdx, 1)
      saveUsersFile(users)
    }
  }

  appendAudit({
    action: 'team.member_removed',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'team',
    resourceId: teamId,
    details: { memberId: userId },
  })
}

// ---------------------------------------------------------------------------
// Access Control Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective role a user has for a specific workspace.
 *
 * Priority:
 * 1. Admin role always wins (global role)
 * 2. Highest team-level role for any team that includes this workspace
 * 3. Global role as fallback
 */
export function getEffectiveRole(user: EnterpriseUser, workspaceId: string): EnterpriseRole {
  // Global admin always has full access
  if (user.role === 'admin') return 'admin'

  const teams = loadTeamsFile()
  let highestRole: EnterpriseRole = user.role

  for (const membership of user.teams) {
    const team = teams.find(t => t.id === membership.teamId)
    if (!team) continue

    // Check if team has access to this workspace
    if (team.workspaceIds.includes(workspaceId)) {
      if (hasMinRole(membership.role, highestRole)) {
        highestRole = membership.role
      }
    }
  }

  return highestRole
}

/**
 * Get all workspace IDs a user has access to.
 * Admins get access to all workspaces.
 */
export function getUserWorkspaceIds(user: EnterpriseUser): string[] | 'all' {
  if (user.role === 'admin') return 'all'

  const teams = loadTeamsFile()
  const workspaceIds = new Set<string>()

  for (const membership of user.teams) {
    const team = teams.find(t => t.id === membership.teamId)
    if (!team) continue
    for (const wsId of team.workspaceIds) {
      workspaceIds.add(wsId)
    }
  }

  return Array.from(workspaceIds)
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export function appendAudit(
  entry: Omit<AuditEntry, 'timestamp'>,
): void {
  const dir = ensureEnterpriseDir()
  const auditPath = join(dir, 'audit.jsonl')
  const full: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  }
  appendFileSync(auditPath, JSON.stringify(full) + '\n', 'utf8')
}

export function readAuditLog(limit = 100, offset = 0): AuditEntry[] {
  const dir = getEnterpriseDir()
  const auditPath = join(dir, 'audit.jsonl')
  try {
    const raw = readFileSync(auditPath, 'utf8')
    const lines = raw.trim().split('\n').filter(Boolean)
    // Most recent first
    const entries = lines.reverse().map(line => JSON.parse(line) as AuditEntry)
    return entries.slice(offset, offset + limit)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function syncTeamMemberships(user: EnterpriseUser, config: EnterpriseConfig): void {
  const teams = loadTeamsFile()

  for (const groupId of user.entraGroups) {
    const mapping = config.groupMappings[groupId]
    if (!mapping) continue

    // Check team exists
    const team = teams.find(t => t.id === mapping.teamId)
    if (!team) continue

    // Add to user's teams if not already present
    if (!user.teams.some(t => t.teamId === mapping.teamId)) {
      user.teams.push({ teamId: mapping.teamId, role: mapping.defaultRole })
    }

    // Add to team's members if not already present
    if (!team.members.some(m => m.userId === user.id)) {
      team.members.push({ userId: user.id, role: mapping.defaultRole, addedAt: new Date().toISOString() })
      team.updatedAt = new Date().toISOString()
    }
  }

  // Save teams if we modified them
  saveTeamsFile(teams)
}

function syncRole(user: EnterpriseUser, config: EnterpriseConfig): void {
  // Map Entra app roles to enterprise roles, taking the highest
  let highestMappedRole: EnterpriseRole | null = null

  for (const appRole of user.entraRoles) {
    const mappedRole = config.roleMappings[appRole]
    if (mappedRole) {
      if (!highestMappedRole || hasMinRole(mappedRole, highestMappedRole)) {
        highestMappedRole = mappedRole
      }
    }
  }

  if (highestMappedRole) {
    user.role = highestMappedRole
  }
}
