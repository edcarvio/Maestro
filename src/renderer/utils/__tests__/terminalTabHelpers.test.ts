/**
 * Tests for terminalTabHelpers utility functions.
 * Validates terminal tab creation, display naming, session ID parsing, and state queries.
 */

import { describe, it, expect, vi } from 'vitest';
import {
	getActiveTerminalTab,
	createDefaultTerminalTab,
	getTerminalTabDisplayName,
	getTerminalSessionId,
	parseTerminalSessionId,
	hasRunningTerminalProcess,
	getActiveTerminalTabCount,
	createClosedTerminalTab,
	MAX_CLOSED_TERMINAL_TABS,
} from '../terminalTabHelpers';
import type { Session, TerminalTab } from '../../types';

// Minimal session factory for testing — only the fields used by terminal tab helpers
function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		name: 'Test Session',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/tmp/test',
		fullPath: '/tmp/test',
		projectRoot: '/tmp/test',
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
		activeTabId: 'tab-1',
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [],
		unifiedClosedTabHistory: [],
		terminalTabs: [],
		activeTerminalTabId: null,
		closedTerminalTabHistory: [],
		...overrides,
	} as Session;
}

function makeTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'term-1',
		name: null,
		createdAt: Date.now(),
		cwd: '/tmp/test',
		...overrides,
	};
}

