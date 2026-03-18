# Fork Merge Guide

This document tracks how to keep our enterprise fork (`Nodestrdamus/craft-agents-oss`, branch `dev`) in sync with the upstream repository (`lukilabs/craft-agents-oss`, branch `main`).

## Current State

| Key | Value |
|-----|-------|
| **Fork remote** | `fork` → `https://github.com/Nodestrdamus/craft-agents-oss.git` |
| **Upstream remote** | `origin` → `https://github.com/lukilabs/craft-agents-oss.git` |
| **Fork branch** | `dev` |
| **Last synced upstream version** | `v0.7.7` (commit `ea760e8`, synced 2026-03-18) |
| **Current upstream version** | Check with `git fetch origin --tags && git tag --sort=-creatordate | head -1` |

## Setup (One-Time)

```bash
# Ensure both remotes exist
git remote -v
# Should show:
#   origin    https://github.com/lukilabs/craft-agents-oss.git (fetch/push)
#   fork      https://github.com/Nodestrdamus/craft-agents-oss.git (fetch/push)

# If missing:
git remote add origin https://github.com/lukilabs/craft-agents-oss.git
git remote add fork https://github.com/Nodestrdamus/craft-agents-oss.git
```

## Merge Workflow

Run this process within **48 hours** of each upstream release.

### Step 1: Fetch upstream

```bash
git fetch origin --tags
git log --oneline origin/main | head -5
```

### Step 2: Identify what changed

```bash
# Compare upstream changes since last sync
LAST_SYNC="v0.7.5"  # Update this to last synced tag
NEW_VERSION=$(git tag --sort=-creatordate | head -1)
echo "Merging $LAST_SYNC → $NEW_VERSION"

# Files changed upstream
git diff --name-only $LAST_SYNC..$NEW_VERSION

# Check overlap with our changes
comm -12 \
  <(git diff --name-only $LAST_SYNC..dev | sort) \
  <(git diff --name-only $LAST_SYNC..$NEW_VERSION | sort)
```

### Step 3: Merge upstream into dev

```bash
git checkout dev
git merge origin/main --no-edit
# If conflicts arise, resolve per the Conflict Zone Registry below
```

### Step 4: Resolve conflicts

See the **Conflict Zone Registry** for per-file resolution strategies.

### Step 5: Validate

```bash
bun install
bun run typecheck:shared
bun run build
# Run any smoke tests
```

### Step 6: Tag and push

```bash
# Tag the sync point
git tag "upstream-$NEW_VERSION"
git push fork dev --tags
```

### Step 7: Update this guide

Update the "Last synced upstream version" in the table above.

---

## Conflict Zone Registry

Files modified in **both** our fork and upstream. These are the primary conflict areas during merges.

### High Risk — Shared Types & Protocol

| File | Our Changes | Conflict Strategy |
|------|-------------|-------------------|
| `packages/shared/src/protocol/dto.ts` | Added `enabledSkillSlugs` to Session, CreateSessionOptions, SessionCommand, SessionEvent, WorkspaceSettings | **Keep both.** Our additions are new fields/union members. Upstream changes are usually also additive. Merge both sets of additions. |
| `packages/shared/src/protocol/channels.ts` | Added skill and global-skill RPC channels | **Keep both.** We add new channels; upstream adds theirs. Ensure no channel name collisions. |
| `packages/shared/src/sessions/types.ts` | Added `enabledSkillSlugs` to SessionConfig, SessionHeader, SESSION_PERSISTENT_FIELDS | **Keep both.** Watch for upstream adding new persistent fields — merge both arrays. |
| `packages/shared/src/workspaces/types.ts` | Added `enabledSkillSlugs` to WorkspaceConfig.defaults | **Keep both.** Additive changes on both sides. |
| `packages/shared/src/config/storage.ts` | May have minor changes from skill config | **Prefer upstream, re-apply our changes.** This file has complex validation logic upstream evolves frequently. |

### Medium Risk — Server Core

| File | Our Changes | Conflict Strategy |
|------|-------------|-------------------|
| `packages/server-core/src/sessions/SessionManager.ts` | Added `enabledSkillSlugs` to ManagedSession, `setSessionSkills()`, `getSessionSkills()`, skill resolution in `createSession()` | **Keep both.** Our changes are additive methods and fields. Watch for upstream refactoring the ManagedSession interface or createSession flow. |
| `packages/server-core/src/handlers/rpc/sessions.ts` | Added `setSkills` command case | **Keep both.** We add a new case to a switch statement. |
| `packages/server-core/src/transport/server.ts` | Added `get httpServer()` getter | **Keep both.** Single getter addition, unlikely to conflict. |
| `packages/server/src/index.ts` | Added `getSessionPath` to bootstrap options | **Keep both.** Single field addition. |

### Low Risk — New Files (No Conflicts Expected)

These are entirely new files we created. Upstream won't touch them:

| File/Directory | Purpose |
|----------------|---------|
| `packages/shared/src/auth/entra-jwt.ts` | Entra ID JWT validation |
| `packages/shared/src/auth/index.ts` | Auth barrel export |
| `packages/server-core/src/handlers/http/downloads.ts` | HTTP download endpoints |
| `packages/server-core/src/bootstrap/headless-start.ts` | Modified for dual auth + HTTP handler |
| `packages/shared/src/skills/storage.ts` | Global skills storage |
| `packages/shared/src/skills/index.ts` | Skills barrel export |
| `apps/web/*` | Entire web client scaffold |

---

## Enterprise-Only Features

Features we've added that do NOT exist upstream. Track these to ensure they survive merges.

| Feature | Key Files | Added In |
|---------|-----------|----------|
| Entra ID JWT dual auth | `shared/src/auth/entra-jwt.ts`, `headless-start.ts` | dev (2026-03-16) |
| HTTP download endpoints | `server-core/src/handlers/http/downloads.ts`, `headless-start.ts` | dev (2026-03-16) |
| Per-session skill selection | `shared/src/sessions/types.ts`, `dto.ts`, `SessionManager.ts`, `sessions.ts` | dev (2026-03-16) |
| Global Skills CRUD | `shared/src/skills/*`, `server-core/src/handlers/rpc/skills.ts` | dev (2026-03-16) |
| Web client scaffold | `apps/web/*` | dev (2026-03-16) |
| Batch Processing | `shared/src/batches/*`, `server-core/src/handlers/rpc/batches.ts` | dev (2026-03-18) |
| RBAC / Teams | TBD | TBD |

---

## Merge History

| Date | Upstream Version | Conflicts | Notes |
|------|-----------------|-----------|-------|
| 2026-03-16 | v0.7.5 | None | Initial fork point |
| 2026-03-18 | v0.7.7 | 1 (SessionManager.ts) | forceAbort→interruptForHandoff API rename. 7 files auto-merged. |

---

## Automated Alerts

A GitHub Actions workflow (`.github/workflows/upstream-sync-check.yml`) checks for new upstream releases daily and creates an issue when a new version is detected.
