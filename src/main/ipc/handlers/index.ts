/**
 * IPC Handler Registration Module
 *
 * This module consolidates all IPC handler registrations, extracted from the main index.ts
 * to improve code organization and maintainability.
 *
 * Each handler module exports a register function that sets up the relevant ipcMain.handle calls.
 */

import { BrowserWindow, App } from 'electron';
import Store from 'electron-store';
import { registerGitHandlers } from './git';
import { registerAutorunHandlers } from './autorun';
import { registerPlaybooksHandlers } from './playbooks';
import { registerHistoryHandlers, HistoryHandlerDependencies } from './history';
import { registerAgentsHandlers, AgentsHandlerDependencies } from './agents';
import { registerProcessHandlers, ProcessHandlerDependencies } from './process';
import { registerPersistenceHandlers, PersistenceHandlerDependencies, MaestroSettings, SessionsData, GroupsData } from './persistence';
import { HistoryEntry } from '../../../shared/types';
import { AgentDetector } from '../../agent-detector';
import { ProcessManager } from '../../process-manager';
import { WebServer } from '../../web-server';

// Re-export individual handlers for selective registration
export { registerGitHandlers };
export { registerAutorunHandlers };
export { registerPlaybooksHandlers };
export { registerHistoryHandlers };
export { registerAgentsHandlers };
export { registerProcessHandlers };
export { registerPersistenceHandlers };
export type { HistoryHandlerDependencies };
export type { AgentsHandlerDependencies };
export type { ProcessHandlerDependencies };
export type { PersistenceHandlerDependencies };
export type { MaestroSettings, SessionsData, GroupsData };

/**
 * Interface for history store data (matches main/index.ts definition)
 */
interface HistoryData {
  entries: HistoryEntry[];
}

/**
 * Interface for agent configuration store data
 */
interface AgentConfigsData {
  configs: Record<string, Record<string, any>>;
}

/**
 * Dependencies required for handler registration
 */
export interface HandlerDependencies {
  mainWindow: BrowserWindow | null;
  getMainWindow: () => BrowserWindow | null;
  app: App;
  // History-specific dependencies
  historyStore: Store<HistoryData>;
  getHistoryNeedsReload: () => boolean;
  setHistoryNeedsReload: (value: boolean) => void;
  // Agents-specific dependencies
  getAgentDetector: () => AgentDetector | null;
  agentConfigsStore: Store<AgentConfigsData>;
  // Process-specific dependencies
  getProcessManager: () => ProcessManager | null;
  settingsStore: Store<MaestroSettings>;
  // Persistence-specific dependencies
  sessionsStore: Store<SessionsData>;
  groupsStore: Store<GroupsData>;
  getWebServer: () => WebServer | null;
}

/**
 * Register all IPC handlers.
 * Call this once during app initialization.
 */
export function registerAllHandlers(deps: HandlerDependencies): void {
  registerGitHandlers();
  registerAutorunHandlers(deps);
  registerPlaybooksHandlers(deps);
  registerHistoryHandlers({
    historyStore: deps.historyStore,
    getHistoryNeedsReload: deps.getHistoryNeedsReload,
    setHistoryNeedsReload: deps.setHistoryNeedsReload,
  });
  registerAgentsHandlers({
    getAgentDetector: deps.getAgentDetector,
    agentConfigsStore: deps.agentConfigsStore,
  });
  registerProcessHandlers({
    getProcessManager: deps.getProcessManager,
    getAgentDetector: deps.getAgentDetector,
    agentConfigsStore: deps.agentConfigsStore,
    settingsStore: deps.settingsStore,
  });
  registerPersistenceHandlers({
    settingsStore: deps.settingsStore,
    sessionsStore: deps.sessionsStore,
    groupsStore: deps.groupsStore,
    getWebServer: deps.getWebServer,
  });
  // Future handlers will be registered here:
  // registerSystemHandlers();
}
