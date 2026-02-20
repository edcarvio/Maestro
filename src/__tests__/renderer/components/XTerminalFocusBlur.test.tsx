/**
 * Tests for XTerminal onFocus/onBlur callback props.
 *
 * Verifies that the xterm.js terminal's native focus/blur events are
 * properly wired to the onFocus and onBlur callbacks, enabling parent
 * components (like TerminalView) to track focus state for visual indicators.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock xterm.js modules BEFORE importing XTerminal ---

const mockTerminalFocus = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalOpen = vi.fn();

/** Captures onFocus/onBlur callbacks registered on the terminal */
let terminalFocusCallback: (() => void) | null = null;
let terminalBlurCallback: (() => void) | null = null;

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
		}
		onData() {
			return { dispose: vi.fn() };
		}
		onTitleChange() {
			return { dispose: vi.fn() };
		}
		onFocus(cb: () => void) {
			terminalFocusCallback = cb;
			return { dispose: vi.fn(() => { terminalFocusCallback = null; }) };
		}
		onBlur(cb: () => void) {
			terminalBlurCallback = cb;
			return { dispose: vi.fn(() => { terminalBlurCallback = null; }) };
		}
	}
	return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class { fit = vi.fn(); dispose = vi.fn(); },
}));
vi.mock('@xterm/addon-webgl', () => ({
	WebglAddon: class { onContextLoss = vi.fn(); dispose = vi.fn(); },
}));
vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: class { dispose = vi.fn(); },
}));
vi.mock('@xterm/addon-search', () => ({
	SearchAddon: class {
		findNext = vi.fn().mockReturnValue(true);
		findPrevious = vi.fn().mockReturnValue(true);
		clearDecorations = vi.fn();
		dispose = vi.fn();
	},
}));
vi.mock('@xterm/addon-unicode11', () => ({
	Unicode11Addon: class { dispose = vi.fn(); },
}));
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

let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;
let rafCallbacks: Array<FrameRequestCallback>;
let nextRafId: number;

beforeEach(() => {
	vi.clearAllMocks();
	terminalFocusCallback = null;
	terminalBlurCallback = null;
	dataCallbacks = [];
	exitCallbacks = [];
	rafCallbacks = [];
	nextRafId = 1;

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
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('XTerminal onFocus/onBlur callbacks', () => {
	describe('onFocus callback', () => {
		it('calls onFocus when the terminal gains focus', () => {
			const onFocus = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
				/>
			);

			expect(terminalFocusCallback).not.toBeNull();

			act(() => {
				terminalFocusCallback!();
			});

			expect(onFocus).toHaveBeenCalledTimes(1);
		});

		it('does not register focus listener when onFocus is undefined', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
				/>
			);

			// onFocus is not provided, so no focus callback should be registered
			expect(terminalFocusCallback).toBeNull();
		});

		it('calls onFocus multiple times for repeated focus events', () => {
			const onFocus = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
				/>
			);

			act(() => {
				terminalFocusCallback!();
				terminalFocusCallback!();
				terminalFocusCallback!();
			});

			expect(onFocus).toHaveBeenCalledTimes(3);
		});
	});

	describe('onBlur callback', () => {
		it('calls onBlur when the terminal loses focus', () => {
			const onBlur = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onBlur={onBlur}
				/>
			);

			expect(terminalBlurCallback).not.toBeNull();

			act(() => {
				terminalBlurCallback!();
			});

			expect(onBlur).toHaveBeenCalledTimes(1);
		});

		it('does not register blur listener when onBlur is undefined', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
				/>
			);

			expect(terminalBlurCallback).toBeNull();
		});
	});

	describe('focus/blur interaction', () => {
		it('fires focus then blur in sequence', () => {
			const onFocus = vi.fn();
			const onBlur = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);

			act(() => {
				terminalFocusCallback!();
			});
			expect(onFocus).toHaveBeenCalledTimes(1);
			expect(onBlur).not.toHaveBeenCalled();

			act(() => {
				terminalBlurCallback!();
			});
			expect(onBlur).toHaveBeenCalledTimes(1);
		});

		it('handles rapid focus/blur cycles', () => {
			const onFocus = vi.fn();
			const onBlur = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);

			act(() => {
				terminalFocusCallback!();
				terminalBlurCallback!();
				terminalFocusCallback!();
				terminalBlurCallback!();
				terminalFocusCallback!();
			});

			expect(onFocus).toHaveBeenCalledTimes(3);
			expect(onBlur).toHaveBeenCalledTimes(2);
		});
	});

	describe('cleanup on unmount', () => {
		it('disposes focus/blur listeners on unmount', () => {
			const onFocus = vi.fn();
			const onBlur = vi.fn();
			const { unmount } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);

			// Callbacks should be registered
			expect(terminalFocusCallback).not.toBeNull();
			expect(terminalBlurCallback).not.toBeNull();

			unmount();

			// After unmount, dispose was called which nullifies the callbacks
			expect(terminalFocusCallback).toBeNull();
			expect(terminalBlurCallback).toBeNull();
		});
	});

	describe('callback prop changes', () => {
		it('re-registers listeners when onFocus changes', () => {
			const onFocus1 = vi.fn();
			const onFocus2 = vi.fn();

			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus1}
				/>
			);

			// First callback works
			act(() => { terminalFocusCallback!(); });
			expect(onFocus1).toHaveBeenCalledTimes(1);

			// Change callback
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus2}
				/>
			);

			// New callback is wired
			act(() => { terminalFocusCallback!(); });
			expect(onFocus2).toHaveBeenCalledTimes(1);
			// Old callback should not have been called again
			expect(onFocus1).toHaveBeenCalledTimes(1);
		});

		it('re-registers listeners when onBlur changes', () => {
			const onBlur1 = vi.fn();
			const onBlur2 = vi.fn();

			const { rerender } = render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onBlur={onBlur1}
				/>
			);

			act(() => { terminalBlurCallback!(); });
			expect(onBlur1).toHaveBeenCalledTimes(1);

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onBlur={onBlur2}
				/>
			);

			act(() => { terminalBlurCallback!(); });
			expect(onBlur2).toHaveBeenCalledTimes(1);
			expect(onBlur1).toHaveBeenCalledTimes(1);
		});
	});

	describe('interaction with shell exit', () => {
		it('focus/blur callbacks still fire after shell exit', () => {
			const onFocus = vi.fn();
			const onBlur = vi.fn();
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					onFocus={onFocus}
					onBlur={onBlur}
				/>
			);

			// Shell exits
			act(() => {
				for (const cb of exitCallbacks) {
					cb('sess-1-terminal-tab-1', 0);
				}
			});

			// Focus/blur should still work — the terminal element is still in the DOM
			act(() => { terminalFocusCallback!(); });
			expect(onFocus).toHaveBeenCalledTimes(1);

			act(() => { terminalBlurCallback!(); });
			expect(onBlur).toHaveBeenCalledTimes(1);
		});
	});
});
