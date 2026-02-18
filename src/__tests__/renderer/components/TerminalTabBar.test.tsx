import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTabBar } from '../../../renderer/components/TerminalTabBar';
import type { TerminalTab, Theme } from '../../../renderer/types';

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
	TerminalSquare: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="terminal-icon" className={className} style={style}>
			&gt;_
		</span>
	),
}));

// Test theme (matches TabBar.test.tsx)
const mockTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#1a1a1a',
		bgSidebar: '#2a2a2a',
		bgActivity: '#3a3a3a',
		textMain: '#ffffff',
		textDim: '#888888',
		accent: '#007acc',
		accentDim: '#007acc80',
		accentText: '#ffffff',
		accentForeground: '#ffffff',
		border: '#444444',
		error: '#ff4444',
		success: '#44ff44',
		warning: '#ffaa00',
	},
};

// Helper to create a terminal tab
function createTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'term-1',
		name: null,
		shellType: 'zsh',
		pid: 12345,
		cwd: '/home/user',
		createdAt: Date.now(),
		state: 'idle',
		...overrides,
	};
}

describe('TerminalTabBar', () => {
	const mockOnTabSelect = vi.fn();
	const mockOnTabClose = vi.fn();
	const mockOnNewTab = vi.fn();
	const mockOnRequestRename = vi.fn();
	const mockOnTabReorder = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		// Mock scrollIntoView
		Element.prototype.scrollIntoView = vi.fn();
	});

	describe('rendering', () => {
		it('renders tab with default display name when name is null', () => {
			const tabs = [createTerminalTab({ id: 'term-1', name: null })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			expect(screen.getByText('Terminal 1')).toBeInTheDocument();
		});

		it('renders tab with custom name when provided', () => {
			const tabs = [createTerminalTab({ id: 'term-1', name: 'Dev Server' })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			expect(screen.getByText('Dev Server')).toBeInTheDocument();
		});

		it('renders multiple tabs with correct numbering', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: null }),
				createTerminalTab({ id: 'term-2', name: null }),
				createTerminalTab({ id: 'term-3', name: 'Build' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			expect(screen.getByText('Terminal 1')).toBeInTheDocument();
			expect(screen.getByText('Terminal 2')).toBeInTheDocument();
			expect(screen.getByText('Build')).toBeInTheDocument();
		});

		it('renders new tab button', () => {
			render(
				<TerminalTabBar
					tabs={[createTerminalTab()]}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			// The new tab button should have a title containing "New terminal"
			const newTabBtn = screen.getByTitle(/New terminal/);
			expect(newTabBtn).toBeInTheDocument();
		});

		it('shows exit code indicator for non-zero exits', () => {
			const tabs = [createTerminalTab({ id: 'term-1', state: 'exited', exitCode: 1 })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			expect(screen.getByText('(1)')).toBeInTheDocument();
		});

		it('does not show exit code indicator for exit code 0', () => {
			const tabs = [createTerminalTab({ id: 'term-1', state: 'exited', exitCode: 0 })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			expect(screen.queryByText('(0)')).not.toBeInTheDocument();
		});
	});

	describe('close button visibility', () => {
		it('hides close button when only one tab exists', () => {
			const tabs = [createTerminalTab()];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			// Close button should not be visible even for the active tab
			expect(screen.queryByTitle('Close terminal')).not.toBeInTheDocument();
		});

		it('shows close button on active tab when multiple tabs exist', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			// Active tab should have a close button visible
			expect(screen.getByTitle('Close terminal')).toBeInTheDocument();
		});
	});

	describe('interactions', () => {
		it('calls onTabSelect when tab is clicked', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			fireEvent.click(screen.getByText('Terminal 2'));
			expect(mockOnTabSelect).toHaveBeenCalledWith('term-2');
		});

		it('calls onTabClose when close button is clicked', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			fireEvent.click(screen.getByTitle('Close terminal'));
			expect(mockOnTabClose).toHaveBeenCalledWith('term-1');
		});

		it('calls onNewTab when new tab button is clicked', () => {
			render(
				<TerminalTabBar
					tabs={[createTerminalTab()]}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			fireEvent.click(screen.getByTitle(/New terminal/));
			expect(mockOnNewTab).toHaveBeenCalledOnce();
		});

		it('calls onRequestRename on double-click', () => {
			const tabs = [createTerminalTab({ id: 'term-1' })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
					onRequestRename={mockOnRequestRename}
				/>
			);

			fireEvent.doubleClick(screen.getByText('Terminal 1'));
			expect(mockOnRequestRename).toHaveBeenCalledWith('term-1');
		});

		it('calls onTabClose on middle-click when multiple tabs exist', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			// Middle-click (button 1)
			fireEvent.mouseDown(screen.getByText('Terminal 2'), { button: 1 });
			expect(mockOnTabClose).toHaveBeenCalledWith('term-2');
		});

		it('does not close on middle-click when only one tab exists', () => {
			const tabs = [createTerminalTab({ id: 'term-1' })];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
				/>
			);

			fireEvent.mouseDown(screen.getByText('Terminal 1'), { button: 1 });
			expect(mockOnTabClose).not.toHaveBeenCalled();
		});
	});

	describe('drag and drop', () => {
		it('calls onTabReorder when a tab is dropped on another', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
				createTerminalTab({ id: 'term-3' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
					onTabReorder={mockOnTabReorder}
				/>
			);

			const tab1 = screen.getByText('Terminal 1');
			const tab3 = screen.getByText('Terminal 3');

			// Simulate drag from tab 1 to tab 3
			fireEvent.dragStart(tab1, {
				dataTransfer: {
					effectAllowed: '',
					setData: vi.fn(),
				},
			});

			fireEvent.dragOver(tab3, {
				dataTransfer: {
					dropEffect: '',
				},
			});

			fireEvent.drop(tab3, {
				dataTransfer: {
					getData: () => 'term-1',
				},
			});

			expect(mockOnTabReorder).toHaveBeenCalledWith(0, 2);
		});

		it('does not reorder when dropping on same tab', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1' }),
				createTerminalTab({ id: 'term-2' }),
			];

			render(
				<TerminalTabBar
					tabs={tabs}
					activeTabId="term-1"
					theme={mockTheme}
					onTabSelect={mockOnTabSelect}
					onTabClose={mockOnTabClose}
					onNewTab={mockOnNewTab}
					onTabReorder={mockOnTabReorder}
				/>
			);

			const tab1 = screen.getByText('Terminal 1');

			fireEvent.drop(tab1, {
				dataTransfer: {
					getData: () => 'term-1',
				},
			});

			expect(mockOnTabReorder).not.toHaveBeenCalled();
		});
	});
});
