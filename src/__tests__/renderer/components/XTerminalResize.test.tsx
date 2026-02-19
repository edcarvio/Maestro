/**
 * Tests for XTerminal resize handling.
 *
 * Verifies the end-to-end resize flow:
 * - ResizeObserver triggers the debounced resize handler
 * - Debounce coalesces rapid resize events (100ms window)
 * - fitAddon.fit() recalculates terminal dimensions
 * - IPC call (process.resize) sends cols/rows to PTY in main process
 * - onResize prop callback receives correct dimensions
 * - Session ID is used correctly in IPC call
 * - Imperative resize handle works
 * - Font size / font family changes trigger fit()
 * - Cleanup: ResizeObserver disconnects on unmount
 * - No IPC calls after unmount (debounce timer cancelled)
 *
 * The resize pipeline is critical for full-screen terminal apps (vim, htop, nano)
 * which rely on accurate PTY dimensions via SIGWINCH to position cursors and draw UI.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock all xterm.js modules BEFORE importing XTerminal ---

const mockFit = vi.fn();
const mockTerminalOpen = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalFocus = vi.fn();

// Configurable cols/rows to simulate fitAddon recalculating dimensions
let mockCols = 80;
let mockRows = 24;

vi.mock('@xterm/xterm', () => {
	class MockTerminal {
		open = mockTerminalOpen;
		write = mockTerminalWrite;
		focus = mockTerminalFocus;
		clear = vi.fn();
		dispose = mockTerminalDispose;
		scrollToBottom = vi.fn();
		getSelection = vi.fn().mockReturnValue('');
		loadAddon = vi.fn();
		unicode = { activeVersion: '' };
		get cols() { return mockCols; }
		get rows() { return mockRows; }
		options: Record<string, unknown> = {};
		onData() { return { dispose: vi.fn() }; }
		onTitleChange() { return { dispose: vi.fn() }; }
	}
	return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
	class MockFitAddon {
		fit = mockFit;
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
	class MockWebLinksAddon { dispose = vi.fn(); }
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
	class MockUnicode11Addon { dispose = vi.fn(); }
	return { Unicode11Addon: MockUnicode11Addon };
});

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Import XTerminal AFTER all mocks are in place
import { XTerminal, XTerminalHandle } from '../../../renderer/components/XTerminal';
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

// IPC callback collectors (for onData/onExit subscriptions)
let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

// Custom ResizeObserver mock with controllable callback triggering.
// Must be a class (not vi.fn().mockImplementation) because it's instantiated with `new`.
let resizeObserverCallback: ResizeObserverCallback | null = null;
let resizeObserverTarget: Element | null = null;
let mockObserveCount = 0;
let mockDisconnectCount = 0;

/**
 * Simulate a ResizeObserver notification with given dimensions.
 * This mimics the browser firing a resize event when the container changes size.
 */
function simulateResize(width: number, height: number) {
	if (!resizeObserverCallback || !resizeObserverTarget) return;
	const entry: ResizeObserverEntry = {
		target: resizeObserverTarget,
		contentRect: {
			width, height,
			top: 0, left: 0,
			bottom: height, right: width,
			x: 0, y: 0,
			toJSON: () => ({}),
		},
		borderBoxSize: [{ blockSize: height, inlineSize: width }],
		contentBoxSize: [{ blockSize: height, inlineSize: width }],
		devicePixelContentBoxSize: [{ blockSize: height, inlineSize: width }],
	};
	resizeObserverCallback([entry], {} as ResizeObserver);
}

