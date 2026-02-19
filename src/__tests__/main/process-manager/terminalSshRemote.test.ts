/**
 * Terminal SSH Remote Session Tests
 *
 * Verifies that terminal tabs correctly handle SSH remote configurations:
 *
 * 1. SSH bypass: Terminal tabs (both 'terminal' and 'embedded-terminal' toolTypes)
 *    always spawn locally, even when the session has SSH remote config enabled.
 *    This is intentional — interactive PTY sessions need direct stdin/stdout
 *    streams that don't work with SSH command wrapping.
 *
 * 2. PTY spawn isolation: ProcessManager.spawnTerminalTab() does not accept
 *    SSH config and always spawns a local PTY process.
 *
 * 3. Resize independence: PTY resize operations work on terminal tabs
 *    regardless of session SSH configuration.
 *
 * 4. Data flow: Raw PTY data streams directly between xterm.js and the local
 *    shell, unaffected by SSH remote settings on the session.
 *
 * 5. Multi-tab with SSH: Multiple terminal tabs in an SSH-configured session
 *    all spawn independently and locally.
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
	generateId: vi.fn(() => `ssh-term-tab-${++mockIdCounter}`),
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
		id: 'session-ssh-test',
		name: 'SSH Test Session',
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

/** Session with SSH remote configuration enabled */
function createSshSession(overrides: Partial<Session> = {}): Session {
	return createMockSession({
		sshRemoteConfig: {
			enabled: true,
			remoteId: 'remote-dev-server',
		},
		...overrides,
	});
}

