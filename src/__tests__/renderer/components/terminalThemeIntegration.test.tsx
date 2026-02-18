/**
 * Terminal Theme Integration Tests
 *
 * Verifies the full theme integration pipeline for the XTerminal component:
 *
 * - Initial theme application: Terminal constructor receives correct theme
 * - Reactive theme switching: dark↔light↔vibe transitions update xterm options
 * - ANSI color mapping: per-theme palettes and fallback resolution
 * - ANSI data flow: PTY data with escape codes flows unmodified to xterm.write()
 * - Edge cases: rapid switches, same-theme re-apply, font independence
 *
 * This file complements:
 * - xtermTheme.test.ts (pure toXtermTheme mapping tests)
 * - terminalSearch.test.tsx (search feature integration)
 *
 * This file focuses on the React component integration layer — verifying that
 * theme prop changes propagate through the useEffect lifecycle into the
 * mocked xterm.js Terminal instance.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Theme, AnsiColors } from '../../../shared/theme-types';
import type { ITheme } from '@xterm/xterm';

// ── Mock: xterm.js packages ────────────────────────────────────────────────
// We capture Terminal constructor calls and the `options` object to verify
// that theme changes propagate correctly.

const {
	terminalMethods,
	terminalInstances,
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
	const _terminalInstances: Array<{
		options: Record<string, unknown>;
		constructorOpts: Record<string, unknown>;
		[key: string]: unknown;
	}> = [];

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

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.constructorOpts = { ...opts };
		this.options = { ...opts };
		this.unicode = { activeVersion: '' };
		this.cols = 80;
		this.rows = 24;
		_terminalInstances.push(this as typeof _terminalInstances[number]);
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

	return {
		terminalMethods: _terminalMethods,
		terminalInstances: _terminalInstances,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockSpawn: vi.fn(() => Promise.resolve({ success: true, pid: 1234 })),
		mockWrite: vi.fn(() => Promise.resolve(true)),
		mockKill: vi.fn(() => Promise.resolve(true)),
		mockResize: vi.fn(() => Promise.resolve(true)),
		mockOnRawPtyData: vi.fn(() => vi.fn()),
		mockOnExit: vi.fn(() => vi.fn()),
	};
});

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: MockWebLinksAddon }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: MockSearchAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: MockUnicode11Addon }));
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

// DO NOT mock toXtermTheme — we want the real mapping for integration testing

// ── Imports after mocks ────────────────────────────────────────────────────

import XTerminal from '../../../renderer/components/XTerminal/XTerminal';
import { toXtermTheme } from '../../../renderer/utils/xtermTheme';

// ── Theme fixtures ─────────────────────────────────────────────────────────

const draculaTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		border: '#44475a',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: 'rgba(189, 147, 249, 0.2)',
		accentText: '#ff79c6',
		accentForeground: '#282a36',
		success: '#50fa7b',
		warning: '#ffb86c',
		error: '#ff5555',
	},
	ansiColors: {
		black: '#21222c',
		red: '#ff5555',
		green: '#50fa7b',
		yellow: '#f1fa8c',
		blue: '#bd93f9',
		magenta: '#ff79c6',
		cyan: '#8be9fd',
		white: '#f8f8f2',
		brightBlack: '#6272a4',
		brightRed: '#ff6e6e',
		brightGreen: '#69ff94',
		brightYellow: '#ffffa5',
		brightBlue: '#d6acff',
		brightMagenta: '#ff92df',
		brightCyan: '#a4ffff',
		brightWhite: '#ffffff',
	},
};

const githubLightTheme: Theme = {
	id: 'github-light',
	name: 'GitHub',
	mode: 'light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f6f8fa',
		bgActivity: '#eff2f5',
		border: '#d0d7de',
		textMain: '#24292f',
		textDim: '#57606a',
		accent: '#0969da',
		accentDim: 'rgba(9, 105, 218, 0.1)',
		accentText: '#0969da',
		accentForeground: '#ffffff',
		success: '#1a7f37',
		warning: '#9a6700',
		error: '#cf222e',
	},
	ansiColors: {
		black: '#24292e',
		red: '#cf222e',
		green: '#1a7f37',
		yellow: '#9a6700',
		blue: '#0969da',
		magenta: '#8250df',
		cyan: '#1b7c83',
		white: '#6e7781',
		brightBlack: '#57606a',
		brightRed: '#a40e26',
		brightGreen: '#2da44e',
		brightYellow: '#bf8700',
		brightBlue: '#218bff',
		brightMagenta: '#a475f9',
		brightCyan: '#3192aa',
		brightWhite: '#8c959f',
	},
};

const nordTheme: Theme = {
	id: 'nord',
	name: 'Nord',
	mode: 'dark',
	colors: {
		bgMain: '#2e3440',
		bgSidebar: '#3b4252',
		bgActivity: '#434c5e',
		border: '#4c566a',
		textMain: '#eceff4',
		textDim: '#d8dee9',
		accent: '#88c0d0',
		accentDim: 'rgba(136, 192, 208, 0.2)',
		accentText: '#8fbcbb',
		accentForeground: '#2e3440',
		success: '#a3be8c',
		warning: '#ebcb8b',
		error: '#bf616a',
	},
	ansiColors: {
		black: '#3b4252',
		red: '#bf616a',
		green: '#a3be8c',
		yellow: '#ebcb8b',
		blue: '#81a1c1',
		magenta: '#b48ead',
		cyan: '#88c0d0',
		white: '#e5e9f0',
		brightBlack: '#4c566a',
		brightRed: '#bf616a',
		brightGreen: '#a3be8c',
		brightYellow: '#ebcb8b',
		brightBlue: '#81a1c1',
		brightMagenta: '#b48ead',
		brightCyan: '#8fbcbb',
		brightWhite: '#eceff4',
	},
};

const vibeTheme: Theme = {
	id: 'pedurple',
	name: 'Pedurple',
	mode: 'vibe',
	colors: {
		bgMain: '#1a0f24',
		bgSidebar: '#140a1c',
		bgActivity: '#2a1a3a',
		border: '#4a2a6a',
		textMain: '#e8d5f5',
		textDim: '#b89fd0',
		accent: '#ff69b4',
		accentDim: 'rgba(255, 105, 180, 0.25)',
		accentText: '#ff8dc7',
		accentForeground: '#1a0f24',
		success: '#7cb342',
		warning: '#d4af37',
		error: '#da70d6',
	},
	ansiColors: {
		black: '#1a0f24',
		red: '#da70d6',
		green: '#7cb342',
		yellow: '#d4af37',
		blue: '#6a5acd',
		magenta: '#ff69b4',
		cyan: '#48d1cc',
		white: '#e8d5f5',
		brightBlack: '#4a2a6a',
		brightRed: '#ee82ee',
		brightGreen: '#a0d468',
		brightYellow: '#ffd700',
		brightBlue: '#7b68ee',
		brightMagenta: '#ff82d2',
		brightCyan: '#66e0dc',
		brightWhite: '#f5e6ff',
	},
};

/** Theme without ansiColors — triggers fallback to dark palette */
const customThemeNoAnsi: Theme = {
	id: 'custom',
	name: 'Custom',
	mode: 'dark',
	colors: {
		bgMain: '#1e1e1e',
		bgSidebar: '#252525',
		bgActivity: '#2d2d2d',
		border: '#3d3d3d',
		textMain: '#d4d4d4',
		textDim: '#888888',
		accent: '#4db8ff',
		accentDim: 'rgba(77, 184, 255, 0.2)',
		accentText: '#4db8ff',
		accentForeground: '#1e1e1e',
		success: '#4ade80',
		warning: '#fbbf24',
		error: '#f87171',
	},
	// No ansiColors — should fall back to DARK_ANSI_FALLBACK
};

