/**
 * Skill Marketplace Store
 *
 * File-based marketplace index with CRUD operations.
 * Skills themselves remain in their source locations (global or workspace).
 * This module manages the catalog metadata layer.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type {
  MarketplaceIndex,
  MarketplaceSkill,
  MarketplaceListOptions,
  MarketplacePublishInput,
  SkillPublishStatus,
  SkillStats,
} from './marketplace-types'
import { EMPTY_MARKETPLACE_INDEX, EMPTY_SKILL_STATS } from './marketplace-types'
import { appendAudit } from './user-store'

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getMarketplacePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  return join(home, '.craft-agent', 'enterprise', 'marketplace.json')
}

function ensureParentDir(filePath: string): void {
  const dir = join(filePath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

// ---------------------------------------------------------------------------
// Index I/O
// ---------------------------------------------------------------------------

export function loadMarketplaceIndex(): MarketplaceIndex {
  const path = getMarketplacePath()
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw) as MarketplaceIndex
  } catch {
    return { ...EMPTY_MARKETPLACE_INDEX }
  }
}

function saveMarketplaceIndex(index: MarketplaceIndex): void {
  const path = getMarketplacePath()
  ensureParentDir(path)
  index.updatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(index, null, 2), 'utf8')
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listMarketplaceSkills(options: MarketplaceListOptions = {}): {
  skills: MarketplaceSkill[]
  total: number
} {
  const index = loadMarketplaceIndex()
  let skills = [...index.skills]

  // Filters
  if (options.category) {
    skills = skills.filter(s => s.category === options.category)
  }
  if (options.status) {
    skills = skills.filter(s => s.status === options.status)
  }
  if (options.scope) {
    skills = skills.filter(s => s.scope === options.scope)
  }
  if (options.workspaceId) {
    skills = skills.filter(s => s.workspaceId === options.workspaceId || s.scope === 'global')
  }
  if (options.query) {
    const q = options.query.toLowerCase()
    skills = skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  const total = skills.length

  // Sort
  const sortBy = options.sortBy || 'name'
  const sortOrder = options.sortOrder || 'asc'
  skills.sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name)
        break
      case 'usage':
        cmp = a.stats.totalUsages - b.stats.totalUsages
        break
      case 'updated':
        cmp = a.updatedAt.localeCompare(b.updatedAt)
        break
      case 'created':
        cmp = a.createdAt.localeCompare(b.createdAt)
        break
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  // Pagination
  if (options.offset || options.limit) {
    const offset = options.offset || 0
    const limit = options.limit || 50
    skills = skills.slice(offset, offset + limit)
  }

  return { skills, total }
}

export function getMarketplaceSkill(slug: string, scope?: 'global' | 'workspace', workspaceId?: string): MarketplaceSkill | null {
  const index = loadMarketplaceIndex()
  return index.skills.find(s => {
    if (s.slug !== slug) return false
    if (scope && s.scope !== scope) return false
    if (workspaceId && s.scope === 'workspace' && s.workspaceId !== workspaceId) return false
    return true
  }) ?? null
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Register a skill in the marketplace catalog.
 * Does NOT move or copy the skill files — just creates catalog metadata.
 */
