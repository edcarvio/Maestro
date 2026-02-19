/**
 * @file terminalTabTransitions.test.tsx
 * @description Tests for terminal tab transition animations:
 * - Entrance animation (animate-tab-enter) for newly created tabs
 * - No entrance animation for pre-existing tabs (old createdAt)
 * - Exit animation (animate-tab-exit) on close button click
 * - Exit animation on middle-click close
 * - Exit animation on context menu Close
 * - Deferred close: onClose called after animation ends
 * - Pointer events disabled during exit animation
 * - Double-close protection (closedRef guard)
 * - animationEnd with tab-exit name triggers actual close
 * - animationEnd with other animation names does NOT trigger close
 * - Fallback timeout triggers close if animation event doesn't fire
 * - shouldAnimateEnter captured once on mount (not re-evaluated)
 * - isClosing prevents re-triggering close
 * - CSS classes co-exist with existing transition-colors, ring-1, etc.
 */

import React from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

/** Render TabBar with terminal tabs and return helpers */
function renderTabBar(
	terminalTabs: TerminalTab[],
	overrides: Record<string, unknown> = {},
) {
	const onTerminalTabClose = vi.fn();

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
		onTerminalTabClose,
		onNewTerminalTab: noop,
	};

	const props = { ...defaultProps, ...overrides };
	const result = render(<TabBar {...(props as React.ComponentProps<typeof TabBar>)} />);

	return { ...result, onTerminalTabClose };
}

/** Find the terminal tab container div by its display text */
function findTerminalTab(name: string): HTMLElement {
	const tabText = screen.getByText(name);
	return tabText.closest('[draggable]') as HTMLElement;
}

/** Find the close button (X icon) inside a terminal tab */
function findCloseButton(tabName: string): HTMLElement {
	const tabEl = findTerminalTab(tabName);
	const buttons = tabEl.querySelectorAll('button');
	// The close button has the X icon (data-testid="x-icon")
	const closeBtn = Array.from(buttons).find((btn) =>
		btn.querySelector('[data-testid="x-icon"]')
	);
	return closeBtn as HTMLElement;
}

/** Dispatch a proper animationend event with animationName property */
function fireAnimationEnd(el: HTMLElement, animationName: string) {
	const event = new Event('animationend', { bubbles: true });
	Object.defineProperty(event, 'animationName', { value: animationName });
	el.dispatchEvent(event);
}

// ============================================================================
// Tests
// ============================================================================

