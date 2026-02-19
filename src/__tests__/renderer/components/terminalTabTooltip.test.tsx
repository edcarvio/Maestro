/**
 * @file terminalTabTooltip.test.tsx
 * @description Tests for terminal tab tooltip showing cwd on hover:
 * - Default tab (no custom name) shows "Terminal — /path/to/cwd"
 * - Named tab shows "Custom Name — /path/to/cwd"
 * - Different cwd values are reflected in the tooltip
 * - Tooltip updates when tab data changes (re-render)
 * - Multiple tabs each show their own cwd
 * - Long cwd paths are preserved in full (no truncation in title attr)
 * - Home directory cwd
 * - Root cwd
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
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

const noop = () => {};

/** Minimal AI tab (required TabBar prop) */
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

/** Create a terminal tab with defaults */
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

/** Render TabBar with terminal tabs */
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
		onTerminalTabClose: noop,
		onNewTerminalTab: noop,
	};

	const props = { ...defaultProps, ...overrides };
	return render(<TabBar {...(props as React.ComponentProps<typeof TabBar>)} />);
}

/** Find the terminal tab container div by its display text */
function findTerminalTab(name: string): HTMLElement {
	const tabText = screen.getByText(name);
	return tabText.closest('[draggable]') as HTMLElement;
}

// ============================================================================
// Tests
// ============================================================================

describe('Terminal tab tooltip (cwd on hover)', () => {
	afterEach(() => {
		cleanup();
	});

	// ================================================================
	// Default name (null → "Terminal")
	// ================================================================

	describe('default tab name', () => {
		it('shows "Terminal — /path" for unnamed tab', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/home/user/projects' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.getAttribute('title')).toBe('Terminal — /home/user/projects');
		});

		it('shows "Terminal — /" for root cwd', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.getAttribute('title')).toBe('Terminal — /');
		});

		it('shows "Terminal — ~" style home directory path', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/Users/dev' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.getAttribute('title')).toBe('Terminal — /Users/dev');
		});
	});

	// ================================================================
	// Custom tab name
	// ================================================================

	describe('named tab', () => {
		it('shows "CustomName — /path" for named tab', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Dev Shell', cwd: '/workspace/app' });
			renderTabBar([tab]);

			const el = findTerminalTab('Dev Shell');
			expect(el.getAttribute('title')).toBe('Dev Shell — /workspace/app');
		});

		it('includes full long path without truncation', () => {
			const longPath = '/very/deeply/nested/project/directory/structure/that/goes/on/and/on';
			const tab = createTerminalTab({ id: 'term-1', name: 'Deep', cwd: longPath });
			renderTabBar([tab]);

			const el = findTerminalTab('Deep');
			expect(el.getAttribute('title')).toBe(`Deep — ${longPath}`);
		});
	});

	// ================================================================
	// Multiple tabs
	// ================================================================

	describe('multiple tabs', () => {
		it('each tab shows its own cwd in the tooltip', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'Frontend', cwd: '/app/frontend' });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Backend', cwd: '/app/backend' });
			const tab3 = createTerminalTab({ id: 'term-3', cwd: '/tmp' });
			renderTabBar([tab1, tab2, tab3]);

			expect(findTerminalTab('Frontend').getAttribute('title')).toBe('Frontend — /app/frontend');
			expect(findTerminalTab('Backend').getAttribute('title')).toBe('Backend — /app/backend');
			expect(findTerminalTab('Terminal').getAttribute('title')).toBe('Terminal — /tmp');
		});
	});

	// ================================================================
	// Tooltip updates on re-render
	// ================================================================

	describe('re-render', () => {
		it('tooltip reflects updated cwd on re-render', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Shell', cwd: '/old/path' });
			const { rerender } = renderTabBar([tab]);

			expect(findTerminalTab('Shell').getAttribute('title')).toBe('Shell — /old/path');

			// Re-render with updated cwd
			const updatedTab = { ...tab, cwd: '/new/path' };
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([updatedTab])}
					activeTerminalTabId="term-1"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>,
			);

			expect(findTerminalTab('Shell').getAttribute('title')).toBe('Shell — /new/path');
		});

		it('tooltip reflects updated name on re-render', () => {
			const tab = createTerminalTab({ id: 'term-1', name: null, cwd: '/home/user' });
			const { rerender } = renderTabBar([tab]);

			expect(findTerminalTab('Terminal').getAttribute('title')).toBe('Terminal — /home/user');

			// Re-render with a name
			const namedTab = { ...tab, name: 'My Shell' };
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([namedTab])}
					activeTerminalTabId="term-1"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>,
			);

			expect(findTerminalTab('My Shell').getAttribute('title')).toBe('My Shell — /home/user');
		});
	});

	// ================================================================
	// Tooltip format consistency
	// ================================================================

	describe('format', () => {
		it('uses em dash (—) as separator, not hyphen', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/home' });
			renderTabBar([tab]);

			const title = findTerminalTab('Terminal').getAttribute('title')!;
			expect(title).toContain('—');
			expect(title).not.toMatch(/^Terminal - /); // Not a plain hyphen
		});

		it('tooltip matches pattern: "DisplayName — cwd"', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Build', cwd: '/project' });
			renderTabBar([tab]);

			const title = findTerminalTab('Build').getAttribute('title')!;
			expect(title).toMatch(/^Build — \/project$/);
		});
	});

	// ================================================================
	// Edge cases
	// ================================================================

	describe('edge cases', () => {
		it('handles cwd with spaces', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/Users/dev/My Projects/app' });
			renderTabBar([tab]);

			expect(findTerminalTab('Terminal').getAttribute('title')).toBe(
				'Terminal — /Users/dev/My Projects/app',
			);
		});

		it('handles Windows-style paths', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: 'C:\\Users\\dev\\projects' });
			renderTabBar([tab]);

			expect(findTerminalTab('Terminal').getAttribute('title')).toBe(
				'Terminal — C:\\Users\\dev\\projects',
			);
		});

		it('inactive tab also has tooltip', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'Active', cwd: '/active' });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Inactive', cwd: '/inactive' });
			renderTabBar([tab1, tab2], { activeTerminalTabId: 'term-1' });

			// Both tabs should have tooltips regardless of active state
			expect(findTerminalTab('Active').getAttribute('title')).toBe('Active — /active');
			expect(findTerminalTab('Inactive').getAttribute('title')).toBe('Inactive — /inactive');
		});

		it('spawning tab (no processRunning) still shows tooltip', () => {
			const tab = createTerminalTab({
				id: 'term-1',
				cwd: '/home/user',
				processRunning: undefined,
				exitCode: undefined,
			});
			renderTabBar([tab]);

			expect(findTerminalTab('Terminal').getAttribute('title')).toBe('Terminal — /home/user');
		});

		it('exited tab still shows tooltip', () => {
			const tab = createTerminalTab({
				id: 'term-1',
				name: 'Done',
				cwd: '/finished',
				processRunning: false,
				exitCode: 0,
			});
			renderTabBar([tab]);

			expect(findTerminalTab('Done').getAttribute('title')).toBe('Done — /finished');
		});
	});
});
