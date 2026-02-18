/**
 * @file xtermTheme.test.ts
 * @description Tests for the Maestro → xterm.js theme mapping utility.
 *
 * Validates:
 * - Background/foreground/cursor mapping from Theme.colors
 * - Per-theme ANSI palettes are used when present
 * - Fallback to generic dark/light palettes when ansiColors is absent
 * - All 17 built-in themes produce valid xterm.js themes
 * - Vibe themes (non-light, non-dark) resolve correctly
 */

import { describe, it, expect } from 'vitest';
import { toXtermTheme } from '../../../renderer/utils/xtermTheme';
import { THEMES } from '../../../shared/themes';
import type { Theme, AnsiColors } from '../../../shared/theme-types';

const ANSI_KEYS: (keyof AnsiColors)[] = [
	'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
	'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
	'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const makeDarkTheme = (overrides?: Partial<Theme['colors']>, ansiColors?: AnsiColors): Theme => ({
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
		...overrides,
	},
	ansiColors,
});

const makeLightTheme = (overrides?: Partial<Theme['colors']>, ansiColors?: AnsiColors): Theme => ({
	id: 'github-light',
	name: 'GitHub Light',
	mode: 'light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f6f8fa',
		bgActivity: '#f0f0f0',
		border: '#d0d7de',
		textMain: '#24292f',
		textDim: '#656d76',
		accent: '#0969da',
		accentDim: 'rgba(9, 105, 218, 0.15)',
		accentText: '#0969da',
		accentForeground: '#ffffff',
		success: '#1a7f37',
		warning: '#9a6700',
		error: '#cf222e',
		...overrides,
	},
	ansiColors,
});

