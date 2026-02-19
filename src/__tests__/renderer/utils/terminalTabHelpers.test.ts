import { describe, it, expect, vi } from 'vitest';
import {
	createTerminalTab,
	getTerminalTabDisplayName,
	getTerminalSessionId,
	parseTerminalSessionId,
	getActiveTerminalTab,
	ensureTerminalTabs,
	migrateSessionsTerminalTabs,
	cleanTerminalTabsForPersistence,
	createClosedTerminalTab,
	hasRunningTerminalProcess,
	getActiveTerminalTabCount,
	MAX_CLOSED_TERMINAL_TABS,
} from '../../../renderer/utils/terminalTabHelpers';
import type { Session, TerminalTab } from '../../../renderer/types';

// Minimal session fixture for testing
function createMinimalSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'test-session',
		name: 'Test',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/test',
		fullPath: '/test',
		projectRoot: '/test',
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 3000,
		isLive: false,
		changedFiles: [],
		isGitRepo: false,
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [],
		activeTabId: '',
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [],
		unifiedClosedTabHistory: [],
		...overrides,
	} as Session;
}

describe('terminalTabHelpers', () => {
	describe('createTerminalTab', () => {
		it('creates a tab with default values', () => {
			const tab = createTerminalTab();
			expect(tab.id).toBeTruthy();
			expect(tab.shellType).toBe('zsh');
			expect(tab.cwd).toBe('');
			expect(tab.name).toBeNull();
			expect(tab.pid).toBe(0);
			expect(tab.state).toBe('idle');
			expect(tab.createdAt).toBeGreaterThan(0);
		});

		it('creates a tab with custom values', () => {
			const tab = createTerminalTab('bash', '/home', 'My Terminal');
			expect(tab.shellType).toBe('bash');
			expect(tab.cwd).toBe('/home');
			expect(tab.name).toBe('My Terminal');
		});
	});

	describe('getTerminalTabDisplayName', () => {
		it('returns custom name when set', () => {
			const tab = createTerminalTab('zsh', '', 'Build');
			expect(getTerminalTabDisplayName(tab, 0)).toBe('Build');
		});

		it('returns Terminal N when no custom name', () => {
			const tab = createTerminalTab('zsh', '', null);
			expect(getTerminalTabDisplayName(tab, 0)).toBe('Terminal 1');
			expect(getTerminalTabDisplayName(tab, 2)).toBe('Terminal 3');
		});
	});

	describe('getTerminalSessionId / parseTerminalSessionId', () => {
		it('generates correct session ID format', () => {
			const id = getTerminalSessionId('abc123', 'def456');
			expect(id).toBe('abc123-terminal-def456');
		});

		it('parses a valid terminal session ID', () => {
			const result = parseTerminalSessionId('abc123-terminal-def456');
			expect(result).toEqual({ sessionId: 'abc123', tabId: 'def456' });
		});

		it('returns null for invalid format', () => {
			expect(parseTerminalSessionId('abc123-ai-def456')).toBeNull();
			expect(parseTerminalSessionId('abc123')).toBeNull();
		});

		it('roundtrips correctly', () => {
			const id = getTerminalSessionId('session-1', 'tab-2');
			const parsed = parseTerminalSessionId(id);
			expect(parsed).toEqual({ sessionId: 'session-1', tabId: 'tab-2' });
		});
	});

	describe('getActiveTerminalTab', () => {
		it('returns the active terminal tab', () => {
			const tab1 = createTerminalTab('zsh', '/test');
			const tab2 = createTerminalTab('bash', '/test');
			const session = createMinimalSession({
				terminalTabs: [tab1, tab2],
				activeTerminalTabId: tab2.id,
			});

			const active = getActiveTerminalTab(session);
			expect(active?.id).toBe(tab2.id);
		});

		it('returns undefined when no terminal tabs', () => {
			const session = createMinimalSession();
			expect(getActiveTerminalTab(session)).toBeUndefined();
		});
	});

	describe('ensureTerminalTabs', () => {
		it('returns session unchanged if terminal tabs exist', () => {
			const tab = createTerminalTab('zsh', '/test');
			const session = createMinimalSession({
				terminalTabs: [tab],
				activeTerminalTabId: tab.id,
				closedTerminalTabHistory: [],
			});

			const result = ensureTerminalTabs(session);
			expect(result).toBe(session);
		});

		it('adds terminal tabs to session without them', () => {
			const session = createMinimalSession();
			const result = ensureTerminalTabs(session, 'bash');

			expect(result.terminalTabs).toHaveLength(1);
			expect(result.terminalTabs![0].shellType).toBe('bash');
			expect(result.terminalTabs![0].cwd).toBe('/test');
			expect(result.activeTerminalTabId).toBe(result.terminalTabs![0].id);
			expect(result.closedTerminalTabHistory).toEqual([]);
		});
	});

	describe('cleanTerminalTabsForPersistence', () => {
		it('resets runtime state', () => {
			const tab: TerminalTab = {
				id: 'tab-1',
				name: 'Dev Server',
				shellType: 'zsh',
				pid: 12345,
				cwd: '/project',
				createdAt: 1000,
				state: 'busy',
				exitCode: undefined,
			};

			const cleaned = cleanTerminalTabsForPersistence([tab]);
			expect(cleaned).toHaveLength(1);
			expect(cleaned[0].pid).toBe(0);
			expect(cleaned[0].state).toBe('idle');
			expect(cleaned[0].name).toBe('Dev Server');
			expect(cleaned[0].cwd).toBe('/project');
		});

		it('strips exitCode, scrollTop, and searchQuery (runtime-only fields)', () => {
			const tab: TerminalTab = {
				id: 'tab-1',
				name: null,
				shellType: 'bash',
				pid: 9999,
				cwd: '/home',
				createdAt: 2000,
				state: 'exited',
				exitCode: 1,
				scrollTop: 500,
				searchQuery: 'error',
			};

			const cleaned = cleanTerminalTabsForPersistence([tab]);
			expect(cleaned).toHaveLength(1);
			// Identity and settings preserved
			expect(cleaned[0].id).toBe('tab-1');
			expect(cleaned[0].shellType).toBe('bash');
			expect(cleaned[0].cwd).toBe('/home');
			expect(cleaned[0].createdAt).toBe(2000);
			// Runtime state stripped
			expect(cleaned[0].pid).toBe(0);
			expect(cleaned[0].state).toBe('idle');
			expect(cleaned[0].exitCode).toBeUndefined();
			expect(cleaned[0].scrollTop).toBeUndefined();
			expect(cleaned[0].searchQuery).toBeUndefined();
		});

		it('handles undefined input', () => {
			expect(cleanTerminalTabsForPersistence(undefined)).toEqual([]);
		});
	});

	describe('hasRunningTerminalProcess', () => {
		it('returns true when a tab is busy', () => {
			const tab = { ...createTerminalTab(), state: 'busy' as const };
			const session = createMinimalSession({ terminalTabs: [tab] });
			expect(hasRunningTerminalProcess(session)).toBe(true);
		});

		it('returns false when all tabs idle', () => {
			const tab = createTerminalTab();
			const session = createMinimalSession({ terminalTabs: [tab] });
			expect(hasRunningTerminalProcess(session)).toBe(false);
		});
	});

	describe('getActiveTerminalTabCount', () => {
		it('counts non-exited tabs', () => {
			const tabs: TerminalTab[] = [
				{ ...createTerminalTab(), state: 'idle' },
				{ ...createTerminalTab(), state: 'busy' },
				{ ...createTerminalTab(), state: 'exited' },
			];
			const session = createMinimalSession({ terminalTabs: tabs });
			expect(getActiveTerminalTabCount(session)).toBe(2);
		});
	});

	describe('createClosedTerminalTab', () => {
		it('creates closed tab entry with reset runtime state', () => {
			const tab: TerminalTab = {
				id: 'tab-1',
				name: null,
				shellType: 'zsh',
				pid: 999,
				cwd: '/test',
				createdAt: 1000,
				state: 'busy',
			};

			const closed = createClosedTerminalTab(tab, 2);
			expect(closed.tab.pid).toBe(0);
			expect(closed.tab.state).toBe('idle');
			expect(closed.index).toBe(2);
			expect(closed.closedAt).toBeGreaterThan(0);
		});
	});

	describe('migrateSessionsTerminalTabs', () => {
		it('migrates sessions without terminal tabs', () => {
			const session1 = createMinimalSession({ id: 'sess-1', cwd: '/project1' });
			const session2 = createMinimalSession({ id: 'sess-2', cwd: '/project2' });

			const result = migrateSessionsTerminalTabs([session1, session2], 'bash');

			expect(result).toHaveLength(2);
			expect(result[0].terminalTabs).toHaveLength(1);
			expect(result[0].terminalTabs![0].shellType).toBe('bash');
			expect(result[0].terminalTabs![0].cwd).toBe('/project1');
			expect(result[0].activeTerminalTabId).toBe(result[0].terminalTabs![0].id);
			expect(result[0].closedTerminalTabHistory).toEqual([]);
			expect(result[1].terminalTabs).toHaveLength(1);
			expect(result[1].terminalTabs![0].cwd).toBe('/project2');
		});

		it('leaves sessions with existing terminal tabs unchanged', () => {
			const tab = createTerminalTab('zsh', '/test');
			const session = createMinimalSession({
				id: 'sess-1',
				terminalTabs: [tab],
				activeTerminalTabId: tab.id,
				closedTerminalTabHistory: [],
			});

			const result = migrateSessionsTerminalTabs([session]);

			expect(result).toHaveLength(1);
			expect(result[0]).toBe(session); // Same reference - unchanged
		});

		it('handles mixed sessions (some with tabs, some without)', () => {
			const tab = createTerminalTab('zsh', '/existing');
			const withTabs = createMinimalSession({
				id: 'has-tabs',
				terminalTabs: [tab],
				activeTerminalTabId: tab.id,
				closedTerminalTabHistory: [],
			});
			const withoutTabs = createMinimalSession({ id: 'no-tabs', cwd: '/new' });

			const result = migrateSessionsTerminalTabs([withTabs, withoutTabs], 'fish');

			expect(result[0]).toBe(withTabs); // Unchanged
			expect(result[1].terminalTabs).toHaveLength(1);
			expect(result[1].terminalTabs![0].shellType).toBe('fish');
		});

		it('handles empty sessions array', () => {
			const result = migrateSessionsTerminalTabs([]);
			expect(result).toEqual([]);
		});

		it('defaults to zsh when no shell specified', () => {
			const session = createMinimalSession({ id: 'sess-1' });
			const result = migrateSessionsTerminalTabs([session]);

			expect(result[0].terminalTabs![0].shellType).toBe('zsh');
		});

		it('ensures closedTerminalTabHistory for sessions with tabs but missing history', () => {
			const tab = createTerminalTab('zsh', '/test');
			const session = createMinimalSession({
				id: 'sess-1',
				terminalTabs: [tab],
				activeTerminalTabId: tab.id,
				// closedTerminalTabHistory intentionally omitted
			});

			const result = migrateSessionsTerminalTabs([session]);

			expect(result[0].closedTerminalTabHistory).toEqual([]);
		});

		it('migrates legacy session with shellLogs but no terminalTabs', () => {
			const legacyShellLogs = [
				{ id: 'log-1', timestamp: 1000, source: 'user' as const, text: 'ls -la' },
				{ id: 'log-2', timestamp: 1001, source: 'stdout' as const, text: 'total 8\ndrwxr-xr-x  2 user user 4096 ...' },
				{ id: 'log-3', timestamp: 1002, source: 'system' as const, text: 'Process exited with code 0' },
			];
			const session = createMinimalSession({
				id: 'legacy-session',
				cwd: '/old-project',
				shellLogs: legacyShellLogs,
				// No terminalTabs - this is a pre-terminal-tabs session
			});

			const result = migrateSessionsTerminalTabs([session], 'bash');

			// Should create terminal tabs
			expect(result[0].terminalTabs).toHaveLength(1);
			expect(result[0].terminalTabs![0].shellType).toBe('bash');
			expect(result[0].terminalTabs![0].cwd).toBe('/old-project');
			expect(result[0].activeTerminalTabId).toBe(result[0].terminalTabs![0].id);
			expect(result[0].closedTerminalTabHistory).toEqual([]);
			// shellLogs should be preserved (not removed by migration)
			expect(result[0].shellLogs).toEqual(legacyShellLogs);
		});

		it('preserves shellLogs when creating terminal tabs for backwards compatibility', () => {
			const shellLogs = [
				{ id: 'log-1', timestamp: 1000, source: 'stdout' as const, text: 'npm test output' },
			];
			const session = createMinimalSession({
				id: 'compat-session',
				shellLogs,
			});

			const result = migrateSessionsTerminalTabs([session]);

			// shellLogs are not modified during migration - they're separate from terminalTabs
			expect(result[0].shellLogs).toBe(shellLogs); // Same reference preserved
			expect(result[0].terminalTabs).toHaveLength(1);
		});

		it('migrates session with empty shellLogs and no terminalTabs', () => {
			const session = createMinimalSession({
				id: 'empty-shell-session',
				cwd: '/project',
				shellLogs: [],
				// No terminalTabs
			});

			const result = migrateSessionsTerminalTabs([session], 'zsh');

			expect(result[0].terminalTabs).toHaveLength(1);
			expect(result[0].terminalTabs![0].cwd).toBe('/project');
			expect(result[0].shellLogs).toEqual([]);
		});

		it('logs migration for sessions with legacy shellLogs', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const session = createMinimalSession({
				id: 'log-test-session',
				shellLogs: [
					{ id: 'log-1', timestamp: 1000, source: 'stdout' as const, text: 'output' },
					{ id: 'log-2', timestamp: 1001, source: 'stdout' as const, text: 'more output' },
				],
			});

			migrateSessionsTerminalTabs([session]);

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('Migrated session log-test-session to terminal tabs')
			);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('2 legacy shellLogs entries')
			);

			consoleSpy.mockRestore();
		});

		it('does not mention shellLogs in log when session had empty shellLogs', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const session = createMinimalSession({
				id: 'no-logs-session',
				shellLogs: [],
			});

			migrateSessionsTerminalTabs([session]);

			const logCall = consoleSpy.mock.calls.find(
				call => typeof call[0] === 'string' && call[0].includes('no-logs-session')
			);
			expect(logCall).toBeDefined();
			expect(logCall![0]).not.toContain('legacy shellLogs');

			consoleSpy.mockRestore();
		});
	});

	it('MAX_CLOSED_TERMINAL_TABS is 10', () => {
		expect(MAX_CLOSED_TERMINAL_TABS).toBe(10);
	});
});
