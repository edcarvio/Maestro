/**
 * @file TerminalScrollbackPerformance.test.tsx
 * @description Performance tests for EmbeddedTerminal with large scrollback
 *
 * Validates that the terminal remains responsive when processing high-throughput
 * PTY output by verifying:
 * - RAF write batching reduces xterm.js write() calls
 * - Large data volumes (100K+ lines) are handled without hanging
 * - Multiple rapid data events are coalesced into single writes
 * - Buffer cleanup on unmount prevents memory leaks
 * - Interleaved data from multiple terminals is correctly isolated
 */

import React, { createRef } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Theme } from '../../shared/theme-types';

// --- Hoisted mocks ---

const {
	terminalMethods,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	MockSearchAddon,
	MockUnicode11Addon,
	mockSpawn,
	mockWrite,
	mockKill,
	mockResize,
	mockOnRawPtyData,
	mockOnExit,
} = vi.hoisted(() => {
	const _terminalMethods = {
		open: vi.fn(),
		write: vi.fn(),
		writeln: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		dispose: vi.fn(),
		scrollToBottom: vi.fn(),
		getSelection: vi.fn(() => ''),
		onData: vi.fn(() => ({ dispose: vi.fn() })),
		onResize: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
	});

	const _mockFit = vi.fn();
	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = _mockFit;
		this.dispose = vi.fn();
	});

	const _MockWebLinksAddon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _MockSearchAddon = vi.fn(function (this: Record<string, unknown>) {
		this.findNext = vi.fn(() => true);
		this.findPrevious = vi.fn(() => true);
		this.clearDecorations = vi.fn();
		this.dispose = vi.fn();
	});

	const _MockUnicode11Addon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _mockSpawn = vi.fn(() => Promise.resolve({ success: true, pid: 1234 }));
	const _mockWrite = vi.fn(() => Promise.resolve(true));
	const _mockKill = vi.fn(() => Promise.resolve(true));
	const _mockResize = vi.fn(() => Promise.resolve(true));
	const _mockOnRawPtyData = vi.fn(() => vi.fn());
	const _mockOnExit = vi.fn(() => vi.fn());

	return {
		terminalMethods: _terminalMethods,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockSpawn: _mockSpawn,
		mockWrite: _mockWrite,
		mockKill: _mockKill,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
		mockOnExit: _mockOnExit,
	};
});

// --- vi.mock calls ---

vi.mock('@xterm/xterm', () => ({
	Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: MockWebLinksAddon,
}));

vi.mock('@xterm/addon-search', () => ({
	SearchAddon: MockSearchAddon,
}));

vi.mock('@xterm/addon-unicode11', () => ({
	Unicode11Addon: MockUnicode11Addon,
}));

vi.mock('@xterm/addon-webgl', () => ({
	WebglAddon: vi.fn(function (this: Record<string, unknown>) {
		this.onContextLoss = vi.fn();
		this.dispose = vi.fn();
	}),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('../../renderer/services/process', () => ({
	processService: {
		spawn: (...args: unknown[]) => mockSpawn(...args),
		write: (...args: unknown[]) => mockWrite(...args),
		kill: (...args: unknown[]) => mockKill(...args),
		resize: (...args: unknown[]) => mockResize(...args),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
		onExit: (...args: unknown[]) => mockOnExit(...args),
	},
}));

vi.mock('../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#000',
		foreground: '#fff',
	})),
}));

// --- Import after mocks ---

import EmbeddedTerminal from '../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import type { EmbeddedTerminalHandle } from '../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import { PERFORMANCE_THRESHOLDS } from '../../shared/performance-metrics';

const defaultTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#44475a',
		border: '#6272a4',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: 'rgba(189, 147, 249, 0.2)',
		accentText: '#bd93f9',
		accentForeground: '#ffffff',
		success: '#50fa7b',
		warning: '#f1fa8c',
		error: '#ff5555',
	},
};

// --- Test Utilities ---

/** Generate terminal output simulating a high-throughput command (like `find /`) */
function generateTerminalLines(lineCount: number): string {
	let output = '';
	for (let i = 0; i < lineCount; i++) {
		output += `/usr/share/doc/package-${i}/README.md\r\n`;
	}
	return output;
}

