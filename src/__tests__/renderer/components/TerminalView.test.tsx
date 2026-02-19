/**
 * @file TerminalView.test.tsx
 * @description Tests for TerminalView component — the composite terminal
 * mode view that renders TerminalTabBar + EmbeddedTerminal instances.
 *
 * EmbeddedTerminal is mocked since it depends on xterm.js (requires real DOM).
 * Tests focus on:
 * - Tab bar rendering and interactions
 * - Terminal pane visibility (only active tab shown)
 * - Empty state
 * - Callback wiring
 * - Keyboard shortcut (Cmd+F for search)
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';
import type { Session, TerminalTab } from '../../../renderer/types';

// --- Mock EmbeddedTerminal (xterm.js dependency) ---

vi.mock('../../../renderer/components/EmbeddedTerminal', () => ({
	EmbeddedTerminal: React.forwardRef(function MockEmbeddedTerminal(
		props: { terminalTabId: string; isVisible: boolean; cwd: string },
		ref: React.Ref<unknown>
	) {
		React.useImperativeHandle(ref, () => ({
			write: vi.fn(),
			focus: vi.fn(),
			clear: vi.fn(),
			scrollToBottom: vi.fn(),
			search: vi.fn(() => false),
			searchNext: vi.fn(() => false),
			searchPrevious: vi.fn(() => false),
			clearSearch: vi.fn(),
			getSelection: vi.fn(() => ''),
			resize: vi.fn(),
		}));
		return (
			<div
				data-testid={`embedded-terminal-${props.terminalTabId}`}
				data-visible={String(props.isVisible)}
				data-cwd={props.cwd}
			>
				Mock Terminal {props.terminalTabId}
			</div>
		);
	}),
	TerminalSearchBar: function MockTerminalSearchBar(props: { onClose: () => void }) {
		return (
			<div data-testid="terminal-search-bar">
				<button onClick={props.onClose} data-testid="terminal-search-close">
					Close
				</button>
			</div>
		);
	},
}));

// --- Mock LayerStackContext (used by TerminalSearchBar) ---

vi.mock('../../../renderer/contexts/LayerStackContext', () => ({
	useLayerStack: () => ({
		registerLayer: vi.fn(),
		unregisterLayer: vi.fn(),
	}),
}));

// --- Import after mocks ---

import { TerminalView } from '../../../renderer/components/TerminalView';

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

function createTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'tab-1',
		name: null,
		createdAt: Date.now(),
		cwd: '/home/user',
		...overrides,
	};
}

function createSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		name: 'Test Agent',
		cwd: '/home/user',
		fullPath: '/home/user',
		projectRoot: '/home/user',
		inputMode: 'terminal',
		toolType: 'claude-code',
		state: 'idle',
		aiPid: 0,
		terminalPid: 0,
		isGitRepo: false,
		aiLogs: [],
		shellLogs: [],
		fileTree: [],
		fileExplorerExpanded: [],
		messageQueue: [],
		aiTabs: [],
		activeTabId: '',
		terminalTabs: [createTerminalTab()],
		activeTerminalTabId: 'tab-1',
		...overrides,
	} as Session;
}

describe('TerminalView', () => {
	const defaultCallbacks = {
		onTabSelect: vi.fn(),
		onTabClose: vi.fn(),
		onNewTab: vi.fn(),
		onTabExit: vi.fn(),
		onTabSpawned: vi.fn(),
		onRequestRename: vi.fn(),
		onTabReorder: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the terminal view container', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-view')).toBeTruthy();
	});

	it('renders the terminal tab bar', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-tab-bar')).toBeTruthy();
	});

	it('renders an EmbeddedTerminal for each tab', () => {
		const tabs = [
			createTerminalTab({ id: 'tab-a', cwd: '/home/a' }),
			createTerminalTab({ id: 'tab-b', cwd: '/home/b' }),
		];

		render(
			<TerminalView
				session={createSession({ terminalTabs: tabs, activeTerminalTabId: 'tab-a' })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('embedded-terminal-tab-a')).toBeTruthy();
		expect(screen.getByTestId('embedded-terminal-tab-b')).toBeTruthy();
	});

	it('shows only the active terminal tab (display: flex vs none)', () => {
		const tabs = [
			createTerminalTab({ id: 'tab-a' }),
			createTerminalTab({ id: 'tab-b' }),
		];

		render(
			<TerminalView
				session={createSession({ terminalTabs: tabs, activeTerminalTabId: 'tab-a' })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		const paneA = screen.getByTestId('terminal-pane-tab-a');
		const paneB = screen.getByTestId('terminal-pane-tab-b');

		expect(paneA.style.display).toBe('flex');
		expect(paneB.style.display).toBe('none');
	});

	it('passes isVisible=true only to the active terminal', () => {
		const tabs = [
			createTerminalTab({ id: 'tab-a' }),
			createTerminalTab({ id: 'tab-b' }),
		];

		render(
			<TerminalView
				session={createSession({ terminalTabs: tabs, activeTerminalTabId: 'tab-a' })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('embedded-terminal-tab-a').getAttribute('data-visible')).toBe('true');
		expect(screen.getByTestId('embedded-terminal-tab-b').getAttribute('data-visible')).toBe('false');
	});

	it('shows empty state when no tabs exist', () => {
		render(
			<TerminalView
				session={createSession({ terminalTabs: [], activeTerminalTabId: null })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-view-empty')).toBeTruthy();
		expect(screen.getByText('No terminal tabs. Click + to create one.')).toBeTruthy();
	});

	it('calls onNewTab when + button is clicked', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		fireEvent.click(screen.getByTestId('terminal-new-tab-button'));
		expect(defaultCallbacks.onNewTab).toHaveBeenCalledTimes(1);
	});

	it('calls onTabSelect when a tab is clicked', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		fireEvent.click(screen.getByTestId('terminal-tab-tab-1'));
		expect(defaultCallbacks.onTabSelect).toHaveBeenCalledWith('tab-1');
	});

	it('calls onRequestRename on tab double-click', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		fireEvent.doubleClick(screen.getByTestId('terminal-tab-tab-1'));
		expect(defaultCallbacks.onRequestRename).toHaveBeenCalledWith('tab-1');
	});

	it('passes correct cwd to each EmbeddedTerminal', () => {
		const tabs = [
			createTerminalTab({ id: 'tab-a', cwd: '/project/a' }),
			createTerminalTab({ id: 'tab-b', cwd: '/project/b' }),
		];

		render(
			<TerminalView
				session={createSession({ terminalTabs: tabs, activeTerminalTabId: 'tab-a' })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('embedded-terminal-tab-a').getAttribute('data-cwd')).toBe('/project/a');
		expect(screen.getByTestId('embedded-terminal-tab-b').getAttribute('data-cwd')).toBe('/project/b');
	});

	describe('Cmd+F terminal search', () => {
		it('opens search bar on Cmd+F when terminal tab is active', () => {
			render(
				<TerminalView
					session={createSession()}
					theme={defaultTheme}
					fontFamily="Menlo"
					{...defaultCallbacks}
				/>
			);

			// No search bar initially
			expect(screen.queryByTestId('terminal-search-bar')).toBeNull();

			// Trigger Cmd+F
			act(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'f',
						metaKey: true,
						bubbles: true,
					})
				);
			});

			expect(screen.getByTestId('terminal-search-bar')).toBeTruthy();
		});

		it('closes search bar on Cmd+F toggle', () => {
			render(
				<TerminalView
					session={createSession()}
					theme={defaultTheme}
					fontFamily="Menlo"
					{...defaultCallbacks}
				/>
			);

			// Open search
			act(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'f',
						metaKey: true,
						bubbles: true,
					})
				);
			});
			expect(screen.getByTestId('terminal-search-bar')).toBeTruthy();

			// Toggle closed
			act(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'f',
						metaKey: true,
						bubbles: true,
					})
				);
			});
			expect(screen.queryByTestId('terminal-search-bar')).toBeNull();
		});

		it('does not open search when no active terminal tab', () => {
			render(
				<TerminalView
					session={createSession({ activeTerminalTabId: null })}
					theme={defaultTheme}
					fontFamily="Menlo"
					{...defaultCallbacks}
				/>
			);

			act(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'f',
						metaKey: true,
						bubbles: true,
					})
				);
			});

			expect(screen.queryByTestId('terminal-search-bar')).toBeNull();
		});

		it('closes search bar via close button', () => {
			render(
				<TerminalView
					session={createSession()}
					theme={defaultTheme}
					fontFamily="Menlo"
					{...defaultCallbacks}
				/>
			);

			// Open search
			act(() => {
				window.dispatchEvent(
					new KeyboardEvent('keydown', {
						key: 'f',
						metaKey: true,
						bubbles: true,
					})
				);
			});

			// Click close button
			fireEvent.click(screen.getByTestId('terminal-search-close'));
			expect(screen.queryByTestId('terminal-search-bar')).toBeNull();
		});
	});

	it('has proper flex container styling for full-height terminal layout', () => {
		render(
			<TerminalView
				session={createSession()}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		const terminalView = screen.getByTestId('terminal-view');
		// Root: flex column, full height
		expect(terminalView.className).toContain('flex');
		expect(terminalView.className).toContain('flex-col');
		expect(terminalView.className).toContain('h-full');

		// Content area (parent of terminal panes): must be a flex container
		// so that tab panes with flex: 1 fill available height
		const pane = screen.getByTestId('terminal-pane-tab-1');
		const contentArea = pane.parentElement!;
		expect(contentArea.className).toContain('flex-1');
		expect(contentArea.className).toContain('flex');
		expect(contentArea.className).toContain('flex-col');
		expect(contentArea.className).toContain('overflow-hidden');
	});

	it('renders tabs in the tab bar with correct display names', () => {
		const tabs = [
			createTerminalTab({ id: 'tab-1', name: 'Build Server' }),
			createTerminalTab({ id: 'tab-2', name: null }),
		];

		render(
			<TerminalView
				session={createSession({ terminalTabs: tabs, activeTerminalTabId: 'tab-1' })}
				theme={defaultTheme}
				fontFamily="Menlo"
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByText('Build Server')).toBeTruthy();
		expect(screen.getByText('Terminal 2')).toBeTruthy();
	});
});
