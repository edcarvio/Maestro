/**
 * Tests for stats-db.ts
 *
 * Note: better-sqlite3 is a native module compiled for Electron's Node version.
 * Direct testing with the native module in vitest is not possible without
 * electron-rebuild for the vitest runtime. These tests use mocked database
 * operations to verify the logic without requiring the actual native module.
 *
 * For full integration testing of the SQLite database, use the Electron test
 * environment (e2e tests) where the native module is properly loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Store mock references so they can be accessed in tests
const mockStatement = {
  run: vi.fn(() => ({ changes: 1 })),
  get: vi.fn(() => ({ count: 0, total_duration: 0 })),
  all: vi.fn(() => []),
};

const mockDb = {
  pragma: vi.fn(() => [{ user_version: 0 }]),
  prepare: vi.fn(() => mockStatement),
  close: vi.fn(),
};

// Mock better-sqlite3 as a class
vi.mock('better-sqlite3', () => {
  return {
    default: class MockDatabase {
      pragma = mockDb.pragma;
      prepare = mockDb.prepare;
      close = mockDb.close;
    },
  };
});

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'maestro-test-stats-db')),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// Mock logger
vi.mock('../../main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import types only - we'll test the type definitions
import type {
  QueryEvent,
  AutoRunSession,
  AutoRunTask,
  StatsTimeRange,
  StatsFilters,
  StatsAggregation,
} from '../../shared/stats-types';

describe('stats-types.ts', () => {
  describe('QueryEvent interface', () => {
    it('should define proper QueryEvent structure', () => {
      const event: QueryEvent = {
        id: 'test-id',
        sessionId: 'session-1',
        agentType: 'claude-code',
        source: 'user',
        startTime: Date.now(),
        duration: 5000,
        projectPath: '/test/project',
        tabId: 'tab-1',
      };

      expect(event.id).toBe('test-id');
      expect(event.sessionId).toBe('session-1');
      expect(event.source).toBe('user');
    });

    it('should allow optional fields to be undefined', () => {
      const event: QueryEvent = {
        id: 'test-id',
        sessionId: 'session-1',
        agentType: 'claude-code',
        source: 'auto',
        startTime: Date.now(),
        duration: 3000,
      };

      expect(event.projectPath).toBeUndefined();
      expect(event.tabId).toBeUndefined();
    });
  });

  describe('AutoRunSession interface', () => {
    it('should define proper AutoRunSession structure', () => {
      const session: AutoRunSession = {
        id: 'auto-run-1',
        sessionId: 'session-1',
        agentType: 'claude-code',
        documentPath: '/docs/task.md',
        startTime: Date.now(),
        duration: 60000,
        tasksTotal: 5,
        tasksCompleted: 3,
        projectPath: '/test/project',
      };

      expect(session.id).toBe('auto-run-1');
      expect(session.tasksTotal).toBe(5);
      expect(session.tasksCompleted).toBe(3);
    });
  });

  describe('AutoRunTask interface', () => {
    it('should define proper AutoRunTask structure', () => {
      const task: AutoRunTask = {
        id: 'task-1',
        autoRunSessionId: 'auto-run-1',
        sessionId: 'session-1',
        agentType: 'claude-code',
        taskIndex: 0,
        taskContent: 'First task content',
        startTime: Date.now(),
        duration: 10000,
        success: true,
      };

      expect(task.id).toBe('task-1');
      expect(task.taskIndex).toBe(0);
      expect(task.success).toBe(true);
    });

    it('should handle failed tasks', () => {
      const task: AutoRunTask = {
        id: 'task-2',
        autoRunSessionId: 'auto-run-1',
        sessionId: 'session-1',
        agentType: 'claude-code',
        taskIndex: 1,
        startTime: Date.now(),
        duration: 5000,
        success: false,
      };

      expect(task.success).toBe(false);
      expect(task.taskContent).toBeUndefined();
    });
  });

  describe('StatsTimeRange type', () => {
    it('should accept valid time ranges', () => {
      const ranges: StatsTimeRange[] = ['day', 'week', 'month', 'year', 'all'];

      expect(ranges).toHaveLength(5);
      expect(ranges).toContain('day');
      expect(ranges).toContain('all');
    });
  });

  describe('StatsFilters interface', () => {
    it('should allow partial filters', () => {
      const filters1: StatsFilters = { agentType: 'claude-code' };
      const filters2: StatsFilters = { source: 'user' };
      const filters3: StatsFilters = { agentType: 'opencode', source: 'auto', projectPath: '/test' };

      expect(filters1.agentType).toBe('claude-code');
      expect(filters2.source).toBe('user');
      expect(filters3.projectPath).toBe('/test');
    });
  });

  describe('StatsAggregation interface', () => {
    it('should define proper aggregation structure', () => {
      const aggregation: StatsAggregation = {
        totalQueries: 100,
        totalDuration: 500000,
        avgDuration: 5000,
        byAgent: {
          'claude-code': { count: 70, duration: 350000 },
          opencode: { count: 30, duration: 150000 },
        },
        bySource: { user: 60, auto: 40 },
        byDay: [
          { date: '2024-01-01', count: 10, duration: 50000 },
          { date: '2024-01-02', count: 15, duration: 75000 },
        ],
      };

      expect(aggregation.totalQueries).toBe(100);
      expect(aggregation.byAgent['claude-code'].count).toBe(70);
      expect(aggregation.bySource.user).toBe(60);
      expect(aggregation.byDay).toHaveLength(2);
    });
  });
});

describe('StatsDB class (mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.pragma.mockReturnValue([{ user_version: 0 }]);
    mockDb.prepare.mockReturnValue(mockStatement);
    mockStatement.run.mockReturnValue({ changes: 1 });
    mockStatement.get.mockReturnValue({ count: 0, total_duration: 0 });
    mockStatement.all.mockReturnValue([]);
  });

  describe('module exports', () => {
    it('should export StatsDB class', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      expect(StatsDB).toBeDefined();
      expect(typeof StatsDB).toBe('function');
    });

    it('should export singleton functions', async () => {
      const { getStatsDB, initializeStatsDB, closeStatsDB } = await import('../../main/stats-db');
      expect(getStatsDB).toBeDefined();
      expect(initializeStatsDB).toBeDefined();
      expect(closeStatsDB).toBeDefined();
    });
  });

  describe('StatsDB instantiation', () => {
    it('should create instance without initialization', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      expect(db).toBeDefined();
      expect(db.isReady()).toBe(false);
    });

    it('should return database path', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      expect(db.getDbPath()).toContain('stats.db');
    });
  });

  describe('initialization', () => {
    it('should initialize database and set isReady to true', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      db.initialize();

      expect(db.isReady()).toBe(true);
    });

    it('should enable WAL mode', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      db.initialize();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('should run v1 migration for fresh database', async () => {
      mockDb.pragma.mockImplementation((sql: string) => {
        if (sql === 'user_version') return [{ user_version: 0 }];
        return undefined;
      });

      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();
      db.initialize();

      // Should set user_version to 1
      expect(mockDb.pragma).toHaveBeenCalledWith('user_version = 1');
    });

    it('should skip migration for already migrated database', async () => {
      mockDb.pragma.mockImplementation((sql: string) => {
        if (sql === 'user_version') return [{ user_version: 1 }];
        return undefined;
      });

      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();
      db.initialize();

      // Should NOT set user_version (no migration needed)
      expect(mockDb.pragma).not.toHaveBeenCalledWith('user_version = 1');
    });
  });

  describe('error handling', () => {
    it('should throw when calling insertQueryEvent before initialization', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      expect(() =>
        db.insertQueryEvent({
          sessionId: 'test',
          agentType: 'claude-code',
          source: 'user',
          startTime: Date.now(),
          duration: 1000,
        })
      ).toThrow('Database not initialized');
    });

    it('should throw when calling getQueryEvents before initialization', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      expect(() => db.getQueryEvents('day')).toThrow('Database not initialized');
    });

    it('should throw when calling getAggregatedStats before initialization', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();

      expect(() => db.getAggregatedStats('week')).toThrow('Database not initialized');
    });
  });

  describe('query events', () => {
    it('should insert a query event and return an id', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();
      db.initialize();

      const eventId = db.insertQueryEvent({
        sessionId: 'session-1',
        agentType: 'claude-code',
        source: 'user',
        startTime: Date.now(),
        duration: 5000,
        projectPath: '/test/project',
        tabId: 'tab-1',
      });

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe('string');
      expect(mockStatement.run).toHaveBeenCalled();
    });

    it('should retrieve query events within time range', async () => {
      mockStatement.all.mockReturnValue([
        {
          id: 'event-1',
          session_id: 'session-1',
          agent_type: 'claude-code',
          source: 'user',
          start_time: Date.now(),
          duration: 5000,
          project_path: '/test',
          tab_id: 'tab-1',
        },
      ]);

      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();
      db.initialize();

      const events = db.getQueryEvents('day');

      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe('session-1');
      expect(events[0].agentType).toBe('claude-code');
    });
  });

  describe('close', () => {
    it('should close the database connection', async () => {
      const { StatsDB } = await import('../../main/stats-db');
      const db = new StatsDB();
      db.initialize();

      db.close();

      expect(mockDb.close).toHaveBeenCalled();
      expect(db.isReady()).toBe(false);
    });
  });
});
