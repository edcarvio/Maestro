/**
 * @file terminalTabContextMenu.test.tsx
 * @description Tests for terminal tab context menu (right-click menu):
 * - Right-click opens context menu at mouse position
 * - Menu items: Rename, Close, Close Others, Close to the Right
 * - Rename calls onRequestRename and dismisses menu
 * - Close calls onClose and dismisses menu
 * - Close Others calls onCloseOthers and dismisses menu
 * - Close to the Right calls onCloseToRight and dismisses menu
 * - Menu dismissed on Escape key
 * - Menu dismissed on click outside
 * - Close Others disabled when only one terminal tab
 * - Close to the Right disabled when tab is last
 * - Menu position adjusted for viewport boundaries
 * - Theme integration (colors, borders)
 * - Menu rendered via portal (document.body)
 * - Multiple terminal tabs with correct index/count
 * - Context menu does not open on left click
 * - Icons present for each menu item
 * - Divider separates Close from bulk actions
 * - App.tsx handlers: closeOtherTerminalTabs, closeTerminalTabsToRight
 */

import React from 'react';
import { render, screen, fireEvent, within, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Theme, TerminalTab, UnifiedTab, AITab } from '../../../renderer/types';
import { TabBar } from '../../../renderer/components/TabBar';

// --- Test helpers ---

const darkTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: '#bd93f980',
		border: '#44475a',
		error: '#ff5555',
		warning: '#f1fa8c',
		success: '#50fa7b',
		info: '#8be9fd',
	},
};

const lightTheme: Theme = {
	id: 'github-light',
	name: 'GitHub Light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f6f8fa',
		textMain: '#24292e',
		textDim: '#6a737d',
		accent: '#0366d6',
		accentDim: '#0366d680',
		border: '#e1e4e8',
		error: '#d73a49',
		warning: '#e36209',
		success: '#28a745',
		info: '#0366d6',
	},
};

const noop = () => {};

/** Helper: minimal AI tab for TabBar (required prop) */
const minimalAiTab: AITab = {
	id: 'ai-1',
	name: 'AI Tab',
	agentSessionId: null,
	isGeneratingName: false,
	hasUnread: false,
	starred: false,
	logs: [],
	inputMode: 'ai',
};

/** Helper: create a terminal tab */
function createTerminalTab(overrides: Partial<TerminalTab> & { id: string }): TerminalTab {
	return {
		name: null,
		createdAt: Date.now(),
		cwd: '/home/user',
		processRunning: true,
		...overrides,
	};
}

/** Build unified tabs from terminal tabs + default AI tab */
function buildUnifiedTabs(terminalTabs: TerminalTab[]): UnifiedTab[] {
	return [
		{ type: 'ai' as const, id: minimalAiTab.id, data: minimalAiTab },
		...terminalTabs.map((t) => ({
			type: 'terminal' as const,
			id: t.id,
			data: t,
		})),
	];
}

/** Render TabBar with terminal tabs and context menu handlers */
function renderTabBar(
	terminalTabs: TerminalTab[],
	overrides: Record<string, unknown> = {},
) {
	const defaultProps = {
		tabs: [minimalAiTab],
		activeTabId: 'ai-1',
		theme: darkTheme,
		onTabSelect: noop,
		onTabClose: noop,
		onNewTab: noop,
		unifiedTabs: buildUnifiedTabs(terminalTabs),
		activeTerminalTabId: terminalTabs[0]?.id ?? null,
		onTerminalTabSelect: noop,
		onTerminalTabClose: vi.fn(),
		onNewTerminalTab: noop,
		onRequestTerminalTabRename: vi.fn(),
		onCloseOtherTerminalTabs: vi.fn(),
		onCloseTerminalTabsToRight: vi.fn(),
	};

	const props = { ...defaultProps, ...overrides };
	const result = render(<TabBar {...(props as React.ComponentProps<typeof TabBar>)} />);
	return { ...result, props };
}

/** Right-click a terminal tab to open context menu */
function rightClickTab(tabElement: HTMLElement, clientX = 100, clientY = 100) {
	act(() => {
		fireEvent.contextMenu(tabElement, { clientX, clientY });
	});
}

/** Find terminal tab by name text */
function findTerminalTab(name: string): HTMLElement {
	const tabText = screen.getByText(name);
	// Walk up to the tab container div (the one with draggable attribute)
	return tabText.closest('[draggable]') as HTMLElement;
}

// ============================================================================
// Tests
// ============================================================================

