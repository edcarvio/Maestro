/**
 * Tests for XTerminal IPC data flow.
 *
 * Verifies the bidirectional data bridge between xterm.js and the main process PTY:
 * - PTY output (process.onData) → terminal.write (via RAF batching)
 * - User input (terminal.onData) → process.write
 * - PTY exit (process.onExit) → exit message in terminal
 * - Session ID filtering (only processes data for the correct session)
 * - Cleanup on unmount (unsubscribes from IPC events)
 *
 * Uses mocked xterm.js Terminal class since the real one requires a browser environment
 * with canvas/webgl support that jsdom doesn't provide.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock all xterm.js modules BEFORE importing XTerminal ---
// Must use class syntax (not arrow functions) since these are instantiated with `new`

const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalOpen = vi.fn();

// Capture terminal.onData callback (user input → PTY)
let userInputCallback: ((data: string) => void) | null = null;

vi.mock('@xterm/xterm', () => {
	class MockTerminal {
		open = mockTerminalOpen;
		write = mockTerminalWrite;
		focus = vi.fn();
		clear = vi.fn();
		dispose = mockTerminalDispose;
		scrollToBottom = vi.fn();
		getSelection = vi.fn().mockReturnValue('');
		loadAddon = vi.fn();
		unicode = { activeVersion: '' };
		cols = 80;
		rows = 24;
		options = {};
		onData(cb: (data: string) => void) {
			userInputCallback = cb;
			return { dispose: vi.fn() };
		}
		onTitleChange() {
			return { dispose: vi.fn() };
		}
	}
	return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
	class MockFitAddon {
		fit = vi.fn();
		dispose = vi.fn();
	}
	return { FitAddon: MockFitAddon };
});

vi.mock('@xterm/addon-webgl', () => {
	class MockWebglAddon {
		onContextLoss = vi.fn();
		dispose = vi.fn();
	}
	return { WebglAddon: MockWebglAddon };
});

vi.mock('@xterm/addon-web-links', () => {
	class MockWebLinksAddon {
		dispose = vi.fn();
	}
	return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock('@xterm/addon-search', () => {
	class MockSearchAddon {
		findNext = vi.fn().mockReturnValue(true);
		findPrevious = vi.fn().mockReturnValue(true);
		clearDecorations = vi.fn();
		dispose = vi.fn();
	}
	return { SearchAddon: MockSearchAddon };
});

vi.mock('@xterm/addon-unicode11', () => {
	class MockUnicode11Addon {
		dispose = vi.fn();
	}
	return { Unicode11Addon: MockUnicode11Addon };
});

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Import XTerminal after all mocks are in place
import { XTerminal } from '../../../renderer/components/XTerminal';
import type { Theme } from '../../../renderer/types';

// Minimal theme for testing
const theme: Theme = {
	id: 'test',
	name: 'Test',
	mode: 'dark',
	colors: {
		background: '#1a1a2e',
		bgMain: '#16213e',
		bgSidebar: '#0f3460',
		bgActivity: '#0f3460',
		surface: '#1a1a4e',
		border: '#533483',
		textMain: '#e94560',
		textDim: '#a1a1b5',
		accent: '#e94560',
		accentForeground: '#ffffff',
		warning: '#ffc107',
		error: '#f44336',
		success: '#4caf50',
	},
};

// IPC callback collectors (simulating main process event subscriptions)
let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

// RAF callback collector for controlled write-buffer flushing
let rafCallbacks: Array<FrameRequestCallback>;
let nextRafId: number;

beforeEach(() => {
	vi.clearAllMocks();
	userInputCallback = null;
	dataCallbacks = [];
	exitCallbacks = [];
	rafCallbacks = [];
	nextRafId = 1;

	// Add process.onData mock (not in global setup.ts)
	(window.maestro.process as Record<string, unknown>).onData = vi.fn(
		(cb: (sid: string, data: string) => void) => {
			dataCallbacks.push(cb);
			return () => {
				const idx = dataCallbacks.indexOf(cb);
				if (idx >= 0) dataCallbacks.splice(idx, 1);
			};
		}
	);

	// Override process.onExit to capture callbacks
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn(
		(cb: (sid: string, code: number) => void) => {
			exitCallbacks.push(cb);
			return () => {
				const idx = exitCallbacks.indexOf(cb);
				if (idx >= 0) exitCallbacks.splice(idx, 1);
			};
		}
	);

	// Mock RAF for controlled write-buffer flushing
	vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
		rafCallbacks.push(cb);
		return nextRafId++;
	});
	vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Execute all pending RAF callbacks (flushes the write buffer) */