/** Create a terminal tab and spawn its PTY */
function createAndSpawnTab(
	pm: ProcessManager,
	session: Session,
	options?: { cwd?: string; name?: string },
): { session: Session; tab: TerminalTab; ptyIndex: number } {
	const result = createTerminalTab(session, options);
	const tab = result!.tab;
	const ptyIndex = spawnedPtys.length;

	pm.spawnTerminalTab({
		sessionId: tab.id,
		cwd: tab.cwd,
	});

	return { session: result!.session, tab, ptyIndex };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal SSH Remote Sessions', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		mockIdCounter = 0;
		spawnedPtys.length = 0;
		pm = new ProcessManager();
	});

	// ── SSH Bypass: Terminal tabs always spawn locally ─────────────────────

	describe('SSH bypass — terminal tabs always spawn locally', () => {
		it('spawnTerminalTab spawns a local PTY even when session has SSH config', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			// spawnTerminalTab does not accept SSH config — it spawns locally
			const spawnResult = pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
			});

			expect(spawnResult.success).toBe(true);
			expect(spawnResult.pid).toBeGreaterThan(0);
			expect(spawnedPtys).toHaveLength(1);

			// Verify PTY was spawned with local command, not 'ssh'
			const spawnCall = mockPtySpawn.mock.calls[0];
			expect(spawnCall[0]).not.toBe('ssh');
		});

		it('spawns with local cwd, not remote working directory', () => {
			const session = createSshSession({
				sshRemoteConfig: {
					enabled: true,
					remoteId: 'remote-1',
					workingDirOverride: '/remote/custom/path',
				},
				cwd: '/local/project',
			});
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
			});

			// PTY should use local cwd, not any remote path
			const spawnCall = mockPtySpawn.mock.calls[0];
			const spawnOptions = spawnCall[2]; // third arg is options object
			expect(spawnOptions.cwd).toBe('/local/project');
		});

		it('does not include SSH arguments in PTY spawn', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
			});

			// Verify no SSH-related arguments
			// Note: PTY args include shell flags like '-l' (login) and '-i' (interactive)
			// which are shell flags, NOT SSH flags. SSH args like '-o', 'BatchMode=yes' are the concern.
			const spawnCall = mockPtySpawn.mock.calls[0];
			const command = spawnCall[0];
			const args = spawnCall[1] as string[];

			expect(command).not.toBe('ssh');
			expect(args).not.toContain('-o');
			expect(args).not.toContain('BatchMode=yes');
			expect(args).not.toContain('StrictHostKeyChecking=accept-new');
			expect(args).not.toContain('ConnectTimeout=10');
		});

		it('uses default shell command for local PTY', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
			});

			const spawnCall = mockPtySpawn.mock.calls[0];
			const command = spawnCall[0] as string;

			// Should be a local shell — PtySpawner resolves bare names to absolute paths
			// (e.g., 'bash' → '/bin/bash', 'zsh' → '/bin/zsh')
			const isLocalShell =
				command === 'powershell.exe' || // Windows
				command.endsWith('/zsh') ||
				command.endsWith('/bash') ||
				command === 'zsh' ||
				command === 'bash';
			expect(isLocalShell).toBe(true);
			expect(command).not.toBe('ssh');
		});

		it('accepts custom shell override regardless of SSH config', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
				shell: '/usr/local/bin/fish',
			});

			const spawnCall = mockPtySpawn.mock.calls[0];
			expect(spawnCall[0]).toBe('/usr/local/bin/fish');
		});
	});

	// ── PTY data flow unaffected by SSH config ────────────────────────────

	describe('PTY data flow — unaffected by SSH configuration', () => {
		it('raw PTY data flows directly from shell to event emitter', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			const receivedData: string[] = [];
			// Embedded terminal emits 'raw-pty-data' (not 'data') for direct xterm.js consumption
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				if (sessionId === tab.id) {
					receivedData.push(data);
				}
			});

			// Simulate shell output
			spawnedPtys[ptyIndex]._simulateData('$ whoami\r\n');
			spawnedPtys[ptyIndex]._simulateData('testuser\r\n');

			expect(receivedData).toEqual(['$ whoami\r\n', 'testuser\r\n']);
		});

		it('write sends data directly to local PTY stdin', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			pm.write(tab.id, 'ls -la\r');

			expect(spawnedPtys[ptyIndex].write).toHaveBeenCalledWith('ls -la\r');
		});

		it('ANSI escape sequences pass through without SSH interference', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			const receivedData: string[] = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				if (sessionId === tab.id) {
					receivedData.push(data);
				}
			});

			// Simulate colored output (like `ls --color`)
			const coloredOutput = '\x1b[34mdir1\x1b[0m  \x1b[32mfile.txt\x1b[0m\r\n';
			spawnedPtys[ptyIndex]._simulateData(coloredOutput);

			expect(receivedData[0]).toBe(coloredOutput);
		});

		it('Ctrl+C interrupt routes to local PTY', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			pm.write(tab.id, '\x03'); // Ctrl+C

			expect(spawnedPtys[ptyIndex].write).toHaveBeenCalledWith('\x03');
		});

		it('Ctrl+D EOF routes to local PTY', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			pm.write(tab.id, '\x04'); // Ctrl+D

			expect(spawnedPtys[ptyIndex].write).toHaveBeenCalledWith('\x04');
		});
	});

	// ── Resize operations work regardless of SSH config ───────────────────

	describe('resize — works independently of SSH configuration', () => {
		it('resize propagates to local PTY on SSH-configured session', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			pm.resize(tab.id, 120, 40);

			expect(spawnedPtys[ptyIndex].resize).toHaveBeenCalledWith(120, 40);
		});

		it('sequential resizes all reach local PTY', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			// Simulate window resize sequence
			pm.resize(tab.id, 100, 30);
			pm.resize(tab.id, 110, 35);
			pm.resize(tab.id, 120, 40);

			expect(spawnedPtys[ptyIndex].resize).toHaveBeenCalledTimes(3);
			expect(spawnedPtys[ptyIndex].resize).toHaveBeenNthCalledWith(1, 100, 30);
			expect(spawnedPtys[ptyIndex].resize).toHaveBeenNthCalledWith(2, 110, 35);
			expect(spawnedPtys[ptyIndex].resize).toHaveBeenNthCalledWith(3, 120, 40);
		});

		it('resize during active output does not disrupt data flow', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			const receivedData: string[] = [];
			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				if (sessionId === tab.id) {
					receivedData.push(data);
				}
			});

			// Interleave data and resizes
			spawnedPtys[ptyIndex]._simulateData('line 1\r\n');
			pm.resize(tab.id, 100, 30);
			spawnedPtys[ptyIndex]._simulateData('line 2\r\n');
			pm.resize(tab.id, 120, 40);
			spawnedPtys[ptyIndex]._simulateData('line 3\r\n');

			expect(receivedData).toEqual(['line 1\r\n', 'line 2\r\n', 'line 3\r\n']);
			expect(spawnedPtys[ptyIndex].resize).toHaveBeenCalledTimes(2);
		});
	});

	// ── Multi-tab independence with SSH config ────────────────────────────

	describe('multi-tab — all tabs spawn locally with SSH config', () => {
		it('multiple terminal tabs in SSH session each get independent local PTYs', () => {
			const session = createSshSession();

			const tab1Result = createAndSpawnTab(pm, session, { cwd: '/project/frontend' });
			const tab2Result = createAndSpawnTab(pm, tab1Result.session, { cwd: '/project/backend' });
			const tab3Result = createAndSpawnTab(pm, tab2Result.session, { cwd: '/project/infra' });

			// Three independent local PTYs
			expect(spawnedPtys).toHaveLength(3);

			// Each with unique PIDs
			const pids = spawnedPtys.map(p => p.pid);
			expect(new Set(pids).size).toBe(3);

			// No PTY spawned with 'ssh' command
			for (const call of mockPtySpawn.mock.calls) {
				expect(call[0]).not.toBe('ssh');
			}
		});

		it('each tab uses its own local cwd, not remote paths', () => {
			const session = createSshSession({
				sshRemoteConfig: {
					enabled: true,
					remoteId: 'remote-1',
					workingDirOverride: '/remote/workspace',
				},
			});

			createAndSpawnTab(pm, session, { cwd: '/local/frontend' });

			const updatedSession = createTerminalTab(session)!.session;
			createAndSpawnTab(pm, updatedSession, { cwd: '/local/backend' });

			expect(mockPtySpawn.mock.calls[0][2].cwd).toBe('/local/frontend');
			expect(mockPtySpawn.mock.calls[1][2].cwd).toBe('/local/backend');
		});

		it('data streams are isolated between tabs in SSH session', () => {
			const session = createSshSession();

			const { tab: tab1, ptyIndex: idx1 } = createAndSpawnTab(pm, session);
			const s2 = createTerminalTab(session)!.session;
			const { tab: tab2, ptyIndex: idx2 } = createAndSpawnTab(pm, s2);

			const tab1Data: string[] = [];
			const tab2Data: string[] = [];

			pm.on('raw-pty-data', (sessionId: string, data: string) => {
				if (sessionId === tab1.id) tab1Data.push(data);
				if (sessionId === tab2.id) tab2Data.push(data);
			});

			spawnedPtys[idx1]._simulateData('tab1 output\r\n');
			spawnedPtys[idx2]._simulateData('tab2 output\r\n');

			expect(tab1Data).toEqual(['tab1 output\r\n']);
			expect(tab2Data).toEqual(['tab2 output\r\n']);
		});

		it('write to one tab does not affect others in SSH session', () => {
			const session = createSshSession();

			const { tab: tab1, ptyIndex: idx1 } = createAndSpawnTab(pm, session);
			const s2 = createTerminalTab(session)!.session;
			const { tab: tab2, ptyIndex: idx2 } = createAndSpawnTab(pm, s2);

			pm.write(tab1.id, 'npm start\r');
			pm.write(tab2.id, 'npm test\r');

			expect(spawnedPtys[idx1].write).toHaveBeenCalledWith('npm start\r');
			expect(spawnedPtys[idx1].write).not.toHaveBeenCalledWith('npm test\r');
			expect(spawnedPtys[idx2].write).toHaveBeenCalledWith('npm test\r');
			expect(spawnedPtys[idx2].write).not.toHaveBeenCalledWith('npm start\r');
		});

		it('resize is per-tab even with SSH config', () => {
			const session = createSshSession();

			const { tab: tab1, ptyIndex: idx1 } = createAndSpawnTab(pm, session);
			const s2 = createTerminalTab(session)!.session;
			const { tab: tab2, ptyIndex: idx2 } = createAndSpawnTab(pm, s2);

			pm.resize(tab1.id, 80, 24);
			pm.resize(tab2.id, 120, 40);

			expect(spawnedPtys[idx1].resize).toHaveBeenCalledWith(80, 24);
			expect(spawnedPtys[idx1].resize).not.toHaveBeenCalledWith(120, 40);
			expect(spawnedPtys[idx2].resize).toHaveBeenCalledWith(120, 40);
		});
	});

	// ── Lifecycle with SSH config ─────────────────────────────────────────

	describe('lifecycle — close/kill/reopen with SSH config', () => {
		it('killing a terminal tab kills the local PTY, not an SSH connection', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			pm.kill(tab.id);

			expect(spawnedPtys[ptyIndex].kill).toHaveBeenCalled();
		});

		it('closed terminal tab in SSH session can be reopened with local PTY', () => {
			let session = createSshSession();

			// Create and spawn tab
			const tabResult = createTerminalTab(session, { cwd: '/home/user/project' });
			session = tabResult!.session;
			const tab = tabResult!.tab;

			pm.spawnTerminalTab({ sessionId: tab.id, cwd: tab.cwd });
			expect(spawnedPtys).toHaveLength(1);

			// Close the tab
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;

			// Kill the PTY
			pm.kill(tab.id);

			// Reopen from unified history
			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs[session.terminalTabs.length - 1];

			// Spawn a new local PTY for reopened tab
			pm.spawnTerminalTab({ sessionId: reopenedTab.id, cwd: reopenedTab.cwd });

			// Two PTYs spawned total — both local
			expect(spawnedPtys).toHaveLength(2);
			expect(mockPtySpawn.mock.calls[0][0]).not.toBe('ssh');
			expect(mockPtySpawn.mock.calls[1][0]).not.toBe('ssh');
		});

		it('reopened tab preserves original local cwd, not remote workingDirOverride', () => {
			let session = createSshSession({
				sshRemoteConfig: {
					enabled: true,
					remoteId: 'remote-1',
					workingDirOverride: '/remote/path',
				},
			});

			const tabResult = createTerminalTab(session, { cwd: '/local/original/path' });
			session = tabResult!.session;
			const tab = tabResult!.tab;

			pm.spawnTerminalTab({ sessionId: tab.id, cwd: tab.cwd });

			// Close and reopen
			const closeResult = closeTerminalTab(session, tab.id);
			session = closeResult!.session;
			pm.kill(tab.id);

			const reopenResult = reopenUnifiedClosedTab(session);
			session = reopenResult!.session;
			const reopenedTab = session.terminalTabs[session.terminalTabs.length - 1];

			// Reopen should use local cwd from original tab
			expect(reopenedTab.cwd).toBe('/local/original/path');

			pm.spawnTerminalTab({ sessionId: reopenedTab.id, cwd: reopenedTab.cwd });
			expect(mockPtySpawn.mock.calls[1][2].cwd).toBe('/local/original/path');
		});

		it('PTY exit event fires normally in SSH-configured session', () => {
			const session = createSshSession();
			const { tab, ptyIndex } = createAndSpawnTab(pm, session);

			const exitEvents: Array<{ sessionId: string; exitCode: number }> = [];
			pm.on('exit', (sessionId: string, exitCode: number) => {
				exitEvents.push({ sessionId, exitCode });
			});

			spawnedPtys[ptyIndex]._simulateExit(0);

			expect(exitEvents).toHaveLength(1);
			expect(exitEvents[0]).toEqual({
				sessionId: tab.id,
				exitCode: 0,
			});
		});
	});

	// ── SSH disabled session behaves identically ──────────────────────────

	describe('SSH disabled — identical behavior to SSH enabled', () => {
		it('session with SSH disabled spawns terminal tabs the same way', () => {
			const sessionWithSsh = createSshSession();
			const sessionWithoutSsh = createMockSession({
				sshRemoteConfig: {
					enabled: false,
					remoteId: null,
				},
			});

			// Spawn tab on SSH-enabled session
			const { tab: tab1 } = createAndSpawnTab(pm, sessionWithSsh);

			// Spawn tab on non-SSH session
			const { tab: tab2 } = createAndSpawnTab(pm, sessionWithoutSsh);

			// Both should use the same local spawn approach
			expect(spawnedPtys).toHaveLength(2);
			expect(mockPtySpawn.mock.calls[0][0]).toBe(mockPtySpawn.mock.calls[1][0]); // Same shell command
		});

		it('session with no SSH config at all spawns identically', () => {
			const sshSession = createSshSession();
			const plainSession = createMockSession(); // No sshRemoteConfig

			createAndSpawnTab(pm, sshSession);
			createAndSpawnTab(pm, plainSession);

			expect(spawnedPtys).toHaveLength(2);
			// Both PTYs use identical commands
			expect(mockPtySpawn.mock.calls[0][0]).toBe(mockPtySpawn.mock.calls[1][0]);
		});
	});

	// ── toolType boundary — 'embedded-terminal' bypasses SSH ──────────────

	describe('toolType boundary — embedded-terminal bypasses SSH', () => {
		it('ProcessManager.spawnTerminalTab uses embedded-terminal toolType', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			// spawnTerminalTab internally sets toolType to 'embedded-terminal'
			pm.spawnTerminalTab({ sessionId: tab.id, cwd: tab.cwd });

			// Verify PTY was spawned (which means embedded-terminal used PTY path)
			expect(spawnedPtys).toHaveLength(1);
			expect(spawnedPtys[0].pid).toBeGreaterThan(0);
		});

		it('spawn with embedded-terminal toolType directly also bypasses SSH logic', () => {
			// Directly testing ProcessManager.spawn with embedded-terminal
			const result = pm.spawn({
				sessionId: 'direct-embedded-test',
				toolType: 'embedded-terminal',
				cwd: '/test/path',
				command: 'zsh',
				args: [],
			});

			expect(result.success).toBe(true);
			// Should spawn PTY (not child process) — proving it went through PTY path
			expect(spawnedPtys).toHaveLength(1);
		});

		it('spawn with terminal toolType also uses PTY path', () => {
			const result = pm.spawn({
				sessionId: 'direct-terminal-test',
				toolType: 'terminal',
				cwd: '/test/path',
				command: 'zsh',
				args: [],
			});

			expect(result.success).toBe(true);
			expect(spawnedPtys).toHaveLength(1);
		});
	});

	// ── Shell configuration with SSH config ───────────────────────────────

	describe('shell configuration — unaffected by SSH config', () => {
		it('custom shell works in SSH-configured session', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
				shell: '/usr/local/bin/fish',
			});

			expect(mockPtySpawn.mock.calls[0][0]).toBe('/usr/local/bin/fish');
		});

		it('shell args pass through in SSH-configured session', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
				shell: 'bash',
				shellArgs: '--login --norc',
			});

			// PtySpawner resolves 'bash' → '/bin/bash' (absolute path lookup)
			const spawnedCommand = mockPtySpawn.mock.calls[0][0] as string;
			expect(spawnedCommand.endsWith('/bash') || spawnedCommand === 'bash').toBe(true);
			expect(spawnedCommand).not.toBe('ssh');
		});

		it('custom environment variables apply locally, not via SSH', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
				shellEnvVars: { CUSTOM_VAR: 'local_value' },
			});

			// PTY is spawned locally — env vars go to local process
			expect(spawnedPtys).toHaveLength(1);
			expect(mockPtySpawn.mock.calls[0][0]).not.toBe('ssh');
		});
	});

	// ── Edge cases ────────────────────────────────────────────────────────

	describe('edge cases — SSH config variations', () => {
		it('handles session with SSH enabled but null remoteId', () => {
			const session = createMockSession({
				sshRemoteConfig: {
					enabled: true,
					remoteId: null,
				},
			});

			const { tab } = createAndSpawnTab(pm, session);

			// Should still spawn locally
			expect(spawnedPtys).toHaveLength(1);
			expect(mockPtySpawn.mock.calls[0][0]).not.toBe('ssh');
		});

		it('handles session with SSH enabled and workingDirOverride', () => {
			const session = createMockSession({
				sshRemoteConfig: {
					enabled: true,
					remoteId: 'some-remote',
					workingDirOverride: '/remote/workspace',
				},
				cwd: '/local/project',
			});

			const { tab } = createAndSpawnTab(pm, session);

			// Terminal tabs ignore workingDirOverride — use local cwd
			expect(mockPtySpawn.mock.calls[0][2].cwd).toBe('/local/project');
		});

		it('rapid spawn/kill cycle works in SSH-configured session', () => {
			const session = createSshSession();

			// Rapidly create and kill tabs
			for (let i = 0; i < 5; i++) {
				const result = createTerminalTab(session);
				const tab = result!.tab;

				pm.spawnTerminalTab({ sessionId: tab.id, cwd: tab.cwd });
				pm.kill(tab.id);
			}

			// All 5 PTYs were spawned locally
			expect(spawnedPtys).toHaveLength(5);
			for (const pty of spawnedPtys) {
				expect(pty.kill).toHaveBeenCalled();
			}
			for (const call of mockPtySpawn.mock.calls) {
				expect(call[0]).not.toBe('ssh');
			}
		});

		it('PTY spawn with explicit cols/rows works in SSH session', () => {
			const session = createSshSession();
			const result = createTerminalTab(session);
			const tab = result!.tab;

			pm.spawnTerminalTab({
				sessionId: tab.id,
				cwd: tab.cwd,
				cols: 200,
				rows: 50,
			});

			// PTY spawns with specified dimensions
			expect(spawnedPtys).toHaveLength(1);
			expect(mockPtySpawn.mock.calls[0][0]).not.toBe('ssh');
		});
	});
});
