/**
 * SettingsPanel — workspace settings, sources, skills management.
 */

import { useState, useEffect } from 'react'
import { useApiOptional } from '../hooks/useApi'
import { useAtomValue } from 'jotai'
import { activeWorkspaceIdAtom } from '../lib/atoms'

type SettingsTab = 'sources' | 'skills' | 'llm'

interface Source {
  slug: string
  name?: string
  type?: string
  status?: string
}

interface Skill {
  slug: string
  name?: string
  description?: string
  isGlobal?: boolean
}

export function SettingsPanel() {
  const [tab, setTab] = useState<SettingsTab>('sources')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">Settings</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-4 text-sm">
        {(['sources', 'skills', 'llm'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 capitalize transition-colors ${
              tab === t
                ? 'text-accent border-b-2 border-accent font-medium'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {t === 'llm' ? 'LLM Connections' : t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'sources' && <SourcesList />}
        {tab === 'skills' && <SkillsList />}
        {tab === 'llm' && <LlmConnectionsList />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function SourcesList() {
  const api = useApiOptional()
  const workspaceId = useAtomValue(activeWorkspaceIdAtom)
  const [sources, setSources] = useState<Source[]>([])

  useEffect(() => {
    if (!api || !workspaceId) return
    api.getSources(workspaceId).then((result) => {
      setSources(result as Source[])
    }).catch(console.error)
  }, [api, workspaceId])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Data Sources</h3>
        <span className="text-xs text-muted">{sources.length} configured</span>
      </div>

      {sources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          No sources configured. Sources connect to external APIs and services.
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map(source => (
            <div
              key={source.slug}
              className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-hover transition-colors"
            >
              <div>
                <p className="text-sm font-medium">{source.name ?? source.slug}</p>
                <p className="text-xs text-muted">{source.type ?? 'mcp'}</p>
              </div>
              <div className={`w-2 h-2 rounded-full ${
                source.status === 'connected' ? 'bg-green-500' : 'bg-muted'
              }`} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function SkillsList() {
  const api = useApiOptional()
  const workspaceId = useAtomValue(activeWorkspaceIdAtom)
  const [skills, setSkills] = useState<Skill[]>([])
  const [globalSkills, setGlobalSkills] = useState<Skill[]>([])

  useEffect(() => {
    if (!api || !workspaceId) return
    api.getSkills(workspaceId).then((result) => {
      setSkills(result as Skill[])
    }).catch(console.error)

    api.getGlobalSkills().then((result) => {
      setGlobalSkills(result as Skill[])
    }).catch(console.error)
  }, [api, workspaceId])

  const allSkills = [...skills.map(s => ({ ...s, isGlobal: false })), ...globalSkills.map(s => ({ ...s, isGlobal: true }))]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Skills</h3>
        <span className="text-xs text-muted">{allSkills.length} available</span>
      </div>

      {allSkills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
          No skills configured. Skills teach the agent specialized behaviors.
        </div>
      ) : (
        <div className="space-y-2">
          {allSkills.map(skill => (
            <div
              key={skill.slug}
              className="rounded-lg border border-border p-3 hover:bg-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{skill.name ?? skill.slug}</p>
                {skill.isGlobal && (
                  <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                    Global
                  </span>
                )}
              </div>
              {skill.description && (
                <p className="text-xs text-muted mt-1">{skill.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LLM Connections
// ---------------------------------------------------------------------------

function LlmConnectionsList() {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">LLM Connections</h3>
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
        LLM connection management will be available here. Configure API keys, models, and provider settings.
      </div>
    </div>
  )
}
