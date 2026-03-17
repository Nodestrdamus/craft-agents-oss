/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata, SkillSource } from './types.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Agent Skills Paths (Issue #171)
// ============================================================

/** Global agent skills directory: ~/.agents/skills/ */
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** Project-level agent skills relative directory name */
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills';

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param slug - Skill directory name
 * @param source - Where this skill is loaded from
 */
function loadSkillFromDir(skillsDir: string, slug: string, source: SkillSource): LoadedSkill | null {
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
    source,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(skillsDir: string, source: SkillSource): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skill = loadSkillFromDir(skillsDir, entry.name, source);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillFromDir(skillsDir, slug, 'workspace');
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillsFromDir(skillsDir, 'workspace');
}

/**
 * Load all skills from all sources (global, workspace, project)
 * Skills with the same slug are overridden by higher-priority sources.
 * Priority: global (lowest) < workspace < project (highest)
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param projectRoot - Optional project root (working directory) for project-level skills
 */
export function loadAllSkills(workspaceRoot: string, projectRoot?: string): LoadedSkill[] {
  const skillsBySlug = new Map<string, LoadedSkill>();

  // 1. Global skills (lowest priority): ~/.agents/skills/
  for (const skill of loadSkillsFromDir(GLOBAL_AGENT_SKILLS_DIR, 'global')) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 2. Workspace skills (medium priority)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 3. Project skills (highest priority): {projectRoot}/.agents/skills/
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    for (const skill of loadSkillsFromDir(projectSkillsDir, 'project')) {
      skillsBySlug.set(skill.slug, skill);
    }
  }

  return Array.from(skillsBySlug.values());
}

/**
 * Load a single skill by slug from all sources (project > workspace > global).
 * Unlike loadAllSkills(), this only reads the specific slug directory — O(1) not O(N).
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug to load
 * @param projectRoot - Optional project root for project-level skills
 */
export function loadSkillBySlug(workspaceRoot: string, slug: string, projectRoot?: string): LoadedSkill | null {
  // Highest priority: project-level
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    const skill = loadSkillFromDir(projectSkillsDir, slug, 'project');
    if (skill) return skill;
  }

  // Medium priority: workspace
  const workspaceSkill = loadSkillFromDir(getWorkspaceSkillsPath(workspaceRoot), slug, 'workspace');
  if (workspaceSkill) return workspaceSkill;

  // Lowest priority: global
  return loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, slug, 'global');
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return null;
  }

  return findIconFile(skillDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return false;
  }

  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Create / Save Operations
// ============================================================

/** Input for creating or updating a skill */
export interface SaveSkillInput {
  name: string;
  description: string;
  content: string;
  globs?: string[];
  alwaysAllow?: string[];
  icon?: string;
  requiredSources?: string[];
}

/**
 * Serialize skill metadata + content into a SKILL.md file string.
 */
function serializeSkillMd(input: SaveSkillInput): string {
  const frontmatter: Record<string, unknown> = {
    name: input.name,
    description: input.description,
  };
  if (input.globs?.length) frontmatter.globs = input.globs;
  if (input.alwaysAllow?.length) frontmatter.alwaysAllow = input.alwaysAllow;
  if (input.icon) frontmatter.icon = input.icon;
  if (input.requiredSources?.length) frontmatter.requiredSources = input.requiredSources;

  return matter.stringify(input.content, frontmatter);
}

/**
 * Validate a skill slug (directory name).
 * Must be lowercase alphanumeric with hyphens, 1-64 chars.
 */
function validateSlug(slug: string): void {
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
    throw new Error(`Invalid skill slug: "${slug}". Must be lowercase alphanumeric with hyphens, 1-64 chars.`);
  }
}

/**
 * Write a skill to a specific skills directory.
 * Creates the directory and SKILL.md file.
 */
function writeSkillToDir(skillsDir: string, slug: string, input: SaveSkillInput): LoadedSkill {
  validateSlug(slug);

  const skillDir = join(skillsDir, slug);
  mkdirSync(skillDir, { recursive: true });

  const skillFile = join(skillDir, 'SKILL.md');
  writeFileSync(skillFile, serializeSkillMd(input), 'utf-8');

  // Re-load to get the canonical parsed form
  const source: SkillSource = skillsDir === GLOBAL_AGENT_SKILLS_DIR ? 'global' : 'workspace';
  const loaded = loadSkillFromDir(skillsDir, slug, source);
  if (!loaded) {
    throw new Error(`Failed to load skill after writing: ${slug}`);
  }
  return loaded;
}

/**
 * Create a new skill in a workspace.
 * @throws If a skill with that slug already exists.
 */
export function createSkill(workspaceRoot: string, slug: string, input: SaveSkillInput): LoadedSkill {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  if (existsSync(join(skillsDir, slug, 'SKILL.md'))) {
    throw new Error(`Skill already exists: ${slug}`);
  }
  return writeSkillToDir(skillsDir, slug, input);
}

/**
 * Update an existing skill in a workspace (or create if it doesn't exist).
 */
export function saveSkill(workspaceRoot: string, slug: string, input: SaveSkillInput): LoadedSkill {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return writeSkillToDir(skillsDir, slug, input);
}

// ============================================================
// Global Skills CRUD
// ============================================================

/**
 * Load all global skills (~/.agents/skills/)
 */
export function loadGlobalSkills(): LoadedSkill[] {
  return loadSkillsFromDir(GLOBAL_AGENT_SKILLS_DIR, 'global');
}

/**
 * List global skill slugs
 */
export function listGlobalSkillSlugs(): string[] {
  if (!existsSync(GLOBAL_AGENT_SKILLS_DIR)) return [];
  try {
    return readdirSync(GLOBAL_AGENT_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        return existsSync(join(GLOBAL_AGENT_SKILLS_DIR, entry.name, 'SKILL.md'));
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Create a new global skill.
 * @throws If a skill with that slug already exists.
 */
export function createGlobalSkill(slug: string, input: SaveSkillInput): LoadedSkill {
  if (existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'))) {
    throw new Error(`Global skill already exists: ${slug}`);
  }
  return writeSkillToDir(GLOBAL_AGENT_SKILLS_DIR, slug, input);
}

/**
 * Save (update or create) a global skill.
 */
export function saveGlobalSkill(slug: string, input: SaveSkillInput): LoadedSkill {
  return writeSkillToDir(GLOBAL_AGENT_SKILLS_DIR, slug, input);
}

/**
 * Delete a global skill.
 */
export function deleteGlobalSkill(slug: string): boolean {
  const skillDir = join(GLOBAL_AGENT_SKILLS_DIR, slug);
  if (!existsSync(skillDir)) return false;
  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a global skill exists.
 */
export function globalSkillExists(slug: string): boolean {
  return existsSync(join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md'));
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        return existsSync(skillFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
