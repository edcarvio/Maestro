import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalTabBar, TERMINAL_TAB_EXIT_MS } from '../../../renderer/components/TerminalTabBar';
import { createTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { Theme, TerminalTab } from '../../../renderer/types';

// Mock lucide-react icons (must include all icons used by TerminalTabBar)
vi.mock('lucide-react', () => ({
	X: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="x-icon" className={className} style={style}>X</span>
	),
	Plus: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="plus-icon" className={className} style={style}>+</span>
	),
	Terminal: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="terminal-icon" className={className} style={style}>&gt;_</span>
	),
	Loader2: ({ className, style, 'data-testid': testId }: { className?: string; style?: React.CSSProperties; 'data-testid'?: string }) => (
		<span data-testid={testId || 'loader-icon'} className={className} style={style}>⟳</span>
	),
	Edit3: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="edit3-icon" className={className} style={style}>✎</span>
	),
	ChevronsRight: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevrons-right-icon" className={className} style={style}>»</span>
	),
}));

const theme: Theme = {
	id: 'test-dark',
	name: 'Test Dark',
	mode: 'dark',
	colors: {
		background: '#1a1a2e',
		bgMain: '#16213e',
		bgSidebar: '#0f3460',
		bgActivity: '#0f3460',
		surface: '#1a1a4e',
		border: '#533483',
		textMain: '#e94560',
		textDim: '#a1a1b5',
		accent: '#e94560',
		accentForeground: '#ffffff',
		warning: '#ffc107',
		error: '#f44336',
		success: '#4caf50',
	},
};

const lightTheme: Theme = {
	...theme,
	id: 'test-light',
	name: 'Test Light',
	mode: 'light',
	colors: {
		...theme.colors,
		bgSidebar: '#f5f5f5',
		textMain: '#333333',
		border: '#dddddd',
	},
};

function makeTabs(count: number): TerminalTab[] {
	return Array.from({ length: count }, (_, i) =>
		createTerminalTab('zsh', '/test', i === 0 ? null : `Tab ${i + 1}`)
	);
}

function makeSpawnedTabs(count: number): TerminalTab[] {
	const tabs = makeTabs(count);
	tabs.forEach(tab => { tab.pid = 1234; });
	return tabs;
}

/** Right-click on a tab element to open the context menu */
function rightClickTab(tabText: string) {
	const tabElement = screen.getByText(tabText).closest('[draggable="true"]')!;
	fireEvent.contextMenu(tabElement, { clientX: 150, clientY: 50 });
}

