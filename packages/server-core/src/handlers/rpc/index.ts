import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerSettingsHandlers } from './settings'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerBatchHandlers } from './batches'
import { registerEnterpriseHandlers } from './enterprise'
import { registerMarketplaceHandlers } from './marketplace'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerWorkspaceMemoryHandlers } from './workspace-memory'
import { registerNotesHandlers } from './notes'
import { registerI18nHandlers } from './i18n'

export function registerCoreRpcHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerAuthHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  registerSettingsHandlers(server, deps)
  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerBatchHandlers(server, deps)
  registerEnterpriseHandlers(server, deps)
  registerMarketplaceHandlers(server, deps)
  registerWorkspaceCoreHandlers(server, deps)
  registerWorkspaceMemoryHandlers(server, deps)
  registerNotesHandlers(server, deps)
  registerI18nHandlers(server, deps)
}
