/**
 * @file TerminalTabBar.test.tsx
 * @description Tests for the standalone TerminalTabBar component.
 *
 * Tests focus on:
 * - Tab rendering (names, icons, status indicators)
 * - Click handling (select, close, double-click rename)
 * - New tab button
 * - Middle-click close
 * - Drag and drop reorder
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';
import type { TerminalTab } from '../../../renderer/types';

import { TerminalTabBar } from '../../../renderer/components/TerminalTabBar';

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

function createTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'tab-1',
		name: null,
		createdAt: Date.now(),
		cwd: '/home/user',
		...overrides,
	};
}

describe('TerminalTabBar', () => {
	const defaultCallbacks = {
		onTabSelect: vi.fn(),
		onTabClose: vi.fn(),
		onNewTab: vi.fn(),
		onRequestRename: vi.fn(),
		onTabReorder: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the tab bar container', () => {
		render(
			<TerminalTabBar
				tabs={[createTab()]}
				activeTabId="tab-1"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-tab-bar')).toBeTruthy();
	});

	it('renders a tab for each terminal tab', () => {
		const tabs = [
			createTab({ id: 'a' }),
			createTab({ id: 'b' }),
			createTab({ id: 'c' }),
		];

		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId="a"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-tab-a')).toBeTruthy();
		expect(screen.getByTestId('terminal-tab-b')).toBeTruthy();
		expect(screen.getByTestId('terminal-tab-c')).toBeTruthy();
	});

	it('shows custom tab name when set', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'a', name: 'Dev Server' })]}
				activeTabId="a"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByText('Dev Server')).toBeTruthy();
	});

	it('shows "Terminal N" when name is null', () => {
		const tabs = [
			createTab({ id: 'a', name: null }),
			createTab({ id: 'b', name: null }),
		];

		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId="a"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByText('Terminal 1')).toBeTruthy();
		expect(screen.getByText('Terminal 2')).toBeTruthy();
	});

	it('calls onTabSelect when a tab is clicked', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'tab-x' })]}
				activeTabId={null}
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		fireEvent.click(screen.getByTestId('terminal-tab-tab-x'));
		expect(defaultCallbacks.onTabSelect).toHaveBeenCalledWith('tab-x');
	});

	it('calls onRequestRename on double-click', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'tab-r' })]}
				activeTabId="tab-r"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		fireEvent.doubleClick(screen.getByTestId('terminal-tab-tab-r'));
		expect(defaultCallbacks.onRequestRename).toHaveBeenCalledWith('tab-r');
	});

	it('calls onNewTab when + button is clicked', () => {
		render(
			<TerminalTabBar
				tabs={[createTab()]}
				activeTabId="tab-1"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		fireEvent.click(screen.getByTestId('terminal-new-tab-button'));
		expect(defaultCallbacks.onNewTab).toHaveBeenCalledTimes(1);
	});

	it('shows close button when tab is active', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'active-tab' })]}
				activeTabId="active-tab"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		expect(screen.getByTestId('terminal-tab-close-active-tab')).toBeTruthy();
	});

	it('calls onTabClose when close button is clicked', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'close-me' })]}
				activeTabId="close-me"
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		fireEvent.click(screen.getByTestId('terminal-tab-close-close-me'));
		expect(defaultCallbacks.onTabClose).toHaveBeenCalledWith('close-me');
	});

	it('calls onTabClose on middle-click (button 1)', () => {
		render(
			<TerminalTabBar
				tabs={[createTab({ id: 'mid-close' })]}
				activeTabId={null}
				theme={defaultTheme}
				{...defaultCallbacks}
			/>
		);

		fireEvent.mouseDown(screen.getByTestId('terminal-tab-mid-close'), { button: 1 });
		expect(defaultCallbacks.onTabClose).toHaveBeenCalledWith('mid-close');
	});

	describe('status indicators', () => {
		it('shows spinner when tab is spawning (no processRunning, no exitCode)', () => {
			render(
				<TerminalTabBar
					tabs={[createTab({ id: 'spawning', processRunning: undefined, exitCode: undefined })]}
					activeTabId="spawning"
					theme={defaultTheme}
					{...defaultCallbacks}
				/>
			);

			expect(screen.getByTestId('terminal-tab-spinner')).toBeTruthy();
		});

		it('shows status dot when process is running', () => {
			render(
				<TerminalTabBar
					tabs={[createTab({ id: 'running', processRunning: true })]}
					activeTabId="running"
					theme={defaultTheme}
					{...defaultCallbacks}
				/>
			);

			const dot = screen.getByTestId('terminal-tab-status-dot');
			expect(dot).toBeTruthy();
			expect(dot.style.backgroundColor).toBe('rgb(34, 197, 94)'); // #22c55e
		});

		it('shows dim status dot when process has exited', () => {
			render(
				<TerminalTabBar
					tabs={[createTab({ id: 'exited', processRunning: false, exitCode: 0 })]}
					activeTabId="exited"
					theme={defaultTheme}
					{...defaultCallbacks}
				/>
			);

			const dot = screen.getByTestId('terminal-tab-status-dot');
			expect(dot).toBeTruthy();
			// Should use textDim color (not green)
			expect(dot.style.backgroundColor).not.toBe('rgb(34, 197, 94)');
		});
	});

	describe('drag and drop reorder', () => {
		it('calls onTabReorder when dropping a tab onto another', () => {
			const tabs = [
				createTab({ id: 'first' }),
				createTab({ id: 'second' }),
				createTab({ id: 'third' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="first"
					theme={defaultTheme}
					{...defaultCallbacks}
				/>
			);

			const firstTab = screen.getByTestId('terminal-tab-first');
			const thirdTab = screen.getByTestId('terminal-tab-third');

			// Start drag from first tab
			fireEvent.dragStart(firstTab, {
				dataTransfer: { effectAllowed: 'move', setData: vi.fn() },
			});

			// Drag over third tab
			fireEvent.dragOver(thirdTab, {
				dataTransfer: { dropEffect: 'move' },
			});

			// Drop on third tab
			fireEvent.drop(thirdTab, {
				dataTransfer: { getData: vi.fn(() => 'first') },
			});

			expect(defaultCallbacks.onTabReorder).toHaveBeenCalledWith(0, 2);
		});

		it('does not call onTabReorder when dropping on same tab', () => {
			render(
				<TerminalTabBar
					tabs={[createTab({ id: 'only' })]}
					activeTabId="only"
					theme={defaultTheme}
					{...defaultCallbacks}
				/>
			);

			const tab = screen.getByTestId('terminal-tab-only');

			fireEvent.dragStart(tab, {
				dataTransfer: { effectAllowed: 'move', setData: vi.fn() },
			});
			fireEvent.drop(tab, {
				dataTransfer: { getData: vi.fn(() => 'only') },
			});

			expect(defaultCallbacks.onTabReorder).not.toHaveBeenCalled();
		});
	});
});
