/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  loadSkillBySlug,
  getSkillIconPath,
  createSkill,
  saveSkill,
  deleteSkill,
  skillExists,
  listSkillSlugs,
  loadGlobalSkills,
  listGlobalSkillSlugs,
  createGlobalSkill,
  saveGlobalSkill,
  deleteGlobalSkill,
  globalSkillExists,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';
export type { SaveSkillInput } from './storage.ts';