describe('terminalTabHelpers', () => {
	describe('getActiveTerminalTab', () => {
		it('should return the active terminal tab', () => {
			const tab1 = makeTerminalTab({ id: 'term-1' });
			const tab2 = makeTerminalTab({ id: 'term-2' });
			const session = makeSession({
				terminalTabs: [tab1, tab2],
				activeTerminalTabId: 'term-2',
			});

			expect(getActiveTerminalTab(session)).toBe(tab2);
		});

		it('should return undefined when no terminal tabs exist', () => {
			const session = makeSession({ terminalTabs: [], activeTerminalTabId: null });
			expect(getActiveTerminalTab(session)).toBeUndefined();
		});

		it('should return undefined when activeTerminalTabId is null', () => {
			const tab = makeTerminalTab({ id: 'term-1' });
			const session = makeSession({
				terminalTabs: [tab],
				activeTerminalTabId: null,
			});
			expect(getActiveTerminalTab(session)).toBeUndefined();
		});

		it('should return undefined when activeTerminalTabId references a non-existent tab', () => {
			const tab = makeTerminalTab({ id: 'term-1' });
			const session = makeSession({
				terminalTabs: [tab],
				activeTerminalTabId: 'term-nonexistent',
			});
			expect(getActiveTerminalTab(session)).toBeUndefined();
		});
	});

	describe('createDefaultTerminalTab', () => {
		it('should create a terminal tab with default values', () => {
			const tab = createDefaultTerminalTab();
			expect(tab.id).toBeDefined();
			expect(tab.name).toBeNull();
			expect(tab.cwd).toBe('');
			expect(tab.createdAt).toBeGreaterThan(0);
			expect(tab.processRunning).toBeUndefined();
			expect(tab.exitCode).toBeUndefined();
		});

		it('should accept cwd and name overrides', () => {
			const tab = createDefaultTerminalTab('/home/user', 'My Shell');
			expect(tab.cwd).toBe('/home/user');
			expect(tab.name).toBe('My Shell');
		});

		it('should generate unique IDs', () => {
			const tab1 = createDefaultTerminalTab();
			const tab2 = createDefaultTerminalTab();
			expect(tab1.id).not.toBe(tab2.id);
		});
	});

	describe('getTerminalTabDisplayName', () => {
		it('should return custom name when set', () => {
			const tab = makeTerminalTab({ name: 'Build Server' });
			expect(getTerminalTabDisplayName(tab, 0)).toBe('Build Server');
		});

		it('should return "Terminal N" when name is null', () => {
			const tab = makeTerminalTab({ name: null });
			expect(getTerminalTabDisplayName(tab, 0)).toBe('Terminal 1');
			expect(getTerminalTabDisplayName(tab, 4)).toBe('Terminal 5');
		});

		it('should return "Terminal N" when name is empty string', () => {
			// Empty string is falsy, so falls through to index-based name
			const tab = makeTerminalTab({ name: '' as any });
			expect(getTerminalTabDisplayName(tab, 2)).toBe('Terminal 3');
		});
	});

	describe('getTerminalSessionId', () => {
		it('should format session ID correctly', () => {
			expect(getTerminalSessionId('sess-123', 'tab-456')).toBe('sess-123-terminal-tab-456');
		});

		it('should handle UUID-style IDs', () => {
			const sessionId = '550e8400-e29b-41d4-a716-446655440000';
			const tabId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
			expect(getTerminalSessionId(sessionId, tabId)).toBe(
				`${sessionId}-terminal-${tabId}`
			);
		});
	});

	describe('parseTerminalSessionId', () => {
		it('should parse a valid terminal session ID', () => {
			const result = parseTerminalSessionId('sess-123-terminal-tab-456');
			expect(result).toEqual({
				sessionId: 'sess-123',
				tabId: 'tab-456',
			});
		});

		it('should roundtrip with getTerminalSessionId', () => {
			const original = getTerminalSessionId('my-session', 'my-tab');
			const parsed = parseTerminalSessionId(original);
			expect(parsed).toEqual({
				sessionId: 'my-session',
				tabId: 'my-tab',
			});
		});

		it('should return null for non-terminal session IDs', () => {
			expect(parseTerminalSessionId('sess-123-ai-tab-456')).toBeNull();
			expect(parseTerminalSessionId('just-a-session-id')).toBeNull();
			expect(parseTerminalSessionId('')).toBeNull();
		});

		it('should handle UUID-style IDs with hyphens', () => {
			const sessionId = '550e8400-e29b-41d4-a716-446655440000';
			const tabId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
			const composite = `${sessionId}-terminal-${tabId}`;
			const result = parseTerminalSessionId(composite);
			expect(result).toEqual({ sessionId, tabId });
		});
	});

	describe('hasRunningTerminalProcess', () => {
		it('should return true when a tab has processRunning=true', () => {
			const session = makeSession({
				terminalTabs: [
					makeTerminalTab({ id: 'term-1', processRunning: false }),
					makeTerminalTab({ id: 'term-2', processRunning: true }),
				],
			});
			expect(hasRunningTerminalProcess(session)).toBe(true);
		});

		it('should return false when no tabs are running', () => {
			const session = makeSession({
				terminalTabs: [
					makeTerminalTab({ id: 'term-1', processRunning: false }),
					makeTerminalTab({ id: 'term-2' }), // undefined
				],
			});
			expect(hasRunningTerminalProcess(session)).toBe(false);
		});

		it('should return false when there are no terminal tabs', () => {
			const session = makeSession({ terminalTabs: [] });
			expect(hasRunningTerminalProcess(session)).toBe(false);
		});

		it('should return false when terminalTabs is undefined', () => {
			const session = makeSession();
			(session as any).terminalTabs = undefined;
			expect(hasRunningTerminalProcess(session)).toBe(false);
		});
	});

	describe('getActiveTerminalTabCount', () => {
		it('should count tabs without exitCode', () => {
			const session = makeSession({
				terminalTabs: [
					makeTerminalTab({ id: 'term-1' }), // no exitCode — active
					makeTerminalTab({ id: 'term-2', exitCode: 0 }), // exited
					makeTerminalTab({ id: 'term-3' }), // no exitCode — active
				],
			});
			expect(getActiveTerminalTabCount(session)).toBe(2);
		});

		it('should return 0 when all tabs have exited', () => {
			const session = makeSession({
				terminalTabs: [
					makeTerminalTab({ id: 'term-1', exitCode: 0 }),
					makeTerminalTab({ id: 'term-2', exitCode: 1 }),
				],
			});
			expect(getActiveTerminalTabCount(session)).toBe(0);
		});

		it('should return 0 for empty terminal tabs', () => {
			const session = makeSession({ terminalTabs: [] });
			expect(getActiveTerminalTabCount(session)).toBe(0);
		});

		it('should return 0 when terminalTabs is undefined', () => {
			const session = makeSession();
			(session as any).terminalTabs = undefined;
			expect(getActiveTerminalTabCount(session)).toBe(0);
		});
	});

	describe('createClosedTerminalTab', () => {
		it('should create a closed tab entry with runtime state cleared', () => {
			const tab = makeTerminalTab({
				id: 'term-1',
				name: 'My Shell',
				processRunning: true,
				exitCode: 1,
			});
			const closed = createClosedTerminalTab(tab, 2);

			expect(closed.tab.id).toBe('term-1');
			expect(closed.tab.name).toBe('My Shell');
			expect(closed.tab.processRunning).toBeUndefined();
			expect(closed.tab.exitCode).toBeUndefined();
			expect(closed.index).toBe(2);
			expect(closed.closedAt).toBeGreaterThan(0);
		});

		it('should not mutate the original tab', () => {
			const tab = makeTerminalTab({ processRunning: true, exitCode: 0 });
			createClosedTerminalTab(tab, 0);

			expect(tab.processRunning).toBe(true);
			expect(tab.exitCode).toBe(0);
		});
	});

	describe('MAX_CLOSED_TERMINAL_TABS', () => {
		it('should be 10', () => {
			expect(MAX_CLOSED_TERMINAL_TABS).toBe(10);
		});
	});
});