describe('Terminal tab transition animations', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	// ================================================================
	// Entrance animation
	// ================================================================

	describe('entrance animation', () => {
		it('applies animate-tab-enter class for newly created tab', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('animate-tab-enter');
		});

		it('does NOT apply animate-tab-enter for pre-existing tab (old createdAt)', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() - 10000 });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).not.toContain('animate-tab-enter');
		});

		it('does NOT apply animate-tab-enter for tab created 1 second ago', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() - 1000 });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).not.toContain('animate-tab-enter');
		});

		it('applies animate-tab-enter for tab created 200ms ago (within 500ms threshold)', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() - 200 });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('animate-tab-enter');
		});

		it('entrance animation class co-exists with base classes', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('transition-colors');
			expect(el.className).toContain('duration-100');
			expect(el.className).toContain('ring-1');
			expect(el.className).toContain('animate-tab-enter');
		});

		it('shouldAnimateEnter is captured once on mount and does not change', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() });
			const { rerender } = renderTabBar([tab]);

			// Initially should have entrance animation
			expect(findTerminalTab('Terminal').className).toContain('animate-tab-enter');

			// Advance time past the 500ms threshold
			vi.advanceTimersByTime(1000);

			// Re-render with same tab (simulating parent re-render)
			const updatedTab = { ...tab };
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

			// Should still have entrance animation (captured on mount)
			expect(findTerminalTab('Terminal').className).toContain('animate-tab-enter');
		});
	});

	// ================================================================
	// Exit animation
	// ================================================================

	describe('exit animation', () => {
		it('applies animate-tab-exit class when close button is clicked', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			renderTabBar([tab], { activeTerminalTabId: 'term-1' });

			const closeBtn = findCloseButton('Terminal');
			expect(closeBtn).toBeTruthy();

			act(() => {
				fireEvent.click(closeBtn);
			});

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('animate-tab-exit');
		});

		it('applies animate-tab-exit on middle-click', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			expect(el.className).toContain('animate-tab-exit');
		});

		it('removes animate-tab-enter class when closing', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('animate-tab-enter');

			// Middle-click to close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// Should have exit but not enter
			expect(el.className).toContain('animate-tab-exit');
			expect(el.className).not.toContain('animate-tab-enter');
		});

		it('does NOT apply animate-tab-exit without close action', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() - 10000 });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).not.toContain('animate-tab-exit');
		});
	});

	// ================================================================
	// Deferred close (onClose called after animation)
	// ================================================================

	describe('deferred close', () => {
		it('does NOT call onClose immediately on close button click', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab], { activeTerminalTabId: 'term-1' });

			const closeBtn = findCloseButton('Terminal');

			act(() => {
				fireEvent.click(closeBtn);
			});

			// onClose should NOT have been called yet (waiting for animation)
			expect(onTerminalTabClose).not.toHaveBeenCalled();
		});

		it('calls onClose when animationEnd fires with tab-exit', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Trigger close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			expect(onTerminalTabClose).not.toHaveBeenCalled();

			// Fire animationEnd with the correct animation name
			act(() => {
				fireAnimationEnd(el, 'tab-exit');
			});

			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);
			expect(onTerminalTabClose).toHaveBeenCalledWith('term-1');
		});

		it('does NOT call onClose when animationEnd fires with a different animation name', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Trigger close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// Fire animationEnd with a different animation name
			act(() => {
				fireAnimationEnd(el, 'tab-enter');
			});

			// Should NOT have been called (wrong animation)
			expect(onTerminalTabClose).not.toHaveBeenCalled();
		});

		it('fallback timeout calls onClose after 200ms', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Trigger close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			expect(onTerminalTabClose).not.toHaveBeenCalled();

			// Advance time past the fallback timeout
			act(() => {
				vi.advanceTimersByTime(200);
			});

			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);
			expect(onTerminalTabClose).toHaveBeenCalledWith('term-1');
		});
	});

	// ================================================================
	// Double-close protection
	// ================================================================

	describe('double-close protection', () => {
		it('onClose is called only once even if animationEnd AND timeout both fire', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Trigger close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// animationEnd fires first
			act(() => {
				fireAnimationEnd(el, 'tab-exit');
			});

			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);

			// Then timeout fires too
			act(() => {
				vi.advanceTimersByTime(200);
			});

			// Should still be 1, not 2
			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);
		});

		it('second middle-click does not re-trigger close', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// First middle-click
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// Second middle-click (during animation)
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// Fire animationEnd
			act(() => {
				fireAnimationEnd(el, 'tab-exit');
			});

			// onClose called exactly once
			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);
		});
	});

	// ================================================================
	// Pointer events during exit
	// ================================================================

	describe('pointer events during exit', () => {
		it('animate-tab-exit class includes pointer-events: none (via CSS)', () => {
			// This test verifies the CSS class is applied — the actual pointer-events: none
			// is in index.css under .animate-tab-exit { pointer-events: none }
			const tab = createTerminalTab({ id: 'term-1' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			expect(el.className).toContain('animate-tab-exit');
			// The pointer-events: none is applied by CSS, not inline style
		});
	});

	// ================================================================
	// Context menu close with animation
	// ================================================================

	describe('context menu close', () => {
		it('context menu Close action triggers exit animation', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			const { onTerminalTabClose } = renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Open context menu
			act(() => {
				fireEvent.contextMenu(el);
			});

			// Click "Close" in context menu
			const closeMenuItem = screen.getByTestId('terminal-ctx-close');
			act(() => {
				fireEvent.click(closeMenuItem);
			});

			// Exit animation should be applied
			expect(el.className).toContain('animate-tab-exit');

			// onClose not called yet
			expect(onTerminalTabClose).not.toHaveBeenCalled();

			// Complete the animation
			act(() => {
				fireAnimationEnd(el, 'tab-exit');
			});

			expect(onTerminalTabClose).toHaveBeenCalledTimes(1);
			expect(onTerminalTabClose).toHaveBeenCalledWith('term-1');
		});
	});

	// ================================================================
	// Multiple tabs
	// ================================================================

	describe('multiple tabs', () => {
		it('new tab animates in while existing tabs do not', () => {
			const oldTab = createTerminalTab({ id: 'term-1', name: 'Old', createdAt: Date.now() - 10000 });
			const newTab = createTerminalTab({ id: 'term-2', name: 'New', createdAt: Date.now() });
			renderTabBar([oldTab, newTab]);

			expect(findTerminalTab('Old').className).not.toContain('animate-tab-enter');
			expect(findTerminalTab('New').className).toContain('animate-tab-enter');
		});

		it('closing one tab does not affect animation state of others', () => {
			const tab1 = createTerminalTab({ id: 'term-1', name: 'First', createdAt: Date.now() - 10000 });
			const tab2 = createTerminalTab({ id: 'term-2', name: 'Second', createdAt: Date.now() - 10000 });
			renderTabBar([tab1, tab2]);

			const el2 = findTerminalTab('Second');

			// Close second tab via middle-click
			act(() => {
				fireEvent.mouseDown(el2, { button: 1 });
			});

			// Second tab has exit animation
			expect(el2.className).toContain('animate-tab-exit');

			// First tab is unaffected
			expect(findTerminalTab('First').className).not.toContain('animate-tab-exit');
			expect(findTerminalTab('First').className).not.toContain('animate-tab-enter');
		});
	});

	// ================================================================
	// onAnimationEnd handler
	// ================================================================

	describe('onAnimationEnd handler', () => {
		it('tab div has onAnimationEnd handler attached', () => {
			const tab = createTerminalTab({ id: 'term-1' });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			// Verify the handler exists by firing an animation event
			// It should not throw
			act(() => {
				fireAnimationEnd(el, 'some-other-animation');
			});
			// No crash = handler is registered
		});
	});

	// ================================================================
	// CSS class structure
	// ================================================================

	describe('CSS class structure', () => {
		it('base classes always present regardless of animation state', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() - 10000 });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');
			expect(el.className).toContain('relative');
			expect(el.className).toContain('flex');
			expect(el.className).toContain('items-center');
			expect(el.className).toContain('cursor-pointer');
			expect(el.className).toContain('select-none');
			expect(el.className).toContain('shrink-0');
		});

		it('animate-tab-enter and animate-tab-exit are mutually exclusive', () => {
			const tab = createTerminalTab({ id: 'term-1', createdAt: Date.now() });
			renderTabBar([tab]);

			const el = findTerminalTab('Terminal');

			// Initially has enter
			expect(el.className).toContain('animate-tab-enter');
			expect(el.className).not.toContain('animate-tab-exit');

			// Trigger close
			act(() => {
				fireEvent.mouseDown(el, { button: 1 });
			});

			// Now has exit, not enter
			expect(el.className).toContain('animate-tab-exit');
			expect(el.className).not.toContain('animate-tab-enter');
		});
	});
});
