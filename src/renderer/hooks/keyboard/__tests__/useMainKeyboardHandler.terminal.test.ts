/**
 * Tests for terminal-mode keyboard shortcuts in useMainKeyboardHandler.
 * Validates that terminal tab navigation, creation, closing, and clearing
 * shortcuts work correctly when inputMode === 'terminal'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMainKeyboardHandler } from '../useMainKeyboardHandler';

// Helper to create a mock keyboard event and dispatch it on window
function fireKey(
	key: string,
	modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
	extra: Partial<KeyboardEventInit> = {}
) {
	const event = new KeyboardEvent('keydown', {
		key,
		metaKey: modifiers.meta ?? false,
		ctrlKey: modifiers.ctrl ?? false,
		shiftKey: modifiers.shift ?? false,
		altKey: modifiers.alt ?? false,
		bubbles: true,
		cancelable: true,
		...extra,
	});
	window.dispatchEvent(event);
	return event;
}

// Minimal terminal tab factory
function makeTerminalTab(id: string) {
	return { id, name: null, createdAt: Date.now(), cwd: '/tmp' };
}

// Creates a mock context with terminal mode active
function makeTerminalCtx(overrides: Record<string, unknown> = {}) {
	const tabs = [makeTerminalTab('tab-1'), makeTerminalTab('tab-2'), makeTerminalTab('tab-3')];

	return {
		// Session state
		activeSessionId: 'session-1',
		activeSession: {
			id: 'session-1',
			inputMode: 'terminal',
			terminalTabs: tabs,
			activeTerminalTabId: 'tab-2',
			aiTabs: [],
			activeTabId: null,
		},
		activeGroupChatId: null,
		sessions: [{ id: 'session-1' }],

		// Shortcut matchers — stub that matches based on simple key mapping
		isShortcut: vi.fn(() => false),
		isTabShortcut: vi.fn((e: KeyboardEvent, actionId: string) => {
			const keyMap: Record<string, (e: KeyboardEvent) => boolean> = {
				prevTab: (ev) => (ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === '[' || ev.key === '{'),
				nextTab: (ev) => (ev.metaKey || ev.ctrlKey) && ev.shiftKey && (ev.key === ']' || ev.key === '}'),
				closeTab: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === 'w',
				reopenClosedTab: (ev) => (ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 't',
				goToTab1: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '1',
				goToTab2: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '2',
				goToTab3: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '3',
				goToTab4: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '4',
				goToTab5: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '5',
				goToTab6: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '6',
				goToTab7: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '7',
				goToTab8: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '8',
				goToTab9: (ev) => (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && ev.key === '9',
			};
			return keyMap[actionId]?.(e) ?? false;
		}),

		// Terminal handlers
		handleNewTerminalTab: vi.fn(),
		handleTerminalTabSelect: vi.fn(),
		handleTerminalTabClose: vi.fn(),
		handleReopenTerminalTab: vi.fn(),

		// General handlers (should NOT be called in terminal mode for overridden shortcuts)
		setQuickActionInitialMode: vi.fn(),
		setQuickActionOpen: vi.fn(),

		// Stubs for other context properties the handler accesses
		editingSessionId: null,
		editingGroupId: null,
		hasOpenLayers: vi.fn(() => false),
		hasOpenModal: vi.fn(() => false),
		handleSidebarNavigation: vi.fn(() => false),
		handleEnterToActivate: vi.fn(() => false),
		handleTabNavigation: vi.fn(() => false),
		handleEscapeInMain: vi.fn(() => false),
		recordShortcutUsage: vi.fn(() => ({ newLevel: null })),
		onKeyboardMasteryLevelUp: vi.fn(),
		leftSidebarOpen: true,
		setLeftSidebarOpen: vi.fn(),
		setRightPanelOpen: vi.fn(),
		addNewSession: vi.fn(),
		deleteSession: vi.fn(),
		cycleSession: vi.fn(),
		toggleInputMode: vi.fn(),
		setSessions: vi.fn(),
		terminalViewRef: { current: { clearActiveTerminal: vi.fn() } },
		visibleSessions: [],

		// Override with caller-provided values
		...overrides,
	};
}

describe('useMainKeyboardHandler — terminal mode shortcuts', () => {
	let result: ReturnType<typeof useMainKeyboardHandler>;

	function setup(ctxOverrides: Record<string, unknown> = {}) {
		const hookResult = renderHook(() => useMainKeyboardHandler());
		result = hookResult.result.current;
		const ctx = makeTerminalCtx(ctxOverrides);
		// Assign context to the ref so the handler can read it
		result.keyboardHandlerRef.current = ctx;
		return ctx;
	}

	describe('Ctrl+Shift+` — New terminal tab', () => {
		it('should call handleNewTerminalTab', () => {
			const ctx = setup();
			act(() => {
				fireKey('`', { ctrl: true, shift: true });
			});
			expect(ctx.handleNewTerminalTab).toHaveBeenCalledOnce();
		});

		it('should also match ~ (Shift+` on some keyboards)', () => {
			const ctx = setup();
			act(() => {
				fireKey('~', { ctrl: true, shift: true });
			});
			expect(ctx.handleNewTerminalTab).toHaveBeenCalledOnce();
		});

		it('should NOT fire when not in terminal mode', () => {
			const ctx = setup({
				activeSession: {
					id: 'session-1',
					inputMode: 'ai',
					terminalTabs: [],
					activeTerminalTabId: null,
					aiTabs: [],
					activeTabId: null,
				},
			});
			act(() => {
				fireKey('`', { ctrl: true, shift: true });
			});
			expect(ctx.handleNewTerminalTab).not.toHaveBeenCalled();
		});
	});

	describe('Cmd+K — Clear terminal', () => {
		it('should call clearActiveTerminal on terminalViewRef', () => {
			const ctx = setup();
			act(() => {
				fireKey('k', { meta: true });
			});
			expect(ctx.terminalViewRef.current.clearActiveTerminal).toHaveBeenCalledOnce();
		});

		it('should NOT open Quick Actions in terminal mode', () => {
			const ctx = setup();
			// Make isShortcut return true for quickAction to simulate what would happen
			// if the terminal block didn't intercept
			(ctx.isShortcut as ReturnType<typeof vi.fn>).mockImplementation(
				(_e: KeyboardEvent, id: string) => id === 'quickAction'
			);
			act(() => {
				fireKey('k', { meta: true });
			});
			expect(ctx.setQuickActionOpen).not.toHaveBeenCalled();
		});
	});

	describe('Cmd+Shift+[ — Previous terminal tab', () => {
		it('should select the previous tab', () => {
			const ctx = setup(); // activeTerminalTabId is 'tab-2' (index 1)
			act(() => {
				fireKey('[', { meta: true, shift: true });
			});
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('tab-1');
		});

		it('should not select when already at first tab', () => {
			const ctx = setup({
				activeSession: {
					id: 'session-1',
					inputMode: 'terminal',
					terminalTabs: [makeTerminalTab('tab-1'), makeTerminalTab('tab-2')],
					activeTerminalTabId: 'tab-1',
					aiTabs: [],
					activeTabId: null,
				},
			});
			act(() => {
				fireKey('[', { meta: true, shift: true });
			});
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
		});
	});

	describe('Cmd+Shift+] — Next terminal tab', () => {
		it('should select the next tab', () => {
			const ctx = setup(); // activeTerminalTabId is 'tab-2' (index 1)
			act(() => {
				fireKey(']', { meta: true, shift: true });
			});
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('tab-3');
		});

		it('should not select when already at last tab', () => {
			const ctx = setup({
				activeSession: {
					id: 'session-1',
					inputMode: 'terminal',
					terminalTabs: [makeTerminalTab('tab-1'), makeTerminalTab('tab-2')],
					activeTerminalTabId: 'tab-2',
					aiTabs: [],
					activeTabId: null,
				},
			});
			act(() => {
				fireKey(']', { meta: true, shift: true });
			});
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
		});
	});

	describe('Cmd+W — Close terminal tab', () => {
		it('should close the active terminal tab when more than one exists', () => {
			const ctx = setup(); // 3 tabs, active is 'tab-2'
			act(() => {
				fireKey('w', { meta: true });
			});
			expect(ctx.handleTerminalTabClose).toHaveBeenCalledWith('tab-2');
		});

		it('should NOT close when only one tab remains', () => {
			const ctx = setup({
				activeSession: {
					id: 'session-1',
					inputMode: 'terminal',
					terminalTabs: [makeTerminalTab('tab-1')],
					activeTerminalTabId: 'tab-1',
					aiTabs: [],
					activeTabId: null,
				},
			});
			act(() => {
				fireKey('w', { meta: true });
			});
			expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
		});
	});

	describe('Cmd+Shift+T — Reopen closed terminal tab', () => {
		it('should call handleReopenTerminalTab', () => {
			const ctx = setup();
			act(() => {
				fireKey('t', { meta: true, shift: true });
			});
			// Note: isTabShortcut checks for lowercase 't'
			expect(ctx.handleReopenTerminalTab).toHaveBeenCalledOnce();
		});
	});

	describe('Cmd+1-9 — Go to terminal tab by number', () => {
		it('should select tab by index (Cmd+1 → first tab)', () => {
			const ctx = setup();
			act(() => {
				fireKey('1', { meta: true });
			});
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('tab-1');
		});

		it('should select tab by index (Cmd+3 → third tab)', () => {
			const ctx = setup();
			act(() => {
				fireKey('3', { meta: true });
			});
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('tab-3');
		});

		it('should NOT select when index is out of range', () => {
			const ctx = setup(); // only 3 tabs
			act(() => {
				fireKey('4', { meta: true });
			});
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
		});
	});

	describe('terminal mode guard', () => {
		it('should not handle terminal shortcuts when in group chat', () => {
			const ctx = setup({ activeGroupChatId: 'group-1' });
			act(() => {
				fireKey('`', { ctrl: true, shift: true });
			});
			expect(ctx.handleNewTerminalTab).not.toHaveBeenCalled();
		});

		it('should not handle terminal shortcuts when no active session', () => {
			const ctx = setup({ activeSessionId: null, activeSession: null });
			act(() => {
				fireKey('`', { ctrl: true, shift: true });
			});
			expect(ctx.handleNewTerminalTab).not.toHaveBeenCalled();
		});
	});
});
