/**
 * Multiple Terminal Tabs — Integration Tests
 *
 * Verifies that multiple terminal tabs maintain fully independent shell sessions.
 * Each tab gets its own PTY process with isolated:
 * - Data streams (output from tab A never reaches tab B)
 * - Write targets (input to tab A never reaches tab B's PTY)
 * - Working directories (cd in tab A doesn't affect tab B)
 * - Lifecycle (killing tab A doesn't affect tab B)
 * - Resize operations (resizing tab A doesn't affect tab B)
 *
 * These tests bridge ProcessManager (PTY spawning) with tab state helpers
 * (creation, switching, navigation) to simulate realistic multi-tab workflows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createTerminalTab,
	closeTerminalTab,
	navigateToNextUnifiedTab,
	navigateToPrevUnifiedTab,
	navigateToUnifiedTabByIndex,
} from '../../../renderer/utils/tabHelpers';
import type {
	Session,
	AITab,
	TerminalTab,
} from '../../../renderer/types';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

// Each PTY process gets its own handlers and mock methods to verify isolation
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
	let _pidCounter = 100;

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

// Mock generateId for predictable tab IDs
let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `tab-${++mockIdCounter}`),
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
		id: 'session-1',
		name: 'Test Session',
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
 * Create N terminal tabs and spawn their PTY processes.
 * Returns the updated session and the tab-to-PTY mapping.
 */
