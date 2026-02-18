/**
 * @file PtySpawner.test.ts
 * @description Tests for PtySpawner — verifies that embedded-terminal mode
 * emits raw PTY data (preserving \r, ANSI sequences, etc.) while AI agent
 * modes go through stripControlSequences filtering.
 *
 * Key behavior under test: progress indicators using \r carriage returns
 * must flow through unmodified for xterm.js to render correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockPtySpawn, mockPtyProcess, mockStripControlSequences } = vi.hoisted(() => {
	const _onDataHandlers: Array<(data: string) => void> = [];
	const _onExitHandlers: Array<(exit: { exitCode: number }) => void> = [];

	const _mockPtyProcess = {
		pid: 42,
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
		// Helpers for tests to simulate PTY output
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

	const _mockPtySpawn = vi.fn(() => _mockPtyProcess);
	const _mockStripControlSequences = vi.fn((data: string) => data.replace(/\x1b\[[^m]*m/g, ''));

	return {
		mockPtySpawn: _mockPtySpawn,
		mockPtyProcess: _mockPtyProcess,
		mockStripControlSequences: _mockStripControlSequences,
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

vi.mock('../../../../main/utils/terminalFilter', () => ({
	stripControlSequences: (...args: unknown[]) => mockStripControlSequences(...args),
}));

vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../../../../main/process-manager/utils/envBuilder', () => ({
	buildPtyTerminalEnv: vi.fn(() => ({ PATH: '/usr/bin', TERM: 'xterm-256color' })),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { PtySpawner } from '../../../../main/process-manager/spawners/PtySpawner';
import type { ManagedProcess, ProcessConfig } from '../../../../main/process-manager/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function createTestContext() {
	const processes = new Map<string, ManagedProcess>();
	const emitter = new EventEmitter();
	const bufferManager = {
		emitDataBuffered: vi.fn(),
		flushDataBuffer: vi.fn(),
	};

	const spawner = new PtySpawner(processes, emitter, bufferManager as any);

	return { processes, emitter, bufferManager, spawner };
}

function createConfig(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
	return {
		sessionId: 'test-session',
		toolType: 'embedded-terminal',
		cwd: '/tmp/test',
		command: '',
		args: [],
		...overrides,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PtySpawner', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPtyProcess._resetHandlers();
	});

	describe('embedded-terminal raw data passthrough', () => {
		it('emits raw-pty-data event for embedded-terminal tool type', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));
			mockPtyProcess._simulateData('hello world');

			expect(rawDataHandler).toHaveBeenCalledWith('test-session', 'hello world');
		});

		it('preserves \\r carriage returns in raw data (progress indicators)', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));

			// Simulate a progress bar that uses \r to overwrite the line
			mockPtyProcess._simulateData('Downloading: 10%\r');
			mockPtyProcess._simulateData('Downloading: 50%\r');
			mockPtyProcess._simulateData('Downloading: 100%\n');

			expect(rawDataHandler).toHaveBeenCalledTimes(3);
			expect(rawDataHandler).toHaveBeenNthCalledWith(1, 'test-session', 'Downloading: 10%\r');
			expect(rawDataHandler).toHaveBeenNthCalledWith(2, 'test-session', 'Downloading: 50%\r');
			expect(rawDataHandler).toHaveBeenNthCalledWith(3, 'test-session', 'Downloading: 100%\n');
		});

		it('preserves ANSI color codes in raw data', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));

			const ansiData = '\x1b[32mSuccess\x1b[0m: operation complete';
			mockPtyProcess._simulateData(ansiData);

			expect(rawDataHandler).toHaveBeenCalledWith('test-session', ansiData);
		});

		it('preserves CSI cursor movement sequences (used by TUI apps)', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));

			// CSI sequence: move cursor up 1 line, clear line
			const csiData = '\x1b[1A\x1b[2K';
			mockPtyProcess._simulateData(csiData);

			expect(rawDataHandler).toHaveBeenCalledWith('test-session', csiData);
		});

		it('does NOT call stripControlSequences for embedded-terminal', () => {
			const { spawner } = createTestContext();

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));
			mockPtyProcess._simulateData('any data');

			expect(mockStripControlSequences).not.toHaveBeenCalled();
		});

		it('does NOT use DataBufferManager for embedded-terminal', () => {
			const { bufferManager, spawner } = createTestContext();

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));
			mockPtyProcess._simulateData('any data');

			expect(bufferManager.emitDataBuffered).not.toHaveBeenCalled();
		});

		it('preserves combined \\r\\n (Windows-style line endings)', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));
			mockPtyProcess._simulateData('line1\r\nline2\r\n');

			expect(rawDataHandler).toHaveBeenCalledWith('test-session', 'line1\r\nline2\r\n');
		});

		it('preserves npm/pip style progress bars with \\r overwrites', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));

			// Simulate npm-style progress: spinner + progress bar using \r
			const npmProgress = '\r⸩ ░░░░░░░░░░░░░░░░░░ 0/125 packages';
			mockPtyProcess._simulateData(npmProgress);

			expect(rawDataHandler).toHaveBeenCalledWith('test-session', npmProgress);
		});
	});

	describe('non-embedded modes use stripControlSequences filtering', () => {
		it('calls stripControlSequences for terminal (non-embedded) mode', () => {
			const { spawner } = createTestContext();

			spawner.spawn(createConfig({ toolType: 'terminal' }));
			mockPtyProcess._simulateData('data with \x1b[32mcolors\x1b[0m');

			expect(mockStripControlSequences).toHaveBeenCalled();
		});

		it('calls stripControlSequences for AI agent mode', () => {
			const { spawner } = createTestContext();

			spawner.spawn(createConfig({
				toolType: 'claude-code',
				command: 'claude',
				args: ['--print'],
			}));
			mockPtyProcess._simulateData('agent output');

			expect(mockStripControlSequences).toHaveBeenCalled();
		});

		it('does NOT emit raw-pty-data for non-embedded modes', () => {
			const { emitter, spawner } = createTestContext();
			const rawDataHandler = vi.fn();
			emitter.on('raw-pty-data', rawDataHandler);

			spawner.spawn(createConfig({ toolType: 'terminal' }));
			mockPtyProcess._simulateData('data');

			expect(rawDataHandler).not.toHaveBeenCalled();
		});

		it('uses DataBufferManager for filtered output', () => {
			const { bufferManager, spawner } = createTestContext();
			// Make stripControlSequences return non-empty content
			mockStripControlSequences.mockReturnValueOnce('cleaned data');

			spawner.spawn(createConfig({ toolType: 'terminal' }));
			mockPtyProcess._simulateData('raw data');

			expect(bufferManager.emitDataBuffered).toHaveBeenCalledWith('test-session', 'cleaned data');
		});
	});

	describe('process lifecycle', () => {
		it('returns success with PID on successful spawn', () => {
			const { spawner } = createTestContext();

			const result = spawner.spawn(createConfig());

			expect(result).toEqual({ pid: 42, success: true });
		});

		it('stores managed process in processes map', () => {
			const { processes, spawner } = createTestContext();

			spawner.spawn(createConfig({ sessionId: 'my-session' }));

			expect(processes.has('my-session')).toBe(true);
			const proc = processes.get('my-session')!;
			expect(proc.pid).toBe(42);
			expect(proc.isTerminal).toBe(true);
		});

		it('emits exit event and removes from processes map on PTY exit', () => {
			const { processes, emitter, spawner } = createTestContext();
			const exitHandler = vi.fn();
			emitter.on('exit', exitHandler);

			spawner.spawn(createConfig({ sessionId: 'exit-test' }));
			expect(processes.has('exit-test')).toBe(true);

			mockPtyProcess._simulateExit(0);

			expect(exitHandler).toHaveBeenCalledWith('exit-test', 0);
			expect(processes.has('exit-test')).toBe(false);
		});

		it('spawns with xterm-256color TERM for embedded terminal', () => {
			const { spawner } = createTestContext();

			spawner.spawn(createConfig({ toolType: 'embedded-terminal' }));

			const spawnCall = mockPtySpawn.mock.calls[0];
			const options = spawnCall[2] as Record<string, unknown>;
			expect(options.name).toBe('xterm-256color');
			expect((options.env as Record<string, string>).TERM).toBe('xterm-256color');
		});
	});
});
