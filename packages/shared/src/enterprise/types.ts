/**
 * Enterprise RBAC Types
 *
 * Role-based access control with teams, tied to Microsoft Entra ID groups.
 * Supports both static token (admin-level) and JWT-based identity.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Enterprise roles — ordered by privilege level (ascending).
 *
 * - viewer:  Read-only access to sessions and workspace content
 * - member:  Create/manage own sessions, enable skills/sources, write workspace memory
 * - manager: All member permissions + manage workspace settings, skills, sources, users within team
 * - admin:   Full control — manage teams, users, global skills, server configuration
 */
export type EnterpriseRole = 'viewer' | 'member' | 'manager' | 'admin'

/** Privilege level for role comparison */
export const ROLE_LEVELS: Record<EnterpriseRole, number> = {
  viewer: 0,
  member: 1,
  manager: 2,
  admin: 3,
}

/** Check if a role meets or exceeds a required minimum role */
export function hasMinRole(actual: EnterpriseRole, required: EnterpriseRole): boolean {
  return ROLE_LEVELS[actual] >= ROLE_LEVELS[required]
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface EnterpriseUser {
  /** Internal user ID (UUID) */
  id: string
  /** Microsoft Entra ID object ID (oid claim) — primary external identifier */
  entraOid: string
  /** Email / UPN from JWT */
  email: string
  /** Display name from JWT */
  displayName: string
  /** Entra tenant ID */
  tenantId: string
  /** Global role (applies when no team-specific role exists) */
  role: EnterpriseRole
  /** Entra security group IDs (synced from JWT groups claim) */
  entraGroups: string[]
  /** Entra app role values (synced from JWT roles claim) */
  entraRoles: string[]
  /** Team memberships */
  teams: TeamMembership[]
  /** ISO timestamp of first login */
  createdAt: string
  /** ISO timestamp of most recent login */
  lastLoginAt: string
  /** Whether the user account is active */
  isActive: boolean
}

export interface TeamMembership {
  teamId: string
  role: EnterpriseRole
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface EnterpriseTeam {
  /** Team ID (UUID) */
  id: string
  /** Display name */
  name: string
  /** Optional description */
  description?: string
  /** Workspace IDs this team has access to */
  workspaceIds: string[]
  /** Members with their team-specific roles */
  members: TeamMember[]
  /** Entra security group IDs that auto-map to this team */
  entraGroupMappings: string[]
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp */
  updatedAt: string
}

export interface TeamMember {
  userId: string
  role: EnterpriseRole
  /** ISO timestamp when member was added */
  addedAt: string
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'user.login'
  | 'user.logout'
  | 'user.created'
  | 'user.role_changed'
  | 'user.deactivated'
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'team.member_added'
  | 'team.member_removed'
  | 'team.member_role_changed'
  | 'workspace.created'
  | 'workspace.deleted'
  | 'workspace.settings_changed'
  | 'session.created'
  | 'session.deleted'
  | 'skill.created'
  | 'skill.deleted'
  | 'skill.published'
  | 'source.created'
  | 'source.deleted'
  | 'batch.started'
  | 'batch.completed'
  | 'permission.denied'

export interface AuditEntry {
  /** ISO timestamp */
  timestamp: string
  /** Action performed */
  action: AuditAction
  /** User who performed the action (null for system actions) */
  userId: string | null
  /** User email (denormalized for log readability) */
  userEmail: string | null
  /** Target resource type */
  resourceType: 'user' | 'team' | 'workspace' | 'session' | 'skill' | 'source' | 'batch' | 'system'
  /** Target resource ID */
  resourceId: string
  /** Additional context */
  details: Record<string, unknown>
  /** Client IP if available */
  clientIp?: string
}

// ---------------------------------------------------------------------------
// Enterprise Config
// ---------------------------------------------------------------------------

export interface EnterpriseConfig {
  /** Whether enterprise RBAC is enabled */
  enabled: boolean
  /**
   * Entra group-to-team mappings.
   * Key: Entra security group ID, Value: { teamId, defaultRole }
   */
  groupMappings: Record<string, { teamId: string; defaultRole: EnterpriseRole }>
  /**
   * Entra app role mappings.
   * Key: Entra app role value, Value: EnterpriseRole
   */
  roleMappings: Record<string, EnterpriseRole>
  /** Default role for new users who don't match any group mapping */
  defaultRole: EnterpriseRole
  /** Whether to auto-provision users on first JWT login */
  autoProvision: boolean
  /** Whether to auto-sync Entra groups on each login */
  syncGroupsOnLogin: boolean
}

// Default config when enterprise mode is first enabled
export const DEFAULT_ENTERPRISE_CONFIG: EnterpriseConfig = {
  enabled: false,
  groupMappings: {},
  roleMappings: {},
  defaultRole: 'member',
  autoProvision: true,
  syncGroupsOnLogin: true,
}

// ---------------------------------------------------------------------------
// Permission Checks
// ---------------------------------------------------------------------------

/**
 * RPC channel permission requirements.
 * Maps channel name patterns to the minimum role required.
 * Channels not listed default to 'member'.
 */
export const CHANNEL_PERMISSIONS: Record<string, EnterpriseRole> = {
  // Admin-only
  'enterprise:*': 'admin',
  'skills:createGlobal': 'admin',
  'skills:saveGlobal': 'admin',
  'skills:deleteGlobal': 'admin',
  'marketplace:publish': 'admin',
  'marketplace:unpublish': 'admin',

  // Manager+
  'workspaceSettings:update': 'manager',
  'workspace:writeImage': 'manager',
  'workspace:getPermissions': 'manager',
  'sources:create': 'manager',
  'sources:delete': 'manager',
  'skills:create': 'manager',
  'skills:save': 'manager',
  'skills:delete': 'manager',
  'batches:start': 'manager',
  'batches:delete': 'manager',
  'statuses:reorder': 'manager',
  'labels:create': 'manager',
  'labels:delete': 'manager',

  // Member (explicit)
  'sessions:create': 'member',
  'sessions:sendMessage': 'member',
  'sessions:command': 'member',
  'batches:test': 'member',

  // Viewer (read-only endpoints)
  'sessions:get': 'viewer',
  'sessions:getMessages': 'viewer',
  'sessions:searchContent': 'viewer',
  'skills:get': 'viewer',
  'skills:getGlobal': 'viewer',
  'sources:get': 'viewer',
  'workspaces:get': 'viewer',
  'workspaceSettings:get': 'viewer',
  'marketplace:list': 'viewer',
  'marketplace:get': 'viewer',
}

/**
 * Resolve the minimum role required for an RPC channel.
 * Checks exact match first, then wildcard patterns, then defaults to 'member'.
 */
export function getRequiredRole(channel: string): EnterpriseRole {
  // Exact match
  if (channel in CHANNEL_PERMISSIONS) return CHANNEL_PERMISSIONS[channel]!

  // Wildcard match (e.g., 'enterprise:*' matches 'enterprise:getUsers')
  const namespace = channel.split(':')[0]
  const wildcard = `${namespace}:*`
  if (wildcard in CHANNEL_PERMISSIONS) return CHANNEL_PERMISSIONS[wildcard]!

  // Default
  return 'member'
}
