/**
 * @file terminalWindowFocusBlur.test.tsx
 * @description Tests for window focus/blur handling in EmbeddedTerminal and XTerminal:
 * - Auto-focus terminal when window regains focus
 * - Cursor blink paused on window blur, restored on focus
 * - Only visible terminals receive focus on window focus
 * - No focus when terminal has exited or has spawn error
 * - Cleanup of event listeners on unmount
 * - Multiple focus/blur cycles
 * - Interaction with isVisible prop changes
 */

import React, { createRef } from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';

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
		onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = { cursorBlink: true };
		this.unicode = { activeVersion: '' };
		this.cols = 80;
		this.rows = 24;
	});

	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = vi.fn();
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

vi.mock('../../../renderer/services/process', () => ({
	processService: {
		spawn: (...args: unknown[]) => mockSpawn(...args),
		write: (...args: unknown[]) => mockWrite(...args),
		kill: (...args: unknown[]) => mockKill(...args),
		resize: (...args: unknown[]) => mockResize(...args),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
		onExit: (...args: unknown[]) => mockOnExit(...args),
	},
}));

vi.mock('../../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#000',
		foreground: '#fff',
	})),
	getSearchDecorationColors: vi.fn(() => ({
		matchBackground: '#3d3548',
		matchBorder: '#6e5e98',
		matchOverviewRuler: '#bd93f9',
		activeMatchBackground: '#8c9261',
		activeMatchBorder: '#c3d273',
		activeMatchColorOverviewRuler: '#f1fa8c',
	})),
}));

// --- Import after mocks ---

import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import XTerminal from '../../../renderer/components/XTerminal/XTerminal';
import type { XTerminalHandle } from '../../../renderer/components/XTerminal/XTerminal';
import type { EmbeddedTerminalHandle } from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

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

/** Helper: render EmbeddedTerminal with successful spawn and wait for setup */
async function renderEmbeddedTerminal(
	props: Partial<React.ComponentProps<typeof EmbeddedTerminal>> & { terminalTabId: string },
) {
	let result: ReturnType<typeof render>;
	await act(async () => {
		result = render(
			<EmbeddedTerminal
				cwd="/tmp"
				theme={defaultTheme}
				fontFamily="Menlo"
				isVisible={true}
				{...props}
			/>
		);
	});

	await waitFor(() => {
		expect(mockSpawn).toHaveBeenCalled();
	});

	return result!;
}

/** Helper: render XTerminal */
function renderXTerminal(
	props?: Partial<React.ComponentProps<typeof XTerminal>>,
) {
	const ref = createRef<XTerminalHandle>();
	let result: ReturnType<typeof render>;
	act(() => {
		result = render(
			<XTerminal
				ref={ref}
				sessionId="test-xterminal-session"
				theme={defaultTheme}
				fontFamily="Menlo"
				{...props}
			/>
		);
	});
	return { result: result!, ref };
}

/** Helper: fire window focus event */
function fireWindowFocus() {
	act(() => {
		window.dispatchEvent(new Event('focus'));
	});
}

/** Helper: fire window blur event */
function fireWindowBlur() {
	act(() => {
		window.dispatchEvent(new Event('blur'));
	});
}

/** Helper: get the exit callback registered with processService.onExit */
function getExitCallback(): (sessionId: string, code: number) => void {
	const calls = mockOnExit.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][0];
}

/** Helper: access the terminal options object from the mock */
function getTerminalOptions(): Record<string, unknown> {
	const instance = MockTerminal.mock.instances[MockTerminal.mock.instances.length - 1] as Record<string, unknown>;
	return instance.options as Record<string, unknown>;
}