describe('toXtermTheme', () => {
	describe('background, foreground, and cursor mapping', () => {
		it('maps dark theme background and foreground colors', () => {
			const result = toXtermTheme(makeDarkTheme());
			expect(result.background).toBe('#282a36');
			expect(result.foreground).toBe('#f8f8f2');
		});

		it('maps light theme background and foreground colors', () => {
			const result = toXtermTheme(makeLightTheme());
			expect(result.background).toBe('#ffffff');
			expect(result.foreground).toBe('#24292f');
		});

		it('uses accent color for cursor', () => {
			const result = toXtermTheme(makeDarkTheme());
			expect(result.cursor).toBe('#bd93f9');
			expect(result.cursorAccent).toBe('#282a36');
		});

		it('uses accentDim for selection background', () => {
			const result = toXtermTheme(makeDarkTheme());
			expect(result.selectionBackground).toBe('rgba(189, 147, 249, 0.2)');
		});

		it('uses textMain for selection foreground', () => {
			const result = toXtermTheme(makeDarkTheme());
			expect(result.selectionForeground).toBe('#f8f8f2');
		});
	});

	describe('per-theme ANSI palette usage', () => {
		it('uses theme ansiColors when provided', () => {
			const customAnsi: AnsiColors = {
				black: '#000000', red: '#aa0000', green: '#00aa00', yellow: '#aaaa00',
				blue: '#0000aa', magenta: '#aa00aa', cyan: '#00aaaa', white: '#aaaaaa',
				brightBlack: '#555555', brightRed: '#ff5555', brightGreen: '#55ff55',
				brightYellow: '#ffff55', brightBlue: '#5555ff', brightMagenta: '#ff55ff',
				brightCyan: '#55ffff', brightWhite: '#ffffff',
			};
			const result = toXtermTheme(makeDarkTheme(undefined, customAnsi));

			for (const key of ANSI_KEYS) {
				expect(result[key]).toBe(customAnsi[key]);
			}
		});

		it('falls back to dark ANSI palette when ansiColors is absent (dark mode)', () => {
			const result = toXtermTheme(makeDarkTheme());
			// Without ansiColors, dark themes use the Dracula-based fallback
			expect(result.magenta).toBe('#ff79c6');
			expect(result.cyan).toBe('#8be9fd');
		});

		it('falls back to light ANSI palette when ansiColors is absent (light mode)', () => {
			const result = toXtermTheme(makeLightTheme());
			// Without ansiColors, light themes use the Solarized-based fallback
			expect(result.magenta).toBe('#d33682');
			expect(result.cyan).toBe('#2aa198');
		});
	});

	describe('all 16 ANSI color slots present', () => {
		it('includes all 16 ANSI color slots for dark theme', () => {
			const result = toXtermTheme(makeDarkTheme());
			for (const key of ANSI_KEYS) {
				expect(result).toHaveProperty(key);
				expect(typeof (result as Record<string, unknown>)[key]).toBe('string');
			}
		});

		it('includes all 16 ANSI color slots for light theme', () => {
			const result = toXtermTheme(makeLightTheme());
			for (const key of ANSI_KEYS) {
				expect(result).toHaveProperty(key);
				expect(typeof (result as Record<string, unknown>)[key]).toBe('string');
			}
		});
	});

	describe('built-in theme integration', () => {
		const themeIds = Object.keys(THEMES) as Array<keyof typeof THEMES>;

		it.each(themeIds)('theme "%s" produces valid xterm ITheme with all 16 ANSI colors', (themeId) => {
			const theme = THEMES[themeId];
			const result = toXtermTheme(theme);

			// Core properties must be set
			expect(result.background).toBe(theme.colors.bgMain);
			expect(result.foreground).toBe(theme.colors.textMain);
			expect(result.cursor).toBe(theme.colors.accent);
			expect(result.cursorAccent).toBe(theme.colors.bgMain);

			// All 16 ANSI colors must be strings
			for (const key of ANSI_KEYS) {
				const value = (result as Record<string, unknown>)[key];
				expect(typeof value).toBe('string');
				expect((value as string).length).toBeGreaterThan(0);
			}
		});

		it('themes with ansiColors use their own palette (not fallback)', () => {
			// Nord has its own ansiColors — verify they're used
			const nordResult = toXtermTheme(THEMES.nord);
			expect(nordResult.blue).toBe('#81a1c1');     // Nord blue, not Dracula fallback
			expect(nordResult.magenta).toBe('#b48ead');   // Nord magenta
			expect(nordResult.cyan).toBe('#88c0d0');      // Nord cyan

			// Catppuccin Mocha has its own ansiColors
			const mochaResult = toXtermTheme(THEMES['catppuccin-mocha']);
			expect(mochaResult.blue).toBe('#89b4fa');     // Catppuccin blue
			expect(mochaResult.magenta).toBe('#f5c2e7');  // Catppuccin pink

			// Gruvbox Dark has its own ansiColors
			const gruvResult = toXtermTheme(THEMES['gruvbox-dark']);
			expect(gruvResult.blue).toBe('#458588');      // Gruvbox blue
			expect(gruvResult.cyan).toBe('#689d6a');      // Gruvbox aqua
		});

		it('custom theme (no ansiColors) falls back to dark palette', () => {
			const result = toXtermTheme(THEMES.custom);
			// Custom theme has mode 'dark' and no ansiColors → dark fallback
			expect(result.magenta).toBe('#ff79c6');
			expect(result.cyan).toBe('#8be9fd');
		});
	});

	describe('vibe theme handling', () => {
		it('vibe themes use their own ansiColors (not dark/light fallback)', () => {
			const dreSynth = THEMES['dre-synth'];
			const result = toXtermTheme(dreSynth);

			// Dre Synth has its own neon-inspired ANSI palette
			expect(result.red).toBe('#ff2a6d');
			expect(result.green).toBe('#00ffcc');
			expect(result.cyan).toBe('#00d4aa');
		});

		it('vibe themes without ansiColors fall back to dark palette', () => {
			const vibeThemeNoAnsi: Theme = {
				id: 'pedurple',
				name: 'Test Vibe',
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
				// No ansiColors — should fall back to dark palette
			};

			const result = toXtermTheme(vibeThemeNoAnsi);
			expect(result.magenta).toBe('#ff79c6'); // Dracula-based dark fallback
		});
	});

	describe('theme ANSI palette completeness', () => {
		const themesWithAnsiColors = Object.values(THEMES).filter(t => t.ansiColors);

		it('all themes with ansiColors have all 16 color slots', () => {
			for (const theme of themesWithAnsiColors) {
				for (const key of ANSI_KEYS) {
					expect(theme.ansiColors).toHaveProperty(key);
					expect(typeof theme.ansiColors![key]).toBe('string');
					expect(theme.ansiColors![key].length).toBeGreaterThan(0);
				}
			}
		});

		it('all themes with ansiColors have valid hex color format', () => {
			const hexColorRegex = /^#[0-9a-fA-F]{6}$/;
			for (const theme of themesWithAnsiColors) {
				for (const key of ANSI_KEYS) {
					expect(theme.ansiColors![key]).toMatch(hexColorRegex);
				}
			}
		});
	});
});
