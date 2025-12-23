/**
 * Tests for the Claude Session IPC handlers
 *
 * These tests verify the Claude Code session management functionality:
 * - List sessions (regular and paginated)
 * - Read session messages
 * - Delete message pairs
 * - Search sessions
 * - Get project and global stats
 * - Session timestamps for activity graphs
 * - Session origins tracking (Maestro vs CLI)
 * - Get available slash commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, app, BrowserWindow } from 'electron';
import { registerClaudeHandlers, ClaudeHandlerDependencies } from '../../../../main/ipc/handlers/claude';

// Mock electron's ipcMain and app
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock/app/path'),
  },
  BrowserWindow: vi.fn(),
}));

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

// Mock path - we need to preserve the actual path functionality but mock specific behaviors
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    default: {
      ...actual,
      join: vi.fn((...args: string[]) => args.join('/')),
      dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
    },
  };
});

// Mock os module
vi.mock('os', () => ({
  default: {
    homedir: vi.fn().mockReturnValue('/mock/home'),
  },
}));

// Mock statsCache module
vi.mock('../../../../main/utils/statsCache', () => ({
  encodeClaudeProjectPath: vi.fn((p: string) => p.replace(/\//g, '-').replace(/^-/, '')),
  loadStatsCache: vi.fn(),
  saveStatsCache: vi.fn(),
  STATS_CACHE_VERSION: 1,
}));

// Mock constants
vi.mock('../../../../main/constants', () => ({
  CLAUDE_SESSION_PARSE_LIMITS: {
    FIRST_MESSAGE_SCAN_LINES: 10,
    FIRST_MESSAGE_PREVIEW_LENGTH: 100,
    LAST_TIMESTAMP_SCAN_LINES: 5,
    OLDEST_TIMESTAMP_SCAN_LINES: 10,
  },
  CLAUDE_PRICING: {
    INPUT_PER_MILLION: 3,
    OUTPUT_PER_MILLION: 15,
    CACHE_READ_PER_MILLION: 0.3,
    CACHE_CREATION_PER_MILLION: 3.75,
  },
}));

describe('Claude IPC handlers', () => {
  let handlers: Map<string, Function>;
  let mockClaudeSessionOriginsStore: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let mockGetMainWindow: ReturnType<typeof vi.fn>;
  let mockDependencies: ClaudeHandlerDependencies;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Capture all registered handlers
    handlers = new Map();
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Create mock dependencies
    mockClaudeSessionOriginsStore = {
      get: vi.fn().mockReturnValue({}),
      set: vi.fn(),
    };

    mockGetMainWindow = vi.fn().mockReturnValue(null);

    mockDependencies = {
      claudeSessionOriginsStore: mockClaudeSessionOriginsStore as unknown as ClaudeHandlerDependencies['claudeSessionOriginsStore'],
      getMainWindow: mockGetMainWindow,
    };

    // Register handlers
    registerClaudeHandlers(mockDependencies);
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('registration', () => {
    it('should register all claude handlers', () => {
      // All ipcMain.handle('claude:*') calls identified from src/main/ipc/handlers/claude.ts:
      // Line 153:  ipcMain.handle('claude:listSessions', ...)        - List sessions for a project
      // Line 316:  ipcMain.handle('claude:listSessionsPaginated', ...)  - Paginated session listing
      // Line 504:  ipcMain.handle('claude:getProjectStats', ...)     - Get stats for a specific project
      // Line 689:  ipcMain.handle('claude:getSessionTimestamps', ...)  - Get session timestamps for activity graphs
      // Line 742:  ipcMain.handle('claude:getGlobalStats', ...)      - Get global stats across all projects
      // Line 949:  ipcMain.handle('claude:readSessionMessages', ...)  - Read messages from a session
      // Line 1025: ipcMain.handle('claude:deleteMessagePair', ...)   - Delete a message pair from session
      // Line 1192: ipcMain.handle('claude:searchSessions', ...)      - Search sessions by query
      // Line 1337: ipcMain.handle('claude:getCommands', ...)         - Get available slash commands
      // Line 1422: ipcMain.handle('claude:registerSessionOrigin', ...)  - Register session origin (user/auto)
      // Line 1438: ipcMain.handle('claude:updateSessionName', ...)   - Update session name
      // Line 1459: ipcMain.handle('claude:updateSessionStarred', ...)  - Update session starred status
      // Line 1480: ipcMain.handle('claude:getSessionOrigins', ...)   - Get session origins for a project
      // Line 1488: ipcMain.handle('claude:getAllNamedSessions', ...)  - Get all sessions with names
      const expectedChannels = [
        'claude:listSessions',
        'claude:listSessionsPaginated',
        'claude:getProjectStats',
        'claude:getSessionTimestamps',
        'claude:getGlobalStats',
        'claude:readSessionMessages',
        'claude:deleteMessagePair',
        'claude:searchSessions',
        'claude:getCommands',
        'claude:registerSessionOrigin',
        'claude:updateSessionName',
        'claude:updateSessionStarred',
        'claude:getSessionOrigins',
        'claude:getAllNamedSessions',
      ];

      for (const channel of expectedChannels) {
        expect(handlers.has(channel), `Handler for ${channel} should be registered`).toBe(true);
      }

      // Verify total count matches - ensures no handlers are added without updating this test
      expect(handlers.size).toBe(expectedChannels.length);
    });
  });

  describe('claude:listSessions', () => {
    it('should return sessions from ~/.claude directory', async () => {
      const fs = await import('fs/promises');

      // Mock directory access - directory exists
      vi.mocked(fs.default.access).mockResolvedValue(undefined);

      // Mock readdir to return session files
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-abc123.jsonl',
        'session-def456.jsonl',
        'not-a-session.txt', // Should be filtered out
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      // Mock file stats - return valid non-zero size files
      const mockMtime = new Date('2024-01-15T10:00:00Z');
      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 1024,
        mtime: mockMtime,
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      // Mock session file content with user message
      const sessionContent = `{"type":"user","message":{"role":"user","content":"Hello world"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}
{"type":"assistant","message":{"role":"assistant","content":"Hi there!"},"timestamp":"2024-01-15T09:01:00Z","uuid":"uuid-2"}`;

      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        sessionId: expect.stringMatching(/^session-/),
        projectPath: '/test/project',
        firstMessage: 'Hello world',
      });
    });

    it('should return empty array when project directory does not exist', async () => {
      const fs = await import('fs/promises');

      // Mock directory access - directory does not exist
      vi.mocked(fs.default.access).mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/nonexistent/project');

      expect(result).toEqual([]);
    });

    it('should filter out 0-byte session files', async () => {
      const fs = await import('fs/promises');

      // Mock directory access
      vi.mocked(fs.default.access).mockResolvedValue(undefined);

      // Mock readdir
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-valid.jsonl',
        'session-empty.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      // Mock file stats - first file has content, second is empty
      let callCount = 0;
      vi.mocked(fs.default.stat).mockImplementation(async () => {
        callCount++;
        return {
          size: callCount === 1 ? 1024 : 0, // First call returns 1024, second returns 0
          mtime: new Date('2024-01-15T10:00:00Z'),
        } as unknown as Awaited<ReturnType<typeof fs.default.stat>>;
      });

      // Mock session file content
      const sessionContent = `{"type":"user","message":{"role":"user","content":"Test message"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}`;
      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      // Only the non-empty session should be returned
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('session-valid');
    });

    it('should parse session JSON files and extract token counts', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-123.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 2048,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      // Session content with token usage information
      const sessionContent = `{"type":"user","message":{"role":"user","content":"What is 2+2?"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}
{"type":"assistant","message":{"role":"assistant","content":"The answer is 4"},"timestamp":"2024-01-15T09:01:00Z","uuid":"uuid-2","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}}`;

      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionId: 'session-123',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheCreationTokens: 10,
        messageCount: 2,
      });
    });

    it('should add origin info from origins store', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-abc.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 1024,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      const sessionContent = `{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}`;
      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      // Mock origins store with session info
      mockClaudeSessionOriginsStore.get.mockReturnValue({
        '/test/project': {
          'session-abc': { origin: 'user', sessionName: 'My Session' },
        },
      });

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionId: 'session-abc',
        origin: 'user',
        sessionName: 'My Session',
      });
    });

    it('should handle string-only origin data from origins store', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-xyz.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 1024,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      const sessionContent = `{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}`;
      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      // Mock origins store with simple string origin (legacy format)
      mockClaudeSessionOriginsStore.get.mockReturnValue({
        '/test/project': {
          'session-xyz': 'auto', // Simple string instead of object
        },
      });

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionId: 'session-xyz',
        origin: 'auto',
      });
      expect(result[0].sessionName).toBeUndefined();
    });

    it('should extract first user message text from array content', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-multi.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 2048,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      // Session content with array-style content (includes images and text)
      const sessionContent = `{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"..."}},{"type":"text","text":"Describe this image"}]},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}`;

      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(1);
      // Should extract only the text content, not the image
      expect(result[0].firstMessage).toBe('Describe this image');
    });

    it('should sort sessions by modified date descending', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-old.jsonl',
        'session-new.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      // Return different mtimes for each file
      let callIdx = 0;
      vi.mocked(fs.default.stat).mockImplementation(async () => {
        callIdx++;
        return {
          size: 1024,
          mtime: callIdx === 1
            ? new Date('2024-01-10T10:00:00Z') // Older
            : new Date('2024-01-15T10:00:00Z'), // Newer
        } as unknown as Awaited<ReturnType<typeof fs.default.stat>>;
      });

      const sessionContent = `{"type":"user","message":{"role":"user","content":"Test"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}`;
      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(2);
      // Newer session should come first
      expect(result[0].sessionId).toBe('session-new');
      expect(result[1].sessionId).toBe('session-old');
    });

    it('should handle malformed JSON lines gracefully', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-corrupt.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 1024,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      // Session with some malformed lines
      const sessionContent = `not valid json at all
{"type":"user","message":{"role":"user","content":"Valid message"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}
{broken json here
{"type":"assistant","message":{"role":"assistant","content":"Response"},"timestamp":"2024-01-15T09:01:00Z","uuid":"uuid-2"}`;

      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      // Should still return the session, skipping malformed lines
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sessionId: 'session-corrupt',
        firstMessage: 'Valid message',
        messageCount: 2, // Still counts via regex
      });
    });

    it('should calculate cost estimate from token counts', async () => {
      const fs = await import('fs/promises');

      vi.mocked(fs.default.access).mockResolvedValue(undefined);
      vi.mocked(fs.default.readdir).mockResolvedValue([
        'session-cost.jsonl',
      ] as unknown as Awaited<ReturnType<typeof fs.default.readdir>>);

      vi.mocked(fs.default.stat).mockResolvedValue({
        size: 1024,
        mtime: new Date('2024-01-15T10:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof fs.default.stat>>);

      // Session with known token counts for cost calculation
      // Using mocked pricing: INPUT=3, OUTPUT=15, CACHE_READ=0.3, CACHE_CREATION=3.75 per million
      const sessionContent = `{"type":"user","message":{"role":"user","content":"Test"},"timestamp":"2024-01-15T09:00:00Z","uuid":"uuid-1"}
{"type":"assistant","message":{"role":"assistant","content":"Response"},"timestamp":"2024-01-15T09:01:00Z","uuid":"uuid-2","usage":{"input_tokens":1000000,"output_tokens":1000000,"cache_read_input_tokens":1000000,"cache_creation_input_tokens":1000000}}`;

      vi.mocked(fs.default.readFile).mockResolvedValue(sessionContent);

      const handler = handlers.get('claude:listSessions');
      const result = await handler!({} as any, '/test/project');

      expect(result).toHaveLength(1);
      // Cost = (1M * 3 + 1M * 15 + 1M * 0.3 + 1M * 3.75) / 1M = 3 + 15 + 0.3 + 3.75 = 22.05
      expect(result[0].costUsd).toBeCloseTo(22.05, 2);
    });
  });
});
