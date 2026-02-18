/**
 * Maps Maestro Theme → xterm.js ITheme
 *
 * Uses per-theme ANSI color palettes when available for a native terminal look.
 * Falls back to generic dark/light palettes for themes without custom ANSI colors.
 */

import type { Theme } from '../../shared/theme-types';
import type { AnsiColors } from '../../shared/theme-types';
import type { ITheme } from '@xterm/xterm';

// Fallback ANSI color palettes for themes that don't define their own
const DARK_ANSI_FALLBACK: AnsiColors = {
	black: '#1a1a2e',
	red: '#ff5555',
	green: '#50fa7b',
	yellow: '#f1fa8c',
	blue: '#6272a4',
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
};

const LIGHT_ANSI_FALLBACK: AnsiColors = {
	black: '#073642',
	red: '#dc322f',
	green: '#859900',
	yellow: '#b58900',
	blue: '#268bd2',
	magenta: '#d33682',
	cyan: '#2aa198',
	white: '#eee8d5',
	brightBlack: '#586e75',
	brightRed: '#cb4b16',
	brightGreen: '#859900',
	brightYellow: '#b58900',
	brightBlue: '#268bd2',
	brightMagenta: '#6c71c4',
	brightCyan: '#2aa198',
	brightWhite: '#fdf6e3',
};

/**
 * Resolve the ANSI color palette for a theme.
 * Prefers the theme's own ansiColors, then falls back to mode-based defaults.
 */
function resolveAnsiColors(theme: Theme): AnsiColors {
	if (theme.ansiColors) return theme.ansiColors;
	return theme.mode === 'light' ? LIGHT_ANSI_FALLBACK : DARK_ANSI_FALLBACK;
}

/**
 * Convert a Maestro Theme to an xterm.js ITheme
 */
export function toXtermTheme(theme: Theme): ITheme {
	const ansi = resolveAnsiColors(theme);

	return {
		background: theme.colors.bgMain,
		foreground: theme.colors.textMain,
		cursor: theme.colors.accent,
		cursorAccent: theme.colors.bgMain,
		selectionBackground: theme.colors.accentDim,
		selectionForeground: theme.colors.textMain,

		// All 16 ANSI colors from the resolved palette
		black: ansi.black,
		red: ansi.red,
		green: ansi.green,
		yellow: ansi.yellow,
		blue: ansi.blue,
		magenta: ansi.magenta,
		cyan: ansi.cyan,
		white: ansi.white,
		brightBlack: ansi.brightBlack,
		brightRed: ansi.brightRed,
		brightGreen: ansi.brightGreen,
		brightYellow: ansi.brightYellow,
		brightBlue: ansi.brightBlue,
		brightMagenta: ansi.brightMagenta,
		brightCyan: ansi.brightCyan,
		brightWhite: ansi.brightWhite,
	};
}
