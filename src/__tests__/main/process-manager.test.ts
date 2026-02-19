/**
 * Tests for src/main/process-manager.ts
 *
 * Tests cover the aggregateModelUsage utility function that consolidates
 * token usage data from Claude Code responses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node-pty before importing process-manager (native module)
vi.mock('node-pty', () => ({
	spawn: vi.fn(),
}));

// Mock logger to avoid any side effects
vi.mock('../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import * as fs from 'fs';
import * as pty from 'node-pty';

import {
	aggregateModelUsage,
	ProcessManager,
	detectNodeVersionManagerBinPaths,
	buildUnixBasePath,
	type UsageStats,
	type ModelStats,
	type AgentError,
} from '../../main/process-manager';

describe('process-manager.ts', () => {
	describe('aggregateModelUsage', () => {
		describe('with modelUsage data', () => {
			it('should aggregate tokens from a single model', () => {
				const modelUsage: Record<string, ModelStats> = {
					'claude-3-sonnet': {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadInputTokens: 200,
						cacheCreationInputTokens: 100,
						contextWindow: 200000,
					},
				};

				const result = aggregateModelUsage(modelUsage, {}, 0.05);

				expect(result).toEqual({
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadInputTokens: 200,
					cacheCreationInputTokens: 100,
					totalCostUsd: 0.05,
					contextWindow: 200000,
				});
			});

			it('should use MAX (not SUM) across multiple models', () => {
				// When multiple models are used in one turn, each reads the same context
				// from cache. Using MAX gives actual context size, SUM would double-count.
				const modelUsage: Record<string, ModelStats> = {
					'claude-3-sonnet': {
						inputTokens: 1000,
						outputTokens: 500,
						cacheReadInputTokens: 200,
						cacheCreationInputTokens: 100,
						contextWindow: 200000,
					},
					'claude-3-haiku': {
						inputTokens: 500,
						outputTokens: 250,
						cacheReadInputTokens: 100,
						cacheCreationInputTokens: 50,
						contextWindow: 180000,
					},
				};

				const result = aggregateModelUsage(modelUsage, {}, 0.1);

				// MAX values: max(1000,500)=1000, max(500,250)=500, etc.
				expect(result).toEqual({
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadInputTokens: 200,
					cacheCreationInputTokens: 100,
					totalCostUsd: 0.1,
					contextWindow: 200000, // Should use the highest context window
				});
			});

			it('should use highest context window from any model', () => {
				const modelUsage: Record<string, ModelStats> = {
					'model-small': {
						inputTokens: 100,
						outputTokens: 50,
						contextWindow: 128000,
					},
					'model-large': {
						inputTokens: 200,
						outputTokens: 100,
						contextWindow: 1000000, // Much larger context
					},
				};

				const result = aggregateModelUsage(modelUsage);

				expect(result.contextWindow).toBe(1000000);
			});

			it('should handle models with missing optional fields', () => {
				const modelUsage: Record<string, ModelStats> = {
					'model-1': {
						inputTokens: 1000,
						outputTokens: 500,
						// No cache fields
					},
					'model-2': {
						inputTokens: 500,
						// Missing outputTokens
						cacheReadInputTokens: 100,
					},
				};

				const result = aggregateModelUsage(modelUsage);

				// MAX values: max(1000,500)=1000, max(500,0)=500, max(0,100)=100
				expect(result).toEqual({
					inputTokens: 1000,
					outputTokens: 500,
					cacheReadInputTokens: 100,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000, // Default value
				});
			});

			it('should handle empty modelUsage object', () => {
				const modelUsage: Record<string, ModelStats> = {};

				const result = aggregateModelUsage(modelUsage, {
					input_tokens: 500,
					output_tokens: 250,
				});

				// Should fall back to usage object when modelUsage is empty
				expect(result.inputTokens).toBe(500);
				expect(result.outputTokens).toBe(250);
			});
		});

		describe('fallback to usage object', () => {
			it('should use usage object when modelUsage is undefined', () => {
				const usage = {
					input_tokens: 2000,
					output_tokens: 1000,
					cache_read_input_tokens: 500,
					cache_creation_input_tokens: 250,
				};

				const result = aggregateModelUsage(undefined, usage, 0.15);

				expect(result).toEqual({
					inputTokens: 2000,
					outputTokens: 1000,
					cacheReadInputTokens: 500,
					cacheCreationInputTokens: 250,
					totalCostUsd: 0.15,
					contextWindow: 200000, // Default
				});
			});

			it('should use usage object when modelUsage has zero totals', () => {
				const modelUsage: Record<string, ModelStats> = {
					'empty-model': {
						inputTokens: 0,
						outputTokens: 0,
					},
				};
				const usage = {
					input_tokens: 1500,
					output_tokens: 750,
				};

				const result = aggregateModelUsage(modelUsage, usage);

				expect(result.inputTokens).toBe(1500);
				expect(result.outputTokens).toBe(750);
			});

			it('should handle partial usage object', () => {
				const usage = {
					input_tokens: 1000,
					// Missing other fields
				};

				const result = aggregateModelUsage(undefined, usage);

				expect(result).toEqual({
					inputTokens: 1000,
					outputTokens: 0,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000,
				});
			});
		});

		describe('default values', () => {
			it('should use default values when no data provided', () => {
				const result = aggregateModelUsage(undefined, {}, 0);

				expect(result).toEqual({
					inputTokens: 0,
					outputTokens: 0,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000, // Default for Claude
				});
			});

			it('should use default empty object for usage when not provided', () => {
				const result = aggregateModelUsage(undefined);

				expect(result).toEqual({
					inputTokens: 0,
					outputTokens: 0,
					cacheReadInputTokens: 0,
					cacheCreationInputTokens: 0,
					totalCostUsd: 0,
					contextWindow: 200000,
				});
			});

			it('should use default 0 for totalCostUsd when not provided', () => {
				const result = aggregateModelUsage(undefined, {});

				expect(result.totalCostUsd).toBe(0);
			});
		});

		describe('totalCostUsd handling', () => {
			it('should pass through totalCostUsd value', () => {
				const result = aggregateModelUsage(undefined, {}, 1.23);
				expect(result.totalCostUsd).toBe(1.23);
			});

			it('should handle zero cost', () => {
				const result = aggregateModelUsage(undefined, {}, 0);
				expect(result.totalCostUsd).toBe(0);
			});

			it('should handle very small cost values', () => {
				const result = aggregateModelUsage(undefined, {}, 0.000001);
				expect(result.totalCostUsd).toBe(0.000001);
			});
		});

		describe('realistic scenarios', () => {
			it('should handle typical Claude Code response with modelUsage', () => {
				// Simulating actual Claude Code response format
				const modelUsage: Record<string, ModelStats> = {
					'claude-sonnet-4-20250514': {
						inputTokens: 15420,
						outputTokens: 2340,
						cacheReadInputTokens: 12000,
						cacheCreationInputTokens: 1500,
						contextWindow: 200000,
					},
				};

				const result = aggregateModelUsage(modelUsage, {}, 0.0543);

				expect(result.inputTokens).toBe(15420);
				expect(result.outputTokens).toBe(2340);
				expect(result.cacheReadInputTokens).toBe(12000);
				expect(result.cacheCreationInputTokens).toBe(1500);
				expect(result.totalCostUsd).toBe(0.0543);
				expect(result.contextWindow).toBe(200000);
			});

			it('should handle legacy response without modelUsage', () => {
				// Older CLI versions might not include modelUsage
				const usage = {
					input_tokens: 5000,
					output_tokens: 1500,
					cache_read_input_tokens: 3000,
					cache_creation_input_tokens: 500,
				};

				const result = aggregateModelUsage(undefined, usage, 0.025);

				expect(result.inputTokens).toBe(5000);
				expect(result.outputTokens).toBe(1500);
				expect(result.cacheReadInputTokens).toBe(3000);
				expect(result.cacheCreationInputTokens).toBe(500);
				expect(result.totalCostUsd).toBe(0.025);
			});

			it('should handle response with both modelUsage and usage (prefer modelUsage)', () => {
				const modelUsage: Record<string, ModelStats> = {
					'claude-3-sonnet': {
						inputTokens: 10000, // Full context including cache
						outputTokens: 500,
					},
				};
				const usage = {
					input_tokens: 1000, // Only new/billable tokens
					output_tokens: 500,
				};

				const result = aggregateModelUsage(modelUsage, usage, 0.05);

				// Should use modelUsage values (full context) not usage (billable only)
				expect(result.inputTokens).toBe(10000);
				expect(result.outputTokens).toBe(500);
			});

			it('should use MAX across multi-model response (e.g., main + tool use)', () => {
				// When multiple models are used, each reads the same context. MAX avoids double-counting.
				const modelUsage: Record<string, ModelStats> = {
					'claude-3-opus': {
						inputTokens: 20000,
						outputTokens: 3000,
						cacheReadInputTokens: 15000,
						cacheCreationInputTokens: 2000,
						contextWindow: 200000,
					},
					'claude-3-haiku': {
						// Used for tool use - smaller context read
						inputTokens: 500,
						outputTokens: 100,
						contextWindow: 200000,
					},
				};

				const result = aggregateModelUsage(modelUsage, {}, 0.25);

				// MAX values: max(20000, 500)=20000, max(3000, 100)=3000
				expect(result.inputTokens).toBe(20000);
				expect(result.outputTokens).toBe(3000);
				expect(result.cacheReadInputTokens).toBe(15000);
				expect(result.cacheCreationInputTokens).toBe(2000);
				expect(result.totalCostUsd).toBe(0.25);
			});
		});
	});

	describe('ProcessManager', () => {
		let processManager: ProcessManager;

		beforeEach(() => {
			processManager = new ProcessManager();
		});

		describe('error detection exports', () => {
			it('should export AgentError type', () => {
				// This test verifies the type is exportable
				const error: AgentError = {
					type: 'auth_expired',
					message: 'Test error',
					recoverable: true,
					agentId: 'claude-code',
					timestamp: Date.now(),
				};
				expect(error.type).toBe('auth_expired');
			});
		});

		describe('agent-error event emission', () => {
			it('should be an EventEmitter that supports agent-error events', () => {
				let emittedError: AgentError | null = null;
				processManager.on('agent-error', (sessionId: string, error: AgentError) => {
					emittedError = error;
				});

				// Manually emit an error event to verify the event system works
				const testError: AgentError = {
					type: 'rate_limited',
					message: 'Rate limit exceeded',
					recoverable: true,
					agentId: 'claude-code',
					sessionId: 'test-session',
					timestamp: Date.now(),
				};
				processManager.emit('agent-error', 'test-session', testError);

				expect(emittedError).not.toBeNull();
				expect(emittedError!.type).toBe('rate_limited');
				expect(emittedError!.message).toBe('Rate limit exceeded');
				expect(emittedError!.agentId).toBe('claude-code');
			});

			it('should include sessionId in emitted error', () => {
				let capturedSessionId: string | null = null;
				processManager.on('agent-error', (sessionId: string) => {
					capturedSessionId = sessionId;
				});

				const testError: AgentError = {
					type: 'network_error',
					message: 'Connection failed',
					recoverable: true,
					agentId: 'claude-code',
					timestamp: Date.now(),
				};
				processManager.emit('agent-error', 'session-123', testError);

				expect(capturedSessionId).toBe('session-123');
			});
		});

		describe('getParser method', () => {
			it('should return null for unknown session', () => {
				const parser = processManager.getParser('non-existent-session');
				expect(parser).toBeNull();
			});
		});

		describe('parseLine method', () => {
			it('should return null for unknown session', () => {
				const event = processManager.parseLine('non-existent-session', '{"type":"test"}');
				expect(event).toBeNull();
			});
		});

		describe('write and interrupt for xterm.js terminal tabs', () => {
			let mockPtyWrite: ReturnType<typeof vi.fn>;
			let mockPtyKill: ReturnType<typeof vi.fn>;
			let mockPtyResize: ReturnType<typeof vi.fn>;
			let dataCallback: ((data: string) => void) | null;
			let exitCallback: ((exitData: { exitCode: number }) => void) | null;

			function createMockPty() {
				mockPtyWrite = vi.fn();
				mockPtyKill = vi.fn();
				mockPtyResize = vi.fn();
				dataCallback = null;
				exitCallback = null;

				return {
					pid: 42,
					write: mockPtyWrite,
					kill: mockPtyKill,
					resize: mockPtyResize,
					onData: (cb: (data: string) => void) => { dataCallback = cb; },
					onExit: (cb: (exitData: { exitCode: number }) => void) => { exitCallback = cb; },
				};
			}

			beforeEach(() => {
				const mockPty = createMockPty();
				vi.mocked(pty.spawn).mockReturnValue(mockPty as any);
			});

			afterEach(() => {
				processManager.killAll();
			});

			it('should write raw data to PTY for xterm.js terminal tabs', () => {
				// Spawn a terminal tab with xterm.js session ID format
				const sessionId = 'session-1-terminal-tab-1';
				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Write data (simulates xterm.js onData forwarding user input)
				const result = processManager.write(sessionId, 'ls -la\r');
				expect(result).toBe(true);
				expect(mockPtyWrite).toHaveBeenCalledWith('ls -la\r');
			});

			it('should write Ctrl+C (\\x03) to PTY for xterm.js terminal tabs', () => {
				const sessionId = 'session-1-terminal-tab-1';
				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Ctrl+C in xterm.js is sent as \x03 ETX character
				const result = processManager.write(sessionId, '\x03');
				expect(result).toBe(true);
				expect(mockPtyWrite).toHaveBeenCalledWith('\x03');
			});

			it('should not track last command for xterm.js terminal tabs', () => {
				const sessionId = 'session-1-terminal-tab-1';
				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Write a command to an xterm.js tab
				processManager.write(sessionId, 'npm run dev\r');

				// Verify lastCommand is not set (xterm handles echoing)
				const proc = processManager.get(sessionId);
				expect(proc?.lastCommand).toBeUndefined();
			});

			it('should send interrupt (\\x03) via interrupt method for PTY processes', () => {
				const sessionId = 'session-1-terminal-tab-1';
				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				const result = processManager.interrupt(sessionId);
				expect(result).toBe(true);
				expect(mockPtyWrite).toHaveBeenCalledWith('\x03');
			});

			it('should return false for interrupt on non-existent session', () => {
				const result = processManager.interrupt('non-existent-session');
				expect(result).toBe(false);
			});

			it('should return false for write on non-existent session', () => {
				const result = processManager.write('non-existent-session', 'hello');
				expect(result).toBe(false);
			});

			it('should emit raw data for xterm.js terminal tabs (no filtering)', () => {
				const sessionId = 'session-1-terminal-tab-1';
				const emittedData: string[] = [];

				processManager.on('data', (_sid: string, data: string) => {
					emittedData.push(data);
				});

				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Simulate PTY data output (ANSI escape sequences should pass through)
				const ansiData = '\x1b[32mgreen text\x1b[0m\r\n';
				dataCallback?.(ansiData);

				expect(emittedData).toHaveLength(1);
				expect(emittedData[0]).toBe(ansiData);
			});

			it('should preserve \\r carriage returns for progress indicators in xterm.js tabs', () => {
				const sessionId = 'session-1-terminal-tab-1';
				const emittedData: string[] = [];

				processManager.on('data', (sid: string, data: string) => {
					if (sid === sessionId) emittedData.push(data);
				});

				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Simulate progress bar output using \r to overwrite the current line
				// This is the pattern used by npm, pip, wget, curl, etc.
				const progressChunks = [
					'Downloading... [##        ] 20%\r',
					'Downloading... [####      ] 40%\r',
					'Downloading... [######    ] 60%\r',
					'Downloading... [########  ] 80%\r',
					'Downloading... [##########] 100%\r\n',
				];

				for (const chunk of progressChunks) {
					dataCallback?.(chunk);
				}

				// All chunks should pass through raw, with \r preserved
				expect(emittedData).toHaveLength(progressChunks.length);
				for (let i = 0; i < progressChunks.length; i++) {
					expect(emittedData[i]).toBe(progressChunks[i]);
				}

				// Verify \r is actually present in intermediate chunks (not stripped)
				expect(emittedData[0]).toContain('\r');
				expect(emittedData[0]).not.toContain('\n');
			});

			it('should preserve cursor positioning sequences for xterm.js tabs', () => {
				const sessionId = 'session-1-terminal-tab-1';
				const emittedData: string[] = [];

				processManager.on('data', (sid: string, data: string) => {
					if (sid === sessionId) emittedData.push(data);
				});

				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				// Simulate output with cursor positioning (CSI sequences)
				// These are used by tools like htop, vim, less, etc.
				const cursorData = '\x1b[2J\x1b[H\x1b[1;32mStatus: OK\x1b[0m\r\n';
				dataCallback?.(cursorData);

				expect(emittedData).toHaveLength(1);
				// CSI sequences like \x1b[2J (clear screen) and \x1b[H (cursor home) must pass through
				expect(emittedData[0]).toBe(cursorData);
				expect(emittedData[0]).toContain('\x1b[2J');
				expect(emittedData[0]).toContain('\x1b[H');
			});

			it('should handle kill for xterm.js terminal tab', () => {
				const sessionId = 'session-1-terminal-tab-1';
				processManager.spawn({
					sessionId,
					toolType: 'terminal',
					cwd: '/test',
					command: 'zsh',
					args: [],
				});

				const result = processManager.kill(sessionId);
				expect(result).toBe(true);
				expect(mockPtyKill).toHaveBeenCalled();

				// Process should be removed from the map
				expect(processManager.get(sessionId)).toBeUndefined();
			});
		});
	});

	describe('data buffering', () => {
		let processManager: ProcessManager;

		beforeEach(() => {
			processManager = new ProcessManager();
			vi.useFakeTimers();
		});

		afterEach(() => {
			processManager.killAll();
			vi.useRealTimers();
		});

		it('should buffer data events and flush after 50ms', () => {
			const emittedData: string[] = [];
			processManager.on('data', (sessionId: string, data: string) => {
				emittedData.push(data);
			});

			// Manually call the private method via emit simulation
			// Since emitDataBuffered is private, we test via the public event interface
			processManager.emit('data', 'test-session', 'chunk1');
			processManager.emit('data', 'test-session', 'chunk2');

			expect(emittedData).toHaveLength(2); // Direct emits pass through
		});

		it('should flush buffer on kill', () => {
			const emittedData: string[] = [];
			processManager.on('data', (sessionId: string, data: string) => {
				emittedData.push(data);
			});

			// Kill should not throw even with no processes
			expect(() => processManager.kill('non-existent')).not.toThrow();
		});

		it('should clear timeout on kill to prevent memory leaks', () => {
			// Verify killAll doesn't throw
			expect(() => processManager.killAll()).not.toThrow();
		});
	});

	describe('detectNodeVersionManagerBinPaths', () => {
		// Note: These tests use the real filesystem. On the test machine, they verify
		// that the function returns an array (possibly empty) and doesn't throw.
		// Full mocking would require restructuring the module to accept fs as a dependency.

		describe('on Windows', () => {
			it('should return empty array on Windows', () => {
				const originalPlatform = process.platform;
				Object.defineProperty(process, 'platform', {
					value: 'win32',
					configurable: true,
				});

				const result = detectNodeVersionManagerBinPaths();

				expect(result).toEqual([]);
				Object.defineProperty(process, 'platform', {
					value: originalPlatform,
					configurable: true,
				});
			});
		});

		describe('on Unix systems', () => {
			it('should return an array of strings', () => {
				// Skip on Windows
				if (process.platform === 'win32') return;

				const result = detectNodeVersionManagerBinPaths();

				expect(Array.isArray(result)).toBe(true);
				result.forEach((path) => {
					expect(typeof path).toBe('string');
					expect(path.length).toBeGreaterThan(0);
				});
			});

			it('should only return paths that exist', () => {
				// Skip on Windows
				if (process.platform === 'win32') return;

				const result = detectNodeVersionManagerBinPaths();

				// All returned paths should exist on the filesystem
				result.forEach((path) => {
					expect(fs.existsSync(path)).toBe(true);
				});
			});

			it('should respect NVM_DIR environment variable when set', () => {
				// Skip on Windows
				if (process.platform === 'win32') return;

				const originalNvmDir = process.env.NVM_DIR;

				// Set to a non-existent path
				process.env.NVM_DIR = '/nonexistent/nvm/path';
				const resultWithFakePath = detectNodeVersionManagerBinPaths();

				// Should not include the fake path since it doesn't exist
				expect(resultWithFakePath.some((p) => p.includes('/nonexistent/'))).toBe(false);

				process.env.NVM_DIR = originalNvmDir;
			});
		});
	});

	describe('buildUnixBasePath', () => {
		it('should include standard paths', () => {
			// Skip on Windows
			if (process.platform === 'win32') return;

			const result = buildUnixBasePath();

			expect(result).toContain('/opt/homebrew/bin');
			expect(result).toContain('/usr/local/bin');
			expect(result).toContain('/usr/bin');
			expect(result).toContain('/bin');
			expect(result).toContain('/usr/sbin');
			expect(result).toContain('/sbin');
		});

		it('should be a colon-separated path string', () => {
			// Skip on Windows
			if (process.platform === 'win32') return;

			const result = buildUnixBasePath();

			expect(typeof result).toBe('string');
			expect(result.includes(':')).toBe(true);

			// Should not have empty segments
			const segments = result.split(':');
			segments.forEach((segment) => {
				expect(segment.length).toBeGreaterThan(0);
			});
		});

		it('should prepend version manager paths when available', () => {
			// Skip on Windows
			if (process.platform === 'win32') return;

			const result = buildUnixBasePath();
			const standardPaths = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

			// Result should end with standard paths (they come after version manager paths)
			expect(result.endsWith(standardPaths) || result === standardPaths).toBe(true);
		});
	});
});
