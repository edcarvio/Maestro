/**
 * Type definitions for the stats tracking system
 *
 * These types are shared between main process (stats-db.ts) and renderer (dashboard).
 */

/**
 * A single AI query event - represents one user/auto message -> AI response cycle
 */
export interface QueryEvent {
  id: string;
  sessionId: string;
  agentType: string;
  source: 'user' | 'auto';
  startTime: number;
  duration: number;
  projectPath?: string;
  tabId?: string;
}

/**
 * An Auto Run session - a complete batch processing run of a document
 */
export interface AutoRunSession {
  id: string;
  sessionId: string;
  agentType: string;
  documentPath?: string;
  startTime: number;
  duration: number;
  tasksTotal?: number;
  tasksCompleted?: number;
  projectPath?: string;
}

/**
 * A single task within an Auto Run session
 */
export interface AutoRunTask {
  id: string;
  autoRunSessionId: string;
  sessionId: string;
  agentType: string;
  taskIndex: number;
  taskContent?: string;
  startTime: number;
  duration: number;
  success: boolean;
}

/**
 * Time range for querying stats
 */
export type StatsTimeRange = 'day' | 'week' | 'month' | 'year' | 'all';

/**
 * Aggregated stats for dashboard display
 */
export interface StatsAggregation {
  totalQueries: number;
  totalDuration: number;
  avgDuration: number;
  byAgent: Record<string, { count: number; duration: number }>;
  bySource: { user: number; auto: number };
  byDay: Array<{ date: string; count: number; duration: number }>;
}

/**
 * Filters for querying stats
 */
export interface StatsFilters {
  agentType?: string;
  source?: 'user' | 'auto';
  projectPath?: string;
  sessionId?: string;
}

/**
 * Database schema version for migrations
 */
export const STATS_DB_VERSION = 1;
