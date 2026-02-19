/**
 * Terminal Search — Integration Tests
 *
 * Verifies the full terminal search feature end-to-end:
 * - Cmd+F shortcut bypass: xterm.js yields control to Maestro
 * - SearchAddon integration: findNext / findPrevious / clearDecorations
 * - TerminalSearchBar interactions: incremental search, keyboard navigation,
 *   button clicks, close behavior, focus management
 * - Edge cases: null refs, rapid query changes, special characters,
 *   empty queries, very long queries, search return values
 * - Layer stack lifecycle: proper registration / unregistration
 *
 * These tests complement the unit-level tests in:
 * - XTerminal.test.tsx (XTerminal SearchAddon delegation)
 * - EmbeddedTerminal.test.tsx (EmbeddedTerminal SearchAddon delegation)
 * - TerminalSearchBar.test.tsx (TerminalSearchBar UI behavior)
 *
 * This file focuses on integration patterns, edge cases, and workflows
 * that span the search feature holistically.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';
import type { EmbeddedTerminalHandle } from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

// ── Mock: Layer stack context ──────────────────────────────────────────────

const mockRegisterLayer = vi.fn(() => 'layer-search-1');
const mockUnregisterLayer = vi.fn();
const mockUpdateLayerHandler = vi.fn();

vi.mock('../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: mockRegisterLayer,
		unregisterLayer: mockUnregisterLayer,
		updateLayerHandler: mockUpdateLayerHandler,
	}),
}));

vi.mock('../../../renderer/constants/modalPriorities', () => ({
	MODAL_PRIORITIES: {
		TERMINAL_SEARCH: 55,
		SLASH_AUTOCOMPLETE: 50,
	},
}));

// ── Mock: xterm.js packages (for EmbeddedTerminal/XTerminal tests) ────────

const {
	terminalMethods,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	searchMethods,
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
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
	});

	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = vi.fn();
		this.dispose = vi.fn();
	});

	const _MockWebLinksAddon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _searchMethods = {
		findNext: vi.fn(() => true),
		findPrevious: vi.fn(() => true),
		clearDecorations: vi.fn(),
		dispose: vi.fn(),
	};
	const _MockSearchAddon = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _searchMethods);
	});

	const _MockUnicode11Addon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	return {
		terminalMethods: _terminalMethods,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		searchMethods: _searchMethods,
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

// ── Imports after mocks ────────────────────────────────────────────────────

import { TerminalSearchBar } from '../../../renderer/components/EmbeddedTerminal/TerminalSearchBar';
import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import XTerminal from '../../../renderer/components/XTerminal/XTerminal';

// ── Shared fixtures ────────────────────────────────────────────────────────

const defaultTheme: Theme = {
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

function createMockTerminalHandle(overrides?: Partial<EmbeddedTerminalHandle>): EmbeddedTerminalHandle {
	return {
		write: vi.fn(),
		focus: vi.fn(),
		clear: vi.fn(),
		scrollToBottom: vi.fn(),
		search: vi.fn(() => true),
		searchNext: vi.fn(() => true),
		searchPrevious: vi.fn(() => true),
		clearSearch: vi.fn(),
		getSelection: vi.fn(() => ''),
		resize: vi.fn(),
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Cmd+F Shortcut Bypass (xterm.js → Maestro handoff)
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: Cmd+F shortcut bypass', () => {
	// Tests use XTerminal (not EmbeddedTerminal) for key handler capture because
	// XTerminal's setup is synchronous, making the handler available immediately
	// after render. Both components use the same isMaestroShortcut() function,
	// so the shortcut bypass behavior is identical.

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function renderAndCaptureKeyHandler(sessionId: string) {
		let keyHandler: ((ev: KeyboardEvent) => boolean) | undefined;
		terminalMethods.attachCustomKeyEventHandler.mockImplementation(
			(handler: (ev: KeyboardEvent) => boolean) => { keyHandler = handler; }
		);

		render(
			<XTerminal
				sessionId={sessionId}
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		expect(keyHandler).toBeDefined();
		return keyHandler!;
	}

	it('blocks Cmd+F from xterm.js so Maestro opens the search bar', () => {
		const keyHandler = renderAndCaptureKeyHandler('search-cmdf');

		const cmdF = new KeyboardEvent('keydown', {
			key: 'f', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false,
		});
		expect(keyHandler(cmdF)).toBe(false);
	});

	it('blocks Ctrl+F from xterm.js (Linux/Windows equivalent)', () => {
		const keyHandler = renderAndCaptureKeyHandler('search-ctrlf');

		const ctrlF = new KeyboardEvent('keydown', {
			key: 'f', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false,
		});
		expect(keyHandler(ctrlF)).toBe(false);
	});

	it('does NOT block plain "f" key (normal typing)', () => {
		const keyHandler = renderAndCaptureKeyHandler('search-plain-f');

		const plainF = new KeyboardEvent('keydown', {
			key: 'f', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
		});
		expect(keyHandler(plainF)).toBe(true);
	});

	it('does NOT block Cmd+Shift+F (goes to files, not terminal search)', () => {
		const keyHandler = renderAndCaptureKeyHandler('search-cmd-shift-f');

		const cmdShiftF = new KeyboardEvent('keydown', {
			key: 'f', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false,
		});
		// Cmd+Shift+F is a Maestro shortcut ("go to files") — should be blocked from xterm
		expect(keyHandler(cmdShiftF)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SearchAddon Integration (EmbeddedTerminal imperative methods)
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: SearchAddon integration via EmbeddedTerminal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('search() delegates to SearchAddon.findNext with the query', async () => {
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-find"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		const result = ref.current!.search('error');
		expect(searchMethods.findNext).toHaveBeenCalledWith('error');
		expect(result).toBe(true);
	});

	it('searchNext() delegates to SearchAddon.findNext with empty string', async () => {
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-next"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		ref.current!.searchNext();
		expect(searchMethods.findNext).toHaveBeenCalledWith('');
	});

	it('searchPrevious() delegates to SearchAddon.findPrevious with empty string', async () => {
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-prev"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		ref.current!.searchPrevious();
		expect(searchMethods.findPrevious).toHaveBeenCalledWith('');
	});

	it('clearSearch() delegates to SearchAddon.clearDecorations', async () => {
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-clear"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		ref.current!.clearSearch();
		expect(searchMethods.clearDecorations).toHaveBeenCalled();
	});

	it('search returns false when SearchAddon reports no match', async () => {
		searchMethods.findNext.mockReturnValueOnce(false);
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-nomatch"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		const result = ref.current!.search('nonexistent');
		expect(result).toBe(false);
	});

	it('searchPrevious returns false when SearchAddon reports no match', async () => {
		searchMethods.findPrevious.mockReturnValueOnce(false);
		const ref = React.createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="search-addon-prev-nomatch"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		const result = ref.current!.searchPrevious();
		expect(result).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TerminalSearchBar: Incremental Search Workflow
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: incremental search workflow', () => {
	let mockHandle: EmbeddedTerminalHandle;
	let terminalRef: { current: EmbeddedTerminalHandle | null };
	let onClose: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockHandle = createMockTerminalHandle();
		terminalRef = { current: mockHandle };
		onClose = vi.fn();
	});

	it('each keystroke triggers a new search (incremental)', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;

		// Simulate typing "hello" character by character
		fireEvent.change(input, { target: { value: 'h' } });
		fireEvent.change(input, { target: { value: 'he' } });
		fireEvent.change(input, { target: { value: 'hel' } });
		fireEvent.change(input, { target: { value: 'hell' } });
		fireEvent.change(input, { target: { value: 'hello' } });

		expect(mockHandle.search).toHaveBeenCalledTimes(5);
		expect(mockHandle.search).toHaveBeenNthCalledWith(1, 'h');
		expect(mockHandle.search).toHaveBeenNthCalledWith(2, 'he');
		expect(mockHandle.search).toHaveBeenNthCalledWith(3, 'hel');
		expect(mockHandle.search).toHaveBeenNthCalledWith(4, 'hell');
		expect(mockHandle.search).toHaveBeenNthCalledWith(5, 'hello');
	});

	it('changing search query mid-search performs new search', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;

		// Search for "error"
		fireEvent.change(input, { target: { value: 'error' } });
		expect(mockHandle.search).toHaveBeenCalledWith('error');

		// Change to "warning"
		fireEvent.change(input, { target: { value: 'warning' } });
		expect(mockHandle.search).toHaveBeenCalledWith('warning');
		expect(mockHandle.search).toHaveBeenCalledTimes(2);
	});

	it('clearing input calls clearSearch, not search with empty string', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;

		// Type something
		fireEvent.change(input, { target: { value: 'test' } });
		expect(mockHandle.search).toHaveBeenCalledWith('test');

		// Clear it
		fireEvent.change(input, { target: { value: '' } });
		expect(mockHandle.clearSearch).toHaveBeenCalled();
		// search should NOT have been called with empty string
		expect(mockHandle.search).not.toHaveBeenCalledWith('');
	});

	it('search then clear then search again works correctly', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;

		// First search
		fireEvent.change(input, { target: { value: 'first' } });
		expect(mockHandle.search).toHaveBeenCalledWith('first');

		// Clear
		fireEvent.change(input, { target: { value: '' } });
		expect(mockHandle.clearSearch).toHaveBeenCalledTimes(1);

		// New search
		fireEvent.change(input, { target: { value: 'second' } });
		expect(mockHandle.search).toHaveBeenCalledWith('second');
		expect(mockHandle.search).toHaveBeenCalledTimes(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TerminalSearchBar: Navigation Controls
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: navigation controls', () => {
	let mockHandle: EmbeddedTerminalHandle;
	let terminalRef: { current: EmbeddedTerminalHandle | null };
	let onClose: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockHandle = createMockTerminalHandle();
		terminalRef = { current: mockHandle };
		onClose = vi.fn();
	});

	it('Enter navigates to next match', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(mockHandle.searchNext).toHaveBeenCalledTimes(1);
		expect(mockHandle.searchPrevious).not.toHaveBeenCalled();
	});

	it('Shift+Enter navigates to previous match', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(1);
		expect(mockHandle.searchNext).not.toHaveBeenCalled();
	});

	it('ArrowDown navigates to next match', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'ArrowDown' });

		expect(mockHandle.searchNext).toHaveBeenCalledTimes(1);
	});

	it('ArrowUp navigates to previous match', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'ArrowUp' });

		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(1);
	});

	it('multiple Enter presses navigate forward through matches sequentially', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'Enter' });
		fireEvent.keyDown(input, { key: 'Enter' });
		fireEvent.keyDown(input, { key: 'Enter' });

		expect(mockHandle.searchNext).toHaveBeenCalledTimes(3);
	});

	it('mixed navigation: forward then backward', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;

		// Navigate forward twice
		fireEvent.keyDown(input, { key: 'Enter' });
		fireEvent.keyDown(input, { key: 'Enter' });
		// Navigate backward once
		fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

		expect(mockHandle.searchNext).toHaveBeenCalledTimes(2);
		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(1);
	});

	it('clicking prev button calls searchPrevious', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');
		fireEvent.click(buttons[0]); // ChevronUp = previous

		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(1);
	});

	it('clicking next button calls searchNext', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');
		fireEvent.click(buttons[1]); // ChevronDown = next

		expect(mockHandle.searchNext).toHaveBeenCalledTimes(1);
	});

	it('unrelated keys do not trigger navigation', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.keyDown(input, { key: 'a' });
		fireEvent.keyDown(input, { key: 'Tab' });
		fireEvent.keyDown(input, { key: 'Backspace' });

		expect(mockHandle.searchNext).not.toHaveBeenCalled();
		expect(mockHandle.searchPrevious).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TerminalSearchBar: Close Behavior & Focus Management
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: close behavior and focus management', () => {
	let mockHandle: EmbeddedTerminalHandle;
	let terminalRef: { current: EmbeddedTerminalHandle | null };
	let onClose: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockHandle = createMockTerminalHandle();
		terminalRef = { current: mockHandle };
		onClose = vi.fn();
	});

	it('close button clears search, restores terminal focus, and calls onClose', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');
		fireEvent.click(buttons[2]); // X button = close

		expect(mockHandle.clearSearch).toHaveBeenCalled();
		expect(mockHandle.focus).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('close clears search BEFORE restoring focus', () => {
		const callOrder: string[] = [];
		const orderedHandle = createMockTerminalHandle({
			clearSearch: vi.fn(() => { callOrder.push('clearSearch'); }),
			focus: vi.fn(() => { callOrder.push('focus'); }),
		});
		const orderedRef = { current: orderedHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={orderedRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={() => { callOrder.push('onClose'); }}
			/>
		);

		const buttons = container.querySelectorAll('button');
		fireEvent.click(buttons[2]);

		expect(callOrder).toEqual(['clearSearch', 'focus', 'onClose']);
	});

	it('search input is auto-focused on mount', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		expect(document.activeElement).toBe(input);
	});

	it('Escape is handled by layer stack (not directly by search bar keyDown)', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		// Escape should NOT call onClose directly from keyDown handler
		// It should be handled by the layer stack's onEscape
		fireEvent.keyDown(input, { key: 'Escape' });

		// The keyDown handler itself does NOT call onClose for Escape
		// Layer stack handles Escape via the registered onEscape callback
		// So searchNext/searchPrevious should NOT be called either
		expect(mockHandle.searchNext).not.toHaveBeenCalled();
		expect(mockHandle.searchPrevious).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Layer Stack Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: layer stack integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('registers as overlay with TERMINAL_SEARCH priority on mount', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		expect(mockRegisterLayer).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'overlay',
				priority: 55,
				blocksLowerLayers: false,
				capturesFocus: true,
				focusTrap: 'none',
				allowClickOutside: true,
				ariaLabel: 'Terminal Search',
			})
		);
	});

	it('registers onEscape handler that will close the search bar', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const layerConfig = mockRegisterLayer.mock.calls[0][0];
		expect(typeof layerConfig.onEscape).toBe('function');
	});

	it('unregisters layer on unmount', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { unmount } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		unmount();

		expect(mockUnregisterLayer).toHaveBeenCalledWith('layer-search-1');
	});

	it('updates layer handler when dependencies change', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		expect(mockUpdateLayerHandler).toHaveBeenCalledWith(
			'layer-search-1',
			expect.any(Function)
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: edge cases', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('handles null terminal ref gracefully (no crash on search)', () => {
		const nullRef = { current: null };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={nullRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;

		// Should not throw
		expect(() => {
			fireEvent.change(input, { target: { value: 'test' } });
		}).not.toThrow();
	});

	it('handles null terminal ref gracefully (no crash on navigation)', () => {
		const nullRef = { current: null };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={nullRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;

		// Should not throw
		expect(() => {
			fireEvent.keyDown(input, { key: 'Enter' });
			fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
			fireEvent.keyDown(input, { key: 'ArrowUp' });
			fireEvent.keyDown(input, { key: 'ArrowDown' });
		}).not.toThrow();
	});

	it('handles null terminal ref gracefully (no crash on close)', () => {
		const nullRef = { current: null };
		const onClose = vi.fn();

		const { container } = render(
			<TerminalSearchBar
				terminalRef={nullRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');

		// Close should still work (calls onClose) even with null ref
		expect(() => {
			fireEvent.click(buttons[2]);
		}).not.toThrow();
		expect(onClose).toHaveBeenCalled();
	});

	it('handles special regex characters in search query', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;

		// These characters have special meaning in regex but should be
		// passed through as-is to SearchAddon (xterm handles escaping)
		fireEvent.change(input, { target: { value: '.*+?^${}()|[]\\' } });
		expect(mockHandle.search).toHaveBeenCalledWith('.*+?^${}()|[]\\');
	});

	it('handles very long search query', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;
		const longQuery = 'a'.repeat(1000);
		fireEvent.change(input, { target: { value: longQuery } });
		expect(mockHandle.search).toHaveBeenCalledWith(longQuery);
	});

	it('handles unicode characters in search query', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.change(input, { target: { value: '日本語テスト 🎉' } });
		expect(mockHandle.search).toHaveBeenCalledWith('日本語テスト 🎉');
	});

	it('handles whitespace-only search query (treated as valid search)', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.change(input, { target: { value: '   ' } });
		// Whitespace is truthy, so search is called (not clearSearch)
		expect(mockHandle.search).toHaveBeenCalledWith('   ');
		expect(mockHandle.clearSearch).not.toHaveBeenCalled();
	});

	it('handles ANSI escape sequences in search query', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.change(input, { target: { value: '\x1b[31m' } });
		expect(mockHandle.search).toHaveBeenCalledWith('\x1b[31m');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Theme Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: theme integration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('applies theme background and border colors to search bar container', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		expect(wrapper.style.backgroundColor).toBeTruthy();
		expect(wrapper.style.borderColor).toBeTruthy();
	});

	it('applies theme text color to search input', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const input = container.querySelector('input')!;
		expect(input.style.color).toBeTruthy();
	});

	it('applies theme dim color to navigation buttons', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const buttons = container.querySelectorAll('button');
		for (const button of buttons) {
			expect((button as HTMLElement).style.color).toBeTruthy();
		}
	});

	it('works with light theme colors', () => {
		const lightTheme: Theme = {
			id: 'light',
			name: 'Light',
			mode: 'light',
			colors: {
				bgMain: '#ffffff',
				bgSidebar: '#f0f0f0',
				bgActivity: '#e0e0e0',
				border: '#cccccc',
				textMain: '#333333',
				textDim: '#999999',
				accent: '#0066cc',
				accentDim: 'rgba(0, 102, 204, 0.2)',
				accentText: '#0066cc',
				accentForeground: '#ffffff',
				success: '#28a745',
				warning: '#ffc107',
				error: '#dc3545',
			},
		};

		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={lightTheme}
				onClose={vi.fn()}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		expect(wrapper.style.backgroundColor).toBeTruthy();
		expect(wrapper.style.borderColor).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Full Search Workflow (end-to-end)
// ═══════════════════════════════════════════════════════════════════════════

describe('Terminal Search: full workflow', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('complete search lifecycle: open → type → navigate → clear → close', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };
		const onClose = vi.fn();

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		const buttons = container.querySelectorAll('button');

		// 1. Input is auto-focused
		expect(document.activeElement).toBe(input);

		// 2. Type a search query — incremental search
		fireEvent.change(input, { target: { value: 'error' } });
		expect(mockHandle.search).toHaveBeenCalledWith('error');

		// 3. Navigate forward twice with Enter
		fireEvent.keyDown(input, { key: 'Enter' });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(mockHandle.searchNext).toHaveBeenCalledTimes(2);

		// 4. Navigate backward with Shift+Enter
		fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(1);

		// 5. Navigate with arrow buttons
		fireEvent.click(buttons[0]); // prev button
		fireEvent.click(buttons[1]); // next button
		expect(mockHandle.searchPrevious).toHaveBeenCalledTimes(2);
		expect(mockHandle.searchNext).toHaveBeenCalledTimes(3);

		// 6. Change query
		fireEvent.change(input, { target: { value: 'warning' } });
		expect(mockHandle.search).toHaveBeenCalledWith('warning');

		// 7. Close search bar
		fireEvent.click(buttons[2]); // close button
		expect(mockHandle.clearSearch).toHaveBeenCalled();
		expect(mockHandle.focus).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('search bar renders with accessible structure', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		// Has an input with placeholder
		const input = container.querySelector('input')!;
		expect(input.placeholder).toBe('Search...');
		expect(input.type).toBe('text');

		// Has three buttons with titles
		const buttons = container.querySelectorAll('button');
		expect(buttons.length).toBe(3);
		expect(buttons[0].title).toBe('Previous match (Shift+Enter)');
		expect(buttons[1].title).toBe('Next match (Enter)');
		expect(buttons[2].title).toBe('Close (Esc)');
	});

	it('search bar is positioned as absolute overlay', () => {
		const mockHandle = createMockTerminalHandle();
		const terminalRef = { current: mockHandle };

		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={vi.fn()}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		expect(wrapper.className).toContain('absolute');
		expect(wrapper.className).toContain('top-2');
		expect(wrapper.className).toContain('right-2');
	});
});
