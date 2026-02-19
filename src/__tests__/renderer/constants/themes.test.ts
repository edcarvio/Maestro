import { describe, it, expect } from 'vitest';
import { THEMES } from '../../../renderer/constants/themes';
import type { ThemeColors } from '../../../shared/theme-types';
import { isValidThemeId } from '../../../shared/theme-types';

/**
 * Tests for the THEMES constant
 *
 * These tests verify structural integrity of the themes object,
 * not specific color values (which change during design iterations).
 */

// Required color properties that every theme must have
const REQUIRED_COLORS: (keyof ThemeColors)[] = [
	'bgMain',
	'bgSidebar',
	'bgActivity',
	'border',
	'textMain',
	'textDim',
	'accent',
	'accentDim',
	'accentText',
	'accentForeground',
	'success',
	'warning',
	'error',
];

// Hex color regex
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{6})$/;
const RGBA_COLOR_REGEX =
	/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;

function isValidCssColor(color: string): boolean {
	return HEX_COLOR_REGEX.test(color) || RGBA_COLOR_REGEX.test(color);
}

describe('THEMES constant', () => {
	const themeIds = Object.keys(THEMES);
	const themes = Object.values(THEMES);

	describe('structure', () => {
		it('should contain at least one theme', () => {
			expect(themeIds.length).toBeGreaterThan(0);
		});

		it('should have valid theme IDs matching isValidThemeId', () => {
			for (const key of themeIds) {
				expect(isValidThemeId(key)).toBe(true);
			}
		});

		it('should have exactly 17 themes (sync check with ThemeId type)', () => {
			// This count should match the number of IDs in ThemeId union type.
			// If a new theme is added to THEMES without updating ThemeId, TypeScript errors.
			// If ThemeId is updated without adding to isValidThemeId array, other tests fail.
			// This test serves as an explicit reminder when themes are added/removed.
			expect(themeIds.length).toBe(17);
		});

		it('should have theme.id matching its key', () => {
			for (const [key, theme] of Object.entries(THEMES)) {
				expect(theme.id).toBe(key);
			}
		});

		it('should have unique theme names', () => {
			const names = themes.map((t) => t.name);
			expect(new Set(names).size).toBe(names.length);
		});

		it('should have valid mode for each theme', () => {
			for (const theme of themes) {
				expect(['light', 'dark', 'vibe']).toContain(theme.mode);
			}
		});
	});

	describe('color properties', () => {
		it('should have all required color properties', () => {
			for (const theme of themes) {
				for (const colorKey of REQUIRED_COLORS) {
					expect(theme.colors[colorKey]).toBeDefined();
				}
			}
		});

		it('should have valid CSS color values', () => {
			for (const theme of themes) {
				for (const [colorName, colorValue] of Object.entries(theme.colors)) {
					expect(
						isValidCssColor(colorValue),
						`${theme.id}.${colorName}: "${colorValue}" is not a valid CSS color`
					).toBe(true);
				}
			}
		});

		it('should have accentDim as rgba with transparency', () => {
			for (const theme of themes) {
				expect(theme.colors.accentDim.startsWith('rgba(')).toBe(true);
			}
		});
	});

	describe('theme modes', () => {
		it('should have at least one dark theme', () => {
			expect(themes.some((t) => t.mode === 'dark')).toBe(true);
		});

		it('should have at least one light theme', () => {
			expect(themes.some((t) => t.mode === 'light')).toBe(true);
		});
	});

	describe('ANSI terminal colors', () => {
		// All 16 ANSI color fields
		const ANSI_COLOR_FIELDS = [
			'ansiBlack', 'ansiRed', 'ansiGreen', 'ansiYellow',
			'ansiBlue', 'ansiMagenta', 'ansiCyan', 'ansiWhite',
			'ansiBrightBlack', 'ansiBrightRed', 'ansiBrightGreen', 'ansiBrightYellow',
			'ansiBrightBlue', 'ansiBrightMagenta', 'ansiBrightCyan', 'ansiBrightWhite',
		] as const;

		// Themes that should have ANSI colors (all except custom)
		const themesWithAnsi = themes.filter((t) => t.id !== 'custom');

		it('should have ANSI colors on all built-in themes (except custom)', () => {
			for (const theme of themesWithAnsi) {
				for (const field of ANSI_COLOR_FIELDS) {
					expect(
						theme.colors[field],
						`${theme.id} missing ${field}`
					).toBeDefined();
				}
			}
		});

		it('should have ansiSelection on all built-in themes (except custom)', () => {
			for (const theme of themesWithAnsi) {
				expect(
					theme.colors.ansiSelection,
					`${theme.id} missing ansiSelection`
				).toBeDefined();
			}
		});

		it('should have valid CSS color values for all ANSI fields', () => {
			for (const theme of themesWithAnsi) {
				for (const field of ANSI_COLOR_FIELDS) {
					const value = theme.colors[field];
					if (value !== undefined) {
						expect(
							isValidCssColor(value),
							`${theme.id}.${field}: "${value}" is not a valid CSS color`
						).toBe(true);
					}
				}
			}
		});

		it('should have ansiSelection as rgba for transparency', () => {
			for (const theme of themesWithAnsi) {
				const sel = theme.colors.ansiSelection;
				if (sel !== undefined) {
					expect(sel.startsWith('rgba(')).toBe(true);
				}
			}
		});

		it('custom theme should NOT have ANSI colors (tests fallback path)', () => {
			const custom = THEMES.custom;
			for (const field of ANSI_COLOR_FIELDS) {
				expect(custom.colors[field]).toBeUndefined();
			}
		});
	});
});