export function publishSkill(
  input: MarketplacePublishInput & {
    scope: 'global' | 'workspace'
    workspaceId?: string
    name: string
    description: string
    requiredSources?: string[]
    globs?: string[]
    alwaysAllow?: string[]
    icon?: string
  },
  performedBy: { userId: string; email: string },
): MarketplaceSkill {
  const index = loadMarketplaceIndex()

  // Check if already exists
  const existingIdx = index.skills.findIndex(s =>
    s.slug === input.slug && s.scope === input.scope && s.workspaceId === input.workspaceId
  )

  const now = new Date().toISOString()

  if (existingIdx >= 0) {
    // Update existing
    const existing = index.skills[existingIdx]!
    existing.name = input.name
    existing.description = input.description
    existing.version = input.version
    existing.category = input.category
    existing.tags = input.tags
    existing.author = input.author
    if (input.readme) existing.readme = input.readme
    if (input.requiredSources) existing.requiredSources = input.requiredSources
    if (input.globs) existing.globs = input.globs
    if (input.alwaysAllow) existing.alwaysAllow = input.alwaysAllow
    if (input.icon) existing.icon = input.icon
    existing.status = 'published'
    existing.approvedBy = performedBy.userId
    existing.approvedAt = now
    existing.updatedAt = now
    existing.versions.push({
      version: input.version,
      changelog: input.changelog,
      publishedAt: now,
      publishedBy: performedBy.email,
    })

    saveMarketplaceIndex(index)

    appendAudit({
      action: 'skill.published',
      userId: performedBy.userId,
      userEmail: performedBy.email,
      resourceType: 'skill',
      resourceId: input.slug,
      details: { version: input.version, scope: input.scope },
    })

    return existing
  }

  // Create new
  const skill: MarketplaceSkill = {
    slug: input.slug,
    name: input.name,
    description: input.description,
    readme: input.readme || '',
    author: input.author,
    version: input.version,
    versions: [{
      version: input.version,
      changelog: input.changelog,
      publishedAt: now,
      publishedBy: performedBy.email,
    }],
    tags: input.tags,
    category: input.category,
    icon: input.icon,
    requiredSources: input.requiredSources || [],
    globs: input.globs,
    alwaysAllow: input.alwaysAllow,
    status: 'published',
    approvedBy: performedBy.userId,
    approvedAt: now,
    stats: { ...EMPTY_SKILL_STATS },
    createdAt: now,
    updatedAt: now,
    scope: input.scope,
    workspaceId: input.workspaceId,
  }

  index.skills.push(skill)
  saveMarketplaceIndex(index)

  appendAudit({
    action: 'skill.published',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'skill',
    resourceId: input.slug,
    details: { version: input.version, scope: input.scope },
  })

  return skill
}

/** Change skill publication status */
export function setSkillStatus(
  slug: string,
  status: SkillPublishStatus,
  performedBy: { userId: string; email: string },
  scope?: 'global' | 'workspace',
  workspaceId?: string,
): MarketplaceSkill {
  const index = loadMarketplaceIndex()
  const skill = index.skills.find(s => {
    if (s.slug !== slug) return false
    if (scope && s.scope !== scope) return false
    if (workspaceId && s.scope === 'workspace' && s.workspaceId !== workspaceId) return false
    return true
  })
  if (!skill) throw new Error(`Skill not found in marketplace: ${slug}`)

  skill.status = status
  skill.updatedAt = new Date().toISOString()
  saveMarketplaceIndex(index)

  return skill
}

/** Remove a skill from the marketplace catalog (does not delete skill files) */
export function unpublishSkill(
  slug: string,
  performedBy: { userId: string; email: string },
  scope?: 'global' | 'workspace',
  workspaceId?: string,
): void {
  const index = loadMarketplaceIndex()
  const idx = index.skills.findIndex(s => {
    if (s.slug !== slug) return false
    if (scope && s.scope !== scope) return false
    if (workspaceId && s.scope === 'workspace' && s.workspaceId !== workspaceId) return false
    return true
  })
  if (idx === -1) throw new Error(`Skill not found in marketplace: ${slug}`)

  index.skills.splice(idx, 1)
  saveMarketplaceIndex(index)

  appendAudit({
    action: 'skill.deleted',
    userId: performedBy.userId,
    userEmail: performedBy.email,
    resourceType: 'skill',
    resourceId: slug,
    details: { scope, workspaceId },
  })
}

/** Record a skill usage */
export function recordSkillUsage(slug: string, userId: string): void {
  const index = loadMarketplaceIndex()
  const skill = index.skills.find(s => s.slug === slug)
  if (!skill) return

  skill.stats.totalUsages++
  skill.stats.lastUsedAt = new Date().toISOString()
  // Note: uniqueUsers tracking is approximate (would need a Set persisted)
  saveMarketplaceIndex(index)
}
