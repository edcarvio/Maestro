/**
 * Agent Sessions IPC Handlers
 *
 * This module provides generic IPC handlers for agent session management
 * that work with any agent supporting the AgentSessionStorage interface.
 *
 * This is the preferred API for new code. The window.maestro.claude.* API
 * remains for backwards compatibility but logs deprecation warnings.
 *
 * Usage:
 * - window.maestro.agentSessions.list(agentId, projectPath)
 * - window.maestro.agentSessions.read(agentId, projectPath, sessionId)
 * - window.maestro.agentSessions.search(agentId, projectPath, query, mode)
 * - window.maestro.agentSessions.getGlobalStats() - aggregates from all providers
 */

import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { logger } from '../../utils/logger';
import { withIpcErrorLogging } from '../../utils/ipcHandler';
import {
  getSessionStorage,
  hasSessionStorage,
  getAllSessionStorages,
} from '../../agent-session-storage';
import { CLAUDE_PRICING } from '../../constants';
import type {
  AgentSessionInfo,
  PaginatedSessionsResult,
  SessionMessagesResult,
  SessionSearchResult,
  SessionSearchMode,
  SessionListOptions,
  SessionReadOptions,
} from '../../agent-session-storage';

const LOG_CONTEXT = '[AgentSessions]';

/**
 * Global stats aggregated from all providers
 */
export interface GlobalAgentStats {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  /** Total cost in USD - only includes providers that support cost tracking */
  totalCostUsd: number;
  /** Whether any provider contributed cost data */
  hasCostData: boolean;
  totalSizeBytes: number;
  isComplete: boolean;
  /** Per-provider breakdown */
  byProvider: Record<string, {
    sessions: number;
    messages: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    hasCostData: boolean;
  }>;
}

/**
 * Dependencies required for agent sessions handlers
 */
export interface AgentSessionsHandlerDependencies {
  getMainWindow: () => BrowserWindow | null;
}

/**
 * Helper function to create consistent handler options
 */
function handlerOpts(operation: string) {
  return { context: LOG_CONTEXT, operation, logSuccess: false };
}

/**
 * Calculate cost for Claude sessions based on token counts
 */
function calculateClaudeCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens: number
): number {
  const inputCost = (inputTokens / 1_000_000) * CLAUDE_PRICING.INPUT_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * CLAUDE_PRICING.OUTPUT_PER_MILLION;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * CLAUDE_PRICING.CACHE_READ_PER_MILLION;
  const cacheCreationCost = (cacheCreationTokens / 1_000_000) * CLAUDE_PRICING.CACHE_CREATION_PER_MILLION;
  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}

/**
 * Scan Claude Code sessions from ~/.claude/projects/
 */
async function scanClaudeSessions(): Promise<{
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  sizeBytes: number;
}> {
  const homeDir = os.homedir();
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

  const totals = {
    sessions: 0,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    sizeBytes: 0,
  };

  try {
    await fs.access(claudeProjectsDir);
  } catch {
    return totals;
  }

  const projectDirs = await fs.readdir(claudeProjectsDir);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(claudeProjectsDir, projectDir);
    try {
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) continue;

      const files = await fs.readdir(projectPath);
      const sessionFiles = files.filter((f) => f.endsWith('.jsonl'));

      for (const filename of sessionFiles) {
        const filePath = path.join(projectPath, filename);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const fileStat = await fs.stat(filePath);

          // Count messages
          const userMessageCount = (content.match(/"type"\s*:\s*"user"/g) || []).length;
          const assistantMessageCount = (content.match(/"type"\s*:\s*"assistant"/g) || []).length;

          // Extract tokens
          let inputTokens = 0;
          let outputTokens = 0;
          let cacheReadTokens = 0;
          let cacheCreationTokens = 0;

          const inputMatches = content.matchAll(/"input_tokens"\s*:\s*(\d+)/g);
          for (const m of inputMatches) inputTokens += parseInt(m[1], 10);

          const outputMatches = content.matchAll(/"output_tokens"\s*:\s*(\d+)/g);
          for (const m of outputMatches) outputTokens += parseInt(m[1], 10);

          const cacheReadMatches = content.matchAll(/"cache_read_input_tokens"\s*:\s*(\d+)/g);
          for (const m of cacheReadMatches) cacheReadTokens += parseInt(m[1], 10);

          const cacheCreationMatches = content.matchAll(/"cache_creation_input_tokens"\s*:\s*(\d+)/g);
          for (const m of cacheCreationMatches) cacheCreationTokens += parseInt(m[1], 10);

          totals.sessions++;
          totals.messages += userMessageCount + assistantMessageCount;
          totals.inputTokens += inputTokens;
          totals.outputTokens += outputTokens;
          totals.cacheReadTokens += cacheReadTokens;
          totals.cacheCreationTokens += cacheCreationTokens;
          totals.sizeBytes += fileStat.size;
        } catch {
          // Skip files that can't be read
        }
      }
    } catch {
      // Skip directories we can't access
    }
  }

  return totals;
}