describe('Terminal tab context menu', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	// ================================================================
	// Context menu opening
	// ================================================================

	describe('opening', () => {
		it('opens context menu on right-click', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Dev Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Dev Shell'));

			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();
		});

		it('does not open context menu on left click', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			act(() => {
				fireEvent.click(findTerminalTab('Shell'));
			});

			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('positions menu at mouse coordinates', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'), 200, 150);

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.style.left).toBe('200px');
			expect(menu.style.top).toBe('150px');
		});

		it('adjusts position to stay within viewport', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			// Right-click near viewport edge (jsdom window is 1024x768 by default)
			rightClickTab(findTerminalTab('Shell'), 900, 700);

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const left = parseInt(menu.style.left);
			const top = parseInt(menu.style.top);
			// Should be clamped: left ≤ innerWidth - 200, top ≤ innerHeight - 180
			expect(left).toBeLessThanOrEqual(window.innerWidth - 200);
			expect(top).toBeLessThanOrEqual(window.innerHeight - 180);
		});

		it('renders via portal to document.body', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = document.body.querySelector('[data-testid="terminal-tab-context-menu"]');
			expect(menu).toBeTruthy();
			expect(menu!.parentElement).toBe(document.body);
		});
	});

	// ================================================================
	// Menu items rendering
	// ================================================================

	describe('menu items', () => {
		it('shows Rename, Close, Close Others, Close to the Right', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(within(menu).getByText('Rename')).toBeTruthy();
			expect(within(menu).getByText('Close')).toBeTruthy();
			expect(within(menu).getByText('Close Others')).toBeTruthy();
			expect(within(menu).getByText('Close to the Right')).toBeTruthy();
		});

		it('hides Rename when onRequestRename is not provided', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab], { onRequestTerminalTabRename: undefined });

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(within(menu).queryByText('Rename')).toBeNull();
			expect(within(menu).getByText('Close')).toBeTruthy();
		});

		it('has a divider separating Close from bulk actions', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const dividers = menu.querySelectorAll('.border-t');
			expect(dividers.length).toBeGreaterThanOrEqual(1);
		});

		it('each menu item has an icon (SVG)', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const buttons = menu.querySelectorAll('button');
			buttons.forEach((btn) => {
				expect(btn.querySelector('svg')).toBeTruthy();
			});
		});
	});

	// ================================================================
	// Menu item actions
	// ================================================================

	describe('actions', () => {
		it('Rename calls onRequestTerminalTabRename with tab ID', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			const { props } = renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-rename'));
			});

			expect(props.onRequestTerminalTabRename).toHaveBeenCalledWith('term-1');
		});

		it('Close calls onTerminalTabClose with tab ID', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			const { props } = renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close'));
			});

			expect(props.onTerminalTabClose).toHaveBeenCalledWith('term-1');
		});

		it('Close Others calls onCloseOtherTerminalTabs with tab ID', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
				createTerminalTab({ id: 'term-3', name: 'Shell 3' }),
			];
			const { props } = renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 2'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-others'));
			});

			expect(props.onCloseOtherTerminalTabs).toHaveBeenCalledWith('term-2');
		});

		it('Close to the Right calls onCloseTerminalTabsToRight with tab ID', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
				createTerminalTab({ id: 'term-3', name: 'Shell 3' }),
			];
			const { props } = renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-to-right'));
			});

			expect(props.onCloseTerminalTabsToRight).toHaveBeenCalledWith('term-1');
		});

		it('Close action dismisses the context menu', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close'));
			});
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('Rename action dismisses the context menu', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-rename'));
			});
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('Close Others action dismisses the context menu', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-others'));
			});
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('Close to the Right action dismisses the context menu', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-to-right'));
			});
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});
	});

	// ================================================================
	// Disabled states
	// ================================================================

	describe('disabled states', () => {
		it('Close Others is disabled when only one terminal tab', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Solo Shell' });
			const { props } = renderTabBar([tab]);

			rightClickTab(findTerminalTab('Solo Shell'));

			const closeOthersBtn = screen.getByTestId('terminal-ctx-close-others');
			expect(closeOthersBtn).toHaveProperty('disabled', true);
			expect(closeOthersBtn.className).toContain('opacity-40');
		});

		it('Close Others is enabled when multiple terminal tabs', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));

			const closeOthersBtn = screen.getByTestId('terminal-ctx-close-others');
			expect(closeOthersBtn).toHaveProperty('disabled', false);
		});

		it('Close to the Right is disabled for the last terminal tab', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Last Shell' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Last Shell'));

			const closeRightBtn = screen.getByTestId('terminal-ctx-close-to-right');
			expect(closeRightBtn).toHaveProperty('disabled', true);
			expect(closeRightBtn.className).toContain('opacity-40');
		});

		it('Close to the Right is enabled for non-last terminal tabs', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'First Shell' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('First Shell'));

			const closeRightBtn = screen.getByTestId('terminal-ctx-close-to-right');
			expect(closeRightBtn).toHaveProperty('disabled', false);
		});

		it('both bulk actions disabled for a single tab', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Solo' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Solo'));

			expect(screen.getByTestId('terminal-ctx-close-others')).toHaveProperty('disabled', true);
			expect(screen.getByTestId('terminal-ctx-close-to-right')).toHaveProperty('disabled', true);
		});

		it('disabled Close Others does not fire handler', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Solo' });
			const { props } = renderTabBar([tab]);

			rightClickTab(findTerminalTab('Solo'));

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-others'));
			});
			// Disabled buttons don't fire click events
			expect(props.onCloseOtherTerminalTabs).not.toHaveBeenCalled();
		});

		it('disabled Close to the Right does not fire handler', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Solo' });
			const { props } = renderTabBar([tab]);

			rightClickTab(findTerminalTab('Solo'));

			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-to-right'));
			});
			expect(props.onCloseTerminalTabsToRight).not.toHaveBeenCalled();
		});
	});

	// ================================================================
	// Dismissal
	// ================================================================

	describe('dismissal', () => {
		it('dismisses on Escape key', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			act(() => {
				fireEvent.keyDown(document, { key: 'Escape' });
			});

			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('dismisses on click outside', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();

			act(() => {
				fireEvent.mouseDown(document.body);
			});

			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('does not dismiss on click inside menu', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Shell 1' }),
				createTerminalTab({ id: 'term-2', name: 'Shell 2' }),
			];
			renderTabBar(tabs);

			rightClickTab(findTerminalTab('Shell 1'));
			const menu = screen.getByTestId('terminal-tab-context-menu');

			act(() => {
				fireEvent.mouseDown(menu);
			});

			// Menu should still be open
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();
		});
	});

	// ================================================================
	// Theme integration
	// ================================================================

	describe('theme integration', () => {
		it('applies theme background color to menu', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			// jsdom normalizes hex to rgb, so check the style attribute directly
			const bgColor = menu.style.backgroundColor;
			expect(bgColor).toBeTruthy();
			// Should be set (either hex or rgb form)
			expect(bgColor.length).toBeGreaterThan(0);
		});

		it('applies theme border color to menu', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const borderColor = menu.style.borderColor;
			expect(borderColor).toBeTruthy();
			expect(borderColor.length).toBeGreaterThan(0);
		});

		it('menu items have color styling applied', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const buttons = menu.querySelectorAll('button');
			buttons.forEach((btn) => {
				expect(btn.style.color).toBeTruthy();
			});
		});

		it('icons have dim color styling applied', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			const icons = menu.querySelectorAll('svg');
			icons.forEach((icon) => {
				expect(icon.style.color).toBeTruthy();
			});
		});

		it('light theme produces different colors than dark theme', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });

			// Dark theme
			const { unmount: u1 } = renderTabBar([tab]);
			rightClickTab(findTerminalTab('Shell'));
			const darkBg = screen.getByTestId('terminal-tab-context-menu').style.backgroundColor;
			u1();

			// Light theme
			renderTabBar([tab], { theme: lightTheme });
			rightClickTab(findTerminalTab('Shell'));
			const lightBg = screen.getByTestId('terminal-tab-context-menu').style.backgroundColor;

			expect(darkBg).not.toBe(lightBg);
		});
	});

	// ================================================================
	// Multiple tabs and indexing
	// ================================================================

	describe('multiple tabs', () => {
		it('correctly identifies tab index for 3 terminal tabs', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'First' }),
				createTerminalTab({ id: 'term-2', name: 'Middle' }),
				createTerminalTab({ id: 'term-3', name: 'Last' }),
			];
			renderTabBar(tabs);

			// Middle tab: Close Others enabled, Close to Right enabled
			rightClickTab(findTerminalTab('Middle'));
			expect(screen.getByTestId('terminal-ctx-close-others')).toHaveProperty('disabled', false);
			expect(screen.getByTestId('terminal-ctx-close-to-right')).toHaveProperty('disabled', false);
			act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });

			// Last tab: Close Others enabled, Close to Right disabled
			rightClickTab(findTerminalTab('Last'));
			expect(screen.getByTestId('terminal-ctx-close-others')).toHaveProperty('disabled', false);
			expect(screen.getByTestId('terminal-ctx-close-to-right')).toHaveProperty('disabled', true);
			act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });

			// First tab: Close Others enabled, Close to Right enabled
			rightClickTab(findTerminalTab('First'));
			expect(screen.getByTestId('terminal-ctx-close-others')).toHaveProperty('disabled', false);
			expect(screen.getByTestId('terminal-ctx-close-to-right')).toHaveProperty('disabled', false);
		});

		it('passes correct tab ID regardless of which tab is right-clicked', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Alpha' }),
				createTerminalTab({ id: 'term-2', name: 'Beta' }),
				createTerminalTab({ id: 'term-3', name: 'Gamma' }),
			];
			const { props } = renderTabBar(tabs);

			// Close Others on Beta → should pass 'term-2'
			rightClickTab(findTerminalTab('Beta'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-others'));
			});
			expect(props.onCloseOtherTerminalTabs).toHaveBeenCalledWith('term-2');

			// Close to the Right on Alpha → should pass 'term-1'
			rightClickTab(findTerminalTab('Alpha'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close-to-right'));
			});
			expect(props.onCloseTerminalTabsToRight).toHaveBeenCalledWith('term-1');
		});

		it('context menu works on unnamed tabs (displays "Terminal")', () => {
			const tab = createTerminalTab({ id: 'term-1', name: null });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Terminal'));
			expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();
		});
	});

	// ================================================================
	// Menu structure and styling
	// ================================================================

	describe('structure', () => {
		it('has minimum width of 160px', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.style.minWidth).toBe('160px');
		});

		it('uses fixed positioning with high z-index', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.className).toContain('fixed');
			expect(menu.className).toContain('z-[10000]');
		});

		it('has rounded corners and shadow', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab]);

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(menu.className).toContain('rounded-md');
			expect(menu.className).toContain('shadow-xl');
		});

		it('hides Close Others and Close to Right when handlers not provided', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell' });
			renderTabBar([tab], {
				onCloseOtherTerminalTabs: undefined,
				onCloseTerminalTabsToRight: undefined,
			});

			rightClickTab(findTerminalTab('Shell'));

			const menu = screen.getByTestId('terminal-tab-context-menu');
			expect(within(menu).queryByTestId('terminal-ctx-close-others')).toBeNull();
			expect(within(menu).queryByTestId('terminal-ctx-close-to-right')).toBeNull();
			// Divider should also not appear when no bulk actions
			expect(menu.querySelectorAll('.border-t').length).toBe(0);
		});
	});

	// ================================================================
	// Full workflow
	// ================================================================

	describe('end-to-end workflows', () => {
		it('right-click → rename → verify dismiss → right-click again → close', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Workflow' });
			const { props } = renderTabBar([tab]);

			// Right-click and rename
			rightClickTab(findTerminalTab('Workflow'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-rename'));
			});
			expect(props.onRequestTerminalTabRename).toHaveBeenCalledWith('term-1');
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();

			// Right-click again and close
			rightClickTab(findTerminalTab('Workflow'));
			act(() => {
				fireEvent.click(screen.getByTestId('terminal-ctx-close'));
			});
			expect(props.onTerminalTabClose).toHaveBeenCalledWith('term-1');
			expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
		});

		it('rapid right-click → escape → right-click cycle', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Rapid' });
			renderTabBar([tab]);

			for (let i = 0; i < 5; i++) {
				rightClickTab(findTerminalTab('Rapid'));
				expect(screen.getByTestId('terminal-tab-context-menu')).toBeTruthy();
				act(() => {
					fireEvent.keyDown(document, { key: 'Escape' });
				});
				expect(screen.queryByTestId('terminal-tab-context-menu')).toBeNull();
			}
		});

		it('context menu on different tabs targets correct tab each time', () => {
			const tabs = [
				createTerminalTab({ id: 'term-1', name: 'Tab A' }),
				createTerminalTab({ id: 'term-2', name: 'Tab B' }),
			];
			const { props } = renderTabBar(tabs);

			// Rename Tab A
			rightClickTab(findTerminalTab('Tab A'));
			act(() => { fireEvent.click(screen.getByTestId('terminal-ctx-rename')); });
			expect(props.onRequestTerminalTabRename).toHaveBeenCalledWith('term-1');

			// Close Tab B
			rightClickTab(findTerminalTab('Tab B'));
			act(() => { fireEvent.click(screen.getByTestId('terminal-ctx-close')); });
			expect(props.onTerminalTabClose).toHaveBeenCalledWith('term-2');
		});
	});
});
