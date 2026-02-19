/**
 * @file terminalWebGLContextLoss.test.tsx
 * @description Tests for WebGL context loss handling in both XTerminal and EmbeddedTerminal.
 *
 * Verifies that:
 * - WebGL addon is loaded asynchronously and onContextLoss is registered
 * - Context loss triggers addon disposal (clean WebGL teardown)
 * - Terminal continues functioning after context loss (canvas fallback)
 * - WebGL constructor failure falls back silently to canvas renderer
 * - PTY data flow is uninterrupted through context loss events
 * - Multiple context losses are handled gracefully
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
	searchMethods,
	MockSearchAddon,
	MockUnicode11Addon,
	mockFit,
	mockSpawn,
	mockWrite,
	mockKill,
	mockResize,
	mockOnRawPtyData,
	mockOnExit,
	webglInstances,
	MockWebglAddon,
	webglShouldFail,
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
		this.options = {};
		this.unicode = { activeVersion: '' };
		this.cols = 80;
		this.rows = 24;
	});

	const _mockFit = vi.fn();
	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = _mockFit;
		this.dispose = vi.fn();
	});

	const _MockWebLinksAddon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _searchMethods = {
		findNext: vi.fn(() => true),
		findPrevious: vi.fn(() => true),
		clearDecorations: vi.fn(),
		dispose: vi.fn(),
	};
	const _MockSearchAddon = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _searchMethods);
	});

	const _MockUnicode11Addon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	// Track WebglAddon instances so tests can trigger onContextLoss
	const _webglInstances: Array<{
		onContextLoss: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
		contextLossCallback: (() => void) | null;
	}> = [];

	// Flag to simulate WebGL constructor failure
	const _webglShouldFail = { value: false };

	const _MockWebglAddon = vi.fn(function (this: Record<string, unknown>) {
		if (_webglShouldFail.value) {
			throw new Error('WebGL not supported');
		}
		const instance = {
			onContextLoss: vi.fn((cb: () => void) => {
				instance.contextLossCallback = cb;
			}),
			dispose: vi.fn(),
			contextLossCallback: null as (() => void) | null,
		};
		Object.assign(this, instance);
		_webglInstances.push(instance);
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
		searchMethods: _searchMethods,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockFit: _mockFit,
		mockSpawn: _mockSpawn,
		mockWrite: _mockWrite,
		mockKill: _mockKill,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
		mockOnExit: _mockOnExit,
		webglInstances: _webglInstances,
		MockWebglAddon: _MockWebglAddon,
		webglShouldFail: _webglShouldFail,
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
	WebglAddon: MockWebglAddon,
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
		background: '#1e1e2e',
		foreground: '#cdd6f4',
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

import XTerminal from '../../../renderer/components/XTerminal/XTerminal';
import type { XTerminalHandle } from '../../../renderer/components/XTerminal/XTerminal';
import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import type { EmbeddedTerminalHandle } from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

const defaultTheme: Theme = {
	id: 'catppuccin-mocha',
	name: 'Catppuccin Mocha',
	mode: 'dark',
	colors: {
		bgMain: '#1e1e2e',
		bgSidebar: '#181825',
		bgActivity: '#313244',
		border: '#585b70',
		textMain: '#cdd6f4',
		textDim: '#6c7086',
		accent: '#cba6f7',
		accentDim: 'rgba(203, 166, 247, 0.2)',
		accentText: '#cba6f7',
		accentForeground: '#1e1e2e',
		success: '#a6e3a1',
		warning: '#f9e2af',
		error: '#f38ba8',
	},
};

/**
 * Wait for the async WebGL addon import to resolve and the addon instance to be created.
 * Uses waitFor which polls with real timers — works regardless of fake timer state.
 */
const waitForWebGL = (count = 1) => waitFor(() => {
	expect(webglInstances).toHaveLength(count);
});