class TestResizeObserver {
	constructor(callback: ResizeObserverCallback) {
		resizeObserverCallback = callback;
	}
	observe(target: Element) {
		mockObserveCount++;
		resizeObserverTarget = target;
		// Simulate initial observation (browser fires immediately on observe)
		setTimeout(() => simulateResize(1000, 500), 0);
	}
	unobserve() {}
	disconnect() {
		mockDisconnectCount++;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	mockCols = 80;
	mockRows = 24;
	resizeObserverCallback = null;
	resizeObserverTarget = null;
	mockObserveCount = 0;
	mockDisconnectCount = 0;
	dataCallbacks = [];
	exitCallbacks = [];

	// Override the global ResizeObserver with our testable class
	global.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

	// Mock IPC event subscriptions
	(window.maestro.process as Record<string, unknown>).onData = vi.fn(
		(cb: (sid: string, data: string) => void) => {
			dataCallbacks.push(cb);
			return () => {
				const idx = dataCallbacks.indexOf(cb);
				if (idx >= 0) dataCallbacks.splice(idx, 1);
			};
		}
	);
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn(
		(cb: (sid: string, code: number) => void) => {
			exitCallbacks.push(cb);
			return () => {
				const idx = exitCallbacks.indexOf(cb);
				if (idx >= 0) exitCallbacks.splice(idx, 1);
			};
		}
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('XTerminal Resize Handling', () => {
	describe('ResizeObserver integration', () => {
		it('creates a ResizeObserver and observes the container on mount', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(mockObserveCount).toBe(1);
		});

		it('disconnects the ResizeObserver on unmount', () => {
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			unmount();

			expect(mockDisconnectCount).toBe(1);
		});

		it('calls fitAddon.fit() on initial mount', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			// fit() is called during terminal initialization (not debounced)
			expect(mockFit).toHaveBeenCalled();
		});
	});

	describe('debounced resize', () => {
		it('calls fitAddon.fit() after 100ms debounce when ResizeObserver fires', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			// Clear the initial fit() call from mount
			mockFit.mockClear();

			// Simulate a resize event
			act(() => {
				simulateResize(1200, 600);
			});

			// fit() should NOT be called yet (debounce pending)
			expect(mockFit).not.toHaveBeenCalled();

			// Advance past the 100ms debounce
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// Now fit() should have been called
			expect(mockFit).toHaveBeenCalledTimes(1);
		});

		it('coalesces multiple rapid resize events into a single fit() call', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			mockFit.mockClear();
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Simulate rapid successive resizes (like dragging a window edge)
			act(() => {
				simulateResize(800, 400);
			});
			act(() => {
				vi.advanceTimersByTime(30);
			});
			act(() => {
				simulateResize(900, 450);
			});
			act(() => {
				vi.advanceTimersByTime(30);
			});
			act(() => {
				simulateResize(1000, 500);
			});

			// Still within debounce window — no fit() yet
			expect(mockFit).not.toHaveBeenCalled();

			// Advance past debounce from last event
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// Only ONE fit() call despite 3 resize events
			expect(mockFit).toHaveBeenCalledTimes(1);
		});

		it('resets the debounce timer on each new resize event', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			mockFit.mockClear();

			// First resize
			act(() => {
				simulateResize(800, 400);
			});

			// Advance 80ms (not yet past 100ms debounce)
			act(() => {
				vi.advanceTimersByTime(80);
			});

			// Second resize resets the timer
			act(() => {
				simulateResize(900, 450);
			});

			// Advance another 80ms (160ms total from first, 80ms from second)
			act(() => {
				vi.advanceTimersByTime(80);
			});

			// Still no fit() — second event reset the timer
			expect(mockFit).not.toHaveBeenCalled();

			// Advance to 100ms after second event
			act(() => {
				vi.advanceTimersByTime(20);
			});

			// Now it fires
			expect(mockFit).toHaveBeenCalledTimes(1);
		});
	});

	describe('IPC resize call', () => {
		it('calls process.resize with correct sessionId, cols, and rows', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			act(() => {
				simulateResize(1200, 600);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1',
				mockCols,
				mockRows
			);
		});

		it('sends updated dimensions when fitAddon recalculates cols/rows', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Simulate fitAddon changing the terminal dimensions (wider terminal)
			mockCols = 120;
			mockRows = 40;

			act(() => {
				simulateResize(1600, 800);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1',
				120,
				40
			);
		});

		it('uses the current sessionId (handles session changes)', () => {
			const { rerender } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Change the session ID (e.g., user switched tabs)
			rerender(
				<XTerminal sessionId="sess-2-terminal-tab-3" theme={theme} fontFamily="Menlo" />
			);

			act(() => {
				simulateResize(1200, 600);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// Should use the UPDATED session ID
			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-2-terminal-tab-3',
				expect.any(Number),
				expect.any(Number)
			);
		});

		it('sends dimensions suitable for full-screen apps (vim, htop)', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Simulate a large terminal (common for htop/vim usage)
			mockCols = 200;
			mockRows = 50;

			act(() => {
				simulateResize(2000, 1000);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// Full-screen apps need both cols AND rows to be sent correctly
			// vim uses these for cursor positioning, htop for drawing its UI
			const call = (window.maestro.process.resize as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(call[1]).toBe(200); // cols
			expect(call[2]).toBe(50);  // rows
			expect(call[1]).toBeGreaterThan(0);
			expect(call[2]).toBeGreaterThan(0);
		});
	});

	describe('onResize callback', () => {
		it('invokes the onResize prop with cols and rows after resize', () => {
			const onResize = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onResize={onResize}
				/>
			);

			mockCols = 100;
			mockRows = 30;

			act(() => {
				simulateResize(1200, 600);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(onResize).toHaveBeenCalledWith(100, 30);
		});

		it('does not throw when onResize prop is undefined', () => {
			// Render without onResize callback (optional prop)
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			// Should not throw
			act(() => {
				simulateResize(1200, 600);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// If we reach here without errors, the test passes
			expect(window.maestro.process.resize).toHaveBeenCalled();
		});
	});

	describe('font change triggers resize', () => {
		it('calls fit() when fontSize changes', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					fontSize={14}
				/>
			);
			mockFit.mockClear();

			// Change font size (user adjusts terminal font size)
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					fontSize={18}
				/>
			);

			// fit() should be called to recalculate cols/rows for new font size
			// Larger font → fewer cols/rows for same container width
			expect(mockFit).toHaveBeenCalled();
		});

		it('calls fit() when fontFamily changes', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					fontSize={14}
				/>
			);
			mockFit.mockClear();

			// Change font family (user switches monospace font)
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Fira Code"
					fontSize={14}
				/>
			);

			// fit() recalculates because different fonts have different character widths
			expect(mockFit).toHaveBeenCalled();
		});
	});

	describe('imperative resize handle', () => {
		it('exposes resize() method that calls fitAddon.fit()', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
				/>
			);
			mockFit.mockClear();

			// Call the imperative resize method (used by parent components)
			act(() => {
				ref.current?.resize();
			});

			expect(mockFit).toHaveBeenCalledTimes(1);
		});
	});

	describe('cleanup and unmount safety', () => {
		it('does not call process.resize after unmount even if debounce timer fires', () => {
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Trigger a resize (starts 100ms debounce)
			act(() => {
				simulateResize(1200, 600);
			});

			// Unmount before debounce fires
			unmount();

			// Advance past debounce — should NOT call resize (component is unmounted)
			act(() => {
				vi.advanceTimersByTime(200);
			});

			// The terminal was disposed on unmount, so fitAddonRef.current is null
			// and the debounce handler's guard (if fitAddonRef.current && terminalRef.current)
			// prevents the IPC call
			// No additional resize calls beyond what happened before unmount
			expect(window.maestro.process.resize).not.toHaveBeenCalled();
		});

		it('disposes the terminal instance on unmount', () => {
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			unmount();

			expect(mockTerminalDispose).toHaveBeenCalledTimes(1);
		});
	});

	describe('terminal dimensions for different app scenarios', () => {
		it('supports standard 80x24 terminal size', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			mockCols = 80;
			mockRows = 24;

			act(() => {
				simulateResize(800, 400);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			// 80x24 is the classic terminal size — must be supported for compatibility
			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1', 80, 24
			);
		});

		it('supports wide terminal for htop-style monitoring tools', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Simulating a wide monitor with lots of columns
			mockCols = 240;
			mockRows = 60;

			act(() => {
				simulateResize(2400, 1200);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1', 240, 60
			);
		});

		it('supports narrow terminal for split-pane layouts', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// Narrow pane — vim/nano should still get correct dimensions
			mockCols = 40;
			mockRows = 20;

			act(() => {
				simulateResize(400, 300);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1', 40, 20
			);
		});
	});

	describe('multiple sequential resizes', () => {
		it('sends correct dimensions for each completed debounce cycle', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			(window.maestro.process.resize as ReturnType<typeof vi.fn>).mockClear();

			// First resize cycle
			mockCols = 100;
			mockRows = 30;
			act(() => {
				simulateResize(1000, 500);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1', 100, 30
			);

			// Second resize cycle (user resizes again)
			mockCols = 150;
			mockRows = 45;
			act(() => {
				simulateResize(1500, 750);
			});
			act(() => {
				vi.advanceTimersByTime(100);
			});

			expect(window.maestro.process.resize).toHaveBeenCalledTimes(2);
			expect(window.maestro.process.resize).toHaveBeenLastCalledWith(
				'sess-1-terminal-tab-1', 150, 45
			);
		});
	});
});