/** Light theme without ansiColors — triggers fallback to light palette */
const lightThemeNoAnsi: Theme = {
	id: 'custom',
	name: 'Custom Light',
	mode: 'light',
	colors: {
		bgMain: '#fafafa',
		bgSidebar: '#f0f0f0',
		bgActivity: '#e8e8e8',
		border: '#d0d0d0',
		textMain: '#333333',
		textDim: '#777777',
		accent: '#2196f3',
		accentDim: 'rgba(33, 150, 243, 0.15)',
		accentText: '#2196f3',
		accentForeground: '#ffffff',
		success: '#4caf50',
		warning: '#ff9800',
		error: '#f44336',
	},
	// No ansiColors — should fall back to LIGHT_ANSI_FALLBACK
};

// ── ANSI keys for iteration ────────────────────────────────────────────────

const ANSI_KEYS: (keyof AnsiColors)[] = [
	'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
	'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
	'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get the latest Terminal mock instance */
function getLatestTerminal() {
	return terminalInstances[terminalInstances.length - 1];
}

/** Render XTerminal with a given theme, return rerender helper */
function renderXTerminal(theme: Theme, sessionId = 'test-session-1') {
	return render(
		<XTerminal
			sessionId={sessionId}
			theme={theme}
			fontFamily="Menlo"
		/>
	);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Terminal Theme Integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalInstances.length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ────────────────────────────────────────────────────────────────────
	// 1. Initial Theme Application
	// ────────────────────────────────────────────────────────────────────

	describe('Initial theme application', () => {
		it('passes dark theme colors to Terminal constructor', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			expect(term).toBeDefined();

			const constructorTheme = term.constructorOpts.theme as ITheme;
			expect(constructorTheme.background).toBe('#282a36');
			expect(constructorTheme.foreground).toBe('#f8f8f2');
			expect(constructorTheme.cursor).toBe('#bd93f9');
		});

		it('passes light theme colors to Terminal constructor', () => {
			renderXTerminal(githubLightTheme);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			expect(constructorTheme.background).toBe('#ffffff');
			expect(constructorTheme.foreground).toBe('#24292f');
			expect(constructorTheme.cursor).toBe('#0969da');
		});

		it('passes all 16 ANSI colors from theme to Terminal constructor', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;

			for (const key of ANSI_KEYS) {
				expect(constructorTheme[key]).toBe(draculaTheme.ansiColors![key]);
			}
		});

		it('includes selection colors from theme accent', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			expect(constructorTheme.selectionBackground).toBe('rgba(189, 147, 249, 0.2)');
			expect(constructorTheme.selectionForeground).toBe('#f8f8f2');
		});

		it('cursorAccent is set to bgMain for contrast', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			expect(constructorTheme.cursorAccent).toBe('#282a36');
		});

		it('vibe theme applies correctly at initialization', () => {
			renderXTerminal(vibeTheme);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			expect(constructorTheme.background).toBe('#1a0f24');
			expect(constructorTheme.foreground).toBe('#e8d5f5');
			expect(constructorTheme.cursor).toBe('#ff69b4');
		});

		it('theme without ansiColors uses dark fallback palette at init', () => {
			renderXTerminal(customThemeNoAnsi);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			// Dark fallback palette colors
			expect(constructorTheme.magenta).toBe('#ff79c6');
			expect(constructorTheme.cyan).toBe('#8be9fd');
			expect(constructorTheme.background).toBe('#1e1e1e');
		});

		it('light theme without ansiColors uses light fallback palette at init', () => {
			renderXTerminal(lightThemeNoAnsi);

			const term = getLatestTerminal();
			const constructorTheme = term.constructorOpts.theme as ITheme;
			// Light fallback palette colors
			expect(constructorTheme.magenta).toBe('#d33682');
			expect(constructorTheme.cyan).toBe('#2aa198');
			expect(constructorTheme.background).toBe('#fafafa');
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 2. Reactive Theme Switching
	// ────────────────────────────────────────────────────────────────────

	describe('Theme switching while terminal is open', () => {
		it('dark → light: updates terminal options.theme', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			expect(term.options.theme.background).toBe('#282a36');

			// Switch to light theme
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = term.options.theme as ITheme;
			expect(updatedTheme.background).toBe('#ffffff');
			expect(updatedTheme.foreground).toBe('#24292f');
			expect(updatedTheme.cursor).toBe('#0969da');
		});

		it('light → dark: updates terminal options.theme', () => {
			const { rerender } = renderXTerminal(githubLightTheme);

			const term = getLatestTerminal();
			expect(term.options.theme.background).toBe('#ffffff');

			// Switch to dark theme
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={draculaTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = term.options.theme as ITheme;
			expect(updatedTheme.background).toBe('#282a36');
			expect(updatedTheme.foreground).toBe('#f8f8f2');
		});

		it('dark → dark (different theme): updates ANSI palette', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			expect(term.options.theme.blue).toBe('#bd93f9'); // Dracula blue

			// Switch to Nord (also dark, different palette)
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={nordTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = term.options.theme as ITheme;
			expect(updatedTheme.blue).toBe('#81a1c1'); // Nord blue
			expect(updatedTheme.background).toBe('#2e3440');
		});

		it('dark → vibe: updates to vibe theme colors', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={vibeTheme}
					fontFamily="Menlo"
				/>
			);

			const term = getLatestTerminal();
			const updatedTheme = term.options.theme as ITheme;
			expect(updatedTheme.background).toBe('#1a0f24');
			expect(updatedTheme.magenta).toBe('#ff69b4');
		});

		it('does NOT recreate Terminal instance on theme change', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			expect(terminalInstances).toHaveLength(1);
			const originalTerm = getLatestTerminal();

			// Switch theme
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);

			// Same terminal instance — no dispose/recreate
			expect(terminalInstances).toHaveLength(1);
			expect(getLatestTerminal()).toBe(originalTerm);
			expect(terminalMethods.dispose).not.toHaveBeenCalled();
		});

		it('multiple sequential theme switches apply the final theme', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();

			// Rapid switches: dracula → github-light → nord → vibe
			rerender(
				<XTerminal sessionId="test-session-1" theme={githubLightTheme} fontFamily="Menlo" />
			);
			rerender(
				<XTerminal sessionId="test-session-1" theme={nordTheme} fontFamily="Menlo" />
			);
			rerender(
				<XTerminal sessionId="test-session-1" theme={vibeTheme} fontFamily="Menlo" />
			);

			// Final state should be vibe theme
			const finalTheme = term.options.theme as ITheme;
			expect(finalTheme.background).toBe('#1a0f24');
			expect(finalTheme.foreground).toBe('#e8d5f5');
			expect(finalTheme.magenta).toBe('#ff69b4');
		});

		it('re-applying the same theme is idempotent', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const firstTheme = term.options.theme;

			// Re-render with same theme object
			rerender(
				<XTerminal sessionId="test-session-1" theme={draculaTheme} fontFamily="Menlo" />
			);

			// Theme is still correct (even though same)
			const afterTheme = term.options.theme as ITheme;
			expect(afterTheme.background).toBe(firstTheme.background);
			expect(afterTheme.foreground).toBe(firstTheme.foreground);
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 3. ANSI Color Mapping Per Theme
	// ────────────────────────────────────────────────────────────────────

	describe('ANSI color mapping per theme', () => {
		it('Dracula: all 16 ANSI colors from theme palette', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect(xtermTheme.black).toBe('#21222c');
			expect(xtermTheme.red).toBe('#ff5555');
			expect(xtermTheme.green).toBe('#50fa7b');
			expect(xtermTheme.yellow).toBe('#f1fa8c');
			expect(xtermTheme.blue).toBe('#bd93f9');
			expect(xtermTheme.magenta).toBe('#ff79c6');
			expect(xtermTheme.cyan).toBe('#8be9fd');
			expect(xtermTheme.white).toBe('#f8f8f2');
			expect(xtermTheme.brightBlack).toBe('#6272a4');
			expect(xtermTheme.brightRed).toBe('#ff6e6e');
			expect(xtermTheme.brightGreen).toBe('#69ff94');
			expect(xtermTheme.brightYellow).toBe('#ffffa5');
			expect(xtermTheme.brightBlue).toBe('#d6acff');
			expect(xtermTheme.brightMagenta).toBe('#ff92df');
			expect(xtermTheme.brightCyan).toBe('#a4ffff');
			expect(xtermTheme.brightWhite).toBe('#ffffff');
		});

		it('GitHub Light: all 16 ANSI colors from theme palette', () => {
			renderXTerminal(githubLightTheme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect(xtermTheme.black).toBe('#24292e');
			expect(xtermTheme.red).toBe('#cf222e');
			expect(xtermTheme.green).toBe('#1a7f37');
			expect(xtermTheme.blue).toBe('#0969da');
			expect(xtermTheme.magenta).toBe('#8250df');
			expect(xtermTheme.cyan).toBe('#1b7c83');
		});

		it('Nord: per-theme ANSI palette (not Dracula fallback)', () => {
			renderXTerminal(nordTheme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			// These differ from Dracula fallback
			expect(xtermTheme.blue).toBe('#81a1c1');
			expect(xtermTheme.magenta).toBe('#b48ead');
			expect(xtermTheme.cyan).toBe('#88c0d0');
			expect(xtermTheme.red).toBe('#bf616a');
		});

		it('theme without ansiColors: dark mode fallback', () => {
			renderXTerminal(customThemeNoAnsi);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			// DARK_ANSI_FALLBACK values
			expect(xtermTheme.black).toBe('#1a1a2e');
			expect(xtermTheme.red).toBe('#ff5555');
			expect(xtermTheme.green).toBe('#50fa7b');
			expect(xtermTheme.magenta).toBe('#ff79c6');
			expect(xtermTheme.cyan).toBe('#8be9fd');
		});

		it('theme without ansiColors: light mode fallback', () => {
			renderXTerminal(lightThemeNoAnsi);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			// LIGHT_ANSI_FALLBACK values
			expect(xtermTheme.black).toBe('#073642');
			expect(xtermTheme.red).toBe('#dc322f');
			expect(xtermTheme.green).toBe('#859900');
			expect(xtermTheme.magenta).toBe('#d33682');
			expect(xtermTheme.cyan).toBe('#2aa198');
		});

		it('ANSI palette switches correctly: dark (custom) → light (custom)', () => {
			const { rerender } = renderXTerminal(customThemeNoAnsi);

			const term = getLatestTerminal();
			// Starts with dark fallback
			expect((term.options.theme as ITheme).magenta).toBe('#ff79c6');

			// Switch to light theme without ansiColors
			rerender(
				<XTerminal sessionId="test-session-1" theme={lightThemeNoAnsi} fontFamily="Menlo" />
			);

			// Now light fallback
			expect((term.options.theme as ITheme).magenta).toBe('#d33682');
		});

		it('ANSI palette switches correctly: fallback → custom palette', () => {
			const { rerender } = renderXTerminal(customThemeNoAnsi);

			const term = getLatestTerminal();
			// Starts with dark fallback
			expect((term.options.theme as ITheme).blue).toBe('#6272a4');

			// Switch to Nord (has custom ansiColors)
			rerender(
				<XTerminal sessionId="test-session-1" theme={nordTheme} fontFamily="Menlo" />
			);

			// Now uses Nord's custom palette
			expect((term.options.theme as ITheme).blue).toBe('#81a1c1');
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 4. Core Color Property Mapping
	// ────────────────────────────────────────────────────────────────────

	describe('Core color property mapping', () => {
		it.each([
			['Dracula', draculaTheme],
			['GitHub Light', githubLightTheme],
			['Nord', nordTheme],
			['Pedurple', vibeTheme],
		] as const)('%s: background = bgMain, foreground = textMain', (_name, theme) => {
			renderXTerminal(theme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect(xtermTheme.background).toBe(theme.colors.bgMain);
			expect(xtermTheme.foreground).toBe(theme.colors.textMain);
		});

		it.each([
			['Dracula', draculaTheme],
			['GitHub Light', githubLightTheme],
			['Nord', nordTheme],
		] as const)('%s: cursor = accent, cursorAccent = bgMain', (_name, theme) => {
			renderXTerminal(theme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect(xtermTheme.cursor).toBe(theme.colors.accent);
			expect(xtermTheme.cursorAccent).toBe(theme.colors.bgMain);
		});

		it.each([
			['Dracula', draculaTheme],
			['GitHub Light', githubLightTheme],
		] as const)('%s: selection = accentDim/textMain', (_name, theme) => {
			renderXTerminal(theme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect(xtermTheme.selectionBackground).toBe(theme.colors.accentDim);
			expect(xtermTheme.selectionForeground).toBe(theme.colors.textMain);
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 5. ANSI Data Flow (ls --color, git diff scenarios)
	// ────────────────────────────────────────────────────────────────────

	describe('ANSI data flow through PTY', () => {
		let onRawPtyDataCallback: (sid: string, data: string) => void;
		let originalRAF: typeof globalThis.requestAnimationFrame;

		beforeEach(() => {
			// Capture the onRawPtyData callback so we can simulate PTY output
			mockOnRawPtyData.mockImplementation((cb: (sid: string, data: string) => void) => {
				onRawPtyDataCallback = cb;
				return vi.fn(); // unsubscribe function
			});

			// Mock requestAnimationFrame to execute synchronously
			originalRAF = globalThis.requestAnimationFrame;
			globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
				cb(0);
				return 0;
			};
		});

		afterEach(() => {
			globalThis.requestAnimationFrame = originalRAF;
		});

		it('ls --color ANSI sequences flow unmodified to xterm.write()', () => {
			renderXTerminal(draculaTheme);

			// Simulate `ls --color` output: directory in blue, file in green
			const lsColorOutput = [
				'\x1b[34mnode_modules\x1b[0m  ', // blue directory
				'\x1b[32mpackage.json\x1b[0m  ',  // green file
				'\x1b[1;31merror.log\x1b[0m  ',    // bold red file
			].join('');

			act(() => {
				onRawPtyDataCallback('test-session-1', lsColorOutput);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(lsColorOutput);
		});

		it('git diff ANSI sequences flow unmodified to xterm.write()', () => {
			renderXTerminal(draculaTheme);

			// Simulate git diff output
			const gitDiffOutput = [
				'\x1b[1mdiff --git a/file.ts b/file.ts\x1b[0m\n',
				'\x1b[31m-  const oldLine = true;\x1b[0m\n',  // red for removals
				'\x1b[32m+  const newLine = false;\x1b[0m\n', // green for additions
				'\x1b[36m@@ -10,3 +10,3 @@\x1b[0m\n',       // cyan for hunk headers
			].join('');

			act(() => {
				onRawPtyDataCallback('test-session-1', gitDiffOutput);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(gitDiffOutput);
		});

		it('256-color ANSI escape codes flow unmodified', () => {
			renderXTerminal(draculaTheme);

			// 256-color (e.g., \x1b[38;5;202m for orange text)
			const output256 = '\x1b[38;5;202mOrange text\x1b[0m and \x1b[48;5;17mblue bg\x1b[0m';

			act(() => {
				onRawPtyDataCallback('test-session-1', output256);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(output256);
		});

		it('RGB (truecolor) ANSI escape codes flow unmodified', () => {
			renderXTerminal(draculaTheme);

			// 24-bit truecolor (\x1b[38;2;R;G;Bm)
			const truecolorOutput = '\x1b[38;2;255;105;180mHot Pink\x1b[0m normal';

			act(() => {
				onRawPtyDataCallback('test-session-1', truecolorOutput);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(truecolorOutput);
		});

		it('mixed ANSI sequences (bold, underline, color) flow unmodified', () => {
			renderXTerminal(draculaTheme);

			// Bold+underline+color combinations
			const mixedOutput = [
				'\x1b[1m\x1b[4m\x1b[33mBold underlined yellow\x1b[0m ',
				'\x1b[7mReverse video\x1b[0m ',
				'\x1b[2mDim text\x1b[0m ',
				'\x1b[5mBlink\x1b[0m',
			].join('');

			act(() => {
				onRawPtyDataCallback('test-session-1', mixedOutput);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(mixedOutput);
		});

		it('ANSI data still flows correctly after theme switch', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			// Switch theme mid-stream
			rerender(
				<XTerminal sessionId="test-session-1" theme={githubLightTheme} fontFamily="Menlo" />
			);

			const ansiData = '\x1b[32mGreen text after theme switch\x1b[0m';

			act(() => {
				onRawPtyDataCallback('test-session-1', ansiData);
			});

			expect(terminalMethods.write).toHaveBeenCalledWith(ansiData);
		});

		it('only routes PTY data for matching sessionId', () => {
			renderXTerminal(draculaTheme, 'session-A');

			act(() => {
				onRawPtyDataCallback('session-B', '\x1b[31mWrong session\x1b[0m');
			});

			// Data for wrong session should NOT be written
			expect(terminalMethods.write).not.toHaveBeenCalled();
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 6. Theme Independence from Other Props
	// ────────────────────────────────────────────────────────────────────

	describe('Theme independence from other props', () => {
		it('font family change does not affect theme', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const originalTheme = { ...term.options.theme };

			// Change only font family
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={draculaTheme}
					fontFamily="Fira Code"
				/>
			);

			expect(term.options.fontFamily).toBe('Fira Code');
			expect(term.options.theme.background).toBe(originalTheme.background);
			expect(term.options.theme.foreground).toBe(originalTheme.foreground);
		});

		it('font size change does not affect theme', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="test-session-1"
					theme={draculaTheme}
					fontFamily="Menlo"
					fontSize={14}
				/>
			);

			const term = getLatestTerminal();

			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={draculaTheme}
					fontFamily="Menlo"
					fontSize={18}
				/>
			);

			expect(term.options.fontSize).toBe(18);
			expect(term.options.theme.background).toBe('#282a36');
		});

		it('theme and font can change simultaneously', () => {
			const { rerender } = render(
				<XTerminal
					sessionId="test-session-1"
					theme={draculaTheme}
					fontFamily="Menlo"
					fontSize={14}
				/>
			);

			const term = getLatestTerminal();

			// Change both theme and font in one rerender
			rerender(
				<XTerminal
					sessionId="test-session-1"
					theme={githubLightTheme}
					fontFamily="JetBrains Mono"
					fontSize={16}
				/>
			);

			expect(term.options.theme.background).toBe('#ffffff');
			expect(term.options.fontFamily).toBe('JetBrains Mono');
			expect(term.options.fontSize).toBe(16);
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 7. toXtermTheme Integration Verification
	// ────────────────────────────────────────────────────────────────────

	describe('toXtermTheme integration verification', () => {
		it('component produces same result as calling toXtermTheme directly', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const componentTheme = term.options.theme as ITheme;
			const directTheme = toXtermTheme(draculaTheme);

			expect(componentTheme.background).toBe(directTheme.background);
			expect(componentTheme.foreground).toBe(directTheme.foreground);
			expect(componentTheme.cursor).toBe(directTheme.cursor);
			expect(componentTheme.cursorAccent).toBe(directTheme.cursorAccent);
			expect(componentTheme.selectionBackground).toBe(directTheme.selectionBackground);

			for (const key of ANSI_KEYS) {
				expect(componentTheme[key]).toBe(directTheme[key]);
			}
		});

		it('after theme switch, still matches toXtermTheme output', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			rerender(
				<XTerminal sessionId="test-session-1" theme={nordTheme} fontFamily="Menlo" />
			);

			const term = getLatestTerminal();
			const componentTheme = term.options.theme as ITheme;
			const directTheme = toXtermTheme(nordTheme);

			expect(componentTheme.background).toBe(directTheme.background);
			expect(componentTheme.foreground).toBe(directTheme.foreground);
			for (const key of ANSI_KEYS) {
				expect(componentTheme[key]).toBe(directTheme[key]);
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 8. Full Theme Lifecycle Workflow
	// ────────────────────────────────────────────────────────────────────

	describe('Full theme lifecycle workflow', () => {
		it('init → switch dark→light → switch light→vibe → switch vibe→dark', () => {
			const { rerender } = renderXTerminal(draculaTheme);

			const term = getLatestTerminal();

			// Phase 1: initial dark theme
			expect(term.options.theme.background).toBe('#282a36');
			expect(term.options.theme.cyan).toBe('#8be9fd');

			// Phase 2: dark → light
			rerender(
				<XTerminal sessionId="test-session-1" theme={githubLightTheme} fontFamily="Menlo" />
			);
			expect(term.options.theme.background).toBe('#ffffff');
			expect(term.options.theme.cyan).toBe('#1b7c83');

			// Phase 3: light → vibe
			rerender(
				<XTerminal sessionId="test-session-1" theme={vibeTheme} fontFamily="Menlo" />
			);
			expect(term.options.theme.background).toBe('#1a0f24');
			expect(term.options.theme.cyan).toBe('#48d1cc');

			// Phase 4: vibe → dark (Nord)
			rerender(
				<XTerminal sessionId="test-session-1" theme={nordTheme} fontFamily="Menlo" />
			);
			expect(term.options.theme.background).toBe('#2e3440');
			expect(term.options.theme.cyan).toBe('#88c0d0');

			// Terminal instance was never recreated
			expect(terminalInstances).toHaveLength(1);
			expect(terminalMethods.dispose).not.toHaveBeenCalled();
		});

		it('theme switch with ANSI data flowing: no data loss or corruption', () => {
			let onRawPtyDataCallback: (sid: string, data: string) => void;
			mockOnRawPtyData.mockImplementation((cb: (sid: string, data: string) => void) => {
				onRawPtyDataCallback = cb;
				return vi.fn();
			});

			// Use deferred RAF to avoid the synchronous assignment ordering problem:
			// writeRafRef.current = requestAnimationFrame(cb) — if cb runs synchronously,
			// it sets writeRafRef=null before the return value overwrites it back to 0.
			let pendingRafCallback: FrameRequestCallback | null = null;
			let rafId = 0;
			const originalRAF = globalThis.requestAnimationFrame;
			globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
				pendingRafCallback = cb;
				return ++rafId;
			};

			function flushRAF() {
				if (pendingRafCallback) {
					const cb = pendingRafCallback;
					pendingRafCallback = null;
					cb(0);
				}
			}

			try {
				const { rerender } = renderXTerminal(draculaTheme);

				// Send data with dark theme
				const darkThemeData = '\x1b[31mRed on dark\x1b[0m';
				act(() => {
					onRawPtyDataCallback!('test-session-1', darkThemeData);
				});
				act(() => { flushRAF(); });
				expect(terminalMethods.write).toHaveBeenCalledWith(darkThemeData);

				// Switch to light theme
				rerender(
					<XTerminal sessionId="test-session-1" theme={githubLightTheme} fontFamily="Menlo" />
				);

				// Send data with light theme
				const lightThemeData = '\x1b[32mGreen on light\x1b[0m';
				act(() => {
					onRawPtyDataCallback!('test-session-1', lightThemeData);
				});
				act(() => { flushRAF(); });
				expect(terminalMethods.write).toHaveBeenCalledWith(lightThemeData);

				// Both data chunks were written unmodified
				expect(terminalMethods.write).toHaveBeenCalledTimes(2);
			} finally {
				globalThis.requestAnimationFrame = originalRAF;
			}
		});
	});

	// ────────────────────────────────────────────────────────────────────
	// 9. Edge Cases
	// ────────────────────────────────────────────────────────────────────

	describe('Edge cases', () => {
		it('all 22 ITheme properties are set (6 core + 16 ANSI)', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			// 6 core properties
			expect(xtermTheme.background).toBeDefined();
			expect(xtermTheme.foreground).toBeDefined();
			expect(xtermTheme.cursor).toBeDefined();
			expect(xtermTheme.cursorAccent).toBeDefined();
			expect(xtermTheme.selectionBackground).toBeDefined();
			expect(xtermTheme.selectionForeground).toBeDefined();

			// 16 ANSI colors
			for (const key of ANSI_KEYS) {
				expect(xtermTheme[key]).toBeDefined();
				expect(typeof xtermTheme[key]).toBe('string');
			}
		});

		it('theme colors are non-empty strings', () => {
			renderXTerminal(draculaTheme);

			const term = getLatestTerminal();
			const xtermTheme = term.options.theme as ITheme;

			expect((xtermTheme.background as string).length).toBeGreaterThan(0);
			expect((xtermTheme.foreground as string).length).toBeGreaterThan(0);
			expect((xtermTheme.cursor as string).length).toBeGreaterThan(0);

			for (const key of ANSI_KEYS) {
				expect((xtermTheme[key] as string).length).toBeGreaterThan(0);
			}
		});

		it('multiple XTerminal instances with different themes', () => {
			render(
				<>
					<XTerminal sessionId="session-dark" theme={draculaTheme} fontFamily="Menlo" />
					<XTerminal sessionId="session-light" theme={githubLightTheme} fontFamily="Menlo" />
				</>
			);

			expect(terminalInstances).toHaveLength(2);

			const darkTerm = terminalInstances[0];
			const lightTerm = terminalInstances[1];

			expect(darkTerm.constructorOpts.theme.background).toBe('#282a36');
			expect(lightTerm.constructorOpts.theme.background).toBe('#ffffff');
		});
	});
});
