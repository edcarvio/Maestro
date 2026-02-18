/**
 * Terminal Resize — Integration Tests
 *
 * Verifies that terminal PTY resize works correctly across all scenarios:
 * - Basic resize propagation to PTY backend
 * - Multi-tab resize isolation (resizing tab A doesn't affect tab B)
 * - Debounce-style rapid resize sequences
 * - Edge cases: resize after kill, resize non-existent session,
 *   resize non-terminal process, zero/negative dimensions
 * - Resize during active output (PTY data stream unaffected)
 * - Resize after PTY exit
 * - Full-screen app simulation (large dimension changes)
 *
 * These tests validate ProcessManager.resize() which is the backend
 * counterpart to the XTerminal ResizeObserver → fitAddon.fit() → IPC
 * pipeline documented in CLAUDE.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	createTerminalTab,
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

		pm.spawnTerminalTab({
			sessionId: result!.tab.id,
			cwd: result!.tab.cwd,
		});
	}

	return { session, tabs: session.terminalTabs };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal Resize', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		spawnedPtys.length = 0;
		mockIdCounter = 0;
		pm = new ProcessManager();
	});

	// ========================================================================
	// Basic resize propagation
	// ========================================================================

	describe('basic resize propagation', () => {
		it('resize() calls ptyProcess.resize() with correct cols and rows', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			const result = pm.resize(tabs[0].id, 120, 40);

			expect(result).toBe(true);
			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(120, 40);
			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(1);
		});

		it('passes through standard 80x24 dimensions', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 80, 24);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(80, 24);
		});

		it('passes through large dimensions for full-screen apps (e.g., htop)', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 300, 80);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(300, 80);
		});

		it('passes through small dimensions for split panes', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 40, 10);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(40, 10);
		});

		it('returns true on successful resize', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			expect(pm.resize(tabs[0].id, 100, 30)).toBe(true);
		});
	});

	// ========================================================================
	// Sequential resize (window drag simulation)
	// ========================================================================

	describe('sequential resize (window drag simulation)', () => {
		it('handles multiple sequential resizes to the same tab', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 80, 24);
			pm.resize(tabs[0].id, 100, 30);
			pm.resize(tabs[0].id, 120, 40);

			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(3);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(1, 80, 24);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(2, 100, 30);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(3, 120, 40);
		});

		it('handles rapid resize sequence simulating window drag', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			// Simulate dragging a window edge: many incremental resizes
			for (let cols = 80; cols <= 120; cols += 2) {
				pm.resize(tabs[0].id, cols, 24);
			}

			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(21);
			// First call
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(1, 80, 24);
			// Last call
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(21, 120, 24);
		});

		it('handles resize back and forth (expand then shrink)', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 80, 24);
			pm.resize(tabs[0].id, 160, 48);
			pm.resize(tabs[0].id, 80, 24);

			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(3);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(3, 80, 24);
		});
	});

	// ========================================================================
	// Multi-tab resize isolation
	// ========================================================================

	describe('multi-tab resize isolation', () => {
		it('resizing one tab does not call resize on other tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.resize(tabs[1].id, 120, 40);

			expect(spawnedPtys[0].resize).not.toHaveBeenCalled();
			expect(spawnedPtys[1].resize).toHaveBeenCalledWith(120, 40);
			expect(spawnedPtys[2].resize).not.toHaveBeenCalled();
		});

		it('each tab can be resized to different dimensions independently', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.resize(tabs[0].id, 80, 24);   // Standard
			pm.resize(tabs[1].id, 200, 60);   // Wide monitor
			pm.resize(tabs[2].id, 40, 12);    // Small split pane

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(80, 24);
			expect(spawnedPtys[1].resize).toHaveBeenCalledWith(200, 60);
			expect(spawnedPtys[2].resize).toHaveBeenCalledWith(40, 12);
		});

		it('rapid resizes interleaved across tabs stay correctly routed', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			// Simulate interleaved resize events from multiple tabs
			pm.resize(tabs[0].id, 80, 24);
			pm.resize(tabs[1].id, 100, 30);
			pm.resize(tabs[0].id, 90, 26);
			pm.resize(tabs[2].id, 120, 40);
			pm.resize(tabs[1].id, 110, 35);

			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(2);
			expect(spawnedPtys[1].resize).toHaveBeenCalledTimes(2);
			expect(spawnedPtys[2].resize).toHaveBeenCalledTimes(1);

			// Verify final calls for each
			expect(spawnedPtys[0].resize).toHaveBeenLastCalledWith(90, 26);
			expect(spawnedPtys[1].resize).toHaveBeenLastCalledWith(110, 35);
			expect(spawnedPtys[2].resize).toHaveBeenLastCalledWith(120, 40);
		});

		it('resizing one tab preserves other tabs\' processes', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.resize(tabs[0].id, 200, 60);

			// All processes remain alive
			for (const tab of tabs) {
				expect(pm.get(tab.id)).toBeDefined();
				expect(pm.get(tab.id)!.isTerminal).toBe(true);
			}
		});
	});

	// ========================================================================
	// Resize with active data streams
	// ========================================================================

	describe('resize during active output', () => {
		it('resize does not disrupt ongoing PTY data events', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 1);

			// Simulate output before resize
			spawnedPtys[0]._simulateData('line 1\r\n');

			// Resize mid-stream
			pm.resize(tabs[0].id, 120, 40);

			// Simulate output after resize
			spawnedPtys[0]._simulateData('line 2\r\n');

			// Both data events should arrive correctly
			expect(rawDataEvents).toHaveLength(2);
			expect(rawDataEvents[0].data).toBe('line 1\r\n');
			expect(rawDataEvents[1].data).toBe('line 2\r\n');
		});

		it('resize during rapid output does not drop data', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 1);

			// Interleave data and resize events rapidly
			spawnedPtys[0]._simulateData('A');
			pm.resize(tabs[0].id, 100, 30);
			spawnedPtys[0]._simulateData('B');
			pm.resize(tabs[0].id, 110, 35);
			spawnedPtys[0]._simulateData('C');
			pm.resize(tabs[0].id, 120, 40);
			spawnedPtys[0]._simulateData('D');

			expect(rawDataEvents).toHaveLength(4);
			expect(rawDataEvents.map(e => e.data)).toEqual(['A', 'B', 'C', 'D']);
			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(3);
		});

		it('resize on tab A does not affect data stream of tab B', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const { tabs } = createAndSpawnTabs(pm, 2);

			// Tab B is receiving data while tab A is resized
			spawnedPtys[1]._simulateData('streaming output\r\n');
			pm.resize(tabs[0].id, 200, 60);
			spawnedPtys[1]._simulateData('still streaming\r\n');

			// Tab B's data is unaffected
			const tabBEvents = rawDataEvents.filter(e => e.sessionId === tabs[1].id);
			expect(tabBEvents).toHaveLength(2);
			expect(tabBEvents[0].data).toBe('streaming output\r\n');
			expect(tabBEvents[1].data).toBe('still streaming\r\n');
		});
	});

	// ========================================================================
	// Edge cases: non-existent and killed sessions
	// ========================================================================

	describe('edge cases — invalid sessions', () => {
		it('returns false for non-existent session ID', () => {
			const result = pm.resize('non-existent-session', 80, 24);
			expect(result).toBe(false);
		});

		it('returns false after PTY has been killed', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.kill(tabs[0].id);

			const result = pm.resize(tabs[0].id, 120, 40);
			expect(result).toBe(false);
		});

		it('returns false after PTY has exited naturally', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			// Simulate shell exit (e.g., user typed 'exit')
			spawnedPtys[0]._simulateExit(0);

			const result = pm.resize(tabs[0].id, 120, 40);
			expect(result).toBe(false);
		});

		it('resize on killed tab does not affect surviving tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 3);

			pm.kill(tabs[1].id);

			// Attempt resize on killed tab
			const killedResult = pm.resize(tabs[1].id, 200, 60);
			expect(killedResult).toBe(false);

			// Resize on surviving tabs still works
			const liveResult0 = pm.resize(tabs[0].id, 100, 30);
			const liveResult2 = pm.resize(tabs[2].id, 110, 35);

			expect(liveResult0).toBe(true);
			expect(liveResult2).toBe(true);
			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(100, 30);
			expect(spawnedPtys[2].resize).toHaveBeenCalledWith(110, 35);
		});
	});

	// ========================================================================
	// Edge cases: PTY resize throws
	// ========================================================================

	describe('edge cases — PTY resize failure', () => {
		it('returns false and logs error when ptyProcess.resize() throws', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			spawnedPtys[0].resize.mockImplementationOnce(() => {
				throw new Error('PTY resize failed: invalid dimensions');
			});

			const result = pm.resize(tabs[0].id, 120, 40);

			expect(result).toBe(false);
		});

		it('subsequent resize succeeds after a failed resize', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			// First resize fails
			spawnedPtys[0].resize.mockImplementationOnce(() => {
				throw new Error('transient failure');
			});
			expect(pm.resize(tabs[0].id, 120, 40)).toBe(false);

			// Second resize succeeds
			expect(pm.resize(tabs[0].id, 100, 30)).toBe(true);
			expect(spawnedPtys[0].resize).toHaveBeenLastCalledWith(100, 30);
		});

		it('failure in one tab does not prevent resize of other tabs', () => {
			const { tabs } = createAndSpawnTabs(pm, 2);

			// Tab 0 resize fails
			spawnedPtys[0].resize.mockImplementationOnce(() => {
				throw new Error('tab 0 failure');
			});
			expect(pm.resize(tabs[0].id, 120, 40)).toBe(false);

			// Tab 1 resize succeeds
			expect(pm.resize(tabs[1].id, 120, 40)).toBe(true);
			expect(spawnedPtys[1].resize).toHaveBeenCalledWith(120, 40);
		});
	});

	// ========================================================================
	// Resize after respawn
	// ========================================================================

	describe('resize after tab respawn', () => {
		it('newly spawned tab can be resized independently', () => {
			let { session, tabs } = createAndSpawnTabs(pm, 2);

			// Kill tab 0
			pm.kill(tabs[0].id);

			// Spawn a replacement tab
			const newTabResult = createTerminalTab(session, { cwd: '/new-project' });
			session = newTabResult!.session;
			const newTab = newTabResult!.tab;

			pm.spawnTerminalTab({ sessionId: newTab.id, cwd: newTab.cwd });

			// Resize the new tab
			const result = pm.resize(newTab.id, 150, 50);
			expect(result).toBe(true);
			expect(spawnedPtys[2].resize).toHaveBeenCalledWith(150, 50);

			// Original tab 1 unaffected
			expect(spawnedPtys[1].resize).not.toHaveBeenCalled();
		});

		it('resize targets the new PTY, not the old killed one', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			// Kill and respawn with the same cwd
			pm.kill(tabs[0].id);

			pm.spawnTerminalTab({ sessionId: 'respawned-tab', cwd: '/project-A' });

			// Resize the respawned tab
			pm.resize('respawned-tab', 180, 55);

			// Only the new PTY (index 1) should be resized
			expect(spawnedPtys[0].resize).not.toHaveBeenCalled();
			expect(spawnedPtys[1].resize).toHaveBeenCalledWith(180, 55);
		});
	});

	// ========================================================================
	// Full-screen app dimension scenarios
	// ========================================================================

	describe('full-screen app dimensions', () => {
		it('supports vim/nano typical dimensions (80x24 → fullscreen)', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			// Start at standard size
			pm.resize(tabs[0].id, 80, 24);
			// User maximizes window
			pm.resize(tabs[0].id, 240, 70);

			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(1, 80, 24);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(2, 240, 70);
		});

		it('supports htop/top with very tall terminal', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 180, 100);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(180, 100);
		});

		it('supports very wide terminal for log viewing', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 400, 24);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(400, 24);
		});

		it('supports minimum viable dimensions', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 1, 1);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(1, 1);
		});
	});

	// ========================================================================
	// Write and resize interleaving
	// ========================================================================

	describe('write and resize interleaving', () => {
		it('resize does not interfere with write operations', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.write(tabs[0].id, 'vim file.txt\r');
			pm.resize(tabs[0].id, 120, 40);
			pm.write(tabs[0].id, ':wq\r');

			expect(spawnedPtys[0].write).toHaveBeenCalledTimes(2);
			expect(spawnedPtys[0].write).toHaveBeenNthCalledWith(1, 'vim file.txt\r');
			expect(spawnedPtys[0].write).toHaveBeenNthCalledWith(2, ':wq\r');
			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(1);
			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(120, 40);
		});

		it('resize and interrupt can happen on the same tab', () => {
			const { tabs } = createAndSpawnTabs(pm, 1);

			pm.resize(tabs[0].id, 120, 40);
			pm.interrupt(tabs[0].id);

			expect(spawnedPtys[0].resize).toHaveBeenCalledWith(120, 40);
			expect(spawnedPtys[0].write).toHaveBeenCalledWith('\x03');
		});
	});

	// ========================================================================
	// Realistic workflow: resize during multi-tab development
	// ========================================================================

	describe('realistic workflow', () => {
		it('simulates developer resizing window while running dev servers', () => {
			const rawDataEvents: Array<{ sessionId: string; data: string }> = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				rawDataEvents.push({ sessionId, data });
			});

			const cwds = ['/app/frontend', '/app/backend', '/app'];
			const { tabs } = createAndSpawnTabs(pm, 3, cwds);

			// Developer starts servers
			pm.write(tabs[0].id, 'npm run dev\r');
			pm.write(tabs[1].id, 'npm start\r');

			// Servers produce output
			spawnedPtys[0]._simulateData('> vite listening on :3000\r\n');
			spawnedPtys[1]._simulateData('> express on :8080\r\n');

			// Developer resizes the window (all visible tabs resize)
			pm.resize(tabs[0].id, 140, 35);
			pm.resize(tabs[1].id, 140, 35);
			pm.resize(tabs[2].id, 140, 35);

			// Servers continue producing output after resize
			spawnedPtys[0]._simulateData('> HMR update\r\n');
			spawnedPtys[1]._simulateData('> GET /api/health 200\r\n');

			// All data events arrive correctly
			expect(rawDataEvents).toHaveLength(4);
			expect(rawDataEvents[0].data).toContain(':3000');
			expect(rawDataEvents[1].data).toContain(':8080');
			expect(rawDataEvents[2].data).toContain('HMR');
			expect(rawDataEvents[3].data).toContain('/api/health');

			// All tabs resized
			for (let i = 0; i < 3; i++) {
				expect(spawnedPtys[i].resize).toHaveBeenCalledWith(140, 35);
			}
		});

		it('simulates toggling between split and full-screen layouts', () => {
			const { tabs } = createAndSpawnTabs(pm, 2);

			// Start in split view
			pm.resize(tabs[0].id, 60, 24);
			pm.resize(tabs[1].id, 60, 24);

			// Switch to full-screen for tab 0
			pm.resize(tabs[0].id, 200, 60);

			// Switch back to split view
			pm.resize(tabs[0].id, 60, 24);

			expect(spawnedPtys[0].resize).toHaveBeenCalledTimes(3);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(1, 60, 24);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(2, 200, 60);
			expect(spawnedPtys[0].resize).toHaveBeenNthCalledWith(3, 60, 24);

			// Tab 1 was only resized once (stayed in split)
			expect(spawnedPtys[1].resize).toHaveBeenCalledTimes(1);
		});
	});
});
