/**
 * Skill Marketplace Types
 *
 * Discovery, governance, and distribution layer for skills.
 * Builds on the Global Skills system with metadata, versioning, and approval workflows.
 */

// ---------------------------------------------------------------------------
// Skill Metadata (extended beyond basic SKILL.md frontmatter)
// ---------------------------------------------------------------------------

export interface MarketplaceSkill {
  /** Unique skill slug (directory name) */
  slug: string
  /** Display name */
  name: string
  /** Short description for catalog browsing */
  description: string
  /** Long-form readme (markdown) */
  readme: string
  /** Skill author */
  author: SkillAuthor
  /** Semantic version */
  version: string
  /** Version history */
  versions: SkillVersion[]
  /** Categorization tags */
  tags: string[]
  /** Primary category */
  category: SkillCategory
  /** Optional icon (emoji or URL) */
  icon?: string
  /** Source slugs this skill requires */
  requiredSources: string[]
  /** File glob patterns (from SKILL.md frontmatter) */
  globs?: string[]
  /** Tools this skill is always allowed to use */
  alwaysAllow?: string[]
  /** Publication status */
  status: SkillPublishStatus
  /** Who approved this skill for the catalog */
  approvedBy?: string
  /** ISO timestamp of approval */
  approvedAt?: string
  /** Usage statistics */
  stats: SkillStats
  /** ISO timestamp */
  createdAt: string
  /** ISO timestamp */
  updatedAt: string
  /** Whether this is a global skill (vs workspace-scoped) */
  scope: 'global' | 'workspace'
  /** Workspace ID (only for workspace-scoped skills) */
  workspaceId?: string
}

export interface SkillAuthor {
  /** Author name */
  name: string
  /** Author email (optional) */
  email?: string
  /** Author URL (optional) */
  url?: string
}

export interface SkillVersion {
  /** Semantic version */
  version: string
  /** Changelog for this version */
  changelog: string
  /** ISO timestamp */
  publishedAt: string
  /** Who published this version */
  publishedBy: string
}

export type SkillPublishStatus =
  | 'draft'        // Created but not submitted for review
  | 'pending'      // Submitted for admin review
  | 'published'    // Approved and available in catalog
  | 'deprecated'   // Still available but marked as superseded
  | 'rejected'     // Admin rejected (with reason)

export type SkillCategory =
  | 'automation'   // Workflow automation, CI/CD, scripting
  | 'data'         // Data processing, analysis, transformation
  | 'integration'  // External service integrations
  | 'development'  // Code generation, review, testing
  | 'devops'       // Infrastructure, deployment, monitoring
  | 'security'     // Security scanning, compliance
  | 'blockchain'   // Blockchain, web3, smart contracts
  | 'productivity' // General productivity, notes, planning
  | 'custom'       // User-defined category

export const SKILL_CATEGORIES: { id: SkillCategory; label: string; description: string }[] = [
  { id: 'automation', label: 'Automation', description: 'Workflow automation, CI/CD, scripting' },
  { id: 'data', label: 'Data', description: 'Data processing, analysis, transformation' },
  { id: 'integration', label: 'Integration', description: 'External service integrations' },
  { id: 'development', label: 'Development', description: 'Code generation, review, testing' },
  { id: 'devops', label: 'DevOps', description: 'Infrastructure, deployment, monitoring' },
  { id: 'security', label: 'Security', description: 'Security scanning, compliance' },
  { id: 'blockchain', label: 'Blockchain', description: 'Blockchain, web3, smart contracts' },
  { id: 'productivity', label: 'Productivity', description: 'General productivity, notes, planning' },
  { id: 'custom', label: 'Custom', description: 'User-defined category' },
]

export interface SkillStats {
  /** Total number of sessions that have used this skill */
  totalUsages: number
  /** Number of unique users who have used this skill */
  uniqueUsers: number
  /** Number of workspaces that have this skill enabled */
  enabledWorkspaces: number
  /** ISO timestamp of last usage */
  lastUsedAt?: string
}

// ---------------------------------------------------------------------------
// Marketplace Operations
// ---------------------------------------------------------------------------

export interface MarketplaceListOptions {
  /** Filter by category */
  category?: SkillCategory
  /** Search query (matches name, description, tags) */
  query?: string
  /** Filter by status */
  status?: SkillPublishStatus
  /** Filter by scope */
  scope?: 'global' | 'workspace'
  /** Filter by workspace */
  workspaceId?: string
  /** Sort field */
  sortBy?: 'name' | 'usage' | 'updated' | 'created'
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
  /** Pagination */
  limit?: number
  offset?: number
}

export interface MarketplacePublishInput {
  slug: string
  version: string
  changelog: string
  category: SkillCategory
  tags: string[]
  author: SkillAuthor
  readme?: string
}

export interface MarketplaceInstallResult {
  slug: string
  version: string
  installedAt: string
  source: 'global' | 'workspace'
}

// ---------------------------------------------------------------------------
// Skill Package (for import/export)
// ---------------------------------------------------------------------------

export interface SkillPackageManifest {
  /** Package format version */
  formatVersion: 1
  /** Skill metadata */
  skill: {
    slug: string
    name: string
    description: string
    version: string
    category: SkillCategory
    tags: string[]
    author: SkillAuthor
    requiredSources: string[]
    globs?: string[]
    alwaysAllow?: string[]
    icon?: string
  }
  /** Files included in the package (relative paths) */
  files: string[]
}

/**
 * Marketplace index stored at ~/.craft-agent/enterprise/marketplace.json
 *
 * Contains metadata for all published skills across the enterprise.
 * Skills themselves remain in their original locations (global or workspace).
 */
export interface MarketplaceIndex {
  version: 1
  skills: MarketplaceSkill[]
  updatedAt: string
}

export const EMPTY_MARKETPLACE_INDEX: MarketplaceIndex = {
  version: 1,
  skills: [],
  updatedAt: new Date().toISOString(),
}

export const EMPTY_SKILL_STATS: SkillStats = {
  totalUsages: 0,
  uniqueUsers: 0,
  enabledWorkspaces: 0,
}
