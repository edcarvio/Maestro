/**
 * Tests for XTerminal window focus/blur handling.
 *
 * Verifies the UX polish for window-level focus transitions:
 * - Terminal auto-focuses when the application window regains focus (Alt-Tab back)
 * - Cursor blink pauses when the window loses focus (reduces visual noise)
 * - Cursor blink resumes on focus only when the cursorBlink prop is true
 * - Focus/blur listeners are cleaned up on unmount
 * - Interaction with other features (shell exit, theme changes) after blur
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock xterm.js modules BEFORE importing XTerminal ---

const mockTerminalFocus = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalOpen = vi.fn();

/** Tracks terminal.options mutations for cursor blink assertions */
let terminalOptions: Record<string, unknown> = {};

let userInputCallback: ((data: string) => void) | null = null;

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
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		constructor(opts: Record<string, unknown>) {
			this.options = { ...opts };
			terminalOptions = this.options;
		}
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

const theme: Theme = {
	id: 'test-dark',
	name: 'Test Dark',
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

// IPC callback collectors
let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;
let rafCallbacks: Array<FrameRequestCallback>;
let nextRafId: number;

// Track window event listeners for assertions
let focusListeners: Array<EventListenerOrEventListenerObject>;
let blurListeners: Array<EventListenerOrEventListenerObject>;
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

beforeEach(() => {
	vi.clearAllMocks();
	userInputCallback = null;
	terminalOptions = {};
	dataCallbacks = [];
	exitCallbacks = [];
	rafCallbacks = [];
	nextRafId = 1;
	focusListeners = [];
	blurListeners = [];

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

	vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
		rafCallbacks.push(cb);
		return nextRafId++;
	});
	vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

	// Spy on window.addEventListener/removeEventListener to track focus/blur listeners
	vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, ...args: unknown[]) => {
		if (type === 'focus') focusListeners.push(listener);
		if (type === 'blur') blurListeners.push(listener);
		return originalAddEventListener(type, listener, ...(args as [boolean | AddEventListenerOptions | undefined]));
	});
	vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, ...args: unknown[]) => {
		if (type === 'focus') {
			const idx = focusListeners.indexOf(listener);
			if (idx >= 0) focusListeners.splice(idx, 1);
		}
		if (type === 'blur') {
			const idx = blurListeners.indexOf(listener);
			if (idx >= 0) blurListeners.splice(idx, 1);
		}
		return originalRemoveEventListener(type, listener, ...(args as [boolean | EventListenerOptions | undefined]));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Simulate browser window gaining focus */
function simulateWindowFocus() {
	window.dispatchEvent(new Event('focus'));
}

/** Simulate browser window losing focus */
function simulateWindowBlur() {
	window.dispatchEvent(new Event('blur'));
}

describe('XTerminal Window Focus/Blur Handling', () => {
	describe('Window focus — auto-focus terminal', () => {
		it('calls terminal.focus() when window gains focus', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			mockTerminalFocus.mockClear();

			act(() => {
				simulateWindowFocus();
			});

			expect(mockTerminalFocus).toHaveBeenCalledTimes(1);
		});

		it('registers focus event listener on mount', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(window.addEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
		});

		it('registers blur event listener on mount', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(window.addEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
		});

		it('focuses terminal on every window focus event (not just the first)', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			mockTerminalFocus.mockClear();

			act(() => { simulateWindowFocus(); });
			act(() => { simulateWindowFocus(); });
			act(() => { simulateWindowFocus(); });

			expect(mockTerminalFocus).toHaveBeenCalledTimes(3);
		});
	});

	describe('Window blur — cursor blink pause', () => {
		it('sets cursorBlink to false when window loses focus', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			act(() => {
				simulateWindowBlur();
			});

			expect(terminalOptions.cursorBlink).toBe(false);
		});

		it('restores cursorBlink to true when window regains focus', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Blur — blink stops
			act(() => {
				simulateWindowBlur();
			});
			expect(terminalOptions.cursorBlink).toBe(false);

			// Focus — blink resumes
			act(() => {
				simulateWindowFocus();
			});
			expect(terminalOptions.cursorBlink).toBe(true);
		});

		it('does not restore cursorBlink if prop is false', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={false}
				/>
			);

			// Blur
			act(() => {
				simulateWindowBlur();
			});
			expect(terminalOptions.cursorBlink).toBe(false);

			// Focus — cursorBlink should stay false because prop is false
			act(() => {
				simulateWindowFocus();
			});
			expect(terminalOptions.cursorBlink).toBe(false);
		});

		it('handles rapid blur/focus cycles correctly', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Rapid Alt-Tab cycles
			act(() => {
				simulateWindowBlur();
				simulateWindowFocus();
				simulateWindowBlur();
				simulateWindowFocus();
			});

			// Final state: focused, blink should be on
			expect(terminalOptions.cursorBlink).toBe(true);
		});

		it('handles blur without prior focus', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Direct blur (e.g., window loses focus immediately after mount)
			act(() => {
				simulateWindowBlur();
			});

			expect(terminalOptions.cursorBlink).toBe(false);
		});
	});

	describe('Cleanup on unmount', () => {
		it('removes focus and blur listeners on unmount', () => {
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(focusListeners.length).toBeGreaterThan(0);
			expect(blurListeners.length).toBeGreaterThan(0);

			unmount();

			expect(window.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
			expect(window.removeEventListener).toHaveBeenCalledWith('blur', expect.any(Function));
		});

		it('does not call terminal.focus() after unmount', () => {
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			unmount();
			mockTerminalFocus.mockClear();

			// Fire focus after unmount — terminalRef.current is null after dispose
			act(() => {
				simulateWindowFocus();
			});

			// Since listeners were removed, no focus call should happen
			// (The removeEventListener cleanup prevents the callback from firing)
			expect(mockTerminalFocus).not.toHaveBeenCalled();
		});
	});

	describe('Interaction with PTY data flow', () => {
		it('PTY data continues flowing after blur', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			act(() => {
				simulateWindowBlur();
			});

			// Data arrives while window is blurred
			act(() => {
				for (const cb of dataCallbacks) {
					cb('sess-1-terminal-tab-1', 'background data\r\n');
				}
			});
			act(() => {
				for (const cb of rafCallbacks) {
					cb(performance.now());
				}
				rafCallbacks = [];
			});

			expect(mockTerminalWrite).toHaveBeenCalledWith('background data\r\n');
		});

		it('user input still works after blur and refocus', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			act(() => {
				simulateWindowBlur();
			});
			act(() => {
				simulateWindowFocus();
			});

			// Type after refocus
			act(() => {
				userInputCallback!('ls\r');
			});

			expect(window.maestro.process.write).toHaveBeenCalledWith(
				'sess-1-terminal-tab-1',
				'ls\r'
			);
		});
	});

	describe('Interaction with shell exit', () => {
		it('focus after shell exit does not crash', () => {
			const onCloseRequest = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onCloseRequest={onCloseRequest}
				/>
			);

			// Shell exits
			act(() => {
				for (const cb of exitCallbacks) {
					cb('sess-1-terminal-tab-1', 0);
				}
			});

			// Window refocus — terminal.focus() should still be called without crashing
			mockTerminalFocus.mockClear();
			expect(() => {
				act(() => {
					simulateWindowFocus();
				});
			}).not.toThrow();

			expect(mockTerminalFocus).toHaveBeenCalled();
		});

		it('blur after shell exit pauses cursor blink', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Shell exits
			act(() => {
				for (const cb of exitCallbacks) {
					cb('sess-1-terminal-tab-1', 0);
				}
			});

			act(() => {
				simulateWindowBlur();
			});

			expect(terminalOptions.cursorBlink).toBe(false);
		});
	});

	describe('cursorBlink prop changes', () => {
		it('respects cursorBlink prop change from true to false', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Change prop to false
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={false}
				/>
			);

			// Blur and focus cycle
			act(() => {
				simulateWindowBlur();
				simulateWindowFocus();
			});

			// cursorBlink should stay false since prop is now false
			expect(terminalOptions.cursorBlink).toBe(false);
		});

		it('respects cursorBlink prop change from false to true', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={false}
				/>
			);

			// Change prop to true
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					cursorBlink={true}
				/>
			);

			// Blur and focus cycle
			act(() => {
				simulateWindowBlur();
			});
			expect(terminalOptions.cursorBlink).toBe(false);

			act(() => {
				simulateWindowFocus();
			});
			// cursorBlink should now restore to true since prop was changed
			expect(terminalOptions.cursorBlink).toBe(true);
		});
	});
});
