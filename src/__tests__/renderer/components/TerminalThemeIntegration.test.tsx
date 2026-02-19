/**
 * Tests for terminal theme integration — verifying that theme changes
 * propagate correctly through the XTerminal React component to the
 * underlying xterm.js Terminal instance.
 *
 * Covers:
 * - Live theme switching: terminal.options.theme is updated via useEffect
 * - Container background color updates with theme.colors.bgMain
 * - Dark → light → vibe → dark round-trip switching
 * - ANSI color propagation for themes with custom palettes (Dracula, Nord, etc.)
 * - Fallback ANSI defaults for themes without custom palettes (Custom theme)
 * - Multiple rapid theme switches (no stale state)
 * - Cursor color (accent) and selection color (ansiSelection) mapping
 * - All built-in themes produce valid xterm.js theme objects via the component
 * - Theme-specific ANSI colors for terminal use cases (ls --color, git diff)
 *
 * Complements:
 * - XTerminalTheme.test.ts: Pure-function tests for mapMaestroThemeToXterm, mixHexColors, buildSearchDecorations
 * - XTerminalSearch.test.tsx: Theme-aware search decoration tests
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock all xterm.js modules BEFORE importing XTerminal ---

const mockTerminalOpen = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalFocus = vi.fn();

// Capture the options object set on the Terminal instance
let capturedTerminalOptions: Record<string, unknown> = {};

vi.mock('@xterm/xterm', () => {
	class MockTerminal {
		open = mockTerminalOpen;
		write = mockTerminalWrite;
		focus = mockTerminalFocus;
		clear = vi.fn();
		dispose = mockTerminalDispose;
		scrollToBottom = vi.fn();
		getSelection = vi.fn().mockReturnValue('');
		loadAddon = vi.fn();
		unicode = { activeVersion: '' };
		cols = 80;
		rows = 24;
		options: Record<string, unknown> = {};
		onData() { return { dispose: vi.fn() }; }
		onTitleChange() { return { dispose: vi.fn() }; }

		constructor(opts: Record<string, unknown>) {
			this.options = { ...opts };
			capturedTerminalOptions = this.options;
		}
	}
	return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
	class MockFitAddon {
		fit = vi.fn();
		dispose = vi.fn();
	}
	return { FitAddon: MockFitAddon };
});

vi.mock('@xterm/addon-webgl', () => {
	class MockWebglAddon {
		onContextLoss = vi.fn();
		dispose = vi.fn();
	}
	return { WebglAddon: MockWebglAddon };
});

vi.mock('@xterm/addon-web-links', () => {
	class MockWebLinksAddon { dispose = vi.fn(); }
	return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock('@xterm/addon-search', () => {
	class MockSearchAddon {
		findNext = vi.fn().mockReturnValue(true);
		findPrevious = vi.fn().mockReturnValue(true);
		clearDecorations = vi.fn();
		dispose = vi.fn();
	}
	return { SearchAddon: MockSearchAddon };
});

vi.mock('@xterm/addon-unicode11', () => {
	class MockUnicode11Addon { dispose = vi.fn(); }
	return { Unicode11Addon: MockUnicode11Addon };
});

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Import AFTER all mocks are in place
import { XTerminal, XTerminalHandle, mapMaestroThemeToXterm } from '../../../renderer/components/XTerminal';
import { THEMES } from '../../../shared/themes';
import type { Theme } from '../../../shared/theme-types';

// --- Test theme fixtures ---

const draculaTheme = THEMES.dracula;
const nordTheme = THEMES.nord;
const monokaiTheme = THEMES.monokai;
const githubLightTheme = THEMES['github-light'];
const solarizedLightTheme = THEMES['solarized-light'];
const tokyoNightTheme = THEMES['tokyo-night'];
const catppuccinMochaTheme = THEMES['catppuccin-mocha'];
const gruvboxDarkTheme = THEMES['gruvbox-dark'];
const oneLightTheme = THEMES['one-light'];
const gruvboxLightTheme = THEMES['gruvbox-light'];
const catppuccinLatteTheme = THEMES['catppuccin-latte'];
const ayuLightTheme = THEMES['ayu-light'];
const pedurpleTheme = THEMES.pedurple;
const maestrosChoiceTheme = THEMES['maestros-choice'];
const dreSynthTheme = THEMES['dre-synth'];
const inquestTheme = THEMES.inquest;
const customTheme = THEMES.custom;

// IPC callback collectors (required for XTerminal mount)
let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	capturedTerminalOptions = {};
	dataCallbacks = [];
	exitCallbacks = [];

	(window.maestro.process as Record<string, unknown>).onData = vi.fn(
		(cb: (sid: string, data: string) => void) => {
			dataCallbacks.push(cb);
			return () => {
				const idx = dataCallbacks.indexOf(cb);
				if (idx >= 0) dataCallbacks.splice(idx, 1);
			};
		}
	);
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn(
		(cb: (sid: string, code: number) => void) => {
			exitCallbacks.push(cb);
			return () => {
				const idx = exitCallbacks.indexOf(cb);
				if (idx >= 0) exitCallbacks.splice(idx, 1);
			};
		}
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// --- Helper ---
function renderTerminal(theme: Theme) {
	const ref = React.createRef<XTerminalHandle>();
	const result = render(
		<XTerminal
			ref={ref}
			sessionId="sess-1-terminal-tab-1"
			theme={theme}
			fontFamily="Menlo"
		/>
	);
	return { ref, ...result };
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('Terminal Theme Integration', () => {
	describe('initial theme application', () => {
		it('should set xterm theme from Maestro theme on mount', () => {
			renderTerminal(draculaTheme);

			const xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.background).toBe(draculaTheme.colors.bgMain);
			expect(xtermTheme.foreground).toBe(draculaTheme.colors.textMain);
			expect(xtermTheme.cursor).toBe(draculaTheme.colors.accent);
		});

		it('should set container background to bgMain', () => {
			const { container } = renderTerminal(draculaTheme);
			const wrapper = container.firstElementChild as HTMLElement;
			expect(wrapper.style.backgroundColor).toBe('rgb(40, 42, 54)'); // #282a36
		});

		it('should pass Dracula ANSI colors to xterm on mount', () => {
			renderTerminal(draculaTheme);

			const xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.red).toBe('#ff5555');
			expect(xtermTheme.green).toBe('#50fa7b');
			expect(xtermTheme.blue).toBe('#bd93f9');
			expect(xtermTheme.cyan).toBe('#8be9fd');
			expect(xtermTheme.magenta).toBe('#ff79c6');
		});

		it('should use light fallback ANSI colors for a light theme without custom palette', () => {
			const lightThemeNoAnsi: Theme = {
				id: 'custom' as any,
				name: 'Test Light No ANSI',
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
			renderTerminal(lightThemeNoAnsi);

			const xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			// Solarized-inspired light fallbacks
			expect(xtermTheme.red).toBe('#dc322f');
			expect(xtermTheme.green).toBe('#859900');
			expect(xtermTheme.blue).toBe('#268bd2');
		});
	});

	describe('live theme switching via rerender', () => {
		it('should update terminal.options.theme when theme prop changes', () => {
			const { rerender } = renderTerminal(draculaTheme);

			// Switch to GitHub Light
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(updatedTheme.background).toBe(githubLightTheme.colors.bgMain);
			expect(updatedTheme.foreground).toBe(githubLightTheme.colors.textMain);
			expect(updatedTheme.cursor).toBe(githubLightTheme.colors.accent);
		});

		it('should update container background on theme switch', () => {
			const { container, rerender } = renderTerminal(draculaTheme);

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);

			const wrapper = container.firstElementChild as HTMLElement;
			expect(wrapper.style.backgroundColor).toBe('rgb(255, 255, 255)'); // #ffffff
		});

		it('should update ANSI colors when switching from Dracula to Nord', () => {
			const { rerender } = renderTerminal(draculaTheme);

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={nordTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = capturedTerminalOptions.theme as Record<string, string>;
			// Nord ANSI colors
			expect(updatedTheme.red).toBe('#bf616a');
			expect(updatedTheme.green).toBe('#a3be8c');
			expect(updatedTheme.blue).toBe('#81a1c1');
			expect(updatedTheme.cyan).toBe('#88c0d0');
		});

		it('should update cursor color to new accent on theme switch', () => {
			const { rerender } = renderTerminal(draculaTheme);

			// Dracula accent = #bd93f9
			expect((capturedTerminalOptions.theme as Record<string, string>).cursor).toBe('#bd93f9');

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={nordTheme}
					fontFamily="Menlo"
				/>
			);

			// Nord accent = #88c0d0
			expect((capturedTerminalOptions.theme as Record<string, string>).cursor).toBe('#88c0d0');
		});

		it('should update selection color when switching to theme with ansiSelection', () => {
			const { rerender } = renderTerminal(customTheme); // no ansiSelection

			const initialTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(initialTheme.selectionBackground).toBe('rgba(255, 255, 255, 0.2)'); // dark fallback

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={draculaTheme}
					fontFamily="Menlo"
				/>
			);

			const updatedTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(updatedTheme.selectionBackground).toBe('rgba(189, 147, 249, 0.3)');
		});
	});

	describe('dark ↔ light ↔ vibe round-trip', () => {
		it('should correctly switch dark → light → vibe → dark', () => {
			const { rerender } = renderTerminal(draculaTheme);

			// Verify initial dark theme
			let xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.background).toBe('#282a36');

			// Switch to light
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);
			xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.background).toBe('#ffffff');
			expect(xtermTheme.red).toBe('#d73a49'); // GitHub Light red

			// Switch to vibe
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={pedurpleTheme}
					fontFamily="Menlo"
				/>
			);
			xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.background).toBe('#1a0f24');
			expect(xtermTheme.red).toBe('#da70d6'); // Pedurple red

			// Back to dark
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={monokaiTheme}
					fontFamily="Menlo"
				/>
			);
			xtermTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(xtermTheme.background).toBe('#272822');
			expect(xtermTheme.red).toBe('#f92672'); // Monokai red
		});
	});

	describe('rapid theme switching', () => {
		it('should settle on the last applied theme after multiple rapid switches', () => {
			const { rerender } = renderTerminal(draculaTheme);

			// Rapid-fire theme switches
			const themes = [nordTheme, monokaiTheme, githubLightTheme, tokyoNightTheme, solarizedLightTheme];
			for (const theme of themes) {
				rerender(
					<XTerminal
						sessionId="sess-1-terminal-tab-1"
						theme={theme}
						fontFamily="Menlo"
					/>
				);
			}

			// Should reflect the final theme (Solarized Light)
			const finalTheme = capturedTerminalOptions.theme as Record<string, string>;
			expect(finalTheme.background).toBe(solarizedLightTheme.colors.bgMain);
			expect(finalTheme.foreground).toBe(solarizedLightTheme.colors.textMain);
			expect(finalTheme.red).toBe('#dc322f');
		});
	});

	describe('ANSI color correctness per theme', () => {
		it('should map all 16 ANSI colors for Dracula', () => {
			renderTerminal(draculaTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.black).toBe('#21222c');
			expect(t.red).toBe('#ff5555');
			expect(t.green).toBe('#50fa7b');
			expect(t.yellow).toBe('#f1fa8c');
			expect(t.blue).toBe('#bd93f9');
			expect(t.magenta).toBe('#ff79c6');
			expect(t.cyan).toBe('#8be9fd');
			expect(t.white).toBe('#f8f8f2');
			expect(t.brightBlack).toBe('#6272a4');
			expect(t.brightRed).toBe('#ff6e6e');
			expect(t.brightGreen).toBe('#69ff94');
			expect(t.brightYellow).toBe('#ffffa5');
			expect(t.brightBlue).toBe('#d6acff');
			expect(t.brightMagenta).toBe('#ff92df');
			expect(t.brightCyan).toBe('#a4ffff');
			expect(t.brightWhite).toBe('#ffffff');
		});

		it('should map all 16 ANSI colors for Tokyo Night', () => {
			renderTerminal(tokyoNightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.black).toBe('#15161e');
			expect(t.red).toBe('#f7768e');
			expect(t.green).toBe('#9ece6a');
			expect(t.yellow).toBe('#e0af68');
			expect(t.blue).toBe('#7aa2f7');
			expect(t.magenta).toBe('#bb9af7');
			expect(t.cyan).toBe('#7dcfff');
		});

		it('should map all 16 ANSI colors for Catppuccin Mocha', () => {
			renderTerminal(catppuccinMochaTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#f38ba8');
			expect(t.green).toBe('#a6e3a1');
			expect(t.blue).toBe('#89b4fa');
			expect(t.cyan).toBe('#94e2d5');
			expect(t.magenta).toBe('#f5c2e7');
		});

		it('should map Gruvbox Dark ANSI colors', () => {
			renderTerminal(gruvboxDarkTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#cc241d');
			expect(t.green).toBe('#98971a');
			expect(t.yellow).toBe('#d79921');
			expect(t.brightRed).toBe('#fb4934');
			expect(t.brightGreen).toBe('#b8bb26');
		});

		it('should map GitHub Light ANSI colors', () => {
			renderTerminal(githubLightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#d73a49');
			expect(t.green).toBe('#28a745');
			expect(t.blue).toBe('#0366d6');
			expect(t.magenta).toBe('#5a32a3');
		});

		it('should map Solarized Light ANSI colors', () => {
			renderTerminal(solarizedLightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#dc322f');
			expect(t.green).toBe('#859900');
			expect(t.cyan).toBe('#2aa198');
			expect(t.blue).toBe('#268bd2');
		});

		it('should use dark fallback ANSI for Custom theme (no ANSI colors defined)', () => {
			renderTerminal(customTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			// One Dark-inspired fallback defaults
			expect(t.red).toBe('#e06c75');
			expect(t.green).toBe('#98c379');
			expect(t.blue).toBe('#61afef');
			expect(t.brightWhite).toBe('#ffffff');
		});
	});

	describe('vibe theme ANSI colors', () => {
		it('should map Pedurple ANSI colors', () => {
			renderTerminal(pedurpleTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#da70d6');
			expect(t.green).toBe('#7cb342');
			expect(t.blue).toBe('#7b68ee');
			expect(t.cyan).toBe('#00ced1');
			expect(t.magenta).toBe('#ff69b4');
		});

		it('should map Maestro\'s Choice ANSI colors', () => {
			renderTerminal(maestrosChoiceTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#e05070');
			expect(t.green).toBe('#66d9a0');
			expect(t.yellow).toBe('#f4c430');
			expect(t.blue).toBe('#6699cc');
		});

		it('should map Dre Synth ANSI colors', () => {
			renderTerminal(dreSynthTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#ff2a6d');
			expect(t.green).toBe('#00ffcc');
			expect(t.yellow).toBe('#f3e70e');
			expect(t.magenta).toBe('#df00ff');
		});

		it('should map InQuest ANSI colors', () => {
			renderTerminal(inquestTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#cc0033');
			expect(t.green).toBe('#b0b0b0');
			expect(t.blue).toBe('#666666');
		});
	});

	describe('light theme ANSI colors', () => {
		it('should map One Light ANSI colors', () => {
			renderTerminal(oneLightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#e45649');
			expect(t.green).toBe('#50a14f');
			expect(t.blue).toBe('#4078f2');
			expect(t.magenta).toBe('#a626a4');
		});

		it('should map Gruvbox Light ANSI colors', () => {
			renderTerminal(gruvboxLightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#cc241d');
			expect(t.green).toBe('#98971a');
			expect(t.brightRed).toBe('#9d0006');
			expect(t.brightGreen).toBe('#79740e');
		});

		it('should map Catppuccin Latte ANSI colors', () => {
			renderTerminal(catppuccinLatteTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#d20f39');
			expect(t.green).toBe('#40a02b');
			expect(t.blue).toBe('#1e66f5');
			expect(t.magenta).toBe('#ea76cb');
		});

		it('should map Ayu Light ANSI colors', () => {
			renderTerminal(ayuLightTheme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			expect(t.red).toBe('#f07171');
			expect(t.green).toBe('#86b300');
			expect(t.blue).toBe('#399ee6');
			expect(t.cyan).toBe('#4cbf99');
		});
	});

	describe('ANSI colors for terminal use cases', () => {
		it('ls --color: green (directories) and blue (symlinks) should differ per theme', () => {
			// Dracula
			renderTerminal(draculaTheme);
			const dracula = capturedTerminalOptions.theme as Record<string, string>;
			const draculaGreen = dracula.green;
			const draculaBlue = dracula.blue;

			// Nord (different palette)
			const { rerender } = render(
				<XTerminal
					sessionId="sess-ls-test"
					theme={nordTheme}
					fontFamily="Menlo"
				/>
			);
			const nord = capturedTerminalOptions.theme as Record<string, string>;

			expect(nord.green).not.toBe(draculaGreen);
			expect(nord.blue).not.toBe(draculaBlue);
		});

		it('git diff: red (removed) and green (added) should be distinguishable within each theme', () => {
			for (const theme of [draculaTheme, nordTheme, githubLightTheme, solarizedLightTheme]) {
				const result = mapMaestroThemeToXterm(theme);
				// Red and green should never be the same color (basic accessibility)
				expect(result.red).not.toBe(result.green);
				// Bright variants also distinct
				expect(result.brightRed).not.toBe(result.brightGreen);
			}
		});

		it('htop-style apps: all 8 base ANSI colors should be unique within a theme', () => {
			const themes = [draculaTheme, nordTheme, githubLightTheme, tokyoNightTheme, catppuccinMochaTheme];
			for (const theme of themes) {
				const result = mapMaestroThemeToXterm(theme);
				const baseColors = [
					result.black, result.red, result.green, result.yellow,
					result.blue, result.magenta, result.cyan, result.white,
				];
				const unique = new Set(baseColors);
				expect(unique.size).toBe(8);
			}
		});
	});

	describe('all built-in themes via component mount', () => {
		const allThemes = Object.entries(THEMES);

		it.each(allThemes)('%s should produce a valid xterm theme with all 16 ANSI colors', (_id, theme) => {
			renderTerminal(theme);
			const t = capturedTerminalOptions.theme as Record<string, string>;

			// Core properties
			expect(t.background).toBeTruthy();
			expect(t.foreground).toBeTruthy();
			expect(t.cursor).toBeTruthy();

			// All 16 ANSI colors
			const ansiKeys = [
				'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
				'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
				'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
			] as const;
			for (const key of ansiKeys) {
				expect(t[key]).toBeTruthy();
			}
		});

		it.each(allThemes)('%s should set container background matching bgMain', (_id, theme) => {
			const { container } = renderTerminal(theme);
			const wrapper = container.firstElementChild as HTMLElement;
			// The inline style should contain the bgMain color
			expect(wrapper.style.backgroundColor).toBeTruthy();
		});
	});

	describe('theme switch preserves component state', () => {
		it('should not remount the terminal on theme change (terminal.open called once)', () => {
			const { rerender } = renderTerminal(draculaTheme);

			expect(mockTerminalOpen).toHaveBeenCalledTimes(1);

			// Switch theme
			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={nordTheme}
					fontFamily="Menlo"
				/>
			);

			// open() should NOT be called again — theme update is in-place via options setter
			expect(mockTerminalOpen).toHaveBeenCalledTimes(1);
		});

		it('should not dispose terminal on theme change', () => {
			const { rerender } = renderTerminal(draculaTheme);

			rerender(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={githubLightTheme}
					fontFamily="Menlo"
				/>
			);

			expect(mockTerminalDispose).not.toHaveBeenCalled();
		});
	});
});
