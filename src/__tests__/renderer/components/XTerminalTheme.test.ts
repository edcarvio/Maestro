/**
 * Tests for mapMaestroThemeToXterm — the bridge between Maestro themes and xterm.js.
 *
 * Verifies:
 * - Per-theme ANSI colors are passed through correctly
 * - Fallback defaults are used when ANSI colors are absent
 * - Selection, cursor, and foreground/background mapping
 * - Theme switching produces correct output
 * - Search decoration colors derived from themes
 */

import { describe, it, expect } from 'vitest';
import { mapMaestroThemeToXterm, mixHexColors, buildSearchDecorations } from '../../../renderer/components/XTerminal';
import { THEMES } from '../../../shared/themes';
import type { Theme } from '../../../shared/theme-types';

describe('mapMaestroThemeToXterm', () => {
	describe('themes with ANSI colors', () => {
		it('should use theme-defined ANSI colors for Dracula', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.red).toBe('#ff5555');
			expect(result.green).toBe('#50fa7b');
			expect(result.blue).toBe('#bd93f9');
			expect(result.magenta).toBe('#ff79c6');
			expect(result.cyan).toBe('#8be9fd');
		});

		it('should use theme-defined ANSI colors for Nord', () => {
			const result = mapMaestroThemeToXterm(THEMES.nord);
			expect(result.red).toBe('#bf616a');
			expect(result.green).toBe('#a3be8c');
			expect(result.blue).toBe('#81a1c1');
			expect(result.brightCyan).toBe('#8fbcbb');
		});

		it('should use theme-defined ANSI colors for GitHub Light', () => {
			const result = mapMaestroThemeToXterm(THEMES['github-light']);
			expect(result.red).toBe('#d73a49');
			expect(result.green).toBe('#28a745');
			expect(result.blue).toBe('#0366d6');
		});

		it('should use theme-defined ANSI colors for Solarized Light', () => {
			const result = mapMaestroThemeToXterm(THEMES['solarized-light']);
			expect(result.red).toBe('#dc322f');
			expect(result.green).toBe('#859900');
			expect(result.cyan).toBe('#2aa198');
		});

		it('should use theme ansiSelection for selection background', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.selectionBackground).toBe('rgba(189, 147, 249, 0.3)');
		});
	});

	describe('themes without ANSI colors (fallback)', () => {
		it('should use dark defaults for custom theme (dark mode, no ANSI)', () => {
			const result = mapMaestroThemeToXterm(THEMES.custom);
			// Defaults are One Dark inspired
			expect(result.red).toBe('#e06c75');
			expect(result.green).toBe('#98c379');
			expect(result.blue).toBe('#61afef');
			expect(result.brightWhite).toBe('#ffffff');
		});

		it('should use light defaults for a light theme without ANSI colors', () => {
			const lightThemeNoAnsi: Theme = {
				id: 'custom' as any,
				name: 'Test Light',
				mode: 'light',
				colors: {
					bgMain: '#ffffff',
					bgSidebar: '#f0f0f0',
					bgActivity: '#e0e0e0',
					border: '#cccccc',
					textMain: '#000000',
					textDim: '#666666',
					accent: '#0066cc',
					accentDim: 'rgba(0, 102, 204, 0.1)',
					accentText: '#0066cc',
					accentForeground: '#ffffff',
					success: '#008800',
					warning: '#cc8800',
					error: '#cc0000',
				},
			};
			const result = mapMaestroThemeToXterm(lightThemeNoAnsi);
			// Defaults are Solarized Light inspired
			expect(result.red).toBe('#dc322f');
			expect(result.green).toBe('#859900');
			expect(result.blue).toBe('#268bd2');
			expect(result.brightWhite).toBe('#fdf6e3');
		});

		it('should use generic selection color when ansiSelection is absent', () => {
			const result = mapMaestroThemeToXterm(THEMES.custom);
			// Dark theme fallback
			expect(result.selectionBackground).toBe('rgba(255, 255, 255, 0.2)');
		});
	});

	describe('core theme mapping', () => {
		it('should map bgMain to background', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.background).toBe(THEMES.dracula.colors.bgMain);
		});

		it('should map textMain to foreground', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.foreground).toBe(THEMES.dracula.colors.textMain);
		});

		it('should use accent color for cursor', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.cursor).toBe(THEMES.dracula.colors.accent);
		});

		it('should use bgMain for cursorAccent (contrast)', () => {
			const result = mapMaestroThemeToXterm(THEMES.dracula);
			expect(result.cursorAccent).toBe(THEMES.dracula.colors.bgMain);
		});
	});

	describe('all built-in themes produce valid xterm theme', () => {
		const themeEntries = Object.entries(THEMES);

		it.each(themeEntries)('%s should produce a complete xterm theme', (_id, theme) => {
			const result = mapMaestroThemeToXterm(theme);

			// Structural completeness
			expect(result.background).toBeTruthy();
			expect(result.foreground).toBeTruthy();
			expect(result.cursor).toBeTruthy();
			expect(result.cursorAccent).toBeTruthy();
			expect(result.selectionBackground).toBeTruthy();

			// All 16 ANSI colors present
			const ansiKeys = [
				'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
				'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
				'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
			] as const;
			for (const key of ansiKeys) {
				expect(result[key]).toBeTruthy();
			}
		});
	});
});

