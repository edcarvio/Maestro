import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	TerminalTabBar,
	TERMINAL_TAB_ENTER_MS,
	TERMINAL_TAB_EXIT_MS,
} from '../../../renderer/components/TerminalTabBar';
import { createTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { Theme, TerminalTab } from '../../../renderer/types';

// Mock lucide-react icons
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

function getTabElement(container: HTMLElement, tabText: string): HTMLElement {
	return screen.getByText(tabText).closest('[draggable="true"]') as HTMLElement;
}

function rightClickTab(tabText: string) {
	const tabElement = screen.getByText(tabText).closest('[draggable="true"]')!;
	fireEvent.contextMenu(tabElement, { clientX: 150, clientY: 50 });
}

describe('TerminalTabTransitions', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
		Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('animation duration constants', () => {
		it('TERMINAL_TAB_ENTER_MS is 150ms', () => {
			expect(TERMINAL_TAB_ENTER_MS).toBe(150);
		});

		it('TERMINAL_TAB_EXIT_MS is 120ms', () => {
			expect(TERMINAL_TAB_EXIT_MS).toBe(120);
		});

		it('enter duration is within perceptible but non-disruptive range (100-300ms)', () => {
			expect(TERMINAL_TAB_ENTER_MS).toBeGreaterThanOrEqual(100);
			expect(TERMINAL_TAB_ENTER_MS).toBeLessThanOrEqual(300);
		});

		it('exit duration is shorter than enter for snappy removal feel', () => {
			expect(TERMINAL_TAB_EXIT_MS).toBeLessThan(TERMINAL_TAB_ENTER_MS);
		});
	});

	describe('enter animation for new tabs', () => {
		it('does NOT apply enter animation to tabs on initial render', () => {
			const tabs = makeSpawnedTabs(3);
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

			// No tab should have the enter animation on initial render
			const animatingTabs = container.querySelectorAll('.terminal-tab-enter');
			expect(animatingTabs).toHaveLength(0);
		});

		it('applies enter animation when a new tab is added', () => {
			const tabs = makeSpawnedTabs(2);
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Add a new tab
			const newTab = createTerminalTab('zsh', '/test', 'New Tab');
			newTab.pid = 5678;
			const updatedTabs = [...tabs, newTab];

			rerender(
				<TerminalTabBar
					tabs={updatedTabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// The new tab should have the enter animation class
			const newTabEl = getTabElement(container, 'New Tab');
			expect(newTabEl.className).toContain('terminal-tab-enter');
		});

		it('does NOT apply enter animation to existing tabs when a new tab is added', () => {
			const tabs = makeSpawnedTabs(2);
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const newTab = createTerminalTab('zsh', '/test', 'New Tab');
			newTab.pid = 5678;
			const updatedTabs = [...tabs, newTab];

			rerender(
				<TerminalTabBar
					tabs={updatedTabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Only the new tab should have the animation, not existing ones
			const allTabs = container.querySelectorAll('[draggable="true"]');
			expect(allTabs[0].className).not.toContain('terminal-tab-enter');
			expect(allTabs[1].className).not.toContain('terminal-tab-enter');
			expect(allTabs[2].className).toContain('terminal-tab-enter');
		});

		it('clears enter animation class after TERMINAL_TAB_ENTER_MS', () => {
			const tabs = makeSpawnedTabs(1);
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const newTab = createTerminalTab('zsh', '/test', 'New Tab');
			newTab.pid = 5678;

			rerender(
				<TerminalTabBar
					tabs={[...tabs, newTab]}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Animation class is present initially
			let newTabEl = getTabElement(container, 'New Tab');
			expect(newTabEl.className).toContain('terminal-tab-enter');

			// Advance past the animation duration
			act(() => {
				vi.advanceTimersByTime(TERMINAL_TAB_ENTER_MS);
			});

			// Animation class should be cleared
			newTabEl = getTabElement(container, 'New Tab');
			expect(newTabEl.className).not.toContain('terminal-tab-enter');
		});

		it('applies enter animation to multiple simultaneously added tabs', () => {
			const tabs = makeSpawnedTabs(1);
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const newTab1 = createTerminalTab('zsh', '/test', 'New A');
			const newTab2 = createTerminalTab('zsh', '/test', 'New B');
			newTab1.pid = 1111;
			newTab2.pid = 2222;

			rerender(
				<TerminalTabBar
					tabs={[...tabs, newTab1, newTab2]}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const tabA = getTabElement(container, 'New A');
			const tabB = getTabElement(container, 'New B');
			expect(tabA.className).toContain('terminal-tab-enter');
			expect(tabB.className).toContain('terminal-tab-enter');
		});
	});

	describe('exit animation for closing tabs', () => {
		it('applies exit animation class when close button is clicked', () => {
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

			// Click close button on active tab
			const closeButton = container.querySelector('[title="Close terminal"]');
			fireEvent.click(closeButton!);

			// Tab should have exit animation class
			const tab1El = getTabElement(container, 'Terminal 1');
			expect(tab1El.className).toContain('terminal-tab-exit');
		});

		it('delays onTabClose until exit animation completes', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			const closeButton = container.querySelector('[title="Close terminal"]');
			fireEvent.click(closeButton!);

			// Not called immediately
			expect(onTabClose).not.toHaveBeenCalled();

			// Not called before animation completes
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS - 1);
			expect(onTabClose).not.toHaveBeenCalled();

			// Called after animation completes
			vi.advanceTimersByTime(1);
			expect(onTabClose).toHaveBeenCalledTimes(1);
			expect(onTabClose).toHaveBeenCalledWith(tabs[0].id);
		});

		it('prevents double-close on same tab', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			const closeButton = container.querySelector('[title="Close terminal"]');
			// Click close twice rapidly
			fireEvent.click(closeButton!);
			fireEvent.click(closeButton!);

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			// Only one close should fire
			expect(onTabClose).toHaveBeenCalledTimes(1);
		});

		it('applies exit animation via middle-click close', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			const tab2El = getTabElement(container, 'Tab 2');
			// Middle-click (button=1)
			fireEvent.mouseDown(tab2El, { button: 1 });

			expect(tab2El.className).toContain('terminal-tab-exit');
			expect(onTabClose).not.toHaveBeenCalled();

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabs[1].id);
		});

		it('applies exit animation via context menu Close', () => {
			const tabs = makeSpawnedTabs(3);
			const onTabClose = vi.fn();
			const { container } = render(
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

			const tab2El = getTabElement(container, 'Tab 2');
			expect(tab2El.className).toContain('terminal-tab-exit');

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabs[1].id);
		});

		it('does NOT apply exit animation to other tabs when closing one', () => {
			const tabs = makeSpawnedTabs(3);
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

			const closeButton = container.querySelector('[title="Close terminal"]');
			fireEvent.click(closeButton!);

			// Only the closing tab should have exit animation
			const allTabs = container.querySelectorAll('[draggable="true"]');
			expect(allTabs[0].className).toContain('terminal-tab-exit'); // closing tab
			expect(allTabs[1].className).not.toContain('terminal-tab-exit');
			expect(allTabs[2].className).not.toContain('terminal-tab-exit');
		});
	});

	describe('batch exit animation (Close Others / Close to Right)', () => {
		it('applies exit animation to all other tabs on Close Others', () => {
			const tabs = makeSpawnedTabs(3);
			const onCloseOtherTabs = vi.fn();
			const { container } = render(
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

			const allTabs = container.querySelectorAll('[draggable="true"]');
			// Tab 2 (index 1) is kept; tabs at index 0 and 2 should be closing
			expect(allTabs[0].className).toContain('terminal-tab-exit');
			expect(allTabs[1].className).not.toContain('terminal-tab-exit');
			expect(allTabs[2].className).toContain('terminal-tab-exit');

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseOtherTabs).toHaveBeenCalledWith(tabs[1].id);
		});

		it('applies exit animation to tabs to the right on Close to Right', () => {
			const tabs = makeSpawnedTabs(4);
			const onCloseTabsToRight = vi.fn();
			const { container } = render(
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

			rightClickTab('Tab 2');
			fireEvent.click(screen.getByText('Close to the Right'));

			const allTabs = container.querySelectorAll('[draggable="true"]');
			// Tabs at index 0 and 1 should NOT be closing
			expect(allTabs[0].className).not.toContain('terminal-tab-exit');
			expect(allTabs[1].className).not.toContain('terminal-tab-exit');
			// Tabs at index 2 and 3 (right of tab 2) should be closing
			expect(allTabs[2].className).toContain('terminal-tab-exit');
			expect(allTabs[3].className).toContain('terminal-tab-exit');

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseTabsToRight).toHaveBeenCalledWith(tabs[1].id);
		});

		it('delays batch close callback until exit animation completes', () => {
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

			rightClickTab('Terminal 1');
			fireEvent.click(screen.getByText('Close Others'));

			expect(onCloseOtherTabs).not.toHaveBeenCalled();
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onCloseOtherTabs).toHaveBeenCalledTimes(1);
		});
	});

	describe('enter/exit interaction', () => {
		it('removes enter animation when a new tab is immediately closed', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Add a new tab
			const newTab = createTerminalTab('zsh', '/test', 'Ephemeral');
			newTab.pid = 9999;
			const updatedTabs = [...tabs, newTab];

			rerender(
				<TerminalTabBar
					tabs={updatedTabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Verify enter animation is applied
			let newTabEl = getTabElement(container, 'Ephemeral');
			expect(newTabEl.className).toContain('terminal-tab-enter');

			// Immediately close the new tab via middle-click
			fireEvent.mouseDown(newTabEl, { button: 1 });

			// Enter animation should be replaced by exit animation
			newTabEl = getTabElement(container, 'Ephemeral');
			expect(newTabEl.className).not.toContain('terminal-tab-enter');
			expect(newTabEl.className).toContain('terminal-tab-exit');

			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(newTab.id);
		});

		it('handles rapid create-close-create cycle', () => {
			const tabs = makeSpawnedTabs(2);
			const onTabClose = vi.fn();
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Add tab A
			const tabA = createTerminalTab('zsh', '/test', 'Tab A');
			tabA.pid = 1111;
			rerender(
				<TerminalTabBar
					tabs={[...tabs, tabA]}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Tab A has enter animation
			expect(getTabElement(container, 'Tab A').className).toContain('terminal-tab-enter');

			// Close tab A
			const tabAEl = getTabElement(container, 'Tab A');
			fireEvent.mouseDown(tabAEl, { button: 1 });

			// Tab A now has exit animation
			expect(getTabElement(container, 'Tab A').className).toContain('terminal-tab-exit');

			// Advance timers to complete exit
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabA.id);

			// Add tab B (simulating parent removing A and adding B)
			const tabB = createTerminalTab('zsh', '/test', 'Tab B');
			tabB.pid = 2222;
			rerender(
				<TerminalTabBar
					tabs={[...tabs, tabB]}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={onTabClose}
					onNewTab={vi.fn()}
				/>
			);

			// Tab B should have enter animation
			expect(getTabElement(container, 'Tab B').className).toContain('terminal-tab-enter');
		});
	});

	describe('CSS class verification', () => {
		it('exit animation class includes pointer-events none (verified via CSS class name)', () => {
			// The .terminal-tab-exit class in index.css includes pointer-events: none
			// We verify the class name is applied correctly, CSS behavior is ensured by the stylesheet
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

			const closeButton = container.querySelector('[title="Close terminal"]');
			fireEvent.click(closeButton!);

			const tab1El = getTabElement(container, 'Terminal 1');
			// The class is applied, which via CSS gives pointer-events: none
			expect(tab1El.className).toContain('terminal-tab-exit');
		});

		it('enter and exit class names do not conflict with existing transition classes', () => {
			const tabs = makeSpawnedTabs(2);
			const { container, rerender } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// Add new tab
			const newTab = createTerminalTab('zsh', '/test', 'Animated');
			newTab.pid = 5678;
			rerender(
				<TerminalTabBar
					tabs={[...tabs, newTab]}
					activeTabId={tabs[0].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const newTabEl = getTabElement(container, 'Animated');
			// Should have enter animation AND existing transition classes (not replacing them)
			expect(newTabEl.className).toContain('terminal-tab-enter');
			expect(newTabEl.className).toContain('transition-all');
			expect(newTabEl.className).toContain('duration-150');
		});
	});
});
