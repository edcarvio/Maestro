/**
 * @file terminalFocusIndicator.test.tsx
 * @description Tests for terminal focus indicator in EmbeddedTerminal and XTerminal:
 * - Subtle inset box-shadow appears when terminal is focused
 * - Box-shadow removed when terminal loses focus
 * - Uses theme.colors.accent for the indicator color
 * - Includes border-radius and transition for polish
 * - No focus indicator when EmbeddedTerminal has a spawn error
 * - Focus/blur cycles work correctly
 * - Both components use the same visual pattern
 */

import React, { createRef } from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const draculaTheme: Theme = {
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

const lightTheme: Theme = {
	id: 'github-light',
	name: 'GitHub Light',
	mode: 'light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f6f8fa',
		bgActivity: '#e1e4e8',
		border: '#d0d7de',
		textMain: '#24292f',
		textDim: '#57606a',
		accent: '#0969da',
		accentDim: 'rgba(9, 105, 218, 0.2)',
		accentText: '#0969da',
		accentForeground: '#ffffff',
		success: '#1a7f37',
		warning: '#9a6700',
		error: '#cf222e',
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
				theme={draculaTheme}
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
				theme={draculaTheme}
				fontFamily="Menlo"
				{...props}
			/>
		);
	});
	return { result: result!, ref };
}

/** Helper: get the container element from render result */
function getContainer(result: ReturnType<typeof render>): HTMLElement {
	return result.container.firstChild as HTMLElement;
}