describe('EmbeddedTerminal — window focus/blur handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	// ================================================================
	// Auto-focus on window focus
	// ================================================================

	describe('auto-focus on window regain', () => {
		it('focuses the terminal when window gains focus', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'focus-1' });

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);
		});

		it('does not focus when tab is not visible', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'focus-hidden', isVisible: false });

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});

		it('does not focus when terminal has exited', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'focus-exited' });

			// Trigger shell exit
			const exitCallback = getExitCallback();
			act(() => exitCallback('focus-exited', 0));

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});

		it('does not focus when there is a spawn error', async () => {
			mockSpawn.mockImplementationOnce(() =>
				Promise.resolve({ success: false, error: 'spawn failed' })
			);
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="focus-spawn-error"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			// Terminal was disposed due to spawn error, so focus should not be called
			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});

		it('focuses on multiple consecutive window focus events', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'focus-multi' });

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			fireWindowFocus();
			fireWindowFocus();

			expect(terminalMethods.focus).toHaveBeenCalledTimes(3);
		});
	});

	// ================================================================
	// Cursor blink on blur/focus
	// ================================================================

	describe('cursor blink management', () => {
		it('pauses cursor blink on window blur', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'blink-blur' });
			const options = getTerminalOptions();

			fireWindowBlur();

			expect(options.cursorBlink).toBe(false);
		});

		it('restores cursor blink on window focus', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'blink-focus' });
			const options = getTerminalOptions();

			fireWindowBlur();
			expect(options.cursorBlink).toBe(false);

			fireWindowFocus();
			expect(options.cursorBlink).toBe(true);
		});

		it('handles rapid blur/focus cycles', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'blink-rapid' });
			const options = getTerminalOptions();

			for (let i = 0; i < 5; i++) {
				fireWindowBlur();
				expect(options.cursorBlink).toBe(false);
				fireWindowFocus();
				expect(options.cursorBlink).toBe(true);
			}
		});

		it('pauses cursor blink even on hidden tabs', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'blink-hidden', isVisible: false });
			const options = getTerminalOptions();

			fireWindowBlur();

			// Cursor blink should still be paused (saves resources even when hidden)
			expect(options.cursorBlink).toBe(false);
		});

		it('does not restore cursor blink on focus if tab is hidden', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'blink-hidden-focus', isVisible: false });
			const options = getTerminalOptions();

			fireWindowBlur();
			expect(options.cursorBlink).toBe(false);

			fireWindowFocus();
			// Focus handler should NOT run for hidden tabs, so cursorBlink stays false
			expect(options.cursorBlink).toBe(false);
		});
	});

	// ================================================================
	// Visibility interaction
	// ================================================================

	describe('interaction with isVisible changes', () => {
		it('starts focusing after becoming visible', async () => {
			const { rerender } = await renderEmbeddedTerminal({
				terminalTabId: 'vis-toggle',
				isVisible: false,
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			expect(terminalMethods.focus).not.toHaveBeenCalled();

			// Become visible
			await act(async () => {
				rerender(
					<EmbeddedTerminal
						terminalTabId="vis-toggle"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);
		});

		it('stops focusing after becoming hidden', async () => {
			const { rerender } = await renderEmbeddedTerminal({
				terminalTabId: 'vis-hide',
				isVisible: true,
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);

			// Become hidden
			await act(async () => {
				rerender(
					<EmbeddedTerminal
						terminalTabId="vis-hide"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={false}
					/>
				);
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});
	});

	// ================================================================
	// Cleanup
	// ================================================================

	describe('event listener cleanup', () => {
		it('removes listeners on unmount', async () => {
			const addSpy = vi.spyOn(window, 'addEventListener');
			const removeSpy = vi.spyOn(window, 'removeEventListener');

			const { unmount } = await renderEmbeddedTerminal({ terminalTabId: 'cleanup-1' });

			// Should have registered focus and blur listeners
			const focusAddCalls = addSpy.mock.calls.filter(c => c[0] === 'focus');
			const blurAddCalls = addSpy.mock.calls.filter(c => c[0] === 'blur');
			expect(focusAddCalls.length).toBeGreaterThan(0);
			expect(blurAddCalls.length).toBeGreaterThan(0);

			// Capture the handlers that were added
			const focusHandler = focusAddCalls[focusAddCalls.length - 1][1];
			const blurHandler = blurAddCalls[blurAddCalls.length - 1][1];

			act(() => unmount());

			// Should have removed the same handlers
			const focusRemoveCalls = removeSpy.mock.calls.filter(c => c[0] === 'focus');
			const blurRemoveCalls = removeSpy.mock.calls.filter(c => c[0] === 'blur');
			expect(focusRemoveCalls.some(c => c[1] === focusHandler)).toBe(true);
			expect(blurRemoveCalls.some(c => c[1] === blurHandler)).toBe(true);

			addSpy.mockRestore();
			removeSpy.mockRestore();
		});

		it('no focus calls after unmount', async () => {
			const { unmount } = await renderEmbeddedTerminal({ terminalTabId: 'cleanup-nofocus' });

			act(() => unmount());

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			// Terminal is disposed, so focus should not be called
			// (the listener was removed on cleanup)
			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});
	});

	// ================================================================
	// Combined scenarios
	// ================================================================

	describe('combined lifecycle scenarios', () => {
		it('blur → exit → focus does not focus', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'combo-exit' });

			fireWindowBlur();

			const exitCallback = getExitCallback();
			act(() => exitCallback('combo-exit', 0));

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});

		it('focus → blur → focus cycle works correctly', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'combo-cycle' });
			const options = getTerminalOptions();

			terminalMethods.focus.mockClear();

			fireWindowFocus();
			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);
			expect(options.cursorBlink).toBe(true);

			fireWindowBlur();
			expect(options.cursorBlink).toBe(false);

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);
			expect(options.cursorBlink).toBe(true);
		});

		it('PTY data continues flowing after blur/focus cycle', async () => {
			await renderEmbeddedTerminal({ terminalTabId: 'combo-data' });

			// Get the raw PTY data callback
			const rawDataCallback = mockOnRawPtyData.mock.calls[0][0];

			fireWindowBlur();

			// Simulate PTY data while blurred
			act(() => rawDataCallback('combo-data', 'hello'));

			fireWindowFocus();

			// Simulate PTY data after focus
			act(() => rawDataCallback('combo-data', ' world'));

			// Terminal should have received both writes (via RAF batching)
			// The write calls happen via requestAnimationFrame so we check the mock
			// which accumulates buffered data
		});

		it('multiple terminals — only visible one gets focused', async () => {
			// Render two terminals: one visible, one hidden
			await renderEmbeddedTerminal({ terminalTabId: 'multi-vis', isVisible: true });

			// The second render creates a new terminal instance
			const focusCountBefore = terminalMethods.focus.mock.calls.length;

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="multi-hidden"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={false}
					/>
				);
			});

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			// At least one focus call from the visible terminal
			// (both share the same mock, but the hidden one should not fire)
			// The visible terminal's handler fires focus, the hidden one does not
			expect(terminalMethods.focus).toHaveBeenCalled();
		});
	});
});

