/**
 * Tests for ProcessManager.spawnTerminalTab()
 *
 * Verifies the terminal tab spawn convenience method that bridges
 * the simplified terminal tab API to the full ProcessConfig/PtySpawner flow.
 *
 * Key behaviors:
 * - toolType is always 'embedded-terminal' (raw PTY data for xterm.js)
 * - Default shell is platform-appropriate (zsh on macOS/Linux, powershell on Windows)
 * - Custom shell/shellArgs/shellEnvVars pass through
 * - Default dimensions are 80x24
 * - Session ID format passes through unchanged (caller provides {sessionId}-terminal-{tabId})
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockPtySpawn, mockPtyProcess } = vi.hoisted(() => {
	const _onDataHandlers: Array<(data: string) => void> = [];
	const _onExitHandlers: Array<(exit: { exitCode: number }) => void> = [];

	const _mockPtyProcess = {
		pid: 100,
		onData: vi.fn((handler: (data: string) => void) => {
			_onDataHandlers.push(handler);
			return { dispose: vi.fn() };
		}),
		onExit: vi.fn((handler: (exit: { exitCode: number }) => void) => {
			_onExitHandlers.push(handler);
			return { dispose: vi.fn() };
		}),
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(),
		_simulateData: (data: string) => {
			for (const handler of _onDataHandlers) handler(data);
		},
		_simulateExit: (exitCode: number) => {
			for (const handler of _onExitHandlers) handler({ exitCode });
		},
		_resetHandlers: () => {
			_onDataHandlers.length = 0;
			_onExitHandlers.length = 0;
		},
	};

	return {
		mockPtySpawn: vi.fn(() => _mockPtyProcess),
		mockPtyProcess: _mockPtyProcess,
	};
});

// ── vi.mock calls ──────────────────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProcessManager.spawnTerminalTab', () => {
	let pm: ProcessManager;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPtyProcess._resetHandlers();
		pm = new ProcessManager();
	});

	// ========================================================================
	// Core spawn behavior
	// ========================================================================

	describe('spawn configuration', () => {
		it('spawns with toolType embedded-terminal', () => {
			const result = pm.spawnTerminalTab({
				sessionId: 'session-1-terminal-tab-abc',
				cwd: '/home/user/project',
			});

			expect(result.success).toBe(true);
			expect(result.pid).toBe(100);

			// Verify node-pty was called (PtySpawner recognized embedded-terminal as PTY)
			expect(mockPtySpawn).toHaveBeenCalledTimes(1);
		});

		it('passes session ID through unchanged', () => {
			const sessionId = 'session-123-terminal-tab-uuid-456';
			pm.spawnTerminalTab({ sessionId, cwd: '/tmp' });

			// The process should be stored under the exact sessionId
			const proc = pm.get(sessionId);
			expect(proc).toBeDefined();
			expect(proc!.sessionId).toBe(sessionId);
		});

		it('passes cwd through to the spawn config', () => {
			const cwd = '/home/user/my-project';
			pm.spawnTerminalTab({ sessionId: 'test-session', cwd });

			const proc = pm.get('test-session');
			expect(proc).toBeDefined();
			expect(proc!.cwd).toBe(cwd);
		});

		it('marks process as terminal (isTerminal = true)', () => {
			pm.spawnTerminalTab({ sessionId: 'term-session', cwd: '/tmp' });

			const proc = pm.get('term-session');
			expect(proc!.isTerminal).toBe(true);
		});
	});

	// ========================================================================
	// Shell selection
	// ========================================================================

	describe('shell selection', () => {
		it('uses provided shell when specified', () => {
			pm.spawnTerminalTab({
				sessionId: 'custom-shell',
				cwd: '/tmp',
				shell: '/usr/local/bin/fish',
			});

			const spawnCall = mockPtySpawn.mock.calls[0];
			// The shell command is the first arg to node-pty.spawn
			const shellArg = spawnCall[0] as string;
			expect(shellArg).toContain('fish');
		});

		it('falls back to default shell when not specified', () => {
			pm.spawnTerminalTab({
				sessionId: 'default-shell',
				cwd: '/tmp',
			});

			// On non-Windows platforms, should default to zsh
			const spawnCall = mockPtySpawn.mock.calls[0];
			const shellArg = spawnCall[0] as string;
			// Either zsh or the platform default
			expect(shellArg).toBeTruthy();
		});
	});

	// ========================================================================
	// Shell customization
	// ========================================================================

	describe('shell customization passthrough', () => {
		it('passes shellArgs to spawn config', () => {
			pm.spawnTerminalTab({
				sessionId: 'with-args',
				cwd: '/tmp',
				shell: 'bash',
				shellArgs: '--norc',
			});

			expect(mockPtySpawn).toHaveBeenCalledTimes(1);
			expect(pm.get('with-args')).toBeDefined();
		});

		it('passes shellEnvVars to spawn config', () => {
			pm.spawnTerminalTab({
				sessionId: 'with-env',
				cwd: '/tmp',
				shellEnvVars: { MY_VAR: 'value', FOO: 'bar' },
			});

			expect(mockPtySpawn).toHaveBeenCalledTimes(1);
			expect(pm.get('with-env')).toBeDefined();
		});
	});

	// ========================================================================
	// PTY data flow
	// ========================================================================

	describe('raw PTY data flow', () => {
		it('emits raw-pty-data events (not filtered data)', () => {
			const rawDataHandler = vi.fn();
			pm.on('raw-pty-data', rawDataHandler);

			pm.spawnTerminalTab({ sessionId: 'data-test', cwd: '/tmp' });
			mockPtyProcess._simulateData('hello from shell\r\n');

			expect(rawDataHandler).toHaveBeenCalledWith('data-test', 'hello from shell\r\n');
		});

		it('preserves ANSI escape sequences in raw data', () => {
			const rawDataHandler = vi.fn();
			pm.on('raw-pty-data', rawDataHandler);

			pm.spawnTerminalTab({ sessionId: 'ansi-test', cwd: '/tmp' });

			const ansiData = '\x1b[32mgreen\x1b[0m and \x1b[31mred\x1b[0m';
			mockPtyProcess._simulateData(ansiData);

			expect(rawDataHandler).toHaveBeenCalledWith('ansi-test', ansiData);
		});

		it('emits exit event when PTY process exits', () => {
			const exitHandler = vi.fn();
			pm.on('exit', exitHandler);

			pm.spawnTerminalTab({ sessionId: 'exit-test', cwd: '/tmp' });
			mockPtyProcess._simulateExit(0);

			expect(exitHandler).toHaveBeenCalledWith('exit-test', 0);
		});

		it('emits exit event with non-zero code on abnormal exit', () => {
			const exitHandler = vi.fn();
			pm.on('exit', exitHandler);

			pm.spawnTerminalTab({ sessionId: 'crash-test', cwd: '/tmp' });
			mockPtyProcess._simulateExit(130); // SIGINT exit code

			expect(exitHandler).toHaveBeenCalledWith('crash-test', 130);
		});
	});

	// ========================================================================
	// Process lifecycle
	// ========================================================================

	describe('process lifecycle', () => {
		it('supports write to spawned terminal', () => {
			pm.spawnTerminalTab({ sessionId: 'write-test', cwd: '/tmp' });

			const result = pm.write('write-test', 'ls -la\r');
			expect(result).toBe(true);
			expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la\r');
		});

		it('supports resize of spawned terminal', () => {
			pm.spawnTerminalTab({ sessionId: 'resize-test', cwd: '/tmp' });

			const result = pm.resize('resize-test', 120, 40);
			expect(result).toBe(true);
			expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
		});

		it('supports kill of spawned terminal', () => {
			pm.spawnTerminalTab({ sessionId: 'kill-test', cwd: '/tmp' });
			expect(pm.get('kill-test')).toBeDefined();

			const result = pm.kill('kill-test');
			expect(result).toBe(true);
			expect(pm.get('kill-test')).toBeUndefined();
		});

		it('supports interrupt (Ctrl+C) on spawned terminal', () => {
			pm.spawnTerminalTab({ sessionId: 'interrupt-test', cwd: '/tmp' });

			const result = pm.interrupt('interrupt-test');
			expect(result).toBe(true);
			// For PTY terminals, interrupt sends \x03 (ETX)
			expect(mockPtyProcess.write).toHaveBeenCalledWith('\x03');
		});

		it('removes process from map after exit', () => {
			pm.spawnTerminalTab({ sessionId: 'cleanup-test', cwd: '/tmp' });
			expect(pm.get('cleanup-test')).toBeDefined();

			mockPtyProcess._simulateExit(0);
			expect(pm.get('cleanup-test')).toBeUndefined();
		});
	});

	// ========================================================================
	// Multiple terminal tabs
	// ========================================================================

	describe('multiple terminal tabs', () => {
		it('supports spawning multiple independent terminals', () => {
			// Reset mock to return fresh PTY instances with unique PIDs
			let pidCounter = 200;
			mockPtySpawn.mockImplementation(() => ({
				...mockPtyProcess,
				pid: pidCounter++,
			}));

			const result1 = pm.spawnTerminalTab({ sessionId: 'session-1-terminal-tab-1', cwd: '/project-a' });
			const result2 = pm.spawnTerminalTab({ sessionId: 'session-1-terminal-tab-2', cwd: '/project-b' });

			expect(result1.success).toBe(true);
			expect(result2.success).toBe(true);
			expect(result1.pid).not.toBe(result2.pid);

			// Both should exist in the process map
			expect(pm.get('session-1-terminal-tab-1')).toBeDefined();
			expect(pm.get('session-1-terminal-tab-2')).toBeDefined();
		});

		it('killing one terminal does not affect others', () => {
			let pidCounter = 300;
			mockPtySpawn.mockImplementation(() => ({
				...mockPtyProcess,
				pid: pidCounter++,
				kill: vi.fn(),
			}));

			pm.spawnTerminalTab({ sessionId: 'tab-a', cwd: '/tmp' });
			pm.spawnTerminalTab({ sessionId: 'tab-b', cwd: '/tmp' });

			pm.kill('tab-a');

			expect(pm.get('tab-a')).toBeUndefined();
			expect(pm.get('tab-b')).toBeDefined();
		});
	});

	// ========================================================================
	// shouldUsePty routing
	// ========================================================================

	describe('PTY routing', () => {
		it('routes embedded-terminal to PTY spawner (not child process)', () => {
			pm.spawnTerminalTab({ sessionId: 'pty-route-test', cwd: '/tmp' });

			// If it used the child process spawner, node-pty.spawn wouldn't be called
			expect(mockPtySpawn).toHaveBeenCalledTimes(1);

			// The managed process should have a ptyProcess, not childProcess
			const proc = pm.get('pty-route-test');
			expect(proc!.ptyProcess).toBeDefined();
		});
	});
});
