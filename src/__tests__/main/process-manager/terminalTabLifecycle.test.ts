/**
 * Terminal Tab Lifecycle Tests
 *
 * End-to-end integration tests verifying the full lifecycle of terminal tabs:
 * 1. Close tabs → verify PTY is killed (process removed from ProcessManager)
 * 2. Reopen closed tab (Cmd+Shift+T) → verify fresh tab with new ID
 * 3. Spawn new PTY for reopened tab → verify same cwd, new process
 *
 * These tests bridge renderer-side state management (tabHelpers) with
 * main-side process management (ProcessManager) to validate the complete
 * close → kill → reopen → respawn cycle.
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

// ── Hoisted mocks ──────────────────────────────────────────────────────────

// Each PTY process gets independent handlers for isolation verification
interface MockPty {
	pid: number;
	onData: ReturnType<typeof vi.fn>;
	onExit: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
	_dataHandlers: Array<(data: string) => void>;
	_exitHandlers: Array<(exit: { exitCode: number }) => void>;
	_simulateData: (data: string) => void;
	_simulateExit: (exitCode: number) => void;
}

const { mockPtySpawn, spawnedPtys } = vi.hoisted(() => {
	const _spawnedPtys: MockPty[] = [];
	let _pidCounter = 200;

	const _mockPtySpawn = vi.fn(() => {
		const dataHandlers: Array<(data: string) => void> = [];
		const exitHandlers: Array<(exit: { exitCode: number }) => void> = [];

		const pty: MockPty = {
			pid: _pidCounter++,
			onData: vi.fn((handler: (data: string) => void) => {
				dataHandlers.push(handler);
				return { dispose: vi.fn() };
			}),
			onExit: vi.fn((handler: (exit: { exitCode: number }) => void) => {
				exitHandlers.push(handler);
				return { dispose: vi.fn() };
			}),
			write: vi.fn(),
			resize: vi.fn(),
			kill: vi.fn(),
			_dataHandlers: dataHandlers,
			_exitHandlers: exitHandlers,
			_simulateData: (data: string) => {
				for (const handler of dataHandlers) handler(data);
			},
			_simulateExit: (exitCode: number) => {
				for (const handler of exitHandlers) handler({ exitCode });
			},
		};

		_spawnedPtys.push(pty);
		return pty;
	});

	return {
		mockPtySpawn: _mockPtySpawn,
		spawnedPtys: _spawnedPtys,
	};
});

// Predictable tab IDs for assertions
let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `lifecycle-tab-${++mockIdCounter}`),
}));

vi.mock('node-pty', () => ({
	spawn: (...args: unknown[]) => mockPtySpawn(...args),
}));

vi.mock('fs', () => ({
	accessSync: vi.fn(),
	constants: { X_OK: 1 },
}));

vi.mock('../../../main/utils/terminalFilter', () => ({
	stripControlSequences: vi.fn((data: string) => data),
}));

vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../main/process-manager/utils/envBuilder', () => ({
	buildPtyTerminalEnv: vi.fn(() => ({
		PATH: '/usr/bin:/usr/local/bin',
		TERM: 'xterm-256color',
		HOME: '/home/testuser',
	})),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { ProcessManager } from '../../../main/process-manager/ProcessManager';

// ── Helpers ────────────────────────────────────────────────────────────────

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

function createMockSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-lifecycle',
		name: 'Lifecycle Test Session',
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
		aiTabs: [createMockAITab()],
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

/**
 * Create a terminal tab and spawn its PTY in one step.
 * Returns the updated session, the tab, and the index of the spawned PTY in spawnedPtys[].
 */