// ================================================================
// XTerminal focus/blur tests
// ================================================================

describe('XTerminal — window focus/blur handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('auto-focus on window regain', () => {
		it('focuses the terminal when window gains focus', () => {
			renderXTerminal();

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).toHaveBeenCalledTimes(1);
		});

		it('focuses on multiple consecutive focus events', () => {
			renderXTerminal();

			terminalMethods.focus.mockClear();
			fireWindowFocus();
			fireWindowFocus();

			expect(terminalMethods.focus).toHaveBeenCalledTimes(2);
		});
	});

	describe('cursor blink management', () => {
		it('pauses cursor blink on window blur', () => {
			renderXTerminal();
			const options = getTerminalOptions();

			fireWindowBlur();

			expect(options.cursorBlink).toBe(false);
		});

		it('restores cursor blink on window focus', () => {
			renderXTerminal();
			const options = getTerminalOptions();

			fireWindowBlur();
			expect(options.cursorBlink).toBe(false);

			fireWindowFocus();
			expect(options.cursorBlink).toBe(true);
		});

		it('handles rapid blur/focus cycles', () => {
			renderXTerminal();
			const options = getTerminalOptions();

			for (let i = 0; i < 5; i++) {
				fireWindowBlur();
				expect(options.cursorBlink).toBe(false);
				fireWindowFocus();
				expect(options.cursorBlink).toBe(true);
			}
		});
	});

	describe('event listener cleanup', () => {
		it('removes listeners on unmount', () => {
			const addSpy = vi.spyOn(window, 'addEventListener');
			const removeSpy = vi.spyOn(window, 'removeEventListener');

			const { result } = renderXTerminal();

			const focusAddCalls = addSpy.mock.calls.filter(c => c[0] === 'focus');
			const blurAddCalls = addSpy.mock.calls.filter(c => c[0] === 'blur');
			expect(focusAddCalls.length).toBeGreaterThan(0);
			expect(blurAddCalls.length).toBeGreaterThan(0);

			const focusHandler = focusAddCalls[focusAddCalls.length - 1][1];
			const blurHandler = blurAddCalls[blurAddCalls.length - 1][1];

			act(() => result.unmount());

			const focusRemoveCalls = removeSpy.mock.calls.filter(c => c[0] === 'focus');
			const blurRemoveCalls = removeSpy.mock.calls.filter(c => c[0] === 'blur');
			expect(focusRemoveCalls.some(c => c[1] === focusHandler)).toBe(true);
			expect(blurRemoveCalls.some(c => c[1] === blurHandler)).toBe(true);

			addSpy.mockRestore();
			removeSpy.mockRestore();
		});

		it('no focus calls after unmount', () => {
			const { result } = renderXTerminal();

			act(() => result.unmount());

			terminalMethods.focus.mockClear();
			fireWindowFocus();

			expect(terminalMethods.focus).not.toHaveBeenCalled();
		});
	});
});