/**
 * Scan Codex sessions from ~/.codex/sessions/
 */
async function scanCodexSessions(): Promise<{
  sessions: number;
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  sizeBytes: number;
}> {
  const homeDir = os.homedir();
  const codexSessionsDir = path.join(homeDir, '.codex', 'sessions');

  const totals = {
    sessions: 0,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    sizeBytes: 0,
  };

  try {
    await fs.access(codexSessionsDir);
  } catch {
    return totals;
  }

  // Scan YYYY/MM/DD directory structure
  const years = await fs.readdir(codexSessionsDir);
  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(codexSessionsDir, year);

    try {
      const yearStat = await fs.stat(yearDir);
      if (!yearStat.isDirectory()) continue;

      const months = await fs.readdir(yearDir);
      for (const month of months) {
        if (!/^\d{2}$/.test(month)) continue;
        const monthDir = path.join(yearDir, month);

        try {
          const monthStat = await fs.stat(monthDir);
          if (!monthStat.isDirectory()) continue;

          const days = await fs.readdir(monthDir);
          for (const day of days) {
            if (!/^\d{2}$/.test(day)) continue;
            const dayDir = path.join(monthDir, day);

            try {
              const dayStat = await fs.stat(dayDir);
              if (!dayStat.isDirectory()) continue;

              const files = await fs.readdir(dayDir);
              for (const file of files) {
                if (!file.endsWith('.jsonl')) continue;
                const filePath = path.join(dayDir, file);

                try {
                  const content = await fs.readFile(filePath, 'utf-8');
                  const fileStat = await fs.stat(filePath);
                  const lines = content.split('\n').filter((l) => l.trim());

                  let messageCount = 0;
                  let inputTokens = 0;
                  let outputTokens = 0;
                  let cachedTokens = 0;

                  for (const line of lines) {
                    try {
                      const entry = JSON.parse(line);

                      // Count messages
                      if (entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant')) {
                        messageCount++;
                      }
                      if (entry.type === 'item.completed' && entry.item?.type === 'agent_message') {
                        messageCount++;
                      }

                      // Extract usage from turn.completed
                      if (entry.type === 'turn.completed' && entry.usage) {
                        inputTokens += entry.usage.input_tokens || 0;
                        outputTokens += entry.usage.output_tokens || 0;
                        outputTokens += entry.usage.reasoning_output_tokens || 0;
                        cachedTokens += entry.usage.cached_input_tokens || 0;
                      }
                    } catch {
                      // Skip malformed lines
                    }
                  }

                  totals.sessions++;
                  totals.messages += messageCount;
                  totals.inputTokens += inputTokens;
                  totals.outputTokens += outputTokens;
                  totals.cachedTokens += cachedTokens;
                  totals.sizeBytes += fileStat.size;
                } catch {
                  // Skip files that can't be read
                }
              }
            } catch {
              continue;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return totals;
}

/**
 * Register all agent sessions IPC handlers.
 */
export function registerAgentSessionsHandlers(deps?: AgentSessionsHandlerDependencies): void {
  const getMainWindow = deps?.getMainWindow;
  // ============ List Sessions ============

  ipcMain.handle(
    'agentSessions:list',
    withIpcErrorLogging(
      handlerOpts('list'),
      async (agentId: string, projectPath: string): Promise<AgentSessionInfo[]> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return [];
        }

        const sessions = await storage.listSessions(projectPath);
        logger.info(
          `Listed ${sessions.length} sessions for agent ${agentId} at ${projectPath}`,
          LOG_CONTEXT
        );
        return sessions;
      }
    )
  );

  // ============ List Sessions Paginated ============

  ipcMain.handle(
    'agentSessions:listPaginated',
    withIpcErrorLogging(
      handlerOpts('listPaginated'),
      async (
        agentId: string,
        projectPath: string,
        options?: SessionListOptions
      ): Promise<PaginatedSessionsResult> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return { sessions: [], hasMore: false, totalCount: 0, nextCursor: null };
        }

        const result = await storage.listSessionsPaginated(projectPath, options);
        logger.info(
          `Listed paginated sessions for agent ${agentId}: ${result.sessions.length} of ${result.totalCount}`,
          LOG_CONTEXT
        );
        return result;
      }
    )
  );

  // ============ Read Session Messages ============

  ipcMain.handle(
    'agentSessions:read',
    withIpcErrorLogging(
      handlerOpts('read'),
      async (
        agentId: string,
        projectPath: string,
        sessionId: string,
        options?: SessionReadOptions
      ): Promise<SessionMessagesResult> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return { messages: [], total: 0, hasMore: false };
        }

        const result = await storage.readSessionMessages(projectPath, sessionId, options);
        logger.info(
          `Read ${result.messages.length} messages for session ${sessionId} (agent: ${agentId})`,
          LOG_CONTEXT
        );
        return result;
      }
    )
  );

  // ============ Search Sessions ============

  ipcMain.handle(
    'agentSessions:search',
    withIpcErrorLogging(
      handlerOpts('search'),
      async (
        agentId: string,
        projectPath: string,
        query: string,
        searchMode: SessionSearchMode
      ): Promise<SessionSearchResult[]> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return [];
        }

        const results = await storage.searchSessions(projectPath, query, searchMode);
        logger.info(
          `Found ${results.length} matching sessions for query "${query}" (agent: ${agentId})`,
          LOG_CONTEXT
        );
        return results;
      }
    )
  );

  // ============ Get Session Path ============

  ipcMain.handle(
    'agentSessions:getPath',
    withIpcErrorLogging(
      handlerOpts('getPath'),
      async (agentId: string, projectPath: string, sessionId: string): Promise<string | null> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return null;
        }

        return storage.getSessionPath(projectPath, sessionId);
      }
    )
  );

  // ============ Delete Message Pair ============

  ipcMain.handle(
    'agentSessions:deleteMessagePair',
    withIpcErrorLogging(
      handlerOpts('deleteMessagePair'),
      async (
        agentId: string,
        projectPath: string,
        sessionId: string,
        userMessageUuid: string,
        fallbackContent?: string
      ): Promise<{ success: boolean; error?: string; linesRemoved?: number }> => {
        const storage = getSessionStorage(agentId);
        if (!storage) {
          logger.warn(`No session storage available for agent: ${agentId}`, LOG_CONTEXT);
          return { success: false, error: `No session storage available for agent: ${agentId}` };
        }

        return storage.deleteMessagePair(projectPath, sessionId, userMessageUuid, fallbackContent);
      }
    )
  );

  // ============ Check Storage Availability ============

  ipcMain.handle(
    'agentSessions:hasStorage',
    withIpcErrorLogging(handlerOpts('hasStorage'), async (agentId: string): Promise<boolean> => {
      return hasSessionStorage(agentId);
    })
  );

  // ============ Get Available Storages ============

  ipcMain.handle(
    'agentSessions:getAvailableStorages',
    withIpcErrorLogging(handlerOpts('getAvailableStorages'), async (): Promise<string[]> => {
      const storages = getAllSessionStorages();
      return storages.map((s) => s.agentId);
    })
  );

  // ============ Get All Named Sessions ============

  ipcMain.handle(
    'agentSessions:getAllNamedSessions',
    withIpcErrorLogging(
      handlerOpts('getAllNamedSessions'),
      async (): Promise<
        Array<{
          agentSessionId: string;
          projectPath: string;
          sessionName: string;
          starred?: boolean;
          lastActivityAt?: number;
        }>
      > => {
        // Aggregate named sessions from all providers that support it
        const allNamedSessions: Array<{
          agentSessionId: string;
          projectPath: string;
          sessionName: string;
          starred?: boolean;
          lastActivityAt?: number;
        }> = [];

        const storages = getAllSessionStorages();
        for (const storage of storages) {
          if ('getAllNamedSessions' in storage && typeof storage.getAllNamedSessions === 'function') {
            try {
              const sessions = await storage.getAllNamedSessions();
              allNamedSessions.push(...sessions);
            } catch (error) {
              logger.warn(
                `Failed to get named sessions from ${storage.agentId}: ${error}`,
                LOG_CONTEXT
              );
            }
          }
        }

        logger.info(`Found ${allNamedSessions.length} named sessions across all providers`, LOG_CONTEXT);
        return allNamedSessions;
      }
    )
  );

  // ============ Get Global Stats (All Providers) ============

  ipcMain.handle(
    'agentSessions:getGlobalStats',
    withIpcErrorLogging(
      handlerOpts('getGlobalStats'),
      async (): Promise<GlobalAgentStats> => {
        const mainWindow = getMainWindow?.();

        // Helper to send progressive updates
        const sendUpdate = (stats: GlobalAgentStats) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agentSessions:globalStatsUpdate', stats);
          }
        };

        // Initialize result
        const result: GlobalAgentStats = {
          totalSessions: 0,
          totalMessages: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheCreationTokens: 0,
          totalCostUsd: 0,
          hasCostData: false,
          totalSizeBytes: 0,
          isComplete: false,
          byProvider: {},
        };

        // Scan Claude Code sessions
        logger.info('Scanning Claude Code sessions for global stats', LOG_CONTEXT);
        const claudeStats = await scanClaudeSessions();
        const claudeCost = calculateClaudeCost(
          claudeStats.inputTokens,
          claudeStats.outputTokens,
          claudeStats.cacheReadTokens,
          claudeStats.cacheCreationTokens
        );

        result.byProvider['claude-code'] = {
          sessions: claudeStats.sessions,
          messages: claudeStats.messages,
          inputTokens: claudeStats.inputTokens,
          outputTokens: claudeStats.outputTokens,
          costUsd: claudeCost,
          hasCostData: true, // Claude supports cost tracking
        };

        result.totalSessions += claudeStats.sessions;
        result.totalMessages += claudeStats.messages;
        result.totalInputTokens += claudeStats.inputTokens;
        result.totalOutputTokens += claudeStats.outputTokens;
        result.totalCacheReadTokens += claudeStats.cacheReadTokens;
        result.totalCacheCreationTokens += claudeStats.cacheCreationTokens;
        result.totalCostUsd += claudeCost;
        result.totalSizeBytes += claudeStats.sizeBytes;
        if (claudeStats.sessions > 0) {
          result.hasCostData = true;
        }

        // Send intermediate update
        sendUpdate({ ...result });

        // Scan Codex sessions
        logger.info('Scanning Codex sessions for global stats', LOG_CONTEXT);
        const codexStats = await scanCodexSessions();

        result.byProvider['codex'] = {
          sessions: codexStats.sessions,
          messages: codexStats.messages,
          inputTokens: codexStats.inputTokens,
          outputTokens: codexStats.outputTokens,
          costUsd: 0, // Codex doesn't have pricing - varies by model
          hasCostData: false,
        };

        result.totalSessions += codexStats.sessions;
        result.totalMessages += codexStats.messages;
        result.totalInputTokens += codexStats.inputTokens;
        result.totalOutputTokens += codexStats.outputTokens;
        result.totalCacheReadTokens += codexStats.cachedTokens;
        result.totalSizeBytes += codexStats.sizeBytes;

        // Mark as complete
        result.isComplete = true;

        logger.info(
          `Global stats complete: ${result.totalSessions} sessions, ${result.totalMessages} messages, $${result.totalCostUsd.toFixed(2)} (from providers with pricing)`,
          LOG_CONTEXT
        );

        // Send final update
        sendUpdate(result);

        return result;
      }
    )
  );
}
