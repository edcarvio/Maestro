/**
 * @file xtermTheme.test.ts
 * @description Tests for the Maestro → xterm.js theme mapping utility
 */

import { describe, it, expect } from 'vitest';
import { toXtermTheme } from '../../../renderer/utils/xtermTheme';
import type { Theme } from '../../../shared/theme-types';

const makeDarkTheme = (overrides?: Partial<Theme['colors']>): Theme => ({
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
});

const makeLightTheme = (overrides?: Partial<Theme['colors']>): Theme => ({
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
});

describe('toXtermTheme', () => {
	it('maps dark theme background and foreground colors', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		expect(result.background).toBe('#282a36');
		expect(result.foreground).toBe('#f8f8f2');
	});

	it('maps light theme background and foreground colors', () => {
		const theme = makeLightTheme();
		const result = toXtermTheme(theme);

		expect(result.background).toBe('#ffffff');
		expect(result.foreground).toBe('#24292f');
	});

	it('uses accent color for cursor', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		expect(result.cursor).toBe('#bd93f9');
		expect(result.cursorAccent).toBe('#282a36');
	});

	it('uses accentDim for selection background', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		expect(result.selectionBackground).toBe('rgba(189, 147, 249, 0.2)');
	});

	it('maps semantic colors to ANSI equivalents', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		// Error → red, success → green, warning → yellow, accent → blue
		expect(result.red).toBe('#ff5555');
		expect(result.green).toBe('#50fa7b');
		expect(result.yellow).toBe('#f1fa8c');
		expect(result.blue).toBe('#bd93f9');
	});

	it('uses dark ANSI palette for dark themes', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		// Non-semantic colors should come from dark palette
		expect(result.magenta).toBe('#ff79c6');
		expect(result.cyan).toBe('#8be9fd');
	});

	it('uses light ANSI palette for light themes', () => {
		const theme = makeLightTheme();
		const result = toXtermTheme(theme);

		// Non-semantic colors should come from light palette
		expect(result.magenta).toBe('#d33682');
		expect(result.cyan).toBe('#2aa198');
	});

	it('includes all 16 ANSI color slots', () => {
		const theme = makeDarkTheme();
		const result = toXtermTheme(theme);

		const requiredKeys = [
			'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
			'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
			'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
		];

		for (const key of requiredKeys) {
			expect(result).toHaveProperty(key);
			expect(typeof (result as Record<string, unknown>)[key]).toBe('string');
		}
	});
});