function createAndSpawnTab(
	pm: ProcessManager,
	session: Session,
	options?: { cwd?: string; name?: string }
): { session: Session; tab: TerminalTab; ptyIndex: number } {
	const result = createTerminalTab(session, options);
	const tab = result!.tab;
	const ptyIndexBefore = spawnedPtys.length;

	pm.spawnTerminalTab({
		sessionId: tab.id,
		cwd: tab.cwd,
	});

	return {
		session: result!.session,
		tab,
		ptyIndex: ptyIndexBefore,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal Tab Lifecycle', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		spawnedPtys.length = 0;
		mockIdCounter = 0;
		pm = new ProcessManager();
	});

	// ========================================================================
	// Close tabs — verify PTY is killed
	// ========================================================================

	describe('close tab kills PTY', () => {
		it('closing a tab and killing its PTY removes it from ProcessManager', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session, { cwd: '/project' });
			session = s1;

			// Verify the PTY is alive
			expect(pm.get(tab.id)).toBeDefined();
			expect(pm.get(tab.id)!.isTerminal).toBe(true);

			// Close the tab in state
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;

			// Kill the PTY (as the renderer would do)
			const killed = pm.kill(tab.id);

			expect(killed).toBe(true);
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('PTY kill() is invoked on the underlying node-pty process', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			pm.kill(tab.id);

			// The mock PTY's kill() method was called
			expect(spawnedPtys[ptyIndex].kill).toHaveBeenCalled();
		});

		it('process is removed from map after kill — get() returns undefined', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Process exists before kill
			expect(pm.get(tab.id)).toBeDefined();

			// Close and kill
			closeTerminalTab(session, tab.id);
			pm.kill(tab.id);

			// Process fully removed — no stale references
			expect(pm.get(tab.id)).toBeUndefined();
			expect(pm.getAll().find(p => p.sessionId === tab.id)).toBeUndefined();
		});

		it('writing to a killed tab returns false', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Write succeeds before kill
			expect(pm.write(tab.id, 'hello\r')).toBe(true);

			// Close and kill
			closeTerminalTab(session, tab.id);
			pm.kill(tab.id);

			// Write fails after kill
			expect(pm.write(tab.id, 'ghost command\r')).toBe(false);
		});

		it('closing active tab selects an adjacent tab while PTY is killed', () => {
			let session = createMockSession();
			const { session: s1 } = createAndSpawnTab(pm, session, { cwd: '/a' });
			session = s1;
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session, { cwd: '/b' });
			session = s2;

			// tabB is active (most recently created)
			expect(session.activeTerminalTabId).toBe(tabB.id);

			// Close active tab
			const closeResult = closeTerminalTab(session, tabB.id);
			session = closeResult!.session;
			pm.kill(tabB.id);

			// Adjacent tab (tabA) becomes active
			expect(session.terminalTabs).toHaveLength(1);
			expect(session.activeTerminalTabId).toBe(session.terminalTabs[0].id);

			// Killed tab is gone from ProcessManager
			expect(pm.get(tabB.id)).toBeUndefined();

			// Surviving tab's PTY is still alive
			expect(pm.get(session.terminalTabs[0].id)).toBeDefined();
		});

		it('closing all terminal tabs falls back to AI tab', () => {
			let session = createMockSession();
			const { session: s1, tab: tabA } = createAndSpawnTab(pm, session);
			session = s1;
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session);
			session = s2;

			// Close both
			const close1 = closeTerminalTab(session, tabB.id);
			session = close1!.session;
			pm.kill(tabB.id);

			const close2 = closeTerminalTab(session, tabA.id);
			session = close2!.session;
			pm.kill(tabA.id);

			expect(session.terminalTabs).toHaveLength(0);
			expect(session.activeTerminalTabId).toBeNull();
			expect(session.activeTabId).toBe('ai-tab-1'); // Falls back to AI tab
		});
	});

	// ========================================================================
	// Reopen closed tab (Cmd+Shift+T)
	// ========================================================================

	describe('reopen closed tab via Cmd+Shift+T', () => {
		it('reopened tab appears in unifiedClosedTabHistory then is restored', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session, { cwd: '/workspace' });
			session = s1;

			// Close and kill
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;
			pm.kill(tab.id);

			// Tab is in the closed history
			expect(session.unifiedClosedTabHistory).toHaveLength(1);
			expect(session.unifiedClosedTabHistory[0].type).toBe('terminal');

			// Reopen (Cmd+Shift+T)
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			// History is now empty
			expect(session.unifiedClosedTabHistory).toHaveLength(0);

			// Tab is back in terminalTabs
			expect(session.terminalTabs).toHaveLength(1);
			expect(reopenResult!.tabType).toBe('terminal');
		});

		it('reopened tab gets a new ID (old PTY session key is dead)', () => {
			let session = createMockSession();
			const { session: s1, tab: originalTab } = createAndSpawnTab(pm, session);
			session = s1;
			const originalId = originalTab.id;

			// Close and kill
			closeTerminalTab(session, originalId);
			session = closeTerminalTab(session, originalId)!.session;
			pm.kill(originalId);

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			// New ID ensures the renderer spawns a fresh PTY
			expect(reopenResult!.tabId).not.toBe(originalId);
		});

		it('reopened tab has runtime state reset for fresh PTY spawn', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Simulate runtime state that would have been set while PTY was running
			session = {
				...session,
				terminalTabs: session.terminalTabs.map(t =>
					t.id === tab.id ? { ...t, processRunning: true, exitCode: 0 } : t
				),
			};

			// Close and kill
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;
			pm.kill(tab.id);

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;
			expect(reopenedTab.processRunning).toBe(false);
			expect(reopenedTab.exitCode).toBeUndefined();
		});

		it('reopened tab becomes the active terminal tab', () => {
			let session = createMockSession();
			const { session: s1, tab: tabA } = createAndSpawnTab(pm, session, { cwd: '/a' });
			session = s1;
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session, { cwd: '/b' });
			session = s2;

			// Close tabA (non-active)
			const closeResult = closeTerminalTab(session, tabA.id);
			session = closeResult!.session;
			pm.kill(tabA.id);

			// tabB should still be active
			expect(session.activeTerminalTabId).toBe(tabB.id);

			// Reopen tabA
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			// Reopened tab becomes active
			expect(session.activeTerminalTabId).toBe(reopenResult!.tabId);
		});

		it('preserves user-assigned tab name through close and reopen', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session, {
				cwd: '/project',
				name: 'Dev Server',
			});
			session = s1;

			// Close and kill
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;
			pm.kill(tab.id);

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;

			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;
			expect(reopenedTab.name).toBe('Dev Server');
		});

		it('reopens tabs in LIFO order (most recently closed first)', () => {
			let session = createMockSession();
			const { session: s1, tab: tabA } = createAndSpawnTab(pm, session, {
				cwd: '/first',
				name: 'First',
			});
			session = s1;
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session, {
				cwd: '/second',
				name: 'Second',
			});
			session = s2;
			const { session: s3, tab: tabC } = createAndSpawnTab(pm, session, {
				cwd: '/third',
				name: 'Third',
			});
			session = s3;

			// Close all three
			const c1 = closeTerminalTab(session, tabA.id);
			session = c1!.session;
			pm.kill(tabA.id);

			const c2 = closeTerminalTab(session, tabB.id);
			session = c2!.session;
			pm.kill(tabB.id);

			const c3 = closeTerminalTab(session, tabC.id);
			session = c3!.session;
			pm.kill(tabC.id);

			expect(session.unifiedClosedTabHistory).toHaveLength(3);

			// Reopen — should come back in reverse order (LIFO)
			const r1 = reopenUnifiedClosedTab(session);
			session = r1!.session;
			expect(session.terminalTabs[session.terminalTabs.length - 1].name).toBe('Third');

			const r2 = reopenUnifiedClosedTab(session);
			session = r2!.session;
			expect(session.terminalTabs[session.terminalTabs.length - 1].name).toBe('Second');

			const r3 = reopenUnifiedClosedTab(session);
			session = r3!.session;
			expect(session.terminalTabs[session.terminalTabs.length - 1].name).toBe('First');

			expect(session.unifiedClosedTabHistory).toHaveLength(0);
		});
	});

	// ========================================================================
	// Verify new PTY is spawned with same cwd
	// ========================================================================

	describe('respawned PTY uses original cwd', () => {
		it('complete cycle: create → run → close → kill → reopen → respawn preserves cwd', () => {
			let session = createMockSession();
			const originalCwd = '/home/user/my-project';

			// Step 1: Create tab and spawn PTY
			const { session: s1, tab: originalTab, ptyIndex: pty1Index } =
				createAndSpawnTab(pm, session, { cwd: originalCwd });
			session = s1;

			// Step 2: Verify PTY is running with correct cwd
			const originalProc = pm.get(originalTab.id);
			expect(originalProc).toBeDefined();
			expect(originalProc!.cwd).toBe(originalCwd);

			// Step 3: Simulate some activity (writing to the terminal)
			pm.write(originalTab.id, 'npm run dev\r');
			spawnedPtys[pty1Index]._simulateData('> Starting dev server...\r\n');

			// Step 4: Close tab and kill PTY
			const closeResult = closeTerminalTab(session, originalTab.id);
			session = closeResult!.session;
			pm.kill(originalTab.id);

			expect(pm.get(originalTab.id)).toBeUndefined();

			// Step 5: Reopen the closed tab (Cmd+Shift+T)
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;

			// Step 6: Verify reopened tab preserved the cwd
			expect(reopenedTab.cwd).toBe(originalCwd);

			// Step 7: Spawn a new PTY for the reopened tab
			pm.spawnTerminalTab({
				sessionId: reopenedTab.id,
				cwd: reopenedTab.cwd,
			});

			// Step 8: Verify the new PTY is running with the original cwd
			const newProc = pm.get(reopenedTab.id);
			expect(newProc).toBeDefined();
			expect(newProc!.cwd).toBe(originalCwd);
			expect(newProc!.isTerminal).toBe(true);

			// Step 9: Verify it's a fresh PTY (different PID)
			expect(newProc!.pid).not.toBe(originalProc!.pid);

			// Step 10: Verify the new PTY is functional
			pm.write(reopenedTab.id, 'echo hello\r');
			const lastPty = spawnedPtys[spawnedPtys.length - 1];
			expect(lastPty.write).toHaveBeenCalledWith('echo hello\r');
		});

		it('each reopened tab gets its own PTY (multi-tab respawn)', () => {
			let session = createMockSession();

			// Create 3 tabs with different cwds
			const cwds = ['/frontend', '/backend', '/infra'];
			const tabs: TerminalTab[] = [];

			for (const cwd of cwds) {
				const { session: s, tab } = createAndSpawnTab(pm, session, { cwd });
				session = s;
				tabs.push(tab);
			}

			// Close all 3
			for (const tab of tabs) {
				const closeResult = closeTerminalTab(session, tab.id);
				session = closeResult!.session;
				pm.kill(tab.id);
			}

			expect(session.terminalTabs).toHaveLength(0);

			// Reopen all 3 and spawn fresh PTYs
			const reopenedTabs: TerminalTab[] = [];
			for (let i = 0; i < 3; i++) {
				const reopenResult = reopenUnifiedClosedTab(session);
				session = reopenResult!.session;
				const reopened = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;
				reopenedTabs.push(reopened);

				pm.spawnTerminalTab({
					sessionId: reopened.id,
					cwd: reopened.cwd,
				});
			}

			// Verify each reopened tab has the correct cwd and its own PTY
			// (LIFO order means they come back reversed: infra, backend, frontend)
			expect(reopenedTabs[0].cwd).toBe('/infra');
			expect(reopenedTabs[1].cwd).toBe('/backend');
			expect(reopenedTabs[2].cwd).toBe('/frontend');

			for (const tab of reopenedTabs) {
				const proc = pm.get(tab.id);
				expect(proc).toBeDefined();
				expect(proc!.cwd).toBe(tab.cwd);
				expect(proc!.isTerminal).toBe(true);
			}

			// Each PTY has a unique PID
			const pids = reopenedTabs.map(t => pm.get(t.id)!.pid);
			expect(new Set(pids).size).toBe(3);
		});

		it('respawned PTY receives data independently from other tabs', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			let session = createMockSession();

			// Create two tabs
			const { session: s1, tab: tabA, ptyIndex: ptyA } =
				createAndSpawnTab(pm, session, { cwd: '/project-a' });
			session = s1;
			const { session: s2, tab: tabB } =
				createAndSpawnTab(pm, session, { cwd: '/project-b' });
			session = s2;

			// Close tab A and kill PTY
			const closeResult = closeTerminalTab(session, tabA.id);
			session = closeResult!.session;
			pm.kill(tabA.id);

			// Reopen tab A and spawn new PTY
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedA = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;

			pm.spawnTerminalTab({
				sessionId: reopenedA.id,
				cwd: reopenedA.cwd,
			});

			// Get the new PTY for the reopened tab
			const newPtyIndex = spawnedPtys.length - 1;

			// Simulate data from the respawned PTY
			spawnedPtys[newPtyIndex]._simulateData('respawned output\r\n');

			// Verify it's correctly tagged with the new tab ID
			const respawnedEvents = rawDataEvents.filter(e => e.sessionId === reopenedA.id);
			expect(respawnedEvents).toHaveLength(1);
			expect(respawnedEvents[0].data).toBe('respawned output\r\n');

			// Verify old tab ID is not receiving events
			const oldTabEvents = rawDataEvents.filter(e => e.sessionId === tabA.id);
			expect(oldTabEvents).toHaveLength(0);
		});
	});

	// ========================================================================
	// Repeated close/reopen cycles
	// ========================================================================

	describe('repeated close and reopen cycles', () => {
		it('tab can be closed and reopened multiple times', () => {
			let session = createMockSession();
			const cwd = '/persistent-project';
			let currentTabId: string;

			// Cycle 1: Create → Close → Kill
			const { session: s1, tab: tab1 } = createAndSpawnTab(pm, session, { cwd });
			session = s1;
			currentTabId = tab1.id;

			const c1 = closeTerminalTab(session, currentTabId);
			session = c1!.session;
			pm.kill(currentTabId);

			// Cycle 1: Reopen → Spawn
			const r1 = reopenUnifiedClosedTab(session);
			session = r1!.session;
			currentTabId = r1!.tabId;
			const tab2 = session.terminalTabs.find(t => t.id === currentTabId)!;
			expect(tab2.cwd).toBe(cwd);

			pm.spawnTerminalTab({ sessionId: currentTabId, cwd: tab2.cwd });
			expect(pm.get(currentTabId)).toBeDefined();

			// Cycle 2: Close → Kill
			const c2 = closeTerminalTab(session, currentTabId);
			session = c2!.session;
			pm.kill(currentTabId);

			// Cycle 2: Reopen → Spawn
			const r2 = reopenUnifiedClosedTab(session);
			session = r2!.session;
			currentTabId = r2!.tabId;
			const tab3 = session.terminalTabs.find(t => t.id === currentTabId)!;
			expect(tab3.cwd).toBe(cwd);

			pm.spawnTerminalTab({ sessionId: currentTabId, cwd: tab3.cwd });
			expect(pm.get(currentTabId)).toBeDefined();

			// Cycle 3: Close → Kill
			const c3 = closeTerminalTab(session, currentTabId);
			session = c3!.session;
			pm.kill(currentTabId);

			// Cycle 3: Reopen → Spawn
			const r3 = reopenUnifiedClosedTab(session);
			session = r3!.session;
			currentTabId = r3!.tabId;
			const tab4 = session.terminalTabs.find(t => t.id === currentTabId)!;
			expect(tab4.cwd).toBe(cwd);

			pm.spawnTerminalTab({ sessionId: currentTabId, cwd: tab4.cwd });
			expect(pm.get(currentTabId)).toBeDefined();

			// Verify: 4 total PTYs spawned (1 original + 3 respawns)
			expect(spawnedPtys).toHaveLength(4);

			// Verify: only 1 process alive (the latest)
			expect(pm.get(tab1.id)).toBeUndefined();
			expect(pm.get(currentTabId)).toBeDefined();
		});

		it('PTY exit event triggers process cleanup, tab can still be closed and reopened', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session, {
				cwd: '/project',
			});
			session = s1;

			// PTY exits on its own (e.g., user typed `exit`)
			spawnedPtys[ptyIndex]._simulateExit(0);

			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 0 });

			// Process is cleaned up after exit
			expect(pm.get(tab.id)).toBeUndefined();

			// Close the tab in state (PTY already dead)
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;

			// Reopen and respawn
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;

			pm.spawnTerminalTab({
				sessionId: reopenedTab.id,
				cwd: reopenedTab.cwd,
			});

			// New PTY is alive
			expect(pm.get(reopenedTab.id)).toBeDefined();
			expect(pm.get(reopenedTab.id)!.cwd).toBe('/project');
		});
	});

	// ========================================================================
	// Edge cases
	// ========================================================================

	describe('edge cases', () => {
		it('killing a non-existent tab ID returns false', () => {
			expect(pm.kill('nonexistent-tab-id')).toBe(false);
		});

		it('reopen with empty history returns null', () => {
			const session = createMockSession();
			const result = reopenUnifiedClosedTab(session);
			expect(result).toBeNull();
		});

		it('close tab that was already killed by PTY exit still adds to history', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session, {
				cwd: '/project',
			});
			session = s1;

			// PTY exits naturally
			spawnedPtys[ptyIndex]._simulateExit(0);
			expect(pm.get(tab.id)).toBeUndefined();

			// Tab is still in session state — user closes it in the UI
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;

			// Tab goes into history for undo
			expect(session.unifiedClosedTabHistory).toHaveLength(1);
			expect(session.terminalTabs).toHaveLength(0);

			// Can still reopen and respawn
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;

			pm.spawnTerminalTab({
				sessionId: reopenedTab.id,
				cwd: reopenedTab.cwd,
			});

			expect(pm.get(reopenedTab.id)).toBeDefined();
			expect(reopenedTab.cwd).toBe('/project');
		});

		it('ProcessManager state stays clean after multiple close/reopen cycles', () => {
			let session = createMockSession();

			// Rapidly create 5 tabs
			const tabIds: string[] = [];
			for (let i = 0; i < 5; i++) {
				const { session: s, tab } = createAndSpawnTab(pm, session, {
					cwd: `/project-${i}`,
				});
				session = s;
				tabIds.push(tab.id);
			}

			// Close all 5
			for (const tabId of tabIds) {
				const closeResult = closeTerminalTab(session, tabId);
				session = closeResult!.session;
				pm.kill(tabId);
			}

			// All processes removed
			for (const tabId of tabIds) {
				expect(pm.get(tabId)).toBeUndefined();
			}

			// Reopen 3 of them
			for (let i = 0; i < 3; i++) {
				const reopenResult = reopenUnifiedClosedTab(session);
				session = reopenResult!.session;
				const reopenedTab = session.terminalTabs.find(t => t.id === reopenResult!.tabId)!;

				pm.spawnTerminalTab({
					sessionId: reopenedTab.id,
					cwd: reopenedTab.cwd,
				});
			}

			// Exactly 3 processes alive (the respawned ones)
			const allProcesses = pm.getAll();
			const terminalProcesses = allProcesses.filter(p => p.isTerminal);
			expect(terminalProcesses).toHaveLength(3);

			// 2 tabs still in closed history
			expect(session.unifiedClosedTabHistory).toHaveLength(2);
		});
	});
});
