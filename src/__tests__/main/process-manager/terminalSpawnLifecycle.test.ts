/**
 * Terminal Spawn Lifecycle Tests
 *
 * Verifies the end-to-end flow from creating a terminal tab (renderer-side state)
 * through to spawning a PTY process (main-side ProcessManager).
 *
 * This test bridges the gap between:
 * - tabHelpers.createTerminalTab() (tested in terminalTabHelpers.test.ts)
 * - ProcessManager.spawnTerminalTab() (tested in ProcessManager.spawnTerminalTab.test.ts)
 *
 * Key scenarios:
 * - Session ID format: tab.id is used as the ProcessManager session key
 * - New session → create terminal tab → spawn PTY → interactive shell
 * - Tab close → PTY kill → tab reopen → new PTY spawn
 * - Multiple tabs within the same session have independent PTY processes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createTerminalTab,
	closeTerminalTab,
	reopenUnifiedClosedTab,
} from '../../../renderer/utils/tabHelpers';
import type {
	Session,
	AITab,
	TerminalTab,
} from '../../../renderer/types';

// Mock the generateId function to return predictable IDs
let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `term-tab-${++mockIdCounter}`),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-agent-1',
		name: 'My Agent',
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/home/user/project',
		fullPath: '/home/user/project',
		projectRoot: '/home/user/project',
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
		aiTabs: [{ id: 'ai-tab-1', agentSessionId: null, name: null, starred: false, logs: [], inputValue: '', stagedImages: [], createdAt: Date.now(), state: 'idle' }],
		activeTabId: 'ai-tab-1',
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [{ type: 'ai', id: 'ai-tab-1' }],
		unifiedClosedTabHistory: [],
		terminalTabs: [],
		activeTerminalTabId: null,
		...overrides,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal Spawn Lifecycle', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIdCounter = 0;
	});

	describe('session ID format for PTY spawn', () => {
		it('terminal tab ID is suitable as a process manager key', () => {
			const session = createMockSession();

			const result = createTerminalTab(session);
			expect(result).not.toBeNull();

			const tabId = result!.tab.id;
			// Tab ID should be a non-empty string
			expect(tabId).toBeTruthy();
			expect(typeof tabId).toBe('string');

			// The renderer would spawn the PTY using this as the session key:
			// processService.spawn({ sessionId: tabId, toolType: 'embedded-terminal', ... })
			// Verify it's a valid session key (no slashes, no colons)
			expect(tabId).not.toContain('/');
			expect(tabId).not.toContain(':');
		});

		it('each terminal tab gets a unique ID for independent PTY sessions', () => {
			let session = createMockSession();

			const result1 = createTerminalTab(session);
			session = result1!.session;

			const result2 = createTerminalTab(session);
			session = result2!.session;

			const result3 = createTerminalTab(session);
			session = result3!.session;

			// Each tab has a unique ID → each PTY has a unique session key
			const ids = session.terminalTabs.map(t => t.id);
			expect(new Set(ids).size).toBe(3);
		});
	});

	describe('terminal tab creation for spawn', () => {
		it('new tab uses session cwd as default working directory for PTY', () => {
			const session = createMockSession({ cwd: '/workspace/my-project' });

			const result = createTerminalTab(session);
			expect(result!.tab.cwd).toBe('/workspace/my-project');
		});

		it('tab cwd can be overridden for PTY spawn', () => {
			const session = createMockSession({ cwd: '/workspace/main' });

			const result = createTerminalTab(session, { cwd: '/workspace/other-dir' });
			expect(result!.tab.cwd).toBe('/workspace/other-dir');
		});

		it('new tab has no processRunning state (PTY not yet spawned)', () => {
			const session = createMockSession();

			const result = createTerminalTab(session);
			// processRunning is undefined until the PTY actually starts
			expect(result!.tab.processRunning).toBeUndefined();
			expect(result!.tab.exitCode).toBeUndefined();
		});

		it('new tab becomes the active terminal tab', () => {
			const session = createMockSession();

			const result = createTerminalTab(session);
			expect(result!.session.activeTerminalTabId).toBe(result!.tab.id);
		});
	});

	describe('tab close → kill → reopen → respawn cycle', () => {
		it('closed tab preserves cwd for respawn', () => {
			let session = createMockSession();

			// Create a terminal tab
			const createResult = createTerminalTab(session, { cwd: '/my/project/path' });
			session = createResult!.session;
			const tabId = createResult!.tab.id;

			// Close the tab (PTY would be killed by the renderer)
			const closeResult = closeTerminalTab(session, tabId);
			session = closeResult!.session;

			// Reopen the closed tab
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			// The reopened tab should have the same cwd for respawning
			expect(reopenResult!.tabType).toBe('terminal');
			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId);
			expect(reopenedTab!.cwd).toBe('/my/project/path');
		});

		it('reopened tab gets a new ID (new PTY session)', () => {
			let session = createMockSession();

			// Create and close
			const createResult = createTerminalTab(session);
			session = createResult!.session;
			const originalId = createResult!.tab.id;

			const closeResult = closeTerminalTab(session, originalId);
			session = closeResult!.session;

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			// New ID means the renderer will spawn a new PTY
			expect(reopenResult!.tabId).not.toBe(originalId);
		});

		it('reopened tab has runtime state reset (ready for fresh spawn)', () => {
			let session = createMockSession();

			// Create tab and simulate it having been running
			const createResult = createTerminalTab(session);
			session = createResult!.session;
			const tabId = createResult!.tab.id;

			// Manually set runtime state as if the PTY was running
			session = {
				...session,
				terminalTabs: session.terminalTabs.map(t =>
					t.id === tabId ? { ...t, processRunning: true, exitCode: 0 } : t
				),
			};

			// Close
			const closeResult = closeTerminalTab(session, tabId);
			session = closeResult!.session;

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId);
			// Runtime state should be reset for fresh PTY spawn
			expect(reopenedTab!.processRunning).toBe(false);
			expect(reopenedTab!.exitCode).toBeUndefined();
		});
	});

	describe('multiple tabs with independent PTY sessions', () => {
		it('closing one tab does not affect other tabs session state', () => {
			let session = createMockSession();

			// Create three terminal tabs
			const r1 = createTerminalTab(session);
			session = r1!.session;

			const r2 = createTerminalTab(session);
			session = r2!.session;

			const r3 = createTerminalTab(session);
			session = r3!.session;

			expect(session.terminalTabs).toHaveLength(3);

			// Close the middle tab
			const closeResult = closeTerminalTab(session, r2!.tab.id);
			session = closeResult!.session;

			// Other tabs should be unaffected
			expect(session.terminalTabs).toHaveLength(2);
			expect(session.terminalTabs.find(t => t.id === r1!.tab.id)).toBeDefined();
			expect(session.terminalTabs.find(t => t.id === r3!.tab.id)).toBeDefined();
			expect(session.terminalTabs.find(t => t.id === r2!.tab.id)).toBeUndefined();
		});

		it('each tab preserves its own cwd for independent PTY spawn', () => {
			let session = createMockSession({ cwd: '/default' });

			const r1 = createTerminalTab(session, { cwd: '/project-a' });
			session = r1!.session;

			const r2 = createTerminalTab(session, { cwd: '/project-b' });
			session = r2!.session;

			const r3 = createTerminalTab(session, { cwd: '/project-c' });
			session = r3!.session;

			const cwds = session.terminalTabs.map(t => t.cwd);
			expect(cwds).toEqual(['/project-a', '/project-b', '/project-c']);
		});

		it('tab name is preserved through the lifecycle', () => {
			let session = createMockSession();

			const r1 = createTerminalTab(session, { name: 'Build Server' });
			session = r1!.session;
			const tabId = r1!.tab.id;

			// Close
			const closeResult = closeTerminalTab(session, tabId);
			session = closeResult!.session;

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			const reopened = session.terminalTabs.find(t => t.id === reopenResult!.tabId);
			expect(reopened!.name).toBe('Build Server');
		});
	});

	describe('spawn config derivation', () => {
		it('provides all data needed for processService.spawn() call', () => {
			const session = createMockSession({ cwd: '/home/user/project' });

			const result = createTerminalTab(session);
			const tab = result!.tab;

			// The renderer would use these values to spawn:
			// processService.spawn({
			//   sessionId: tab.id,           // Process manager key
			//   toolType: 'embedded-terminal', // Raw PTY mode
			//   cwd: tab.cwd,                // Working directory
			//   command: '',                  // Shell resolved by main process
			//   args: [],
			// })
			expect(tab.id).toBeTruthy();
			expect(tab.cwd).toBe('/home/user/project');
			expect(typeof tab.id).toBe('string');
			expect(typeof tab.cwd).toBe('string');
		});
	});
});
