/**
 * Skill Marketplace RPC Handlers
 *
 * Catalog browsing, publishing, and management for the skill marketplace.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  listMarketplaceSkills,
  getMarketplaceSkill,
  publishSkill,
  unpublishSkill,
  setSkillStatus,
  SKILL_CATEGORIES,
  type MarketplaceListOptions,
  type MarketplacePublishInput,
  type SkillPublishStatus,
  type SkillCategory,
  type SkillAuthor,
} from '@craft-agent/shared/enterprise'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.marketplace.LIST,
  RPC_CHANNELS.marketplace.GET,
  RPC_CHANNELS.marketplace.PUBLISH,
  RPC_CHANNELS.marketplace.UNPUBLISH,
  RPC_CHANNELS.marketplace.SET_STATUS,
  RPC_CHANNELS.marketplace.GET_CATEGORIES,
] as const

function getPerformer(ctx: any): { userId: string; email: string } {
  if (ctx.authContext?.user) {
    return { userId: ctx.authContext.user.id, email: ctx.authContext.user.email }
  }
  return { userId: 'system', email: 'system@local' }
}

export function registerMarketplaceHandlers(server: RpcServer, deps: HandlerDeps): void {
  // List skills in the marketplace (with filtering, sorting, pagination)
  server.handle(RPC_CHANNELS.marketplace.LIST, async (_ctx, options?: MarketplaceListOptions) => {
    return listMarketplaceSkills(options ?? {})
  })

  // Get a single marketplace skill by slug
  server.handle(RPC_CHANNELS.marketplace.GET, async (_ctx, slug: string, scope?: 'global' | 'workspace', workspaceId?: string) => {
    const skill = getMarketplaceSkill(slug, scope, workspaceId)
    if (!skill) throw new Error(`Marketplace skill not found: ${slug}`)
    return skill
  })

  // Publish a skill to the marketplace (admin only via CHANNEL_PERMISSIONS)
  server.handle(RPC_CHANNELS.marketplace.PUBLISH, async (ctx, input: MarketplacePublishInput & {
    scope: 'global' | 'workspace'
    workspaceId?: string
    name: string
    description: string
    requiredSources?: string[]
    globs?: string[]
    alwaysAllow?: string[]
    icon?: string
  }) => {
    const performer = getPerformer(ctx)
    const skill = publishSkill(input, performer)
    deps.platform.logger?.info(`[marketplace] Published skill: ${input.slug} v${input.version}`)
    return skill
  })

  // Remove a skill from the marketplace (admin only)
  server.handle(RPC_CHANNELS.marketplace.UNPUBLISH, async (ctx, slug: string, scope?: 'global' | 'workspace', workspaceId?: string) => {
    const performer = getPerformer(ctx)
    unpublishSkill(slug, performer, scope, workspaceId)
    deps.platform.logger?.info(`[marketplace] Unpublished skill: ${slug}`)
    return { success: true }
  })

  // Change skill status (published → deprecated, etc.)
  server.handle(RPC_CHANNELS.marketplace.SET_STATUS, async (ctx, slug: string, status: SkillPublishStatus, scope?: 'global' | 'workspace', workspaceId?: string) => {
    const performer = getPerformer(ctx)
    return setSkillStatus(slug, status, performer, scope, workspaceId)
  })

  // Get available skill categories
  server.handle(RPC_CHANNELS.marketplace.GET_CATEGORIES, async () => {
    return SKILL_CATEGORIES
  })
}