describe('mixHexColors', () => {
	it('should return foreground at alpha=1', () => {
		expect(mixHexColors('#ff0000', '#000000', 1)).toBe('#ff0000');
	});

	it('should return background at alpha=0', () => {
		expect(mixHexColors('#ff0000', '#000000', 0)).toBe('#000000');
	});

	it('should mix colors at 50% opacity', () => {
		// #ff0000 mixed with #000000 at 0.5 → #800000
		expect(mixHexColors('#ff0000', '#000000', 0.5)).toBe('#800000');
	});

	it('should mix white on black at 30%', () => {
		// #ffffff on #000000 at 0.3 → ~#4d4d4d
		const result = mixHexColors('#ffffff', '#000000', 0.3);
		expect(result).toBe('#4d4d4d');
	});

	it('should mix different channels independently', () => {
		// #ff8000 on #002040 at 0.5 → #805020
		const result = mixHexColors('#ff8000', '#002040', 0.5);
		expect(result).toBe('#805020');
	});
});

describe('buildSearchDecorations', () => {
	it('should return all required decoration properties', () => {
		const result = buildSearchDecorations(THEMES.dracula);
		expect(result).toHaveProperty('matchBackground');
		expect(result).toHaveProperty('matchBorder');
		expect(result).toHaveProperty('matchOverviewRuler');
		expect(result).toHaveProperty('activeMatchBackground');
		expect(result).toHaveProperty('activeMatchBorder');
		expect(result).toHaveProperty('activeMatchColorOverviewRuler');
	});

	it('should return #RRGGBB hex colors', () => {
		const result = buildSearchDecorations(THEMES.dracula);
		const hexPattern = /^#[0-9a-f]{6}$/;
		expect(result.matchBackground).toMatch(hexPattern);
		expect(result.matchBorder).toMatch(hexPattern);
		expect(result.matchOverviewRuler).toMatch(hexPattern);
		expect(result.activeMatchBackground).toMatch(hexPattern);
		expect(result.activeMatchBorder).toMatch(hexPattern);
		expect(result.activeMatchColorOverviewRuler).toMatch(hexPattern);
	});

	it('should use warning color for matchOverviewRuler', () => {
		const result = buildSearchDecorations(THEMES.dracula);
		expect(result.matchOverviewRuler).toBe(THEMES.dracula.colors.warning);
	});

	it('should use accent color for activeMatchBorder and overview ruler', () => {
		const result = buildSearchDecorations(THEMES.dracula);
		expect(result.activeMatchBorder).toBe(THEMES.dracula.colors.accent);
		expect(result.activeMatchColorOverviewRuler).toBe(THEMES.dracula.colors.accent);
	});

	it('should produce different colors for match vs active match', () => {
		const result = buildSearchDecorations(THEMES.dracula);
		expect(result.matchBackground).not.toBe(result.activeMatchBackground);
	});

	const themeEntries = Object.entries(THEMES);

	it.each(themeEntries)('%s should produce valid search decorations', (_id, theme) => {
		const result = buildSearchDecorations(theme);
		const hexPattern = /^#[0-9a-f]{6}$/;
		expect(result.matchBackground).toMatch(hexPattern);
		expect(result.activeMatchBackground).toMatch(hexPattern);
		expect(result.matchOverviewRuler).toMatch(hexPattern);
		expect(result.activeMatchColorOverviewRuler).toMatch(hexPattern);
	});
});