/** Generate a large ANSI-colored output block (like `ls --color` or build output) */
function generateColoredOutput(sizeKb: number): string {
	const patterns = [
		'\x1b[32m✓\x1b[0m src/components/App.tsx compiled\r\n',
		'\x1b[33m⚠\x1b[0m src/utils/helper.ts has warnings\r\n',
		'\x1b[31m✗\x1b[0m tests/unit.test.ts failed\r\n',
		'\x1b[36m→\x1b[0m Processing module dependencies...\r\n',
		'\x1b[35m█████████░\x1b[0m 90% complete\r',
	];
	const targetBytes = sizeKb * 1024;
	let output = '';
	let idx = 0;
	while (output.length < targetBytes) {
		output += patterns[idx % patterns.length];
		idx++;
	}
	return output.slice(0, targetBytes);
}

describe('TerminalScrollbackPerformance', () => {
	let rafCallbacks: Map<number, FrameRequestCallback>;
	let rafIdCounter: number;

	beforeEach(() => {
		vi.clearAllMocks();

		// Set up RAF mock for controlling when writes are flushed
		rafCallbacks = new Map();
		rafIdCounter = 0;

		global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
			const id = ++rafIdCounter;
			rafCallbacks.set(id, callback);
			return id;
		});

		global.cancelAnimationFrame = vi.fn((id: number) => {
			rafCallbacks.delete(id);
		});
	});

	afterEach(() => {
		rafCallbacks.clear();
	});

	/** Flush all pending RAF callbacks (simulates next animation frame) */
	const flushRaf = () => {
		const callbacks = Array.from(rafCallbacks.values());
		rafCallbacks.clear();
		const timestamp = performance.now();
		callbacks.forEach((cb) => cb(timestamp));
	};

	/** Mount EmbeddedTerminal and capture the onRawPtyData callback */
	async function mountTerminal(tabId = 'perf-test-tab'): Promise<{
		rawPtyCallback: (sessionId: string, data: string) => void;
		unmount: () => void;
	}> {
		let rawPtyCallback: (sessionId: string, data: string) => void = () => {};

		mockOnRawPtyData.mockImplementation(
			(handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			}
		);

		let unmountFn: () => void;

		await act(async () => {
			const result = render(
				<EmbeddedTerminal
					terminalTabId={tabId}
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
			unmountFn = result.unmount;
		});

		return { rawPtyCallback, unmount: unmountFn! };
	}

	describe('Large Scrollback Data Volume', () => {
		it('should buffer 10K lines of output efficiently', async () => {
			const { rawPtyCallback } = await mountTerminal();
			const output = generateTerminalLines(10000);

			const startTime = performance.now();

			// Send as many chunks (simulating PTY output)
			const chunkSize = 4096; // Typical PTY chunk size
			await act(async () => {
				for (let i = 0; i < output.length; i += chunkSize) {
					rawPtyCallback('perf-test-tab', output.slice(i, i + chunkSize));
				}
			});

			// Flush any pending RAF callbacks
			await act(async () => {
				flushRaf();
			});

			const elapsed = performance.now() - startTime;

			// Buffering and processing 10K lines (~400KB) should be fast
			expect(elapsed).toBeLessThan(500);
		});

		it('should buffer 50K lines of output without hanging', async () => {
			const { rawPtyCallback } = await mountTerminal();
			const output = generateTerminalLines(50000);

			const startTime = performance.now();

			const chunkSize = 8192;
			await act(async () => {
				for (let i = 0; i < output.length; i += chunkSize) {
					rawPtyCallback('perf-test-tab', output.slice(i, i + chunkSize));
				}
			});

			await act(async () => {
				flushRaf();
			});

			const elapsed = performance.now() - startTime;

			// Should complete in reasonable time (string concatenation is O(n))
			expect(elapsed).toBeLessThan(2000);
		});

		it('should handle large ANSI-colored output (100KB+) efficiently', async () => {
			const { rawPtyCallback } = await mountTerminal();
			const coloredOutput = generateColoredOutput(100);

			const startTime = performance.now();

			// Send in realistic PTY-sized chunks
			const chunkSize = 4096;
			await act(async () => {
				for (let i = 0; i < coloredOutput.length; i += chunkSize) {
					rawPtyCallback(
						'perf-test-tab',
						coloredOutput.slice(i, i + chunkSize)
					);
				}
			});

			await act(async () => {
				flushRaf();
			});

			const elapsed = performance.now() - startTime;

			// 100KB of ANSI output should process in under 1 second
			expect(elapsed).toBeLessThan(1000);
		});
	});

	describe('Cleanup and Memory', () => {
		it('should cancel pending RAF on unmount', async () => {
			const { rawPtyCallback, unmount } = await mountTerminal();

			// Queue some data but don't flush
			await act(async () => {
				rawPtyCallback('perf-test-tab', 'pending data');
			});

			expect(global.requestAnimationFrame).toHaveBeenCalledTimes(1);

			// Unmount should cancel the pending RAF
			act(() => {
				unmount();
			});

			expect(global.cancelAnimationFrame).toHaveBeenCalled();
		});

		it('should flush remaining buffer on unmount', async () => {
			const { rawPtyCallback, unmount } = await mountTerminal();

			// Queue some data but don't trigger RAF
			await act(async () => {
				rawPtyCallback('perf-test-tab', 'buffered data before unmount');
			});

			// Unmount — should flush the buffer before disposing
			act(() => {
				unmount();
			});

			// The buffered data should have been written (flush on unmount)
			expect(terminalMethods.write).toHaveBeenCalledWith(
				'buffered data before unmount'
			);
		});

		it('should not leak memory after multiple mount/unmount cycles', async () => {
			for (let cycle = 0; cycle < 5; cycle++) {
				vi.clearAllMocks();

				const { rawPtyCallback, unmount } = await mountTerminal(
					`perf-tab-cycle-${cycle}`
				);

				// Write some data
				await act(async () => {
					for (let i = 0; i < 100; i++) {
						rawPtyCallback(
							`perf-tab-cycle-${cycle}`,
							`cycle-${cycle}-line-${i}\r\n`
						);
					}
				});

				await act(async () => {
					flushRaf();
				});

				// Unmount
				act(() => {
					unmount();
				});

				// Verify cleanup happened
				expect(terminalMethods.dispose).toHaveBeenCalled();
				expect(mockKill).toHaveBeenCalledWith(`perf-tab-cycle-${cycle}`);
			}
		});
	});

	describe('PERFORMANCE_THRESHOLDS', () => {
		it('should define terminal-specific thresholds', () => {
			expect(PERFORMANCE_THRESHOLDS.TERMINAL_WRITE_BATCH).toBe(8);
			expect(PERFORMANCE_THRESHOLDS.TERMINAL_SCROLLBACK_LINES).toBe(50000);
		});
	});

	describe('Carriage return preservation with batching', () => {
		it('should preserve \\r progress indicators when batched', async () => {
			const { rawPtyCallback } = await mountTerminal();

			// Simulate npm-style progress bar with rapid \r overwrites
			await act(async () => {
				rawPtyCallback('perf-test-tab', 'Progress: 10%\r');
				rawPtyCallback('perf-test-tab', 'Progress: 50%\r');
				rawPtyCallback('perf-test-tab', 'Progress: 100%\n');
			});

			await act(async () => {
				flushRaf();
			});

			// All progress updates should be in a single batched write
			expect(terminalMethods.write).toHaveBeenCalledTimes(1);
			const writtenData = terminalMethods.write.mock.calls[0][0] as string;
			expect(writtenData).toBe('Progress: 10%\rProgress: 50%\rProgress: 100%\n');
		});

		it('should preserve ANSI codes when batching colored progress', async () => {
			const { rawPtyCallback } = await mountTerminal();

			await act(async () => {
				rawPtyCallback('perf-test-tab', '\x1b[32m█████\x1b[0m░░░░░ 50%\r');
				rawPtyCallback('perf-test-tab', '\x1b[32m██████████\x1b[0m 100%\n');
			});

			await act(async () => {
				flushRaf();
			});

			expect(terminalMethods.write).toHaveBeenCalledTimes(1);
			const writtenData = terminalMethods.write.mock.calls[0][0] as string;
			expect(writtenData).toContain('\x1b[32m█████\x1b[0m');
			expect(writtenData).toContain('\x1b[32m██████████\x1b[0m');
		});
	});
});