describe('EmbeddedTerminal — focus indicator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	// ================================================================
	// Initial state
	// ================================================================

	describe('initial state', () => {
		it('has no focus indicator by default', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'init-1' });
			const container = getContainer(result);

			expect(container.style.boxShadow).toBe('none');
		});

		it('has border-radius applied', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'init-radius' });
			const container = getContainer(result);

			expect(container.style.borderRadius).toBe('4px');
		});

		it('has transition property set', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'init-transition' });
			const container = getContainer(result);

			expect(container.style.transition).toContain('box-shadow');
			expect(container.style.transition).toContain('0.15s');
		});
	});

	// ================================================================
	// Focus / blur behavior
	// ================================================================

	describe('focus and blur behavior', () => {
		it('shows accent-colored inset box-shadow on focus', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'focus-show' });
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toBe(`inset 0 0 0 1px ${draculaTheme.colors.accent}`);
		});

		it('removes box-shadow on blur', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'focus-remove' });
			const container = getContainer(result);

			fireEvent.focus(container);
			expect(container.style.boxShadow).toContain(draculaTheme.colors.accent);

			fireEvent.blur(container);
			expect(container.style.boxShadow).toBe('none');
		});

		it('handles multiple focus/blur cycles', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'focus-cycle' });
			const container = getContainer(result);

			for (let i = 0; i < 5; i++) {
				fireEvent.focus(container);
				expect(container.style.boxShadow).toContain('inset');

				fireEvent.blur(container);
				expect(container.style.boxShadow).toBe('none');
			}
		});

		it('uses 1px inset ring (not 2px or outline)', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'focus-1px' });
			const container = getContainer(result);

			fireEvent.focus(container);

			// Verify the ring is 1px inset
			expect(container.style.boxShadow).toMatch(/inset 0 0 0 1px/);
		});
	});

	// ================================================================
	// Theme integration
	// ================================================================

	describe('theme integration', () => {
		it('uses accent color from dark theme', async () => {
			const result = await renderEmbeddedTerminal({
				terminalTabId: 'theme-dark',
				theme: draculaTheme,
			});
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toContain('#bd93f9');
		});

		it('uses accent color from light theme', async () => {
			const result = await renderEmbeddedTerminal({
				terminalTabId: 'theme-light',
				theme: lightTheme,
			});
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toContain('#0969da');
		});

		it('updates focus indicator color on theme change', async () => {
			const { rerender } = await renderEmbeddedTerminal({
				terminalTabId: 'theme-switch',
				theme: draculaTheme,
			});
			const container = document.querySelector('[style]') as HTMLElement;

			fireEvent.focus(container);
			expect(container.style.boxShadow).toContain('#bd93f9');

			await act(async () => {
				rerender(
					<EmbeddedTerminal
						terminalTabId="theme-switch"
						cwd="/tmp"
						theme={lightTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			// Focus is maintained, color should update
			expect(container.style.boxShadow).toContain('#0969da');
		});
	});

	// ================================================================
	// Spawn error interaction
	// ================================================================

	describe('spawn error interaction', () => {
		it('does not show focus indicator when there is a spawn error', async () => {
			mockSpawn.mockImplementationOnce(() =>
				Promise.resolve({ success: false, error: 'spawn failed' })
			);
			let result: ReturnType<typeof render>;
			await act(async () => {
				result = render(
					<EmbeddedTerminal
						terminalTabId="focus-spawn-error"
						cwd="/tmp"
						theme={draculaTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			const container = getContainer(result!);

			// Even if we somehow trigger focus, the spawnError state suppresses the indicator
			fireEvent.focus(container);
			expect(container.style.boxShadow).toBe('none');
		});
	});

	// ================================================================
	// Container structure
	// ================================================================

	describe('container structure', () => {
		it('applies focus handlers to the outer container div', async () => {
			const result = await renderEmbeddedTerminal({ terminalTabId: 'container-1' });
			const container = getContainer(result);

			// The outer container should have position: relative (for overlay)
			expect(container.style.position).toBe('relative');

			// And the focus-related styles
			expect(container.style.borderRadius).toBe('4px');
			expect(container.style.transition).toContain('box-shadow');
		});
	});
});

// ================================================================
// XTerminal focus indicator tests
// ================================================================

describe('XTerminal — focus indicator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('initial state', () => {
		it('has no focus indicator by default', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			expect(container.style.boxShadow).toBe('none');
		});

		it('has border-radius applied', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			expect(container.style.borderRadius).toBe('4px');
		});

		it('has transition property set', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			expect(container.style.transition).toContain('box-shadow');
			expect(container.style.transition).toContain('0.15s');
		});
	});

	describe('focus and blur behavior', () => {
		it('shows accent-colored inset box-shadow on focus', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toBe(`inset 0 0 0 1px ${draculaTheme.colors.accent}`);
		});

		it('removes box-shadow on blur', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			fireEvent.focus(container);
			expect(container.style.boxShadow).toContain(draculaTheme.colors.accent);

			fireEvent.blur(container);
			expect(container.style.boxShadow).toBe('none');
		});

		it('handles multiple focus/blur cycles', () => {
			const { result } = renderXTerminal();
			const container = getContainer(result);

			for (let i = 0; i < 5; i++) {
				fireEvent.focus(container);
				expect(container.style.boxShadow).toContain('inset');

				fireEvent.blur(container);
				expect(container.style.boxShadow).toBe('none');
			}
		});
	});

	describe('theme integration', () => {
		it('uses accent color from dark theme', () => {
			const { result } = renderXTerminal({ theme: draculaTheme });
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toContain('#bd93f9');
		});

		it('uses accent color from light theme', () => {
			const { result } = renderXTerminal({ theme: lightTheme });
			const container = getContainer(result);

			fireEvent.focus(container);

			expect(container.style.boxShadow).toContain('#0969da');
		});

		it('updates focus indicator color on theme change', () => {
			const ref = createRef<XTerminalHandle>();
			let renderResult: ReturnType<typeof render>;

			act(() => {
				renderResult = render(
					<XTerminal
						ref={ref}
						sessionId="theme-switch-x"
						theme={draculaTheme}
						fontFamily="Menlo"
					/>
				);
			});

			const container = getContainer(renderResult!);
			fireEvent.focus(container);
			expect(container.style.boxShadow).toContain('#bd93f9');

			act(() => {
				renderResult!.rerender(
					<XTerminal
						ref={ref}
						sessionId="theme-switch-x"
						theme={lightTheme}
						fontFamily="Menlo"
					/>
				);
			});

			expect(container.style.boxShadow).toContain('#0969da');
		});
	});

	// ================================================================
	// Consistency between components
	// ================================================================

	describe('consistency between EmbeddedTerminal and XTerminal', () => {
		it('both use the same border-radius', async () => {
			const embeddedResult = await renderEmbeddedTerminal({ terminalTabId: 'consistency-1' });
			const { result: xtermResult } = renderXTerminal();

			const embeddedContainer = getContainer(embeddedResult);
			const xtermContainer = getContainer(xtermResult);

			expect(embeddedContainer.style.borderRadius).toBe(xtermContainer.style.borderRadius);
		});

		it('both use the same transition timing', async () => {
			const embeddedResult = await renderEmbeddedTerminal({ terminalTabId: 'consistency-2' });
			const { result: xtermResult } = renderXTerminal();

			const embeddedContainer = getContainer(embeddedResult);
			const xtermContainer = getContainer(xtermResult);

			expect(embeddedContainer.style.transition).toBe(xtermContainer.style.transition);
		});

		it('both produce identical box-shadow values when focused', async () => {
			const embeddedResult = await renderEmbeddedTerminal({
				terminalTabId: 'consistency-3',
				theme: draculaTheme,
			});
			const { result: xtermResult } = renderXTerminal({ theme: draculaTheme });

			const embeddedContainer = getContainer(embeddedResult);
			const xtermContainer = getContainer(xtermResult);

			fireEvent.focus(embeddedContainer);
			fireEvent.focus(xtermContainer);

			expect(embeddedContainer.style.boxShadow).toBe(xtermContainer.style.boxShadow);
		});

		it('both produce identical styles when unfocused', async () => {
			const embeddedResult = await renderEmbeddedTerminal({ terminalTabId: 'consistency-4' });
			const { result: xtermResult } = renderXTerminal();

			const embeddedContainer = getContainer(embeddedResult);
			const xtermContainer = getContainer(xtermResult);

			expect(embeddedContainer.style.boxShadow).toBe(xtermContainer.style.boxShadow);
		});
	});
});