function createAndSpawnTabs(
	pm: ProcessManager,
	count: number,
	cwds?: string[]
): { session: Session; tabs: TerminalTab[] } {
	let session = createMockSession();

	for (let i = 0; i < count; i++) {
		const cwd = cwds?.[i] || `/project-${String.fromCharCode(65 + i)}`;
		const result = createTerminalTab(session, { cwd });
		session = result!.session;

		// Spawn the PTY for this tab
		pm.spawnTerminalTab({
			sessionId: result!.tab.id,
			cwd: result!.tab.cwd,
		});
	}

	return { session, tabs: session.terminalTabs };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Multiple Terminal Tabs', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		spawnedPtys.length = 0;
		mockIdCounter = 0;
		pm = new ProcessManager();
	});

	// ========================================================================
	// Independent PTY processes
	// ========================================================================

	describe('independent PTY processes', () => {
		it('each tab gets its own PTY process with a unique PID', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			// Each tab should have a separate process in the ProcessManager
			for (const tab of tabs) {
				const proc = pm.get(tab.id);
				expect(proc).toBeDefined();
				expect(proc!.isTerminal).toBe(true);
			}

			// PIDs should all be unique
			const pids = tabs.map(t => pm.get(t.id)!.pid);
			expect(new Set(pids).size).toBe(3);
		});

		it('spawns one node-pty process per tab', () => {
			createAndSpawnTabs(pm, 4);

			expect(mockPtySpawn).toHaveBeenCalledTimes(4);
			expect(spawnedPtys).toHaveLength(4);
		});

		it('each PTY spawns with its own cwd', () => {
			const cwds = ['/project-frontend', '/project-backend', '/project-infra'];
			const { tabs } = createAndSpawnTabs(pm, 3, cwds);

			for (let i = 0; i < tabs.length; i++) {
				const proc = pm.get(tabs[i].id);
				expect(proc!.cwd).toBe(cwds[i]);
			}
		});
	});

	// ========================================================================
	// Data stream isolation
	// ========================================================================

	describe('data stream isolation', () => {
		it('raw-pty-data events are tagged with the correct session ID', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 3);

			// Simulate output from each PTY
			spawnedPtys[0]._simulateData('output from tab 1\r\n');
			spawnedPtys[1]._simulateData('output from tab 2\r\n');
			spawnedPtys[2]._simulateData('output from tab 3\r\n');

			expect(rawDataEvents).toHaveLength(3);
			expect(rawDataEvents[0]).toEqual({ sessionId: tabs[0].id, data: 'output from tab 1\r\n' });
			expect(rawDataEvents[1]).toEqual({ sessionId: tabs[1].id, data: 'output from tab 2\r\n' });
			expect(rawDataEvents[2]).toEqual({ sessionId: tabs[2].id, data: 'output from tab 3\r\n' });
		});

		it('ANSI escape sequences are preserved per-tab', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 2);

			const ansiGreen = '\x1b[32mgreen output\x1b[0m';
			const ansiRed = '\x1b[31mred output\x1b[0m';

			spawnedPtys[0]._simulateData(ansiGreen);
			spawnedPtys[1]._simulateData(ansiRed);

			expect(rawDataEvents[0]).toEqual({ sessionId: tabs[0].id, data: ansiGreen });
			expect(rawDataEvents[1]).toEqual({ sessionId: tabs[1].id, data: ansiRed });
		});

		it('rapid interleaved output from multiple tabs stays correctly tagged', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 3);

			// Simulate rapid interleaved output
			spawnedPtys[0]._simulateData('A1');
			spawnedPtys[1]._simulateData('B1');
			spawnedPtys[0]._simulateData('A2');
			spawnedPtys[2]._simulateData('C1');
			spawnedPtys[1]._simulateData('B2');
			spawnedPtys[0]._simulateData('A3');

			expect(rawDataEvents).toHaveLength(6);

			// Verify each event is tagged with the correct tab
			const tab0Events = rawDataEvents.filter(e => e.sessionId === tabs[0].id);
			const tab1Events = rawDataEvents.filter(e => e.sessionId === tabs[1].id);
			const tab2Events = rawDataEvents.filter(e => e.sessionId === tabs[2].id);

			expect(tab0Events.map(e => e.data)).toEqual(['A1', 'A2', 'A3']);
			expect(tab1Events.map(e => e.data)).toEqual(['B1', 'B2']);
			expect(tab2Events.map(e => e.data)).toEqual(['C1']);
		});
	});

	// ========================================================================
	// Write isolation (input routing)
	// ========================================================================

	describe('write isolation', () => {
		it('writing to one tab only targets that tab\'s PTY', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.write(tabs[1].id, 'ls -la\r');

			// Only the second PTY should have received the write
			expect(spawnedPtys[0].write).not.toHaveBeenCalled();
			expect(spawnedPtys[1].write).toHaveBeenCalledWith('ls -la\r');
			expect(spawnedPtys[2].write).not.toHaveBeenCalled();
		});

		it('writing to different tabs routes to their respective PTYs', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.write(tabs[0].id, 'cd /tmp\r');
			pm.write(tabs[1].id, 'npm start\r');
			pm.write(tabs[2].id, 'git status\r');

			expect(spawnedPtys[0].write).toHaveBeenCalledWith('cd /tmp\r');
			expect(spawnedPtys[1].write).toHaveBeenCalledWith('npm start\r');
			expect(spawnedPtys[2].write).toHaveBeenCalledWith('git status\r');
		});

		it('cd in one tab only writes to that tab\'s PTY (cwd isolation)', () => {
			const cwds = ['/project-a', '/project-b'];
			const { tabs } = createAndSpawnTabs(pm, 2, cwds);

			// Simulate user typing cd in tab 0
			pm.write(tabs[0].id, 'cd /completely/different/path\r');

			// Tab 0's PTY got the cd command
			expect(spawnedPtys[0].write).toHaveBeenCalledWith('cd /completely/different/path\r');

			// Tab 1's PTY was never touched
			expect(spawnedPtys[1].write).not.toHaveBeenCalled();

			// Both processes still exist independently
			expect(pm.get(tabs[0].id)).toBeDefined();
			expect(pm.get(tabs[1].id)).toBeDefined();

			// Tab 1's process still has its original cwd (set at spawn)
			expect(pm.get(tabs[1].id)!.cwd).toBe('/project-b');
		});

		it('interrupt (Ctrl+C) targets only the specified tab', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.interrupt(tabs[1].id);

			// Only tab 1 should receive the ETX character
			expect(spawnedPtys[0].write).not.toHaveBeenCalled();
			expect(spawnedPtys[1].write).toHaveBeenCalledWith('\x03');
			expect(spawnedPtys[2].write).not.toHaveBeenCalled();
		});
	});

	// ========================================================================
	// Resize isolation
	// ========================================================================

	describe('resize isolation', () => {
		it('resizing one tab does not affect other tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.resize(tabs[0].id, 120, 40);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(120, 40);
			expect(spawnedPtys[1].resize).not.toHaveBeenCalled();
			expect(spawnedPtys[2].resize).not.toHaveBeenCalled();
		});

		it('each tab can have different dimensions', () => {
			const { tabs } = createAndSpawnTabs(pm, 2);

			pm.resize(tabs[0].id, 80, 24);
			pm.resize(tabs[1].id, 200, 60);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(80, 24);
			expect(spawnedPtys[1].resize).toHaveBeenCalledWith(200, 60);
		});
	});

	// ========================================================================
	// Lifecycle isolation
	// ========================================================================

	describe('lifecycle isolation', () => {
		it('killing one tab preserves all other tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 4);

			pm.kill(tabs[1].id);

			expect(pm.get(tabs[0].id)).toBeDefined();
			expect(pm.get(tabs[1].id)).toBeUndefined();
			expect(pm.get(tabs[2].id)).toBeDefined();
			expect(pm.get(tabs[3].id)).toBeDefined();
		});

		it('exit of one PTY does not affect other PTYs', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			const { tabs } = createAndSpawnTabs(pm, 3);

			// Tab 1 exits normally
			spawnedPtys[1]._simulateExit(0);

			// Only one exit event fired, for the correct tab
			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tabs[1].id, exitCode: 0 });

			// Tab 0 and 2 still running
			expect(pm.get(tabs[0].id)).toBeDefined();
			expect(pm.get(tabs[1].id)).toBeUndefined(); // Cleaned up after exit
			expect(pm.get(tabs[2].id)).toBeDefined();
		});

		it('abnormal exit of one tab does not cascade to others', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			const { tabs } = createAndSpawnTabs(pm, 3);

			// Tab 0 crashes
			spawnedPtys[0]._simulateExit(130);

			// Verify only tab 0 exited
			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tabs[0].id, exitCode: 130 });

			// Other tabs still alive
			expect(pm.get(tabs[1].id)).toBeDefined();
			expect(pm.get(tabs[2].id)).toBeDefined();

			// Other tabs still receive data normally
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			spawnedPtys[1]._simulateData('still alive\r\n');
			expect(rawDataEvents).toHaveLength(1);
			expect(rawDataEvents[0].sessionId).toBe(tabs[1].id);
		});

		it('killAll terminates all tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.killAll();

			for (const tab of tabs) {
				expect(pm.get(tab.id)).toBeUndefined();
			}
		});
	});

	// ========================================================================
	// Tab switching with ProcessManager
	// ========================================================================

	describe('tab switching maintains process independence', () => {
		it('switching active tab does not affect which processes are running', () => {
			const { session, tabs } = createAndSpawnTabs(pm, 3);

			// Navigate to each tab — all processes should remain alive throughout
			const nav1 = navigateToUnifiedTabByIndex(session, 1);
			expect(nav1!.session.activeTerminalTabId).toBe(tabs[0].id);

			const nav2 = navigateToUnifiedTabByIndex(session, 2);
			expect(nav2!.session.activeTerminalTabId).toBe(tabs[1].id);

			const nav3 = navigateToUnifiedTabByIndex(session, 3);
			expect(nav3!.session.activeTerminalTabId).toBe(tabs[2].id);

			// All three processes still running
			for (const tab of tabs) {
				expect(pm.get(tab.id)).toBeDefined();
			}
		});

		it('cycling tabs with next/prev does not disrupt running processes', () => {
			const { session, tabs } = createAndSpawnTabs(pm, 3);

			// Start on last tab (active after creation)
			let current = session;
			expect(current.activeTerminalTabId).toBe(tabs[2].id);

			// Navigate forward (wraps to AI tab then to first terminal)
			const next1 = navigateToNextUnifiedTab(current);
			current = next1!.session;

			const next2 = navigateToNextUnifiedTab(current);
			current = next2!.session;

			// Navigate back
			const prev1 = navigateToPrevUnifiedTab(current);
			current = prev1!.session;

			// All processes still alive despite tab switching
			for (const tab of tabs) {
				expect(pm.get(tab.id)).toBeDefined();
			}
		});

		it('writes go to the correct tab regardless of active tab state', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			// Regardless of which tab is "active" in session state,
			// writing to a specific tab ID always targets the right PTY
			pm.write(tabs[0].id, 'command-for-tab-0\r');
			pm.write(tabs[2].id, 'command-for-tab-2\r');

			expect(spawnedPtys[0].write).toHaveBeenCalledWith('command-for-tab-0\r');
			expect(spawnedPtys[1].write).not.toHaveBeenCalled();
			expect(spawnedPtys[2].write).toHaveBeenCalledWith('command-for-tab-2\r');
		});
	});

	// ========================================================================
	// Tab close and respawn
	// ========================================================================

	describe('close and respawn with ProcessManager', () => {
		it('closed tab PTY can be killed while others continue', () => {
			let { session, tabs } = createAndSpawnTabs(pm, 3);

			// Close the middle tab in state
			const closeResult = closeTerminalTab(session, tabs[1].id);
			session = closeResult!.session;

			// Kill the PTY for the closed tab
			pm.kill(tabs[1].id);

			// Verify state and process map are consistent
			expect(session.terminalTabs).toHaveLength(2);
			expect(pm.get(tabs[0].id)).toBeDefined();
			expect(pm.get(tabs[1].id)).toBeUndefined();
			expect(pm.get(tabs[2].id)).toBeDefined();

			// Remaining tabs still functional
			pm.write(tabs[0].id, 'hello\r');
			pm.write(tabs[2].id, 'world\r');
			expect(spawnedPtys[0].write).toHaveBeenCalledWith('hello\r');
			expect(spawnedPtys[2].write).toHaveBeenCalledWith('world\r');
		});

		it('new tab spawned after closing gets a fresh PTY', () => {
			let { session, tabs } = createAndSpawnTabs(pm, 2);

			// Close tab 0
			const closeResult = closeTerminalTab(session, tabs[0].id);
			session = closeResult!.session;
			pm.kill(tabs[0].id);

			// Create a new tab
			const newTabResult = createTerminalTab(session, { cwd: '/new-project' });
			session = newTabResult!.session;
			const newTab = newTabResult!.tab;

			// Spawn PTY for the new tab
			pm.spawnTerminalTab({ sessionId: newTab.id, cwd: newTab.cwd });

			// Three PTYs were spawned total (2 initial + 1 new)
			expect(spawnedPtys).toHaveLength(3);

			// The new tab has its own independent process
			const newProc = pm.get(newTab.id);
			expect(newProc).toBeDefined();
			expect(newProc!.cwd).toBe('/new-project');

			// The new tab's PTY is separate from surviving tab
			expect(newProc!.pid).not.toBe(pm.get(tabs[1].id)!.pid);
		});
	});

	// ========================================================================
	// Realistic multi-tab workflow
	// ========================================================================

	describe('realistic multi-tab workflow', () => {
		it('simulates developer using multiple terminals for different tasks', () => {
			// Developer opens three terminal tabs for a typical workflow:
			// Tab 1: Frontend dev server (cwd: /app/frontend)
			// Tab 2: Backend dev server (cwd: /app/backend)
			// Tab 3: Git operations (cwd: /app)

			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const cwds = ['/app/frontend', '/app/backend', '/app'];
			const { session, tabs } = createAndSpawnTabs(pm, 3, cwds);

			// Verify each tab has its own cwd
			expect(pm.get(tabs[0].id)!.cwd).toBe('/app/frontend');
			expect(pm.get(tabs[1].id)!.cwd).toBe('/app/backend');
			expect(pm.get(tabs[2].id)!.cwd).toBe('/app');

			// Developer starts frontend dev server
			pm.write(tabs[0].id, 'npm run dev\r');
			spawnedPtys[0]._simulateData('> vite dev server running on http://localhost:3000\r\n');

			// Developer starts backend server
			pm.write(tabs[1].id, 'npm start\r');
			spawnedPtys[1]._simulateData('> Express server listening on port 8080\r\n');

			// Developer runs git operations in tab 3
			pm.write(tabs[2].id, 'git status\r');
			spawnedPtys[2]._simulateData('On branch main\r\nnothing to commit\r\n');

			// Verify all data events are correctly attributed
			expect(rawDataEvents).toHaveLength(3);
			expect(rawDataEvents[0].sessionId).toBe(tabs[0].id);
			expect(rawDataEvents[0].data).toContain('localhost:3000');
			expect(rawDataEvents[1].sessionId).toBe(tabs[1].id);
			expect(rawDataEvents[1].data).toContain('port 8080');
			expect(rawDataEvents[2].sessionId).toBe(tabs[2].id);
			expect(rawDataEvents[2].data).toContain('nothing to commit');

			// Developer cd's in git tab — doesn't affect server tabs
			pm.write(tabs[2].id, 'cd /app/docs\r');
			expect(spawnedPtys[0].write).toHaveBeenCalledTimes(1); // Only the initial npm command
			expect(spawnedPtys[1].write).toHaveBeenCalledTimes(1); // Only the initial npm command
			expect(spawnedPtys[2].write).toHaveBeenCalledTimes(2); // git status + cd

			// Developer Ctrl+C's the frontend server — backend and git unaffected
			pm.interrupt(tabs[0].id);
			expect(spawnedPtys[0].write).toHaveBeenCalledWith('\x03');
			expect(spawnedPtys[1].write).not.toHaveBeenCalledWith('\x03');
			expect(spawnedPtys[2].write).not.toHaveBeenCalledWith('\x03');

			// All processes still exist
			expect(pm.get(tabs[0].id)).toBeDefined();
			expect(pm.get(tabs[1].id)).toBeDefined();
			expect(pm.get(tabs[2].id)).toBeDefined();
		});

		it('handles rapid tab creation and deletion', () => {
			let session = createMockSession();
			const tabIds: string[] = [];

			// Rapidly create 5 tabs
			for (let i = 0; i < 5; i++) {
				const result = createTerminalTab(session, { cwd: `/project-${i}` });
				session = result!.session;
				tabIds.push(result!.tab.id);

				pm.spawnTerminalTab({
					sessionId: result!.tab.id,
					cwd: result!.tab.cwd,
				});
			}

			expect(session.terminalTabs).toHaveLength(5);
			expect(spawnedPtys).toHaveLength(5);

			// Rapidly close tabs 1, 3 (indices)
			const close1 = closeTerminalTab(session, tabIds[1]);
			session = close1!.session;
			pm.kill(tabIds[1]);

			const close3 = closeTerminalTab(session, tabIds[3]);
			session = close3!.session;
			pm.kill(tabIds[3]);

			// Verify correct tabs survived
			expect(session.terminalTabs).toHaveLength(3);
			expect(pm.get(tabIds[0])).toBeDefined();
			expect(pm.get(tabIds[1])).toBeUndefined();
			expect(pm.get(tabIds[2])).toBeDefined();
			expect(pm.get(tabIds[3])).toBeUndefined();
			expect(pm.get(tabIds[4])).toBeDefined();

			// Surviving tabs still work
			pm.write(tabIds[0], 'alive\r');
			pm.write(tabIds[2], 'also alive\r');
			pm.write(tabIds[4], 'still here\r');
			expect(spawnedPtys[0].write).toHaveBeenCalledWith('alive\r');
			expect(spawnedPtys[2].write).toHaveBeenCalledWith('also alive\r');
			expect(spawnedPtys[4].write).toHaveBeenCalledWith('still here\r');
		});
	});
});