describe('TerminalTabContextMenu', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Mock window dimensions for viewport clamping tests
		Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
		Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('rendering', () => {
		it('shows context menu on right-click', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// No context menu initially
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();

			// Right-click on a tab
			rightClickTab('Terminal 1');

			// Context menu should appear
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();
		});

		it('renders all four menu items', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Tab 2');

			expect(screen.getByText('Rename')).toBeTruthy();
			expect(screen.getByText('Close')).toBeTruthy();
			expect(screen.getByText('Close Others')).toBeTruthy();
			expect(screen.getByText('Close to the Right')).toBeTruthy();
		});

		it('renders correct icons for each menu item', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Tab 2');

			// Edit3 icon for Rename
			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.querySelector('[data-testid="edit3-icon"]')).toBeTruthy();
			// ChevronsRight icon for Close to the Right
			expect(menu.querySelector('[data-testid="chevrons-right-icon"]')).toBeTruthy();
		});

		it('positions the menu at mouse coordinates', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const tabElement = screen.getByText('Terminal 1').closest('[draggable="true"]')!;
			fireEvent.contextMenu(tabElement, { clientX: 200, clientY: 80 });

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.style.left).toBe('200px');
			expect(menu.style.top).toBe('80px');
		});

		it('clamps position to viewport bounds', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Right-click near the right/bottom edge
			const tabElement = screen.getByText('Terminal 1').closest('[draggable="true"]')!;
			fireEvent.contextMenu(tabElement, { clientX: 950, clientY: 700 });

			const menu = screen.getByTestId('terminal-tab-context-menu');
			// Should be clamped: left = min(950, 1024-200) = 824
			expect(menu.style.left).toBe('824px');
			// Should be clamped: top = min(700, 768-160) = 608
			expect(menu.style.top).toBe('608px');
		});

		it('includes a divider between Rename and close actions', () => {
			const tabs = makeSpawnedTabs(2);
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const dividers = menu.querySelectorAll('.border-t');
			expect(dividers.length).toBeGreaterThanOrEqual(1);
		});

		it('uses theme colors for styling', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const menu = screen.getByTestId('terminal-tab-context-menu');
			// JSDOM normalizes hex colors to rgb(), so check via cssText
			expect(menu.style.cssText).toContain('background-color');
			expect(menu.style.cssText).toContain('border-color');
			expect(menu.style.minWidth).toBe('160px');
		});

		it('works with light theme', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={lightTheme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const menu = screen.getByTestId('terminal-tab-context-menu');
			// Verify the menu renders with light theme (JSDOM normalizes hex to rgb)
			expect(menu.style.cssText).toContain('background-color');
			expect(menu.className).toContain('fixed');
		});
	});

	describe('disabled states', () => {
		it('disables Close and Close Others when only one tab exists', () => {
			const tabs = makeSpawnedTabs(1);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const closeBtn = screen.getByText('Close').closest('button')!;
			const closeOthersBtn = screen.getByText('Close Others').closest('button')!;

			expect(closeBtn.disabled).toBe(true);
			expect(closeOthersBtn.disabled).toBe(true);
		});

		it('enables Close and Close Others when multiple tabs exist', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Tab 2');

			const closeBtn = screen.getByText('Close').closest('button')!;
			const closeOthersBtn = screen.getByText('Close Others').closest('button')!;

			expect(closeBtn.disabled).toBe(false);
			expect(closeOthersBtn.disabled).toBe(false);
		});

		it('disables Close to the Right for the last tab', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Right-click on the last tab
			rightClickTab('Tab 3');

			const closeToRightBtn = screen.getByText('Close to the Right').closest('button')!;
			expect(closeToRightBtn.disabled).toBe(true);
		});

		it('enables Close to the Right for non-last tabs', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const closeToRightBtn = screen.getByText('Close to the Right').closest('button')!;
			expect(closeToRightBtn.disabled).toBe(false);
		});

		it('disables all close actions for single tab (only Rename enabled)', () => {
			const tabs = makeSpawnedTabs(1);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			// Rename is always enabled
			const renameBtn = screen.getByText('Rename').closest('button')!;
			expect(renameBtn.disabled).toBe(false);

			// All close actions disabled with 1 tab (last tab too)
			const closeBtn = screen.getByText('Close').closest('button')!;
			const closeOthersBtn = screen.getByText('Close Others').closest('button')!;
			const closeToRightBtn = screen.getByText('Close to the Right').closest('button')!;
			expect(closeBtn.disabled).toBe(true);
			expect(closeOthersBtn.disabled).toBe(true);
			expect(closeToRightBtn.disabled).toBe(true);
		});

		it('applies opacity styling to disabled items', () => {
			const tabs = makeSpawnedTabs(1);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			const closeBtn = screen.getByText('Close').closest('button')!;
			expect(closeBtn.className).toContain('opacity-40');
		});
	});

	describe('action callbacks', () => {
		it('calls onRequestRename when Rename is clicked', () => {
			const tabs = makeSpawnedTabs(2);
			const onRequestRename = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onRequestRename={onRequestRename}
				/>
			);

			rightClickTab('Tab 2');

			fireEvent.click(screen.getByText('Rename'));
			expect(onRequestRename).toHaveBeenCalledWith(tabs[1].id);
		});

		it('calls onTabClose when Close is clicked (after exit animation)', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Tab 2');

			fireEvent.click(screen.getByText('Close'));
			// Close is delayed by exit animation
			expect(onTabClose).not.toHaveBeenCalled();
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabs[1].id);
		});

		it('calls onCloseOtherTabs when Close Others is clicked (after exit animation)', () => {
			const tabs = makeSpawnedTabs(3);
			const onCloseOtherTabs = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseOtherTabs={onCloseOtherTabs}
				/>
			);

			rightClickTab('Tab 2');

			fireEvent.click(screen.getByText('Close Others'));
			expect(onCloseOtherTabs).not.toHaveBeenCalled();
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseOtherTabs).toHaveBeenCalledWith(tabs[1].id);
		});

		it('calls onCloseTabsToRight when Close to the Right is clicked (after exit animation)', () => {
			const tabs = makeSpawnedTabs(3);
			const onCloseTabsToRight = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseTabsToRight={onCloseTabsToRight}
				/>
			);

			rightClickTab('Terminal 1');

			fireEvent.click(screen.getByText('Close to the Right'));
			expect(onCloseTabsToRight).not.toHaveBeenCalled();
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseTabsToRight).toHaveBeenCalledWith(tabs[0].id);
		});

		it('does not call disabled Close callback on single tab', () => {
			const tabs = makeSpawnedTabs(1);
			const onTabClose = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');

			// Click the disabled Close button
			fireEvent.click(screen.getByText('Close'));
			// Disabled button click should not trigger callback
			expect(onTabClose).not.toHaveBeenCalled();
		});

		it('does not call disabled Close Others callback on single tab', () => {
			const tabs = makeSpawnedTabs(1);
			const onCloseOtherTabs = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseOtherTabs={onCloseOtherTabs}
				/>
			);

			rightClickTab('Terminal 1');

			fireEvent.click(screen.getByText('Close Others'));
			expect(onCloseOtherTabs).not.toHaveBeenCalled();
		});

		it('handles missing optional callbacks gracefully', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					// No onRequestRename, onCloseOtherTabs, onCloseTabsToRight
				/>
			);

			rightClickTab('Terminal 1');

			// Clicking Rename with no handler should not throw
			expect(() => fireEvent.click(screen.getByText('Rename'))).not.toThrow();
			// Menu should be dismissed
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});
	});

	describe('dismissal', () => {
		it('dismisses menu when an action is clicked', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			fireEvent.click(screen.getByText('Rename'));
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('dismisses menu on Escape key', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			act(() => {
				document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
			});

			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('dismisses menu on click outside', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			// Click outside the menu (on the document body)
			act(() => {
				document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			});

			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('dismisses Close Others and removes the menu', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseOtherTabs={vi.fn()}
				/>
			);

			rightClickTab('Tab 2');
			fireEvent.click(screen.getByText('Close Others'));
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('dismisses Close to the Right and removes the menu', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseTabsToRight={vi.fn()}
				/>
			);

			rightClickTab('Terminal 1');
			fireEvent.click(screen.getByText('Close to the Right'));
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});
	});

	describe('context menu replacement', () => {
		it('replaces context menu when right-clicking a different tab', () => {
			const tabs = makeSpawnedTabs(3);
			const onTabClose = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Right-click first tab
			rightClickTab('Terminal 1');
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			// Right-click second tab - should replace the menu
			rightClickTab('Tab 2');
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			// Close should close tab 2, not tab 1 (after exit animation)
			fireEvent.click(screen.getByText('Close'));
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabs[1].id);
		});

		it('prevents default browser context menu', () => {
			const tabs = makeSpawnedTabs(2);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const tabElement = screen.getByText('Terminal 1').closest('[draggable="true"]')!;
			const contextMenuEvent = new MouseEvent('contextmenu', {
				bubbles: true,
				clientX: 100,
				clientY: 50,
			});
			const preventDefaultSpy = vi.spyOn(contextMenuEvent, 'preventDefault');

			tabElement.dispatchEvent(contextMenuEvent);
			expect(preventDefaultSpy).toHaveBeenCalled();
		});
	});

	describe('TerminalView bulk close integration', () => {
		it('Close Others targets the right-clicked tab, not the active tab', () => {
			const tabs = makeSpawnedTabs(3);
			const onCloseOtherTabs = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseOtherTabs={onCloseOtherTabs}
				/>
			);

			// Right-click the second tab (not the active one)
			rightClickTab('Tab 2');
			fireEvent.click(screen.getByText('Close Others'));

			// Should pass the right-clicked tab's ID, not the active tab (after exit animation)
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseOtherTabs).toHaveBeenCalledWith(tabs[1].id);
		});

		it('Close to the Right targets the right-clicked tab', () => {
			const tabs = makeSpawnedTabs(3);
			const onCloseTabsToRight = vi.fn();
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[2].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
					onCloseTabsToRight={onCloseTabsToRight}
				/>
			);

			// Right-click the first tab
			rightClickTab('Terminal 1');
			fireEvent.click(screen.getByText('Close to the Right'));

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseTabsToRight).toHaveBeenCalledWith(tabs[0].id);
		});

		it('Close to the Right is enabled for middle tab', () => {
			const tabs = makeSpawnedTabs(3);
			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Right-click the middle tab
			rightClickTab('Tab 2');

			const closeToRightBtn = screen.getByText('Close to the Right').closest('button')!;
			expect(closeToRightBtn.disabled).toBe(false);
		});
	});
});
