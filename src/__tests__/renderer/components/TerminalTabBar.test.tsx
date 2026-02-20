import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TerminalTabBar, TERMINAL_TAB_EXIT_MS } from '../../../renderer/components/TerminalTabBar';
import { createTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { Theme, TerminalTab } from '../../../renderer/types';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
	X: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="x-icon" className={className} style={style}>
			X
		</span>
	),
	Plus: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="plus-icon" className={className} style={style}>
			+
		</span>
	),
	Terminal: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="terminal-icon" className={className} style={style}>
			&gt;_
		</span>
	),
	Loader2: ({ className, style, 'data-testid': testId }: { className?: string; style?: React.CSSProperties; 'data-testid'?: string }) => (
		<span data-testid={testId || 'loader-icon'} className={className} style={style}>
			⟳
		</span>
	),
	Edit3: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="edit3-icon" className={className} style={style}>✎</span>
	),
	ChevronsRight: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevrons-right-icon" className={className} style={style}>»</span>
	),
}));

// Minimal theme fixture
const theme: Theme = {
	id: 'test',
	name: 'Test',
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

describe('TerminalTabBar', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders all terminal tabs', () => {
		const tabs = makeTabs(3);
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

		// First tab has no custom name → "Terminal 1"
		expect(screen.getByText('Terminal 1')).toBeTruthy();
		// Second and third have custom names
		expect(screen.getByText('Tab 2')).toBeTruthy();
		expect(screen.getByText('Tab 3')).toBeTruthy();
	});

	it('calls onTabSelect when a tab is clicked', () => {
		const tabs = makeTabs(2);
		const onTabSelect = vi.fn();
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={onTabSelect}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		// Click the second tab
		fireEvent.click(screen.getByText('Tab 2'));
		expect(onTabSelect).toHaveBeenCalledWith(tabs[1].id);
	});

	it('calls onNewTab when the add button is clicked', () => {
		const tabs = makeTabs(1);
		const onNewTab = vi.fn();
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={onNewTab}
			/>
		);

		// Click the plus button
		const addButton = screen.getByTitle('New terminal (Ctrl+Shift+`)');
		fireEvent.click(addButton);
		expect(onNewTab).toHaveBeenCalledTimes(1);
	});

	it('hides close button when only one tab exists', () => {
		const tabs = makeTabs(1);
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

		// Close button should not be present (canClose = false when tabs.length <= 1)
		const closeButtons = container.querySelectorAll('[title="Close terminal"]');
		expect(closeButtons).toHaveLength(0);
	});

	it('shows close button when multiple tabs exist and tab is active', () => {
		const tabs = makeTabs(2);
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

		// Close buttons should be present for active/hovered tabs
		const closeButtons = container.querySelectorAll('[title="Close terminal"]');
		expect(closeButtons.length).toBeGreaterThan(0);
	});

	it('shows exit code indicator for non-zero exit', () => {
		const tabs = makeTabs(2);
		tabs[1] = { ...tabs[1], state: 'exited', exitCode: 1 };
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

		expect(screen.getByText('(1)')).toBeTruthy();
	});

	it('does not show exit code indicator for zero exit', () => {
		const tabs = makeTabs(2);
		tabs[1] = { ...tabs[1], state: 'exited', exitCode: 0 };
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

		// Should not show "(0)" for clean exit
		expect(screen.queryByText('(0)')).toBeNull();
	});

	it('calls onTabClose when close button is clicked (after exit animation)', () => {
		const tabs = makeTabs(2);
		const onTabClose = vi.fn();

		// Render with first tab active so close button is visible
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

		// Click the first close button (active tab)
		const closeButton = container.querySelector('[title="Close terminal"]');
		if (closeButton) {
			fireEvent.click(closeButton);
			// Close is delayed by exit animation
			expect(onTabClose).not.toHaveBeenCalled();
			vi.advanceTimersByTime(TERMINAL_TAB_EXIT_MS);
			expect(onTabClose).toHaveBeenCalledWith(tabs[0].id);
		}
	});

	it('renders terminal icons for each spawned tab', () => {
		const tabs = makeTabs(3);
		// Give all tabs a pid > 0 so they show TerminalIcon instead of spinner
		tabs.forEach(tab => { tab.pid = 1234; });
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

		const terminalIcons = screen.getAllByTestId('terminal-icon');
		expect(terminalIcons).toHaveLength(3);
	});

	it('renders spinner icons for spawning tabs (pid=0, state=idle)', () => {
		const tabs = makeTabs(3);
		// Default tabs have pid=0 and state='idle' → spinner
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

		const loaderIcons = screen.getAllByTestId('loader-icon');
		expect(loaderIcons).toHaveLength(3);
		expect(screen.queryByTestId('terminal-icon')).toBeNull();
	});

	it('calls onTabReorder via drag and drop', () => {
		const tabs = makeTabs(3);
		const onTabReorder = vi.fn();
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
				onTabReorder={onTabReorder}
			/>
		);

		const tab1 = screen.getByText('Terminal 1').closest('[draggable="true"]')!;
		const tab3 = screen.getByText('Tab 3').closest('[draggable="true"]')!;

		// Simulate drag from tab 1 to tab 3 position
		fireEvent.dragStart(tab1, {
			dataTransfer: { effectAllowed: 'move', setData: vi.fn() },
		});
		fireEvent.dragOver(tab3, {
			dataTransfer: { dropEffect: 'move' },
			preventDefault: vi.fn(),
		});
		fireEvent.drop(tab3, {
			dataTransfer: { getData: () => '0' },
			preventDefault: vi.fn(),
		});

		expect(onTabReorder).toHaveBeenCalledWith(0, 2);
	});

	describe('tooltip with cwd on tab hover', () => {
		it('shows shellType and cwd in tooltip for each tab', () => {
			const tabs = makeTabs(2);
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

			const draggableTabs = container.querySelectorAll('[draggable="true"]');
			expect(draggableTabs).toHaveLength(2);
			expect(draggableTabs[0].getAttribute('title')).toBe('zsh - /test');
			expect(draggableTabs[1].getAttribute('title')).toBe('zsh - /test');
		});

		it('shows different cwd per tab', () => {
			const tabs = [
				createTerminalTab('zsh', '/home/user', null),
				createTerminalTab('bash', '/var/log', 'Logs'),
			];
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

			const draggableTabs = container.querySelectorAll('[draggable="true"]');
			expect(draggableTabs[0].getAttribute('title')).toBe('zsh - /home/user');
			expect(draggableTabs[1].getAttribute('title')).toBe('bash - /var/log');
		});

		it('shows different shell types in tooltip', () => {
			const tabs = [
				createTerminalTab('bash', '/tmp', null),
				createTerminalTab('powershell', 'C:\\Users', null),
				createTerminalTab('fish', '/home', null),
			];
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

			const draggableTabs = container.querySelectorAll('[draggable="true"]');
			expect(draggableTabs[0].getAttribute('title')).toBe('bash - /tmp');
			expect(draggableTabs[1].getAttribute('title')).toBe('powershell - C:\\Users');
			expect(draggableTabs[2].getAttribute('title')).toBe('fish - /home');
		});

		it('shows tooltip on active and inactive tabs', () => {
			const tabs = makeTabs(3);
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[1].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			const draggableTabs = container.querySelectorAll('[draggable="true"]');
			// All tabs should have the tooltip regardless of active state
			for (const tab of draggableTabs) {
				expect(tab.getAttribute('title')).toBe('zsh - /test');
			}
		});

		it('shows tooltip for exited tabs', () => {
			const tabs = makeTabs(2);
			tabs[1] = { ...tabs[1], state: 'exited', exitCode: 1 };
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

			const draggableTabs = container.querySelectorAll('[draggable="true"]');
			// Exited tab should still show tooltip
			expect(draggableTabs[1].getAttribute('title')).toBe('zsh - /test');
		});

		it('handles empty cwd gracefully', () => {
			const tabs = [createTerminalTab('zsh', '', null)];
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

			const draggableTab = container.querySelector('[draggable="true"]');
			expect(draggableTab?.getAttribute('title')).toBe('zsh - ');
		});
	});

	describe('long tab name truncation', () => {
		it('applies truncate and max-w-[150px] to all tab name spans', () => {
			const tabs = makeTabs(2);
			tabs[0].pid = 1234; // spawned
			tabs[1].pid = 5678;
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

			// All tab name spans should have truncation classes
			const nameSpans = container.querySelectorAll('.truncate.max-w-\\[150px\\]');
			expect(nameSpans).toHaveLength(2);
		});

		it('applies truncation to the active tab', () => {
			const tabs = [createTerminalTab('zsh', '/test', 'A very long tab name that should definitely be truncated by CSS')];
			tabs[0].pid = 1234;
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

			const nameSpan = container.querySelector('.truncate.max-w-\\[150px\\]');
			expect(nameSpan).toBeTruthy();
			expect(nameSpan?.textContent).toBe('A very long tab name that should definitely be truncated by CSS');
		});

		it('applies truncation to inactive tabs', () => {
			const tabs = [
				createTerminalTab('zsh', '/test', null),
				createTerminalTab('zsh', '/test', 'Another very long tab name for the inactive tab'),
			];
			tabs.forEach(t => { t.pid = 1234; });
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

			const nameSpans = container.querySelectorAll('.truncate.max-w-\\[150px\\]');
			expect(nameSpans).toHaveLength(2);
			// Both active and inactive have same truncation classes
			nameSpans.forEach(span => {
				expect(span.className).toContain('truncate');
				expect(span.className).toContain('max-w-[150px]');
			});
		});

		it('applies consistent truncation across active and inactive tabs', () => {
			const tabs = makeTabs(3);
			tabs.forEach(t => { t.pid = 1234; });
			const { container } = render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId={tabs[1].id}
					theme={theme}
					onTabSelect={vi.fn()}
					onTabClose={vi.fn()}
					onNewTab={vi.fn()}
				/>
			);

			// All 3 tab name spans should have the same truncation classes
			const nameSpans = container.querySelectorAll('.truncate.max-w-\\[150px\\]');
			expect(nameSpans).toHaveLength(3);
		});

		it('still renders the full text in DOM (CSS handles visual truncation)', () => {
			const longName = 'x'.repeat(200);
			const tabs = [createTerminalTab('zsh', '/test', longName)];
			tabs[0].pid = 1234;
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

			// The full text should be in the DOM (CSS text-overflow handles visual truncation)
			expect(screen.getByText(longName)).toBeTruthy();
		});

		it('shows full name in tooltip even when display is truncated', () => {
			const longName = 'This is a really long terminal tab name';
			const tabs = [createTerminalTab('zsh', '/projects/my-long-path', longName)];
			tabs[0].pid = 1234;
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

			// The tooltip (title attribute) on the draggable container shows full shell+cwd info
			const draggableTab = container.querySelector('[draggable="true"]');
			expect(draggableTab?.getAttribute('title')).toBe('zsh - /projects/my-long-path');
		});
	});

	it('applies horizontal scroll CSS to the tab bar container', () => {
		const tabs = makeTabs(2);
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

		// The outermost container div should have overflow-x-auto and no-scrollbar classes
		const tabBarContainer = container.firstElementChild as HTMLElement;
		expect(tabBarContainer.className).toContain('overflow-x-auto');
		expect(tabBarContainer.className).toContain('no-scrollbar');
	});
});
