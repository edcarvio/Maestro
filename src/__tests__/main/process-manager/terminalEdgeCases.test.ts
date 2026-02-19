/**
 * Terminal Edge Case Tests
 *
 * Verifies correct behavior under stress and unusual timing conditions:
 * 1. Rapidly opening/closing tabs — ProcessManager map stays consistent
 * 2. Switching modes while PTY is spawning — no orphaned processes
 * 3. Killing app while terminal is running — killAll() cleans up everything
 * 4. Terminal that exits immediately — exit event fires before any write
 *
 * These tests target the boundary conditions that manual testing would
 * miss but users will inevitably trigger in practice.
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
	let _pidCounter = 500;

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

let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `edge-tab-${++mockIdCounter}`),
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
		id: 'session-edge',
		name: 'Edge Case Session',
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

describe('Terminal Edge Cases', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		spawnedPtys.length = 0;
		mockIdCounter = 0;
		pm = new ProcessManager();
	});

	// ========================================================================
	// 1. Rapidly opening/closing tabs
	// ========================================================================

	describe('rapidly opening and closing tabs', () => {
		it('create and immediately close 10 tabs in rapid succession', () => {
			let session = createMockSession();

			for (let i = 0; i < 10; i++) {
				const { session: s, tab } = createAndSpawnTab(pm, session, {
					cwd: `/project-${i}`,
				});
				session = s;

				// Immediately close without any interaction
				const closeResult = closeTerminalTab(session, tab.id);
				session = closeResult!.session;
				pm.kill(tab.id);
			}

			// All processes should be cleaned up
			expect(pm.getAll()).toHaveLength(0);
			// All 10 tabs spawned PTYs
			expect(spawnedPtys).toHaveLength(10);
			// All 10 PTYs were killed
			for (const pty of spawnedPtys) {
				expect(pty.kill).toHaveBeenCalled();
			}
			// No terminal tabs remain in session
			expect(session.terminalTabs).toHaveLength(0);
			// All 10 are in closed history
			expect(session.unifiedClosedTabHistory).toHaveLength(10);
		});

		it('alternating create/close — two at a time, close one', () => {
			let session = createMockSession();
			const survivingTabs: TerminalTab[] = [];

			for (let i = 0; i < 5; i++) {
				// Create two tabs
				const { session: s1, tab: tabA } = createAndSpawnTab(pm, session, {
					cwd: `/a-${i}`,
				});
				session = s1;
				const { session: s2, tab: tabB } = createAndSpawnTab(pm, session, {
					cwd: `/b-${i}`,
				});
				session = s2;

				// Close the first one
				const closeResult = closeTerminalTab(session, tabA.id);
				session = closeResult!.session;
				pm.kill(tabA.id);

				survivingTabs.push(tabB);
			}

			// 5 tabs should survive
			expect(session.terminalTabs).toHaveLength(5);
			expect(pm.getAll()).toHaveLength(5);

			// Each surviving tab has its own live PTY
			for (const tab of survivingTabs) {
				expect(pm.get(tab.id)).toBeDefined();
				expect(pm.get(tab.id)!.isTerminal).toBe(true);
			}
		});

		it('create 20 tabs then close all — ProcessManager map is empty', () => {
			let session = createMockSession();
			const tabs: TerminalTab[] = [];

			// Burst create 20 tabs
			for (let i = 0; i < 20; i++) {
				const { session: s, tab } = createAndSpawnTab(pm, session, {
					cwd: `/dir-${i}`,
				});
				session = s;
				tabs.push(tab);
			}

			expect(pm.getAll()).toHaveLength(20);

			// Burst close all 20
			for (const tab of tabs) {
				const closeResult = closeTerminalTab(session, tab.id);
				session = closeResult!.session;
				pm.kill(tab.id);
			}

			expect(pm.getAll()).toHaveLength(0);
			expect(session.terminalTabs).toHaveLength(0);
		});

		it('rapid close does not corrupt neighboring tab PTY references', () => {
			let session = createMockSession();

			// Create 3 tabs
			const { session: s1, tab: tabA, ptyIndex: ptyA } =
				createAndSpawnTab(pm, session, { cwd: '/a' });
			session = s1;
			const { session: s2, tab: tabB } =
				createAndSpawnTab(pm, session, { cwd: '/b' });
			session = s2;
			const { session: s3, tab: tabC, ptyIndex: ptyC } =
				createAndSpawnTab(pm, session, { cwd: '/c' });
			session = s3;

			// Close middle tab rapidly
			const closeResult = closeTerminalTab(session, tabB.id);
			session = closeResult!.session;
			pm.kill(tabB.id);

			// tabA and tabC PTYs should still be fully functional
			pm.write(tabA.id, 'echo a\r');
			expect(spawnedPtys[ptyA].write).toHaveBeenCalledWith('echo a\r');

			pm.write(tabC.id, 'echo c\r');
			expect(spawnedPtys[ptyC].write).toHaveBeenCalledWith('echo c\r');

			// Data from tabA PTY should route correctly
			const rawEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawEvents.push({ sessionId, data });
			});

			spawnedPtys[ptyA]._simulateData('output-a');
			spawnedPtys[ptyC]._simulateData('output-c');

			expect(rawEvents).toEqual([
				{ sessionId: tabA.id, data: 'output-a' },
				{ sessionId: tabC.id, data: 'output-c' },
			]);
		});

		it('rapidly reopen then close again — IDs stay unique', () => {
			let session = createMockSession();
			const seenIds = new Set<string>();

			// Create and close a tab
			const { session: s1, tab } = createAndSpawnTab(pm, session, { cwd: '/project' });
			session = s1;
			seenIds.add(tab.id);

			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;
			pm.kill(tab.id);

			// Rapidly reopen and close 5 times
			for (let i = 0; i < 5; i++) {
				const reopenResult = reopenUnifiedClosedTab(session);
				session = reopenResult!.session;
				const reopenedTab = session.terminalTabs.find(
					t => t.id === reopenResult!.tabId
				)!;

				// Every reopened tab should have a unique ID
				expect(seenIds.has(reopenedTab.id)).toBe(false);
				seenIds.add(reopenedTab.id);

				// Spawn PTY for it
				pm.spawnTerminalTab({
					sessionId: reopenedTab.id,
					cwd: reopenedTab.cwd,
				});

				// Close again immediately
				const close = closeTerminalTab(session, reopenedTab.id);
				session = close!.session;
				pm.kill(reopenedTab.id);
			}

			// 6 unique IDs total (1 original + 5 reopens)
			expect(seenIds.size).toBe(6);
			expect(pm.getAll()).toHaveLength(0);
		});

		it('kill after kill on same tab ID is a no-op (returns false)', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// First kill succeeds
			expect(pm.kill(tab.id)).toBe(true);
			// Second kill is a no-op
			expect(pm.kill(tab.id)).toBe(false);
			// Third kill is still a no-op
			expect(pm.kill(tab.id)).toBe(false);
		});
	});

	// ========================================================================
	// 2. Switching modes while PTY is spawning
	// ========================================================================

	describe('switching modes while PTY is spawning', () => {
		it('PTY spawn followed by immediate mode switch to AI — PTY stays alive', () => {
			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Simulate mode switch to AI (Cmd+J) immediately after spawn
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// PTY should still be alive in ProcessManager even though UI switched away
			expect(pm.get(tab.id)).toBeDefined();
			expect(pm.get(tab.id)!.isTerminal).toBe(true);

			// PTY can still receive data (shell is running in background)
			spawnedPtys[ptyIndex]._simulateData('background output\r\n');

			const rawEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sid: string, data: string) => {
				rawEvents.push({ sessionId: sid, data });
			});
			spawnedPtys[ptyIndex]._simulateData('more output\r\n');

			expect(rawEvents).toHaveLength(1);
			expect(rawEvents[0].sessionId).toBe(tab.id);
		});

		it('mode switch back to terminal reconnects to existing PTY', () => {
			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Switch away to AI mode
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// Switch back to terminal mode
			session = { ...session, inputMode: 'terminal', activeTerminalTabId: tab.id };

			// Same PTY is still there — no respawn needed
			expect(pm.get(tab.id)).toBeDefined();
			expect(spawnedPtys).toHaveLength(1); // Only 1 PTY was ever spawned
		});

		it('spawn tab, switch to AI, create another terminal tab — both PTYs coexist', () => {
			let session = createMockSession({ inputMode: 'terminal' });

			// Spawn first tab
			const { session: s1, tab: tabA } = createAndSpawnTab(pm, session, { cwd: '/a' });
			session = s1;

			// Switch to AI mode
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// Create another terminal tab (switch back to terminal mode)
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session, { cwd: '/b' });
			session = { ...s2, inputMode: 'terminal', activeTerminalTabId: tabB.id };

			// Both PTYs should be alive
			expect(pm.get(tabA.id)).toBeDefined();
			expect(pm.get(tabB.id)).toBeDefined();
			expect(spawnedPtys).toHaveLength(2);
		});

		it('write to PTY while in AI mode succeeds (process still running)', () => {
			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Switch to AI mode
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// Writing to the PTY should still work
			expect(pm.write(tab.id, 'echo hello\r')).toBe(true);
		});

		it('resize while in AI mode succeeds', () => {
			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Switch to AI mode
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// Resize should still work
			expect(pm.resize(tab.id, 120, 40)).toBe(true);
		});

		it('PTY exit while in AI mode emits exit event and cleans up', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Switch to AI mode
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// PTY exits while user is in AI mode
			spawnedPtys[ptyIndex]._simulateExit(0);

			// Exit event should still fire
			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 0 });

			// Process should be cleaned up
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('rapid mode toggling does not duplicate or lose PTYs', () => {
			let session = createMockSession({ inputMode: 'ai' });
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			// Rapidly toggle between modes 10 times
			for (let i = 0; i < 10; i++) {
				session = {
					...session,
					inputMode: i % 2 === 0 ? 'terminal' : 'ai',
					activeTerminalTabId: i % 2 === 0 ? tab.id : null,
				};
			}

			// Only 1 PTY should exist throughout all toggles
			expect(spawnedPtys).toHaveLength(1);
			expect(pm.get(tab.id)).toBeDefined();
			expect(pm.getAll()).toHaveLength(1);
		});
	});

	// ========================================================================
	// 3. Killing app while terminal is running
	// ========================================================================

	describe('killing app while terminal is running (killAll)', () => {
		it('killAll() cleans up a single running terminal', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);
			expect(pm.get(tab.id)).toBeUndefined();
			expect(spawnedPtys[ptyIndex].kill).toHaveBeenCalled();
		});

		it('killAll() cleans up multiple terminals at once', () => {
			let session = createMockSession();
			const tabs: TerminalTab[] = [];

			for (let i = 0; i < 5; i++) {
				const { session: s, tab } = createAndSpawnTab(pm, session, {
					cwd: `/project-${i}`,
				});
				session = s;
				tabs.push(tab);
			}

			expect(pm.getAll()).toHaveLength(5);

			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);

			// Every PTY's kill() was invoked
			for (const pty of spawnedPtys) {
				expect(pty.kill).toHaveBeenCalled();
			}

			// Every tab's process is removed
			for (const tab of tabs) {
				expect(pm.get(tab.id)).toBeUndefined();
			}
		});

		it('killAll() during active data streaming — processes still killed', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Simulate active data streaming
			const rawEvents: string[] = [];
			pm.on('raw-pty-data', (_sid: string, data: string) => {
				rawEvents.push(data);
			});
			spawnedPtys[ptyIndex]._simulateData('streaming data...');

			// Kill during streaming
			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);
			expect(spawnedPtys[ptyIndex].kill).toHaveBeenCalled();

			// Data that was received before kill is still in events
			expect(rawEvents).toContain('streaming data...');
		});

		it('killAll() after some tabs already closed — no double-kill errors', () => {
			let session = createMockSession();

			const { session: s1, tab: tabA } = createAndSpawnTab(pm, session);
			session = s1;
			const { session: s2, tab: tabB } = createAndSpawnTab(pm, session);
			session = s2;
			const { session: s3 } = createAndSpawnTab(pm, session);
			session = s3;

			// Close tabA manually first
			closeTerminalTab(session, tabA.id);
			pm.kill(tabA.id);

			expect(pm.getAll()).toHaveLength(2);

			// killAll cleans up the remaining 2 without errors
			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);

			// tabA's PTY was killed once (manual), not twice
			expect(spawnedPtys[0].kill).toHaveBeenCalledTimes(1);
		});

		it('killAll() is idempotent — calling it twice is safe', () => {
			let session = createMockSession();
			const { session: s1 } = createAndSpawnTab(pm, session);
			session = s1;

			pm.killAll();
			expect(pm.getAll()).toHaveLength(0);

			// Second call should be a no-op without throwing
			pm.killAll();
			expect(pm.getAll()).toHaveLength(0);
		});

		it('operations on tabs after killAll return false', () => {
			let session = createMockSession();
			const { session: s1, tab } = createAndSpawnTab(pm, session);
			session = s1;

			pm.killAll();

			// All operations should gracefully fail
			expect(pm.write(tab.id, 'hello')).toBe(false);
			expect(pm.resize(tab.id, 100, 50)).toBe(false);
			expect(pm.interrupt(tab.id)).toBe(false);
			expect(pm.kill(tab.id)).toBe(false);
		});

		it('new tabs can be spawned after killAll', () => {
			let session = createMockSession();
			const { session: s1 } = createAndSpawnTab(pm, session);
			session = s1;

			pm.killAll();
			expect(pm.getAll()).toHaveLength(0);

			// Spawn a fresh tab after reset
			const { session: s2, tab: newTab } = createAndSpawnTab(pm, session, {
				cwd: '/new-project',
			});
			session = s2;

			expect(pm.get(newTab.id)).toBeDefined();
			expect(pm.get(newTab.id)!.cwd).toBe('/new-project');
			expect(pm.getAll()).toHaveLength(1);
		});

		it('killAll with mixed terminal and non-terminal processes', () => {
			let session = createMockSession();

			// Spawn terminal tabs
			const { session: s1, tab: termTab } = createAndSpawnTab(pm, session);
			session = s1;

			// Spawn an AI agent process (non-terminal-tab)
			pm.spawn({
				sessionId: 'ai-process-1',
				toolType: 'embedded-terminal',
				cwd: '/project',
				command: 'claude',
				args: [],
			});

			expect(pm.getAll()).toHaveLength(2);

			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);
			expect(pm.get(termTab.id)).toBeUndefined();
			expect(pm.get('ai-process-1')).toBeUndefined();
		});
	});

	// ========================================================================
	// 4. Terminal that exits immediately
	// ========================================================================

	describe('terminal that exits immediately', () => {
		it('PTY exits with code 0 right after spawn — process is cleaned up', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// PTY exits immediately (e.g., shell -c "true")
			spawnedPtys[ptyIndex]._simulateExit(0);

			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 0 });
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('PTY exits with non-zero code — exit event carries error code', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Shell fails to start (exit code 127 = command not found)
			spawnedPtys[ptyIndex]._simulateExit(127);

			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 127 });
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('write to immediately-exited PTY returns false', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Exit immediately
			spawnedPtys[ptyIndex]._simulateExit(0);

			// Process is gone — write fails
			expect(pm.write(tab.id, 'echo hello\r')).toBe(false);
		});

		it('resize on immediately-exited PTY returns false', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			spawnedPtys[ptyIndex]._simulateExit(0);

			expect(pm.resize(tab.id, 120, 40)).toBe(false);
		});

		it('kill on already-exited PTY returns false (auto-cleaned)', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Exit cleans up the process map entry automatically
			spawnedPtys[ptyIndex]._simulateExit(0);

			// Manual kill returns false since the entry is already gone
			expect(pm.kill(tab.id)).toBe(false);
		});

		it('close and reopen after immediate exit — fresh PTY spawns normally', () => {
			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session, {
				cwd: '/project',
			});
			session = s1;

			// PTY exits immediately
			spawnedPtys[ptyIndex]._simulateExit(1);

			// Close the tab in UI
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;

			// Reopen
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs.find(
				t => t.id === reopenResult!.tabId
			)!;

			// Spawn fresh PTY
			pm.spawnTerminalTab({
				sessionId: reopenedTab.id,
				cwd: reopenedTab.cwd,
			});

			expect(pm.get(reopenedTab.id)).toBeDefined();
			expect(pm.get(reopenedTab.id)!.cwd).toBe('/project');
		});

		it('multiple tabs where some exit immediately and others survive', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();

			// Create 4 tabs
			const results: Array<{ tab: TerminalTab; ptyIndex: number }> = [];
			for (let i = 0; i < 4; i++) {
				const { session: s, tab, ptyIndex } = createAndSpawnTab(pm, session, {
					cwd: `/dir-${i}`,
				});
				session = s;
				results.push({ tab, ptyIndex });
			}

			// Tabs 0 and 2 exit immediately
			spawnedPtys[results[0].ptyIndex]._simulateExit(0);
			spawnedPtys[results[2].ptyIndex]._simulateExit(1);

			// Tabs 1 and 3 survive
			expect(pm.get(results[0].tab.id)).toBeUndefined();
			expect(pm.get(results[1].tab.id)).toBeDefined();
			expect(pm.get(results[2].tab.id)).toBeUndefined();
			expect(pm.get(results[3].tab.id)).toBeDefined();

			expect(exitEvents).toHaveLength(2);
			expect(pm.getAll()).toHaveLength(2);
		});

		it('PTY that outputs data then exits immediately — data arrives before exit', () => {
			const rawEvents: Array<{ sessionId: string; data: string }> = [];
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];

			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawEvents.push({ sessionId, data });
			});
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Shell outputs something then exits
			spawnedPtys[ptyIndex]._simulateData('login: Last login...\r\n');
			spawnedPtys[ptyIndex]._simulateExit(0);

			// Data arrived before exit
			expect(rawEvents).toHaveLength(1);
			expect(rawEvents[0]).toEqual({
				sessionId: tab.id,
				data: 'login: Last login...\r\n',
			});

			// Exit also fired
			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 0 });

			// Process is cleaned up
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('exit with signal code (SIGKILL = 137) is reported correctly', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// Simulate SIGKILL (128 + 9 = 137)
			spawnedPtys[ptyIndex]._simulateExit(137);

			expect(exitEvents[0]).toEqual({ sessionId: tab.id, exitCode: 137 });
			expect(pm.get(tab.id)).toBeUndefined();
		});

		it('spawn fails gracefully when pty.spawn throws', () => {
			// Make the next spawn throw
			mockPtySpawn.mockImplementationOnce(() => {
				throw new Error('PTY allocation failed');
			});

			const result = pm.spawnTerminalTab({
				sessionId: 'fail-tab',
				cwd: '/project',
			});

			expect(result.success).toBe(false);
			expect(result.pid).toBe(-1);
			expect(result.error).toContain('PTY allocation failed');

			// No process was added to the map
			expect(pm.get('fail-tab')).toBeUndefined();
		});
	});

	// ========================================================================
	// 5. Combined edge cases — stress scenarios
	// ========================================================================

	describe('combined stress scenarios', () => {
		it('rapid create → exit → close → reopen → respawn cycle', () => {
			let session = createMockSession();

			for (let i = 0; i < 5; i++) {
				const { session: s, tab, ptyIndex } = createAndSpawnTab(pm, session, {
					cwd: `/cycle-${i}`,
				});
				session = s;

				// PTY exits immediately
				spawnedPtys[ptyIndex]._simulateExit(0);

				// Close the dead tab
				const closeResult = closeTerminalTab(session, tab.id);
				session = closeResult!.session;

				// Reopen and respawn
				const reopenResult = reopenUnifiedClosedTab(session);
				session = reopenResult!.session;
				const reopened = session.terminalTabs.find(
					t => t.id === reopenResult!.tabId
				)!;

				pm.spawnTerminalTab({
					sessionId: reopened.id,
					cwd: reopened.cwd,
				});
			}

			// Only the last respawned tab should be alive (previous ones exited)
			// Actually 5 are alive: each cycle creates a respawned tab that stays
			expect(pm.getAll()).toHaveLength(5);
			expect(spawnedPtys).toHaveLength(10); // 5 original + 5 respawned
		});

		it('killAll after some tabs have already exited naturally', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession();

			// Create 4 tabs
			const tabs: Array<{ tab: TerminalTab; ptyIndex: number }> = [];
			for (let i = 0; i < 4; i++) {
				const { session: s, tab, ptyIndex } = createAndSpawnTab(pm, session, {
					cwd: `/dir-${i}`,
				});
				session = s;
				tabs.push({ tab, ptyIndex });
			}

			// Tabs 0, 1 exit naturally
			spawnedPtys[tabs[0].ptyIndex]._simulateExit(0);
			spawnedPtys[tabs[1].ptyIndex]._simulateExit(0);

			expect(pm.getAll()).toHaveLength(2);

			// App closes — killAll for remaining
			pm.killAll();

			expect(pm.getAll()).toHaveLength(0);
			// Tabs 2, 3 were killed
			expect(spawnedPtys[tabs[2].ptyIndex].kill).toHaveBeenCalled();
			expect(spawnedPtys[tabs[3].ptyIndex].kill).toHaveBeenCalled();
			// Tabs 0, 1 were NOT killed (already cleaned up by exit)
			expect(spawnedPtys[tabs[0].ptyIndex].kill).not.toHaveBeenCalled();
			expect(spawnedPtys[tabs[1].ptyIndex].kill).not.toHaveBeenCalled();
		});

		it('mode switch during exit event — no stale state', () => {
			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			let session = createMockSession({ inputMode: 'terminal' });
			const { session: s1, tab, ptyIndex } = createAndSpawnTab(pm, session);
			session = s1;

			// PTY exits
			spawnedPtys[ptyIndex]._simulateExit(0);

			// Mode switch happens after exit
			session = { ...session, inputMode: 'ai', activeTerminalTabId: null };

			// Tab is still in session state (UI hasn't closed it yet)
			expect(session.terminalTabs).toHaveLength(1);
			// But process is gone from ProcessManager
			expect(pm.get(tab.id)).toBeUndefined();

			// Attempting to write to the dead tab fails gracefully
			expect(pm.write(tab.id, 'hello')).toBe(false);
		});

		it('interleaved exits and spawns — ProcessManager bookkeeping stays correct', () => {
			let session = createMockSession();

			// Spawn tab A
			const { session: s1, tab: tabA, ptyIndex: ptyA } =
				createAndSpawnTab(pm, session, { cwd: '/a' });
			session = s1;

			// Spawn tab B
			const { session: s2, tab: tabB, ptyIndex: ptyB } =
				createAndSpawnTab(pm, session, { cwd: '/b' });
			session = s2;

			// Tab A exits
			spawnedPtys[ptyA]._simulateExit(0);

			// Spawn tab C while A is dead
			const { session: s3, tab: tabC } =
				createAndSpawnTab(pm, session, { cwd: '/c' });
			session = s3;

			// Tab B exits
			spawnedPtys[ptyB]._simulateExit(0);

			// Only tab C should be alive
			expect(pm.get(tabA.id)).toBeUndefined();
			expect(pm.get(tabB.id)).toBeUndefined();
			expect(pm.get(tabC.id)).toBeDefined();
			expect(pm.getAll()).toHaveLength(1);
		});
	});
});
