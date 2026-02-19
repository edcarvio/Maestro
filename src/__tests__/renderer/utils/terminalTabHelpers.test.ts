import { describe, it, expect } from 'vitest';
import {
	createTerminalTab,
	getTerminalTabDisplayName,
	getTerminalSessionId,
	parseTerminalSessionId,
	getActiveTerminalTab,
	ensureTerminalTabs,
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

	it('MAX_CLOSED_TERMINAL_TABS is 10', () => {
		expect(MAX_CLOSED_TERMINAL_TABS).toBe(10);
	});
});