describe('WebGL Context Loss Handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		webglInstances.length = 0;
		webglShouldFail.value = false;
	});

	describe('XTerminal', () => {
		it('loads WebGL addon and registers onContextLoss callback', async () => {
			render(
				<XTerminal
					sessionId="webgl-test-1"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			expect(MockWebglAddon).toHaveBeenCalledTimes(1);
			expect(webglInstances[0].onContextLoss).toHaveBeenCalledTimes(1);
			expect(typeof webglInstances[0].contextLossCallback).toBe('function');
		});

		it('loads WebGL addon via term.loadAddon after async import', async () => {
			render(
				<XTerminal
					sessionId="webgl-test-load"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			// 4 synchronous addons + 1 WebGL = 5 total loadAddon calls
			expect(terminalMethods.loadAddon).toHaveBeenCalledTimes(5);
		});

		it('disposes WebGL addon when context loss fires', async () => {
			render(
				<XTerminal
					sessionId="webgl-test-ctx-loss"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			const webglInstance = webglInstances[0];
			expect(webglInstance.dispose).not.toHaveBeenCalled();

			// Simulate WebGL context loss
			act(() => {
				webglInstance.contextLossCallback!();
			});

			expect(webglInstance.dispose).toHaveBeenCalledTimes(1);
		});

		it('terminal remains functional after WebGL context loss (canvas fallback)', async () => {
			const ref = createRef<XTerminalHandle>();

			render(
				<XTerminal
					ref={ref}
					sessionId="webgl-test-fallback"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Terminal instance should NOT be disposed — only the WebGL addon
			expect(terminalMethods.dispose).not.toHaveBeenCalled();

			// Imperative handle should still work
			expect(ref.current).toBeTruthy();
			ref.current!.write('still working');
			expect(terminalMethods.write).toHaveBeenCalledWith('still working');
		});

		it('PTY data continues flowing after WebGL context loss', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;
			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			render(
				<XTerminal
					sessionId="webgl-test-pty-flow"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			// Now enable fake timers for RAF testing
			vi.useFakeTimers();

			// Send data before context loss
			await act(async () => {
				rawPtyCallback!('webgl-test-pty-flow', 'before-loss\n');
			});
			act(() => { vi.advanceTimersByTime(16); });

			const beforeCall = terminalMethods.write.mock.calls.find(
				(call: unknown[]) => call[0] === 'before-loss\n'
			);
			expect(beforeCall).toBeTruthy();

			terminalMethods.write.mockClear();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Send data after context loss — should still arrive
			await act(async () => {
				rawPtyCallback!('webgl-test-pty-flow', 'after-loss\n');
			});
			act(() => { vi.advanceTimersByTime(16); });

			const afterCall = terminalMethods.write.mock.calls.find(
				(call: unknown[]) => call[0] === 'after-loss\n'
			);
			expect(afterCall).toBeTruthy();

			vi.useRealTimers();
		});

		it('handles WebGL constructor failure silently (canvas fallback)', async () => {
			webglShouldFail.value = true;

			render(
				<XTerminal
					sessionId="webgl-test-no-webgl"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			// Wait a tick for the async IIFE to attempt and fail
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});

			// Terminal should still be created and functional (4 sync addons loaded)
			expect(MockTerminal).toHaveBeenCalledTimes(1);
			expect(terminalMethods.open).toHaveBeenCalled();
			// WebGL addon was constructed but threw — no instances tracked
			expect(webglInstances).toHaveLength(0);
			// Only 4 sync addons loaded (WebGL failed before loadAddon)
			expect(terminalMethods.loadAddon).toHaveBeenCalledTimes(4);
		});

		it('does not dispose terminal instance on context loss — only the addon', async () => {
			render(
				<XTerminal
					sessionId="webgl-test-no-term-dispose"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Terminal.dispose should NOT be called
			expect(terminalMethods.dispose).not.toHaveBeenCalled();
			// Only the WebGL addon's dispose should be called
			expect(webglInstances[0].dispose).toHaveBeenCalledTimes(1);
		});

		it('theme updates still work after WebGL context loss', async () => {
			const { rerender } = render(
				<XTerminal
					sessionId="webgl-test-theme"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Change theme — should still update options.theme without crashing
			const lightTheme: Theme = {
				...defaultTheme,
				id: 'light',
				name: 'Light',
				mode: 'light',
				colors: { ...defaultTheme.colors, bgMain: '#ffffff', textMain: '#000000' },
			};

			rerender(
				<XTerminal
					sessionId="webgl-test-theme"
					theme={lightTheme}
					fontFamily="Menlo"
				/>
			);

			// Terminal was created exactly once (not recreated after context loss)
			expect(MockTerminal).toHaveBeenCalledTimes(1);
		});
	});

	describe('EmbeddedTerminal', () => {
		it('loads WebGL addon and registers onContextLoss callback', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-1"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			expect(MockWebglAddon).toHaveBeenCalledTimes(1);
			expect(webglInstances[0].onContextLoss).toHaveBeenCalledTimes(1);
			expect(typeof webglInstances[0].contextLossCallback).toBe('function');
		});

		it('loads WebGL addon via term.loadAddon after async import', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-load"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// 4 synchronous addons + 1 WebGL = 5 total
			expect(terminalMethods.loadAddon).toHaveBeenCalledTimes(5);
		});

		it('disposes WebGL addon when context loss fires', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-ctx-loss"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			const webglInstance = webglInstances[0];
			expect(webglInstance.dispose).not.toHaveBeenCalled();

			act(() => {
				webglInstance.contextLossCallback!();
			});

			expect(webglInstance.dispose).toHaveBeenCalledTimes(1);
		});

		it('terminal remains functional after WebGL context loss', async () => {
			const ref = createRef<EmbeddedTerminalHandle>();

			await act(async () => {
				render(
					<EmbeddedTerminal
						ref={ref}
						terminalTabId="embed-webgl-fallback"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Terminal should NOT be disposed
			expect(terminalMethods.dispose).not.toHaveBeenCalled();

			// Imperative handle still works
			expect(ref.current).toBeTruthy();
			ref.current!.write('still here');
			expect(terminalMethods.write).toHaveBeenCalledWith('still here');
		});

		it('PTY data continues flowing after WebGL context loss', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;
			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-pty"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Enable fake timers for RAF testing
			vi.useFakeTimers();

			// Data before context loss
			await act(async () => {
				rawPtyCallback!('embed-webgl-pty', 'pre-loss\n');
			});
			act(() => { vi.advanceTimersByTime(16); });

			expect(terminalMethods.write.mock.calls.find(
				(call: unknown[]) => call[0] === 'pre-loss\n'
			)).toBeTruthy();

			terminalMethods.write.mockClear();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Data after context loss
			await act(async () => {
				rawPtyCallback!('embed-webgl-pty', 'post-loss\n');
			});
			act(() => { vi.advanceTimersByTime(16); });

			expect(terminalMethods.write.mock.calls.find(
				(call: unknown[]) => call[0] === 'post-loss\n'
			)).toBeTruthy();

			vi.useRealTimers();
		});

		it('user input (onData) still routes to PTY after context loss', async () => {
			let dataCallback: (data: string) => void;
			terminalMethods.onData.mockImplementation((handler: (data: string) => void) => {
				dataCallback = handler;
				return { dispose: vi.fn() };
			});

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-input"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Simulate user typing after context loss
			act(() => {
				dataCallback!('ls -la\r');
			});

			expect(mockWrite).toHaveBeenCalledWith('embed-webgl-input', 'ls -la\r');
		});

		it('handles WebGL constructor failure silently', async () => {
			webglShouldFail.value = true;

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-no-webgl"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			// Wait for async setupTerminal to complete
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});

			// Terminal should still be created and PTY spawned
			expect(MockTerminal).toHaveBeenCalledTimes(1);
			expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({
				sessionId: 'embed-webgl-no-webgl',
				toolType: 'embedded-terminal',
			}));
			// No WebGL instances tracked (constructor threw)
			expect(webglInstances).toHaveLength(0);
		});

		it('does not dispose terminal instance on context loss — only the addon', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-no-term-dispose"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			expect(terminalMethods.dispose).not.toHaveBeenCalled();
			expect(webglInstances[0].dispose).toHaveBeenCalledTimes(1);
		});

		it('search still works after WebGL context loss', async () => {
			const ref = createRef<EmbeddedTerminalHandle>();

			await act(async () => {
				render(
					<EmbeddedTerminal
						ref={ref}
						terminalTabId="embed-webgl-search"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Search should still delegate to SearchAddon
			ref.current!.search('findme');
			expect(searchMethods.findNext).toHaveBeenCalledWith('findme');

			ref.current!.searchPrevious();
			expect(searchMethods.findPrevious).toHaveBeenCalled();

			ref.current!.clearSearch();
			expect(searchMethods.clearDecorations).toHaveBeenCalled();
		});

		it('theme updates still work after WebGL context loss', async () => {
			let rerenderFn: ReturnType<typeof render>['rerender'];

			await act(async () => {
				const result = render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-theme"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
				rerenderFn = result.rerender;
			});

			await waitForWebGL();

			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			const lightTheme: Theme = {
				...defaultTheme,
				id: 'light',
				name: 'Light',
				mode: 'light',
				colors: { ...defaultTheme.colors, bgMain: '#ffffff', textMain: '#000000' },
			};

			rerenderFn!(
				<EmbeddedTerminal
					terminalTabId="embed-webgl-theme"
					cwd="/tmp"
					theme={lightTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);

			// Should not crash — canvas renderer handles theme updates fine
			expect(MockTerminal).toHaveBeenCalledTimes(1);
		});

		it('process exit handling still works after WebGL context loss', async () => {
			let exitCallback: (sessionId: string, code: number) => void;
			mockOnExit.mockImplementation((handler: (sessionId: string, code: number) => void) => {
				exitCallback = handler;
				return vi.fn();
			});

			const onProcessExit = vi.fn();

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-exit"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
						onProcessExit={onProcessExit}
					/>
				);
			});

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Then process exits
			act(() => {
				exitCallback!('embed-webgl-exit', 0);
			});

			expect(onProcessExit).toHaveBeenCalledWith('embed-webgl-exit', 0);
			// Exit message should still be written to terminal
			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('Shell exited')
			);
		});
	});

	describe('Edge cases', () => {
		it('each terminal instance gets its own WebGL addon with independent context loss', async () => {
			// Render first terminal and wait for WebGL to load
			const { unmount } = render(
				<XTerminal sessionId="multi-1" theme={defaultTheme} fontFamily="Menlo" />
			);

			await waitForWebGL(1);
			const firstWebgl = webglInstances[0];

			// Trigger context loss on first terminal's WebGL addon
			act(() => {
				firstWebgl.contextLossCallback!();
			});
			expect(firstWebgl.dispose).toHaveBeenCalledTimes(1);

			// Unmount first, render second
			unmount();

			render(
				<XTerminal sessionId="multi-2" theme={defaultTheme} fontFamily="Menlo" />
			);

			await waitForWebGL(2);
			const secondWebgl = webglInstances[1];

			// Second addon is a distinct instance with its own callback
			expect(secondWebgl).not.toBe(firstWebgl);
			expect(secondWebgl.dispose).not.toHaveBeenCalled();
			expect(secondWebgl.contextLossCallback).not.toBe(firstWebgl.contextLossCallback);
		});

		it('context loss after component unmount does not throw', async () => {
			const { unmount } = render(
				<XTerminal
					sessionId="webgl-unmount"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			const webglInstance = webglInstances[0];

			unmount();

			// Should not throw — the callback just calls dispose on the addon
			expect(() => {
				webglInstance.contextLossCallback!();
			}).not.toThrow();
		});

		it('dispose is called on each context loss event', async () => {
			render(
				<XTerminal
					sessionId="webgl-double-dispose"
					theme={defaultTheme}
					fontFamily="Menlo"
				/>
			);

			await waitForWebGL();

			const webglInstance = webglInstances[0];

			// First context loss
			act(() => {
				webglInstance.contextLossCallback!();
			});
			expect(webglInstance.dispose).toHaveBeenCalledTimes(1);

			// Second context loss (in practice xterm.js only fires once,
			// but verifying the callback is safe to call multiple times)
			act(() => {
				webglInstance.contextLossCallback!();
			});
			expect(webglInstance.dispose).toHaveBeenCalledTimes(2);
		});

		it('ANSI-heavy data with WebGL context loss mid-stream', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;
			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="embed-webgl-ansi"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Enable fake timers for RAF testing
			vi.useFakeTimers();

			// Start sending ANSI data
			const ansiChunk1 = '\x1b[32m✓ Test passed\x1b[0m\n';
			await act(async () => {
				rawPtyCallback!('embed-webgl-ansi', ansiChunk1);
			});

			// Context loss mid-stream (before RAF flush)
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// More ANSI data after context loss
			const ansiChunk2 = '\x1b[31m✗ Test failed\x1b[0m\n';
			await act(async () => {
				rawPtyCallback!('embed-webgl-ansi', ansiChunk2);
			});

			// Flush RAF
			act(() => { vi.advanceTimersByTime(16); });

			// Both chunks should be batched and written together
			const writtenData = terminalMethods.write.mock.calls.find(
				(call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('Test passed')
			);
			expect(writtenData).toBeTruthy();
			expect(writtenData![0]).toContain(ansiChunk1);
			expect(writtenData![0]).toContain(ansiChunk2);

			vi.useRealTimers();
		});

		it('resize still works after WebGL context loss in EmbeddedTerminal', async () => {
			const ref = createRef<EmbeddedTerminalHandle>();

			await act(async () => {
				render(
					<EmbeddedTerminal
						ref={ref}
						terminalTabId="embed-webgl-resize"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitForWebGL();

			// Trigger context loss
			act(() => {
				webglInstances[0].contextLossCallback!();
			});

			// Resize should still work (delegates to FitAddon, not WebGL)
			expect(() => {
				ref.current!.resize();
			}).not.toThrow();
		});
	});
});
