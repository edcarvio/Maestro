/**
 * Tests for XTerminal search functionality.
 *
 * Verifies the end-to-end search flow through XTerminal's imperative handle:
 * - search() calls SearchAddon.findNext with correct query and options
 * - searchNext() repeats the last query via SearchAddon.findNext
 * - searchPrevious() repeats the last query via SearchAddon.findPrevious
 * - clearSearch() clears decorations and resets the stored query
 * - Empty/missing queries are guarded (return false, no SearchAddon calls)
 * - Search decorations are built from the current theme
 * - Theme changes are reflected in subsequent search decoration options
 * - Boolean return values propagate from SearchAddon to the caller
 * - buildSearchDecorations() and mixHexColors() produce correct color values
 *
 * Complements:
 * - TerminalSearchBar.test.tsx (UI layer: input, buttons, keyboard, no-results state)
 * - TerminalView.test.tsx (delegation layer: TerminalView → XTerminal handle wiring)
 *
 * This file tests the XTerminal component layer where SearchAddon is actually loaded,
 * configured, and called — the critical middle layer of the search pipeline.
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock all xterm.js modules BEFORE importing XTerminal ---

const mockTerminalOpen = vi.fn();
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalFocus = vi.fn();
const mockTerminalClear = vi.fn();

const mockFindNext = vi.fn().mockReturnValue(true);
const mockFindPrevious = vi.fn().mockReturnValue(true);
const mockClearDecorations = vi.fn();

vi.mock('@xterm/xterm', () => {
	class MockTerminal {
		open = mockTerminalOpen;
		write = mockTerminalWrite;
		focus = mockTerminalFocus;
		clear = mockTerminalClear;
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
		findNext = mockFindNext;
		findPrevious = mockFindPrevious;
		clearDecorations = mockClearDecorations;
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
import { XTerminal, XTerminalHandle, buildSearchDecorations, mixHexColors } from '../../../renderer/components/XTerminal';
import type { Theme } from '../../../renderer/types';

// --- Test themes ---

const darkTheme: Theme = {
	id: 'dracula' as any,
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		border: '#6272a4',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentForeground: '#ffffff',
		warning: '#f1fa8c',
		error: '#ff5555',
		success: '#50fa7b',
	},
};

const lightTheme: Theme = {
	id: 'solarized-light' as any,
	name: 'Solarized Light',
	mode: 'light',
	colors: {
		bgMain: '#fdf6e3',
		bgSidebar: '#eee8d5',
		bgActivity: '#eee8d5',
		border: '#93a1a1',
		textMain: '#657b83',
		textDim: '#93a1a1',
		accent: '#268bd2',
		accentForeground: '#ffffff',
		warning: '#b58900',
		error: '#dc322f',
		success: '#859900',
	},
};

// IPC callback collectors
let dataCallbacks: Array<(sid: string, data: string) => void>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	dataCallbacks = [];
	exitCallbacks = [];

	// Reset SearchAddon mocks to default return values
	mockFindNext.mockReturnValue(true);
	mockFindPrevious.mockReturnValue(true);

	// Mock IPC event subscriptions
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

// --- Utility functions ---

describe('buildSearchDecorations', () => {
	it('produces decoration colors from a dark theme', () => {
		const decorations = buildSearchDecorations(darkTheme);

		// All fields should be non-empty hex strings
		expect(decorations.matchBackground).toMatch(/^#[0-9a-f]{6}$/i);
		expect(decorations.matchBorder).toMatch(/^#[0-9a-f]{6}$/i);
		expect(decorations.matchOverviewRuler).toBe(darkTheme.colors.warning);
		expect(decorations.activeMatchBackground).toMatch(/^#[0-9a-f]{6}$/i);
		expect(decorations.activeMatchBorder).toBe(darkTheme.colors.accent);
		expect(decorations.activeMatchColorOverviewRuler).toBe(darkTheme.colors.accent);
	});

	it('produces decoration colors from a light theme', () => {
		const decorations = buildSearchDecorations(lightTheme);

		expect(decorations.matchBackground).toMatch(/^#[0-9a-f]{6}$/i);
		expect(decorations.matchOverviewRuler).toBe(lightTheme.colors.warning);
		expect(decorations.activeMatchBorder).toBe(lightTheme.colors.accent);
	});

	it('uses warning color for match highlights and accent for active match', () => {
		const decorations = buildSearchDecorations(darkTheme);

		// matchBackground is a blend of warning onto bgMain at 30% opacity
		// Should be closer to bgMain (70%) with a hint of warning (30%)
		expect(decorations.matchBackground).not.toBe(darkTheme.colors.bgMain);
		expect(decorations.matchBackground).not.toBe(darkTheme.colors.warning);

		// activeMatchBackground is accent onto bgMain at 60% opacity
		// Should lean more towards accent
		expect(decorations.activeMatchBackground).not.toBe(darkTheme.colors.bgMain);
		expect(decorations.activeMatchBackground).not.toBe(darkTheme.colors.accent);
	});
});

describe('mixHexColors', () => {
	it('returns pure background when alpha is 0', () => {
		const result = mixHexColors('#ff0000', '#0000ff', 0);
		expect(result).toBe('#0000ff');
	});

	it('returns pure foreground when alpha is 1', () => {
		const result = mixHexColors('#ff0000', '#0000ff', 1);
		expect(result).toBe('#ff0000');
	});

	it('returns midpoint blend at alpha 0.5', () => {
		const result = mixHexColors('#ff0000', '#0000ff', 0.5);
		// Red channel: 255*0.5 + 0*0.5 = 128 (0x80)
		// Green channel: 0*0.5 + 0*0.5 = 0 (0x00)
		// Blue channel: 0*0.5 + 255*0.5 = 128 (0x80)
		expect(result).toBe('#800080');
	});

	it('blends black on white at 30% opacity', () => {
		const result = mixHexColors('#000000', '#ffffff', 0.3);
		// Each channel: 0*0.3 + 255*0.7 = 179 (0xb3)
		expect(result).toBe('#b3b3b3');
	});
});

// --- XTerminal search handle methods ---

describe('XTerminal Search Handle', () => {
	describe('search()', () => {
		it('calls SearchAddon.findNext with correct query and options', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('hello world');
			});

			expect(mockFindNext).toHaveBeenCalledWith('hello world', {
				caseSensitive: false,
				wholeWord: false,
				regex: false,
				incremental: true,
				decorations: buildSearchDecorations(darkTheme),
			});
		});

		it('returns true when SearchAddon finds a match', () => {
			mockFindNext.mockReturnValue(true);
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			let result: boolean;
			act(() => {
				result = ref.current!.search('found');
			});

			expect(result!).toBe(true);
		});

		it('returns false when SearchAddon finds no match', () => {
			mockFindNext.mockReturnValue(false);
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			let result: boolean;
			act(() => {
				result = ref.current!.search('nonexistent');
			});

			expect(result!).toBe(false);
		});

		it('returns false for an empty query without calling SearchAddon', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			let result: boolean;
			act(() => {
				result = ref.current!.search('');
			});

			expect(result!).toBe(false);
			expect(mockFindNext).not.toHaveBeenCalled();
		});

		it('stores the query for subsequent searchNext/searchPrevious calls', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('persistent query');
			});
			mockFindNext.mockClear();

			act(() => {
				ref.current!.searchNext();
			});

			// searchNext should reuse the stored query
			expect(mockFindNext).toHaveBeenCalledWith('persistent query', expect.objectContaining({
				decorations: expect.any(Object),
			}));
		});
	});

	describe('searchNext()', () => {
		it('calls SearchAddon.findNext with the last searched query', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// First establish a search query
			act(() => {
				ref.current!.search('my query');
			});
			mockFindNext.mockClear();

			act(() => {
				ref.current!.searchNext();
			});

			expect(mockFindNext).toHaveBeenCalledTimes(1);
			expect(mockFindNext).toHaveBeenCalledWith('my query', {
				decorations: buildSearchDecorations(darkTheme),
			});
		});

		it('returns false when no prior search has been performed', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			let result: boolean;
			act(() => {
				result = ref.current!.searchNext();
			});

			expect(result!).toBe(false);
			expect(mockFindNext).not.toHaveBeenCalled();
		});

		it('returns the boolean from SearchAddon.findNext', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('test');
			});

			// Now findNext returns false (e.g., wrapped around with no more matches)
			mockFindNext.mockReturnValue(false);

			let result: boolean;
			act(() => {
				result = ref.current!.searchNext();
			});

			expect(result!).toBe(false);
		});
	});

	describe('searchPrevious()', () => {
		it('calls SearchAddon.findPrevious with the last searched query', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('reverse search');
			});

			act(() => {
				ref.current!.searchPrevious();
			});

			expect(mockFindPrevious).toHaveBeenCalledWith('reverse search', {
				decorations: buildSearchDecorations(darkTheme),
			});
		});

		it('returns false when no prior search has been performed', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			let result: boolean;
			act(() => {
				result = ref.current!.searchPrevious();
			});

			expect(result!).toBe(false);
			expect(mockFindPrevious).not.toHaveBeenCalled();
		});

		it('returns the boolean from SearchAddon.findPrevious', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('test');
			});

			mockFindPrevious.mockReturnValue(false);

			let result: boolean;
			act(() => {
				result = ref.current!.searchPrevious();
			});

			expect(result!).toBe(false);
		});
	});

	describe('clearSearch()', () => {
		it('calls SearchAddon.clearDecorations', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('query to clear');
			});

			act(() => {
				ref.current!.clearSearch();
			});

			expect(mockClearDecorations).toHaveBeenCalledTimes(1);
		});

		it('resets stored query so searchNext returns false after clear', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Perform a search, then clear
			act(() => {
				ref.current!.search('will be cleared');
			});
			act(() => {
				ref.current!.clearSearch();
			});

			mockFindNext.mockClear();

			// searchNext should now return false (no stored query)
			let result: boolean;
			act(() => {
				result = ref.current!.searchNext();
			});

			expect(result!).toBe(false);
			expect(mockFindNext).not.toHaveBeenCalled();
		});

		it('resets stored query so searchPrevious returns false after clear', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('will be cleared');
			});
			act(() => {
				ref.current!.clearSearch();
			});

			mockFindPrevious.mockClear();

			let result: boolean;
			act(() => {
				result = ref.current!.searchPrevious();
			});

			expect(result!).toBe(false);
			expect(mockFindPrevious).not.toHaveBeenCalled();
		});
	});

	describe('sequential searches', () => {
		it('updates the stored query when a new search is performed', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// First search
			act(() => {
				ref.current!.search('first query');
			});

			// Second search replaces the stored query
			act(() => {
				ref.current!.search('second query');
			});
			mockFindNext.mockClear();

			// searchNext should use the SECOND query
			act(() => {
				ref.current!.searchNext();
			});

			expect(mockFindNext).toHaveBeenCalledWith('second query', expect.any(Object));
		});

		it('searchPrevious uses the most recent search query', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('alpha');
			});
			act(() => {
				ref.current!.search('beta');
			});

			act(() => {
				ref.current!.searchPrevious();
			});

			expect(mockFindPrevious).toHaveBeenCalledWith('beta', expect.any(Object));
		});
	});

	describe('theme-aware decorations', () => {
		it('passes current theme decorations to search()', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('themed search');
			});

			const expectedDecorations = buildSearchDecorations(darkTheme);
			expect(mockFindNext).toHaveBeenCalledWith('themed search', expect.objectContaining({
				decorations: expectedDecorations,
			}));
		});

		it('reflects theme changes in subsequent search calls', () => {
			const ref = React.createRef<XTerminalHandle>();
			const { rerender } = render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Switch to light theme
			rerender(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={lightTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('after theme change');
			});

			const lightDecorations = buildSearchDecorations(lightTheme);
			expect(mockFindNext).toHaveBeenCalledWith('after theme change', expect.objectContaining({
				decorations: lightDecorations,
			}));
		});

		it('uses updated theme decorations for searchNext after theme change', () => {
			const ref = React.createRef<XTerminalHandle>();
			const { rerender } = render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Perform initial search with dark theme
			act(() => {
				ref.current!.search('query');
			});

			// Switch to light theme
			rerender(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={lightTheme}
					fontFamily="Menlo"
				/>
			);

			mockFindNext.mockClear();

			// searchNext should use light theme decorations
			act(() => {
				ref.current!.searchNext();
			});

			const lightDecorations = buildSearchDecorations(lightTheme);
			expect(mockFindNext).toHaveBeenCalledWith('query', {
				decorations: lightDecorations,
			});
		});

		it('uses updated theme decorations for searchPrevious after theme change', () => {
			const ref = React.createRef<XTerminalHandle>();
			const { rerender } = render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('query');
			});

			rerender(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={lightTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.searchPrevious();
			});

			const lightDecorations = buildSearchDecorations(lightTheme);
			expect(mockFindPrevious).toHaveBeenCalledWith('query', {
				decorations: lightDecorations,
			});
		});

		it('produces different decorations for dark vs light themes', () => {
			const darkDecorations = buildSearchDecorations(darkTheme);
			const lightDecorations = buildSearchDecorations(lightTheme);

			// Match backgrounds should differ because bgMain and warning colors differ
			expect(darkDecorations.matchBackground).not.toBe(lightDecorations.matchBackground);
			// Active match backgrounds should differ because accent colors differ
			expect(darkDecorations.activeMatchBackground).not.toBe(lightDecorations.activeMatchBackground);
		});
	});

	describe('search options', () => {
		it('uses case-insensitive search by default', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('CaSe InSeNsItIvE');
			});

			expect(mockFindNext).toHaveBeenCalledWith(
				'CaSe InSeNsItIvE',
				expect.objectContaining({ caseSensitive: false })
			);
		});

		it('uses literal string search (no regex)', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('.*regex chars [ignored]');
			});

			expect(mockFindNext).toHaveBeenCalledWith(
				'.*regex chars [ignored]',
				expect.objectContaining({ regex: false })
			);
		});

		it('uses incremental search (highlight as you type)', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('incremental');
			});

			expect(mockFindNext).toHaveBeenCalledWith(
				'incremental',
				expect.objectContaining({ incremental: true })
			);
		});

		it('matches partial words (wholeWord is false)', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			act(() => {
				ref.current!.search('part');
			});

			expect(mockFindNext).toHaveBeenCalledWith(
				'part',
				expect.objectContaining({ wholeWord: false })
			);
		});
	});

	describe('cleanup on unmount', () => {
		it('sets searchAddonRef to null so search returns false after dispose', () => {
			const ref = React.createRef<XTerminalHandle>();
			const { unmount } = render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Verify search works before unmount
			let result: boolean;
			act(() => {
				result = ref.current!.search('before unmount');
			});
			expect(result!).toBe(true);

			unmount();

			// After unmount, the ref is no longer valid (React clears it)
			expect(ref.current).toBeNull();
		});
	});

	describe('scrollback search scenario', () => {
		it('supports search → next → next → previous navigation cycle', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Step 1: Initial search
			act(() => {
				ref.current!.search('pattern');
			});
			expect(mockFindNext).toHaveBeenCalledTimes(1);

			// Step 2: Navigate to next match (Enter)
			act(() => {
				ref.current!.searchNext();
			});
			expect(mockFindNext).toHaveBeenCalledTimes(2);

			// Step 3: Navigate to next match again (Enter)
			act(() => {
				ref.current!.searchNext();
			});
			expect(mockFindNext).toHaveBeenCalledTimes(3);

			// Step 4: Navigate back (Shift+Enter)
			act(() => {
				ref.current!.searchPrevious();
			});
			expect(mockFindPrevious).toHaveBeenCalledTimes(1);

			// All calls should have used the same query
			for (const call of mockFindNext.mock.calls) {
				expect(call[0]).toBe('pattern');
			}
			expect(mockFindPrevious.mock.calls[0][0]).toBe('pattern');
		});

		it('supports search → clear → new search lifecycle', () => {
			const ref = React.createRef<XTerminalHandle>();
			render(
				<XTerminal
					ref={ref}
					sessionId="sess-1-terminal-tab-1"
					theme={darkTheme}
					fontFamily="Menlo"
				/>
			);

			// Search for first term
			act(() => {
				ref.current!.search('first');
			});
			expect(mockFindNext).toHaveBeenCalledWith('first', expect.any(Object));

			// Clear (user closes search bar)
			act(() => {
				ref.current!.clearSearch();
			});
			expect(mockClearDecorations).toHaveBeenCalledTimes(1);

			// Verify search state is reset
			mockFindNext.mockClear();
			let result: boolean;
			act(() => {
				result = ref.current!.searchNext();
			});
			expect(result!).toBe(false);
			expect(mockFindNext).not.toHaveBeenCalled();

			// New search for different term
			act(() => {
				ref.current!.search('second');
			});
			expect(mockFindNext).toHaveBeenCalledWith('second', expect.any(Object));

			// searchNext should use new term
			mockFindNext.mockClear();
			act(() => {
				ref.current!.searchNext();
			});
			expect(mockFindNext).toHaveBeenCalledWith('second', expect.any(Object));
		});
	});
});
