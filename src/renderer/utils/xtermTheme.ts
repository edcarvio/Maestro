/**
 * Maps Maestro Theme → xterm.js ITheme
 *
 * Derives terminal ANSI colors from the Maestro theme palette.
 * Provides sensible fallback ANSI colors for colors that themes don't define.
 */

import type { Theme } from '../types';
import type { ITheme } from '@xterm/xterm';

// Default ANSI color palettes for dark and light modes
const DARK_ANSI = {
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

const LIGHT_ANSI = {
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
 * Convert a Maestro Theme to an xterm.js ITheme
 */
export function toXtermTheme(theme: Theme): ITheme {
	const isLight = theme.mode === 'light';
	const ansi = isLight ? LIGHT_ANSI : DARK_ANSI;

	return {
		background: theme.colors.bgMain,
		foreground: theme.colors.textMain,
		cursor: theme.colors.accent,
		cursorAccent: theme.colors.bgMain,
		selectionBackground: theme.colors.accentDim,
		selectionForeground: theme.colors.textMain,

		// Map semantic theme colors to ANSI equivalents where possible
		black: ansi.black,
		red: theme.colors.error || ansi.red,
		green: theme.colors.success || ansi.green,
		yellow: theme.colors.warning || ansi.yellow,
		blue: theme.colors.accent || ansi.blue,
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
