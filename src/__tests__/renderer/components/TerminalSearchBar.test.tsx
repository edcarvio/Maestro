/**
 * @file TerminalSearchBar.test.tsx
 * @description Tests for TerminalSearchBar component
 *
 * Verifies the search bar UI drives EmbeddedTerminalHandle imperative methods
 * correctly: incremental search, next/previous navigation, close behavior,
 * and keyboard shortcuts (Enter, Shift+Enter, ArrowUp/Down, Escape).
 */

import React, { createRef } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';
import type { EmbeddedTerminalHandle } from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

// Mock layer stack context
const mockRegisterLayer = vi.fn(() => 'layer-1');
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

import { TerminalSearchBar } from '../../../renderer/components/EmbeddedTerminal/TerminalSearchBar';

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

function createMockTerminalHandle(): EmbeddedTerminalHandle {
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
	};
}

describe('TerminalSearchBar', () => {
	let mockHandle: EmbeddedTerminalHandle;
	let terminalRef: { current: EmbeddedTerminalHandle | null };
	let onClose: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockHandle = createMockTerminalHandle();
		terminalRef = { current: mockHandle };
		onClose = vi.fn();
	});

	it('renders search input, prev/next/close buttons', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input');
		expect(input).toBeTruthy();
		expect(input!.placeholder).toBe('Search...');

		const buttons = container.querySelectorAll('button');
		expect(buttons.length).toBe(3); // prev, next, close
	});

	it('auto-focuses the search input on mount', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input');
		expect(document.activeElement).toBe(input);
	});

	it('performs incremental search on typing', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const input = container.querySelector('input')!;
		fireEvent.change(input, { target: { value: 'hello' } });

		expect(mockHandle.search).toHaveBeenCalledWith('hello');
	});

	it('clears search decorations when input is emptied', () => {
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

		expect(mockHandle.searchNext).toHaveBeenCalled();
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

		expect(mockHandle.searchPrevious).toHaveBeenCalled();
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

		expect(mockHandle.searchNext).toHaveBeenCalled();
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

		expect(mockHandle.searchPrevious).toHaveBeenCalled();
	});

	it('clicking previous button calls searchPrevious', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');
		// First button is previous (ChevronUp)
		fireEvent.click(buttons[0]);

		expect(mockHandle.searchPrevious).toHaveBeenCalled();
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
		// Second button is next (ChevronDown)
		fireEvent.click(buttons[1]);

		expect(mockHandle.searchNext).toHaveBeenCalled();
	});

	it('clicking close button clears search and calls onClose', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const buttons = container.querySelectorAll('button');
		// Third button is close (X)
		fireEvent.click(buttons[2]);

		expect(mockHandle.clearSearch).toHaveBeenCalled();
		expect(mockHandle.focus).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('registers with layer stack on mount', () => {
		render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		expect(mockRegisterLayer).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'overlay',
				priority: 55,
				ariaLabel: 'Terminal Search',
			})
		);
	});

	it('unregisters from layer stack on unmount', () => {
		const { unmount } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		unmount();

		expect(mockUnregisterLayer).toHaveBeenCalledWith('layer-1');
	});

	it('applies theme colors to the search bar', () => {
		const { container } = render(
			<TerminalSearchBar
				terminalRef={terminalRef as React.RefObject<EmbeddedTerminalHandle | null>}
				theme={defaultTheme}
				onClose={onClose}
			/>
		);

		const wrapper = container.firstChild as HTMLElement;
		// jsdom converts hex to rgb, so check that styles are set (not empty)
		expect(wrapper.style.backgroundColor).toBeTruthy();
		expect(wrapper.style.borderColor).toBeTruthy();
	});
});
