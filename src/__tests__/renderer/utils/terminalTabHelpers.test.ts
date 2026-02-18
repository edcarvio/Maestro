/**
 * Tests for terminal tab helpers in tabHelpers.ts
 *
 * Verifies multi-tab terminal support within Maestro sessions:
 * - createTerminalTab: Create new terminal tabs with proper state
 * - closeTerminalTab: Close tabs with undo history and adjacent selection
 * - reopenUnifiedClosedTab: Restore terminal tabs from unified history
 * - navigateToUnifiedTabByIndex: Navigate to terminal tabs via Cmd+1-9
 * - navigateToNextUnifiedTab / navigateToPrevUnifiedTab: Cycle through terminal tabs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createTerminalTab,
	closeTerminalTab,
	reopenUnifiedClosedTab,
	navigateToUnifiedTabByIndex,
	navigateToNextUnifiedTab,
	navigateToPrevUnifiedTab,
	navigateToLastUnifiedTab,
} from '../../../renderer/utils/tabHelpers';
import type {
	Session,
	AITab,
	TerminalTab,
	ClosedTabEntry,
} from '../../../renderer/types';

// Mock the generateId function to return predictable IDs
let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `mock-id-${++mockIdCounter}`),
}));

// Helper to create a minimal Session for testing
function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		name: 'Test Session',
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
		port: 0,
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
		terminalTabs: [],
		activeTerminalTabId: null,
		...overrides,
	};
}

// Helper to create a minimal AITab for testing
function createMockAITab(overrides: Partial<AITab> = {}): AITab {
	return {
		id: 'ai-tab-1',
		agentSessionId: null,
		name: null,
		starred: false,
		logs: [],
		inputValue: '',
		stagedImages: [],
		createdAt: Date.now(),
		state: 'idle',
		...overrides,
	};
}

// Helper to create a minimal TerminalTab for testing
function createMockTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'term-tab-1',
		name: null,
		createdAt: Date.now(),
		cwd: '/test',
		processRunning: undefined,
		...overrides,
	};
}

describe('Terminal Tab Helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIdCounter = 0;
	});

	// ============================================================================
	// createTerminalTab
	// ============================================================================

	describe('createTerminalTab', () => {
		it('returns null for null session', () => {
			expect(createTerminalTab(null as any)).toBeNull();
		});

		it('creates a terminal tab with default values', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
			});

			const result = createTerminalTab(session);

			expect(result).not.toBeNull();
			expect(result!.tab.id).toBe('mock-id-1');
			expect(result!.tab.name).toBeNull();
			expect(result!.tab.cwd).toBe('/test');
			expect(result!.tab.processRunning).toBeUndefined();
			expect(result!.tab.exitCode).toBeUndefined();
		});

		it('sets new terminal tab as active and clears file tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				activeFileTabId: 'some-file-tab',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
			});

			const result = createTerminalTab(session);

			expect(result!.session.activeTerminalTabId).toBe('mock-id-1');
			expect(result!.session.activeFileTabId).toBeNull();
		});

		it('adds terminal tab to terminalTabs array', () => {
			const existingTermTab = createMockTerminalTab({ id: 'term-existing' });
			const session = createMockSession({
				terminalTabs: [existingTermTab],
				activeTerminalTabId: 'term-existing',
				unifiedTabOrder: [{ type: 'terminal', id: 'term-existing' }],
			});

			const result = createTerminalTab(session);

			expect(result!.session.terminalTabs).toHaveLength(2);
			expect(result!.session.terminalTabs[0].id).toBe('term-existing');
			expect(result!.session.terminalTabs[1].id).toBe('mock-id-1');
		});

		it('adds terminal tab to unifiedTabOrder', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
			});

			const result = createTerminalTab(session);

			expect(result!.session.unifiedTabOrder).toHaveLength(2);
			expect(result!.session.unifiedTabOrder[1]).toEqual({
				type: 'terminal',
				id: 'mock-id-1',
			});
		});

		it('respects custom name option', () => {
			const session = createMockSession({
				unifiedTabOrder: [],
			});

			const result = createTerminalTab(session, { name: 'Build Server' });

			expect(result!.tab.name).toBe('Build Server');
		});

		it('respects custom cwd option', () => {
			const session = createMockSession({
				cwd: '/default',
				unifiedTabOrder: [],
			});

			const result = createTerminalTab(session, { cwd: '/custom/path' });

			expect(result!.tab.cwd).toBe('/custom/path');
		});

		it('uses session cwd when cwd option not provided', () => {
			const session = createMockSession({
				cwd: '/project/root',
				unifiedTabOrder: [],
			});

			const result = createTerminalTab(session);

			expect(result!.tab.cwd).toBe('/project/root');
		});

		it('supports creating multiple terminal tabs', () => {
			const session = createMockSession({
				unifiedTabOrder: [],
			});

			const result1 = createTerminalTab(session);
			expect(result1!.session.terminalTabs).toHaveLength(1);

			const result2 = createTerminalTab(result1!.session);
			expect(result2!.session.terminalTabs).toHaveLength(2);

			const result3 = createTerminalTab(result2!.session);
			expect(result3!.session.terminalTabs).toHaveLength(3);

			// Each tab gets a unique ID
			const ids = result3!.session.terminalTabs.map((t) => t.id);
			expect(new Set(ids).size).toBe(3);

			// Active tab is always the newest
			expect(result3!.session.activeTerminalTabId).toBe(result3!.tab.id);
		});
	});

	// ============================================================================
	// closeTerminalTab
	// ============================================================================

	describe('closeTerminalTab', () => {
		it('returns null for null session', () => {
			expect(closeTerminalTab(null as any, 'tab-1')).toBeNull();
		});

		it('returns null for session with no terminal tabs', () => {
			const session = createMockSession({ terminalTabs: [] });
			expect(closeTerminalTab(session, 'tab-1')).toBeNull();
		});

		it('returns null for non-existent tab id', () => {
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				terminalTabs: [termTab],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [{ type: 'terminal', id: 'term-1' }],
			});

			expect(closeTerminalTab(session, 'non-existent')).toBeNull();
		});

		it('closes a terminal tab and removes from terminalTabs', () => {
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const session = createMockSession({
				terminalTabs: [term1, term2],
				activeTerminalTabId: 'term-2',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
				],
			});

			const result = closeTerminalTab(session, 'term-1');

			expect(result).not.toBeNull();
			expect(result!.session.terminalTabs).toHaveLength(1);
			expect(result!.session.terminalTabs[0].id).toBe('term-2');
		});

		it('removes tab from unifiedTabOrder', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [term1, term2],
				activeTerminalTabId: 'term-2',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
				],
			});

			const result = closeTerminalTab(session, 'term-1');

			expect(result!.session.unifiedTabOrder).toHaveLength(2);
			expect(result!.session.unifiedTabOrder).toEqual([
				{ type: 'ai', id: 'ai-1' },
				{ type: 'terminal', id: 'term-2' },
			]);
		});

		it('adds closed tab to unifiedClosedTabHistory', () => {
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const session = createMockSession({
				terminalTabs: [term1, term2],
				activeTerminalTabId: 'term-2',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
				],
				unifiedClosedTabHistory: [],
			});

			const result = closeTerminalTab(session, 'term-1');

			expect(result!.session.unifiedClosedTabHistory).toHaveLength(1);
			expect(result!.closedTabEntry.type).toBe('terminal');
			expect(result!.closedTabEntry.tab.id).toBe('term-1');
			expect(result!.closedTabEntry.unifiedIndex).toBe(0);
		});

		it('selects adjacent tab when closing the active terminal tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [term1, term2],
				activeTerminalTabId: 'term-2',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
				],
			});

			const result = closeTerminalTab(session, 'term-2');

			// Should select term-1 (the tab to the left)
			expect(result!.session.activeTerminalTabId).toBe('term-1');
		});

		it('falls back to AI tab when closing only terminal tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [term1],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = closeTerminalTab(session, 'term-1');

			// Should fall back to AI tab
			expect(result!.session.activeTerminalTabId).toBeNull();
			expect(result!.session.activeTabId).toBe('ai-1');
		});

		it('does not change active tab when closing inactive terminal tab', () => {
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const term3 = createMockTerminalTab({ id: 'term-3' });
			const session = createMockSession({
				terminalTabs: [term1, term2, term3],
				activeTerminalTabId: 'term-3',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
					{ type: 'terminal', id: 'term-3' },
				],
			});

			const result = closeTerminalTab(session, 'term-1');

			// Active tab should remain unchanged
			expect(result!.session.activeTerminalTabId).toBe('term-3');
		});

		it('preserves existing closed tab history entries', () => {
			const existingClosedEntry: ClosedTabEntry = {
				type: 'ai',
				tab: createMockAITab({ id: 'closed-ai' }),
				unifiedIndex: 0,
				closedAt: Date.now() - 1000,
			};
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const session = createMockSession({
				terminalTabs: [term1, term2],
				activeTerminalTabId: 'term-2',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
				],
				unifiedClosedTabHistory: [existingClosedEntry],
			});

			const result = closeTerminalTab(session, 'term-1');

			expect(result!.session.unifiedClosedTabHistory).toHaveLength(2);
			// New entry is prepended
			expect(result!.session.unifiedClosedTabHistory[0].type).toBe('terminal');
			expect(result!.session.unifiedClosedTabHistory[1].type).toBe('ai');
		});
	});

	// ============================================================================
	// reopenUnifiedClosedTab (terminal-specific)
	// ============================================================================

	describe('reopenUnifiedClosedTab with terminal tabs', () => {
		it('reopens a terminal tab from unified history', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const closedTermTab = createMockTerminalTab({
				id: 'closed-term',
				name: 'Build',
				cwd: '/project',
			});
			const closedEntry: ClosedTabEntry = {
				type: 'terminal',
				tab: closedTermTab,
				unifiedIndex: 1,
				closedAt: Date.now(),
			};
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [],
				activeTerminalTabId: null,
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
				unifiedClosedTabHistory: [closedEntry],
			});

			const result = reopenUnifiedClosedTab(session);

			expect(result).not.toBeNull();
			expect(result!.tabType).toBe('terminal');
			expect(result!.wasDuplicate).toBe(false);
			expect(result!.session.terminalTabs).toHaveLength(1);
			expect(result!.session.terminalTabs[0].name).toBe('Build');
			expect(result!.session.terminalTabs[0].cwd).toBe('/project');
			expect(result!.session.activeTerminalTabId).toBe(result!.tabId);
			expect(result!.session.activeFileTabId).toBeNull();
		});

		it('resets runtime state when reopening terminal tab', () => {
			const closedTermTab = createMockTerminalTab({
				id: 'closed-term',
				processRunning: true,
				exitCode: 1,
			});
			const closedEntry: ClosedTabEntry = {
				type: 'terminal',
				tab: closedTermTab,
				unifiedIndex: 0,
				closedAt: Date.now(),
			};
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
				unifiedClosedTabHistory: [closedEntry],
			});

			const result = reopenUnifiedClosedTab(session);

			expect(result).not.toBeNull();
			const restoredTab = result!.session.terminalTabs[0];
			expect(restoredTab.processRunning).toBe(false);
			expect(restoredTab.exitCode).toBeUndefined();
		});

		it('generates new ID for reopened terminal tab', () => {
			const closedTermTab = createMockTerminalTab({ id: 'original-id' });
			const closedEntry: ClosedTabEntry = {
				type: 'terminal',
				tab: closedTermTab,
				unifiedIndex: 0,
				closedAt: Date.now(),
			};
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
				unifiedClosedTabHistory: [closedEntry],
			});

			const result = reopenUnifiedClosedTab(session);

			expect(result).not.toBeNull();
			expect(result!.session.terminalTabs[0].id).not.toBe('original-id');
			expect(result!.session.terminalTabs[0].id).toBe('mock-id-1');
		});

		it('inserts reopened terminal tab at original unified index', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const aiTab2 = createMockAITab({ id: 'ai-2' });
			const closedTermTab = createMockTerminalTab({ id: 'closed-term' });
			const closedEntry: ClosedTabEntry = {
				type: 'terminal',
				tab: closedTermTab,
				unifiedIndex: 1, // Between the two AI tabs
				closedAt: Date.now(),
			};
			const session = createMockSession({
				aiTabs: [aiTab, aiTab2],
				activeTabId: 'ai-1',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'ai', id: 'ai-2' },
				],
				unifiedClosedTabHistory: [closedEntry],
			});

			const result = reopenUnifiedClosedTab(session);

			expect(result!.session.unifiedTabOrder).toHaveLength(3);
			expect(result!.session.unifiedTabOrder[1]).toEqual({
				type: 'terminal',
				id: 'mock-id-1',
			});
		});

		it('removes entry from unified history after reopening', () => {
			const closedTermTab = createMockTerminalTab({ id: 'closed-term' });
			const closedEntry: ClosedTabEntry = {
				type: 'terminal',
				tab: closedTermTab,
				unifiedIndex: 0,
				closedAt: Date.now(),
			};
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
				unifiedClosedTabHistory: [closedEntry],
			});

			const result = reopenUnifiedClosedTab(session);

			expect(result!.session.unifiedClosedTabHistory).toHaveLength(0);
		});
	});

	// ============================================================================
	// Unified navigation with terminal tabs
	// ============================================================================

	describe('navigateToUnifiedTabByIndex with terminal tabs', () => {
		it('navigates to a terminal tab by index', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = navigateToUnifiedTabByIndex(session, 1);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.id).toBe('term-1');
			expect(result!.session.activeTerminalTabId).toBe('term-1');
			expect(result!.session.activeFileTabId).toBeNull();
		});

		it('returns current state when terminal tab is already active', () => {
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [{ type: 'terminal', id: 'term-1' }],
			});

			const result = navigateToUnifiedTabByIndex(session, 0);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.session).toBe(session); // Same reference = no state change
		});

		it('clears terminal tab when navigating to AI tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = navigateToUnifiedTabByIndex(session, 0);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('ai');
			expect(result!.session.activeTerminalTabId).toBeNull();
			expect(result!.session.activeFileTabId).toBeNull();
		});

		it('returns null for non-existent terminal tab', () => {
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				terminalTabs: [], // No terminal tabs
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'ghost-term' }, // Orphaned ref
				],
			});

			const result = navigateToUnifiedTabByIndex(session, 1);

			expect(result).toBeNull();
		});
	});

	describe('navigateToNextUnifiedTab with terminal tabs', () => {
		it('cycles from AI tab to terminal tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = navigateToNextUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.id).toBe('term-1');
		});

		it('cycles from terminal tab back to AI tab (wrap around)', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = navigateToNextUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('ai');
			expect(result!.id).toBe('ai-1');
		});

		it('cycles through multiple terminal tabs', () => {
			const term1 = createMockTerminalTab({ id: 'term-1' });
			const term2 = createMockTerminalTab({ id: 'term-2' });
			const term3 = createMockTerminalTab({ id: 'term-3' });
			const session = createMockSession({
				aiTabs: [createMockAITab({ id: 'ai-1' })],
				activeTabId: 'ai-1',
				terminalTabs: [term1, term2, term3],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'terminal', id: 'term-2' },
					{ type: 'terminal', id: 'term-3' },
				],
			});

			const result = navigateToNextUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.id).toBe('term-2');
		});

		it('includes terminal tabs when showUnreadOnly filters AI tabs', () => {
			// AI tab that would be filtered out (no unread, no draft)
			const aiTab = createMockAITab({ id: 'ai-1', hasUnread: false, inputValue: '' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			// Terminal tabs are always navigable even with showUnreadOnly
			const result = navigateToNextUnifiedTab(session, true);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
		});
	});

	describe('navigateToPrevUnifiedTab with terminal tabs', () => {
		it('cycles from AI tab backward to terminal tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'ai', id: 'ai-1' },
				],
			});

			const result = navigateToPrevUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.id).toBe('term-1');
		});

		it('wraps from first terminal tab to last tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: 'term-1',
				unifiedTabOrder: [
					{ type: 'terminal', id: 'term-1' },
					{ type: 'ai', id: 'ai-1' },
				],
			});

			const result = navigateToPrevUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('ai');
			expect(result!.id).toBe('ai-1');
		});
	});

	describe('navigateToLastUnifiedTab with terminal tabs', () => {
		it('navigates to last terminal tab', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			const result = navigateToLastUnifiedTab(session);

			expect(result).not.toBeNull();
			expect(result!.type).toBe('terminal');
			expect(result!.id).toBe('term-1');
		});
	});

	// ============================================================================
	// End-to-end multi-tab workflow
	// ============================================================================

	describe('multi-tab workflow integration', () => {
		it('supports full create-select-close-reopen cycle', () => {
			// Start with a session that has one AI tab
			const aiTab = createMockAITab({ id: 'ai-1' });
			let session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				unifiedTabOrder: [{ type: 'ai', id: 'ai-1' }],
			});

			// Step 1: Create first terminal tab
			const create1 = createTerminalTab(session);
			expect(create1).not.toBeNull();
			session = create1!.session;
			const term1Id = create1!.tab.id;

			expect(session.terminalTabs).toHaveLength(1);
			expect(session.activeTerminalTabId).toBe(term1Id);
			expect(session.unifiedTabOrder).toHaveLength(2);

			// Step 2: Create second terminal tab
			const create2 = createTerminalTab(session);
			expect(create2).not.toBeNull();
			session = create2!.session;
			const term2Id = create2!.tab.id;

			expect(session.terminalTabs).toHaveLength(2);
			expect(session.activeTerminalTabId).toBe(term2Id);
			expect(session.unifiedTabOrder).toHaveLength(3);

			// Step 3: Navigate to first terminal tab via index
			const nav = navigateToUnifiedTabByIndex(session, 1); // Index 1 = term1
			expect(nav).not.toBeNull();
			session = nav!.session;
			expect(session.activeTerminalTabId).toBe(term1Id);

			// Step 4: Close the first terminal tab
			const close = closeTerminalTab(session, term1Id);
			expect(close).not.toBeNull();
			session = close!.session;

			expect(session.terminalTabs).toHaveLength(1);
			expect(session.terminalTabs[0].id).toBe(term2Id);
			expect(session.unifiedClosedTabHistory).toHaveLength(1);
			expect(session.unifiedClosedTabHistory[0].type).toBe('terminal');

			// Step 5: Reopen the closed terminal tab (Cmd+Shift+T)
			const reopen = reopenUnifiedClosedTab(session);
			expect(reopen).not.toBeNull();
			session = reopen!.session;

			expect(reopen!.tabType).toBe('terminal');
			expect(session.terminalTabs).toHaveLength(2);
			expect(session.activeTerminalTabId).toBe(reopen!.tabId);
			expect(session.unifiedClosedTabHistory).toHaveLength(0);
		});

		it('handles mixed AI, file, and terminal tabs correctly', () => {
			const aiTab = createMockAITab({ id: 'ai-1' });
			const termTab = createMockTerminalTab({ id: 'term-1' });
			const session = createMockSession({
				aiTabs: [aiTab],
				activeTabId: 'ai-1',
				terminalTabs: [termTab],
				activeTerminalTabId: null,
				filePreviewTabs: [{
					id: 'file-1',
					path: '/test/file.ts',
					name: 'file',
					extension: '.ts',
					content: '// test',
					scrollTop: 0,
					searchQuery: '',
					editMode: false,
					editContent: undefined,
					createdAt: Date.now(),
					lastModified: Date.now(),
				}],
				activeFileTabId: null,
				unifiedTabOrder: [
					{ type: 'ai', id: 'ai-1' },
					{ type: 'file', id: 'file-1' },
					{ type: 'terminal', id: 'term-1' },
				],
			});

			// Can navigate through all three types
			const nav1 = navigateToUnifiedTabByIndex(session, 0);
			expect(nav1!.type).toBe('ai');

			const nav2 = navigateToUnifiedTabByIndex(session, 1);
			expect(nav2!.type).toBe('file');

			const nav3 = navigateToUnifiedTabByIndex(session, 2);
			expect(nav3!.type).toBe('terminal');
		});
	});
});
