/**
 * @file terminalTabLongNames.test.tsx
 * @description Tests for terminal tab long name truncation:
 * - Tab name span has CSS truncation classes (truncate, max-w-[150px])
 * - Long names are rendered in full in the DOM (CSS handles visual truncation)
 * - Short names also have truncation classes (consistent styling)
 * - Tooltip still shows full untruncated name + cwd
 * - Both active and inactive tabs have truncation
 * - Default "Terminal" name has truncation
 * - Multiple tabs each apply truncation independently
 * - Truncation classes are consistent (text-xs, truncate, max-w-[150px])
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

/** Find the tab name span element by its text content */
function findTabNameSpan(name: string): HTMLElement {
	return screen.getByText(name);
}

/** Find the terminal tab container div by its display text */
function findTerminalTab(name: string): HTMLElement {
	const tabText = screen.getByText(name);
	return tabText.closest('[draggable]') as HTMLElement;
}

// ============================================================================
// Tests
// ============================================================================

describe('Terminal tab long name truncation', () => {
	afterEach(() => {
		cleanup();
	});

	// ================================================================
	// CSS truncation classes
	// ================================================================

	describe('truncation CSS classes', () => {
		it('tab name span has "truncate" class for ellipsis overflow', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'My Tab' });
			renderTabBar([tab]);

			const span = findTabNameSpan('My Tab');
			expect(span.className).toContain('truncate');
		});

		it('tab name span has "max-w-[150px]" class to constrain width', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'My Tab' });
			renderTabBar([tab]);

			const span = findTabNameSpan('My Tab');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('tab name span has "text-xs" class for font sizing', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'My Tab' });
			renderTabBar([tab]);

			const span = findTabNameSpan('My Tab');
			expect(span.className).toContain('text-xs');
		});

		it('all three truncation-related classes are present together', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Short' });
			renderTabBar([tab]);

			const span = findTabNameSpan('Short');
			const className = span.className;
			expect(className).toContain('text-xs');
			expect(className).toContain('truncate');
			expect(className).toContain('max-w-[150px]');
		});
	});

	// ================================================================
	// Long names are rendered in DOM
	// ================================================================

	describe('long name rendering', () => {
		it('renders very long name in full in the DOM (CSS handles visual truncation)', () => {
			const longName = 'This is a very long terminal tab name that exceeds 150 pixels';
			const tab = createTerminalTab({ id: 'term-1', name: longName });
			renderTabBar([tab]);

			const span = findTabNameSpan(longName);
			expect(span.textContent).toBe(longName);
		});

		it('renders a 100-character name in the DOM', () => {
			const name100 = 'A'.repeat(100);
			const tab = createTerminalTab({ id: 'term-1', name: name100 });
			renderTabBar([tab]);

			const span = findTabNameSpan(name100);
			expect(span.textContent).toBe(name100);
			expect(span.className).toContain('truncate');
		});

		it('renders name with special characters', () => {
			const specialName = 'npm run dev:watch — frontend (hot-reload)';
			const tab = createTerminalTab({ id: 'term-1', name: specialName });
			renderTabBar([tab]);

			const span = findTabNameSpan(specialName);
			expect(span.textContent).toBe(specialName);
		});

		it('renders name with unicode characters', () => {
			const unicodeName = '🚀 Deploy Server — Production 日本語';
			const tab = createTerminalTab({ id: 'term-1', name: unicodeName });
			renderTabBar([tab]);

			const span = findTabNameSpan(unicodeName);
			expect(span.textContent).toBe(unicodeName);
		});
	});

	// ================================================================
	// Short names also have truncation (consistent styling)
	// ================================================================

	describe('short names', () => {
		it('short name still has truncation classes', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'sh' });
			renderTabBar([tab]);

			const span = findTabNameSpan('sh');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('single character name has truncation classes', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Z' });
			renderTabBar([tab]);

			const span = findTabNameSpan('Z');
			expect(span.className).toContain('truncate');
		});
	});

	// ================================================================
	// Default "Terminal" name
	// ================================================================

	describe('default name', () => {
		it('default "Terminal" name has truncation classes', () => {
			const tab = createTerminalTab({ id: 'term-1', name: null });
			renderTabBar([tab]);

			const span = findTabNameSpan('Terminal');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});
	});

	// ================================================================
	// Active vs inactive tabs
	// ================================================================

	describe('active vs inactive tabs', () => {
		it('active tab has truncation classes', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Active Long Name That Is Very Extended' });
			renderTabBar([tab], { activeTerminalTabId: 'term-1' });

			const span = findTabNameSpan('Active Long Name That Is Very Extended');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('inactive tab has truncation classes', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'Active' });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Inactive Long Name That Is Very Extended' });
			renderTabBar([tab1, tab2], { activeTerminalTabId: 'term-1' });

			const span = findTabNameSpan('Inactive Long Name That Is Very Extended');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('active tab has a color style applied', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Active' });
			renderTabBar([tab], { activeTerminalTabId: 'term-1' });

			const span = findTabNameSpan('Active');
			expect(span.style.color).toBeTruthy();
		});

		it('inactive tab has a different color from active tab', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'Active' });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Inactive' });
			renderTabBar([tab1, tab2], { activeTerminalTabId: 'term-1' });

			const activeSpan = findTabNameSpan('Active');
			const inactiveSpan = findTabNameSpan('Inactive');
			expect(activeSpan.style.color).not.toBe(inactiveSpan.style.color);
		});
	});

	// ================================================================
	// Tooltip preserves full name
	// ================================================================

	describe('tooltip shows full name despite truncation', () => {
		it('very long name is fully visible in tooltip', () => {
			const longName = 'This is a very long terminal tab name that should be fully visible in tooltip';
			const tab = createTerminalTab({ id: 'term-1', name: longName, cwd: '/workspace' });
			renderTabBar([tab]);

			const container = findTerminalTab(longName);
			expect(container.getAttribute('title')).toBe(`${longName} — /workspace`);
		});

		it('default name tooltip is unaffected by truncation', () => {
			const tab = createTerminalTab({ id: 'term-1', cwd: '/home/user/projects' });
			renderTabBar([tab]);

			const container = findTerminalTab('Terminal');
			expect(container.getAttribute('title')).toBe('Terminal — /home/user/projects');
		});
	});

	// ================================================================
	// Multiple tabs
	// ================================================================

	describe('multiple tabs with long names', () => {
		it('each tab independently applies truncation', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'Very Long Frontend Development Server Tab' });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Backend API with Database Connection Pool' });
			const tab3 = createTerminalTab({ id: 'term-3', name: null });
			renderTabBar([tab1, tab2, tab3]);

			const span1 = findTabNameSpan('Very Long Frontend Development Server Tab');
			const span2 = findTabNameSpan('Backend API with Database Connection Pool');
			const span3 = findTabNameSpan('Terminal');

			// All tabs have truncation classes
			for (const span of [span1, span2, span3]) {
				expect(span.className).toContain('truncate');
				expect(span.className).toContain('max-w-[150px]');
			}
		});
	});

	// ================================================================
	// Theme integration
	// ================================================================

	describe('theme integration', () => {
		it('truncation classes are present with dark theme', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Dark Theme Long Tab Name Test' });
			renderTabBar([tab], { theme: darkTheme });

			const span = findTabNameSpan('Dark Theme Long Tab Name Test');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('truncation classes are present with light theme', () => {
			const tab = createTerminalTab({ id: 'term-1', name: 'Light Theme Long Tab Name Test' });
			renderTabBar([tab], { theme: lightTheme });

			const span = findTabNameSpan('Light Theme Long Tab Name Test');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});
	});

	// ================================================================
	// Tab states with truncation
	// ================================================================

	describe('tab states', () => {
		it('spawning tab has truncation', () => {
			const tab = createTerminalTab({
				id: 'term-1',
				name: 'Spawning Tab With Long Name',
				processRunning: undefined,
			});
			renderTabBar([tab]);

			const span = findTabNameSpan('Spawning Tab With Long Name');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('exited tab has truncation', () => {
			const tab = createTerminalTab({
				id: 'term-1',
				name: 'Exited Tab With Long Name',
				processRunning: false,
				exitCode: 0,
			});
			renderTabBar([tab]);

			const span = findTabNameSpan('Exited Tab With Long Name');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});

		it('errored tab has truncation', () => {
			const tab = createTerminalTab({
				id: 'term-1',
				name: 'Errored Tab With Long Name',
				processRunning: false,
				exitCode: 127,
			});
			renderTabBar([tab]);

			const span = findTabNameSpan('Errored Tab With Long Name');
			expect(span.className).toContain('truncate');
			expect(span.className).toContain('max-w-[150px]');
		});
	});
});