function flushRaf() {
	const cbs = [...rafCallbacks];
	rafCallbacks = [];
	for (const cb of cbs) {
		cb(performance.now());
	}
}

describe('XTerminal IPC Data Flow', () => {
	it('subscribes to PTY data events on mount', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		expect(window.maestro.process.onData).toHaveBeenCalledTimes(1);
		expect(dataCallbacks).toHaveLength(1);
	});

	it('subscribes to PTY exit events on mount', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		expect(window.maestro.process.onExit).toHaveBeenCalledTimes(1);
		expect(exitCallbacks).toHaveLength(1);
	});

	it('routes PTY data to terminal.write via RAF batching', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		// Simulate PTY output from main process
		act(() => {
			for (const cb of dataCallbacks) {
				cb('sess-1-terminal-tab-1', 'Hello from shell\r\n');
			}
		});

		// Data is buffered — not written yet
		expect(mockTerminalWrite).not.toHaveBeenCalledWith('Hello from shell\r\n');

		// Flush RAF to trigger write-buffer flush
		act(() => {
			flushRaf();
		});

		expect(mockTerminalWrite).toHaveBeenCalledWith('Hello from shell\r\n');
	});

	it('coalesces multiple PTY data chunks into a single write', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		// Simulate multiple rapid PTY data events (common during build output)
		act(() => {
			for (const cb of dataCallbacks) {
				cb('sess-1-terminal-tab-1', 'line 1\r\n');
				cb('sess-1-terminal-tab-1', 'line 2\r\n');
				cb('sess-1-terminal-tab-1', 'line 3\r\n');
			}
		});

		// Only one RAF should be scheduled despite 3 data events
		expect(rafCallbacks).toHaveLength(1);

		act(() => {
			flushRaf();
		});

		// All data coalesced into a single write
		expect(mockTerminalWrite).toHaveBeenCalledWith('line 1\r\nline 2\r\nline 3\r\n');
	});

	it('filters PTY data by session ID (ignores other sessions)', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		// Simulate data for a DIFFERENT session
		act(() => {
			for (const cb of dataCallbacks) {
				cb('sess-2-terminal-tab-2', 'wrong session data');
			}
		});

		// No RAF should have been scheduled for wrong-session data
		expect(rafCallbacks).toHaveLength(0);
		expect(mockTerminalWrite).not.toHaveBeenCalled();
	});

	it('sends user input to PTY via process.write', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		// xterm.js fires terminal.onData when user types
		expect(userInputCallback).not.toBeNull();
		act(() => {
			userInputCallback!('ls -la\r');
		});

		expect(window.maestro.process.write).toHaveBeenCalledWith(
			'sess-1-terminal-tab-1',
			'ls -la\r'
		);
	});

	it('calls onData prop callback when user types', () => {
		const onDataProp = vi.fn();
		render(
			<XTerminal
				sessionId="sess-1-terminal-tab-1"
				theme={theme}
				fontFamily="Menlo"
				onData={onDataProp}
			/>
		);

		act(() => {
			userInputCallback!('echo hello\r');
		});

		expect(onDataProp).toHaveBeenCalledWith('echo hello\r');
	});

	it('writes exit message to terminal when PTY exits', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		act(() => {
			for (const cb of exitCallbacks) {
				cb('sess-1-terminal-tab-1', 0);
			}
		});

		expect(mockTerminalWrite).toHaveBeenCalledWith(
			expect.stringContaining('Process exited with code 0')
		);
	});

	it('does not write exit message for different session', () => {
		render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		act(() => {
			for (const cb of exitCallbacks) {
				cb('other-session', 1);
			}
		});

		expect(mockTerminalWrite).not.toHaveBeenCalledWith(
			expect.stringContaining('Process exited')
		);
	});

	it('unsubscribes from PTY data on unmount', () => {
		const { unmount } = render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		expect(dataCallbacks).toHaveLength(1);

		unmount();

		expect(dataCallbacks).toHaveLength(0);
	});

	it('unsubscribes from PTY exit on unmount', () => {
		const { unmount } = render(
			<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
		);

		expect(exitCallbacks).toHaveLength(1);

		unmount();

		expect(exitCallbacks).toHaveLength(0);
	});
});
