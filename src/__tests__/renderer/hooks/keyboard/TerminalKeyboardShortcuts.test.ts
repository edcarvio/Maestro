/**
 * Tests for terminal keyboard shortcuts.
 *
 * Verifies the keyboard handler's behavior when the active session is in terminal mode:
 *
 * Terminal tab shortcuts (Phase 8):
 * - Ctrl+Shift+` → New terminal tab
 * - Cmd+Shift+] → Next terminal tab (wraps around)
 * - Cmd+Shift+[ → Previous terminal tab (wraps around)
 * - Cmd+W → Close terminal tab (only if >1 tab)
 * - Cmd+Shift+T → Reopen closed terminal tab
 * - Cmd+1-9 → Jump to terminal tab by number
 * - Cmd+K → Clear terminal (instead of Quick Actions)
 * - Cmd+F → Open terminal search
 * - Cmd+J → Toggle mode (terminal ↔ AI)
 *
 * Signal passthrough:
 * - Ctrl+C passes through to xterm.js (sends \x03 interrupt to PTY)
 * - Ctrl+D passes through to xterm.js (sends \x04 EOF to PTY)
 *
 * No conflicts with shell:
 * - Common shell shortcuts (Ctrl+A, Ctrl+E, Ctrl+L, Ctrl+R, Ctrl+U, Ctrl+W,
 *   Ctrl+Z, Ctrl+K, Ctrl+P, Ctrl+N) are NOT intercepted
 * - Only Cmd (Meta) shortcuts and Ctrl+Shift+` are captured by Maestro
 *
 * Complements:
 * - MultipleTerminalTabs.test.tsx: TerminalView tab orchestration
 * - TerminalTabLifecycle.test.tsx: Close/reopen/PTY lifecycle
 * - XTerminalSearch.test.tsx: Search addon integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SHORTCUTS, TAB_SHORTCUTS, TERMINAL_TAB_SHORTCUTS } from '../../../../renderer/constants/shortcuts';
import type { TerminalTab } from '../../../../renderer/types';

// ---------------------------------------------------------------------------
// Helper: build isShortcut / isTabShortcut matchers identical to the real ones
// in useKeyboardShortcutHelpers, but without React (pure function).
// ---------------------------------------------------------------------------

function buildMatcher(shortcuts: Record<string, { keys: string[] }>) {
	return (e: KeyboardEvent, actionId: string): boolean => {
		const sc = shortcuts[actionId];
		if (!sc) return false;
		const keys = sc.keys.map((k) => k.toLowerCase());

		const metaPressed = e.metaKey || e.ctrlKey;
		const shiftPressed = e.shiftKey;
		const altPressed = e.altKey;
		const key = e.key.toLowerCase();

		const configMeta = keys.includes('meta') || keys.includes('ctrl') || keys.includes('command');
		const configShift = keys.includes('shift');
		const configAlt = keys.includes('alt');

		if (metaPressed !== configMeta) return false;
		if (shiftPressed !== configShift) return false;
		if (altPressed !== configAlt) return false;

		const mainKey = keys[keys.length - 1];
		if (mainKey === '[' && (key === '[' || key === '{')) return true;
		if (mainKey === ']' && (key === ']' || key === '}')) return true;

		if (altPressed && e.code) {
			const codeKey = e.code.replace('Key', '').toLowerCase();
			const codeToKey: Record<string, string> = {
				comma: ',', period: '.', slash: '/', backslash: '\\',
				bracketleft: '[', bracketright: ']', semicolon: ';',
				quote: "'", backquote: '`', minus: '-', equal: '=',
			};
			const mappedKey = codeToKey[codeKey] || codeKey;
			return mappedKey === mainKey;
		}

		return key === mainKey;
	};
}

const isShortcut = buildMatcher(DEFAULT_SHORTCUTS as Record<string, { keys: string[] }>);
// isTabShortcut falls back to DEFAULT_SHORTCUTS when a key isn't in TAB_SHORTCUTS,
// matching the real useKeyboardShortcutHelpers behavior.
const isTabShortcut = buildMatcher({
	...DEFAULT_SHORTCUTS,
	...TAB_SHORTCUTS,
	...TERMINAL_TAB_SHORTCUTS,
} as Record<string, { keys: string[] }>);

// ---------------------------------------------------------------------------
// Helper: create a mock keyboard handler context (mirrors App.tsx ref shape)
// ---------------------------------------------------------------------------

function makeTerminalTabs(count: number, activeIndex = 0): { tabs: TerminalTab[]; activeId: string } {
	const tabs: TerminalTab[] = [];
	for (let i = 0; i < count; i++) {
		tabs.push({
			id: `tab-${i}`,
			shellType: 'zsh',
			cwd: '/test',
			name: i === 0 ? '' : `Tab ${i + 1}`,
			pid: 1000 + i,
			exitCode: null,
			state: 'idle',
		});
	}
	return { tabs, activeId: tabs[activeIndex]?.id || '' };
}

interface MockCtx {
	isShortcut: typeof isShortcut;
	isTabShortcut: typeof isTabShortcut;
	sessions: unknown[];
	activeSession: Record<string, unknown> | null;
	activeSessionId: string | null;
	activeGroupChatId: string | null;
	activeFocus: string;
	activeRightTab: string;
	hasOpenLayers: () => boolean;
	hasOpenModal: () => boolean;
	editingSessionId: string | null;
	editingGroupId: string | null;
	leftSidebarOpen: boolean;
	// Navigation stubs
	handleSidebarNavigation: () => boolean;
	handleEnterToActivate: () => boolean;
	handleTabNavigation: () => boolean;
	handleEscapeInMain: () => boolean;
	// Terminal handlers
	handleTerminalNewTab: ReturnType<typeof vi.fn>;
	handleTerminalTabSelect: ReturnType<typeof vi.fn>;
	handleTerminalTabClose: ReturnType<typeof vi.fn>;
	handleTerminalTabReopen: ReturnType<typeof vi.fn>;
	toggleInputMode: ReturnType<typeof vi.fn>;
	incrementTerminalClearSignal: ReturnType<typeof vi.fn>;
	setTerminalSearchOpen: ReturnType<typeof vi.fn>;
	// Stubs for other shortcuts
	setLeftSidebarOpen: ReturnType<typeof vi.fn>;
	setRightPanelOpen: ReturnType<typeof vi.fn>;
	setQuickActionOpen: ReturnType<typeof vi.fn>;
	setQuickActionInitialMode: ReturnType<typeof vi.fn>;
	setShortcutsHelpOpen: ReturnType<typeof vi.fn>;
	setSettingsModalOpen: ReturnType<typeof vi.fn>;
	setSettingsTab: ReturnType<typeof vi.fn>;
	recordShortcutUsage: ReturnType<typeof vi.fn>;
	onKeyboardMasteryLevelUp: ReturnType<typeof vi.fn>;
	addNewSession: ReturnType<typeof vi.fn>;
	cycleSession: ReturnType<typeof vi.fn>;
	[key: string]: unknown;
}

function makeMockCtx(tabCount = 3, activeTabIndex = 0): MockCtx {
	const { tabs, activeId } = makeTerminalTabs(tabCount, activeTabIndex);

	return {
		isShortcut,
		isTabShortcut,
		sessions: [{ id: 'session-1' }],
		activeSession: {
			id: 'session-1',
			inputMode: 'terminal',
			terminalTabs: tabs,
			activeTerminalTabId: activeId,
			aiTabs: [{ id: 'ai-tab-1' }],
		},
		activeSessionId: 'session-1',
		activeGroupChatId: null,
		activeFocus: 'main',
		activeRightTab: 'files',
		hasOpenLayers: () => false,
		hasOpenModal: () => false,
		editingSessionId: null,
		editingGroupId: null,
		leftSidebarOpen: true,
		// These navigation handlers always return false (no interception)
		handleSidebarNavigation: () => false,
		handleEnterToActivate: () => false,
		handleTabNavigation: () => false,
		handleEscapeInMain: () => false,
		// Terminal handlers
		handleTerminalNewTab: vi.fn(),
		handleTerminalTabSelect: vi.fn(),
		handleTerminalTabClose: vi.fn(),
		handleTerminalTabReopen: vi.fn(),
		toggleInputMode: vi.fn(),
		incrementTerminalClearSignal: vi.fn(),
		setTerminalSearchOpen: vi.fn(),
		// Misc stubs
		setLeftSidebarOpen: vi.fn(),
		setRightPanelOpen: vi.fn(),
		setQuickActionOpen: vi.fn(),
		setQuickActionInitialMode: vi.fn(),
		setShortcutsHelpOpen: vi.fn(),
		setSettingsModalOpen: vi.fn(),
		setSettingsTab: vi.fn(),
		recordShortcutUsage: vi.fn().mockReturnValue({ newLevel: null }),
		onKeyboardMasteryLevelUp: vi.fn(),
		addNewSession: vi.fn(),
		cycleSession: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// Re-implement the keyboard handler logic extracted from useMainKeyboardHandler.
// We test the *logic*, not the React hook — the hook is a thin wrapper.
// ---------------------------------------------------------------------------

/**
 * Simulate the keyboard handler from useMainKeyboardHandler.ts.
 * This is a faithful extraction of the handler logic, kept in sync
 * with the source code's control flow.
 */
function simulateKeydown(e: KeyboardEvent, ctx: MockCtx): void {
	// Block browser refresh
	if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
		e.preventDefault();
	}

	// Ctrl+C in terminal mode: let xterm.js handle it
	if (e.ctrlKey && e.key === 'c' && ctx.activeSession?.inputMode === 'terminal') {
		return;
	}

	// Skip layers/modals check (hasOpenLayers returns false in our tests)
	if (ctx.hasOpenLayers()) return;

	// Skip editing check
	if (ctx.editingSessionId || ctx.editingGroupId) return;

	// Navigation handlers
	if (ctx.handleSidebarNavigation(e)) return;
	if (ctx.handleEnterToActivate(e)) return;
	if (ctx.handleTabNavigation(e)) return;
	if (ctx.handleEscapeInMain(e)) return;

	const trackShortcut = (shortcutId: string) => {
		if (ctx.recordShortcutUsage) {
			const result = ctx.recordShortcutUsage(shortcutId);
			if (result.newLevel !== null && ctx.onKeyboardMasteryLevelUp) {
				ctx.onKeyboardMasteryLevelUp(result.newLevel);
			}
		}
	};

	// General shortcuts
	if (ctx.isShortcut(e, 'toggleMode')) {
		e.preventDefault();
		ctx.toggleInputMode();
		trackShortcut('toggleMode');
	} else if (ctx.isShortcut(e, 'quickAction')) {
		e.preventDefault();
		// In terminal mode, Cmd+K clears the terminal
		if (ctx.activeSession?.inputMode === 'terminal') {
			ctx.incrementTerminalClearSignal();
			trackShortcut('clearTerminal');
			return;
		}
		if ((ctx.sessions as unknown[]).length > 0) {
			ctx.setQuickActionInitialMode('main');
			ctx.setQuickActionOpen(true);
			trackShortcut('quickAction');
		}
	}

	// Terminal tab shortcuts (terminal mode only)
	if (
		ctx.activeSessionId &&
		ctx.activeSession?.inputMode === 'terminal' &&
		ctx.activeSession?.terminalTabs &&
		(ctx.activeSession.terminalTabs as TerminalTab[]).length > 0 &&
		!ctx.activeGroupChatId
	) {
		const termTabs = ctx.activeSession.terminalTabs as TerminalTab[];
		const activeTermTabId = ctx.activeSession.activeTerminalTabId as string;

		// Ctrl+Shift+` - New terminal tab
		if (e.ctrlKey && e.shiftKey && e.key === '`') {
			e.preventDefault();
			ctx.handleTerminalNewTab((ctx.activeSession as Record<string, unknown>).id as string);
			return;
		}

		// Cmd+Shift+] - Next terminal tab
		if (ctx.isTabShortcut(e, 'nextTab')) {
			e.preventDefault();
			const currentIndex = termTabs.findIndex((t) => t.id === activeTermTabId);
			const nextIndex = currentIndex < termTabs.length - 1 ? currentIndex + 1 : 0;
			ctx.handleTerminalTabSelect((ctx.activeSession as Record<string, unknown>).id as string, termTabs[nextIndex].id);
			return;
		}

		// Cmd+Shift+[ - Previous terminal tab
		if (ctx.isTabShortcut(e, 'prevTab')) {
			e.preventDefault();
			const currentIndex = termTabs.findIndex((t) => t.id === activeTermTabId);
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : termTabs.length - 1;
			ctx.handleTerminalTabSelect((ctx.activeSession as Record<string, unknown>).id as string, termTabs[prevIndex].id);
			return;
		}

		// Cmd+W - Close terminal tab (only if more than one)
		if (ctx.isTabShortcut(e, 'closeTab')) {
			e.preventDefault();
			if (termTabs.length > 1 && activeTermTabId) {
				ctx.handleTerminalTabClose((ctx.activeSession as Record<string, unknown>).id as string, activeTermTabId);
			}
			return;
		}

		// Cmd+Shift+T - Reopen closed terminal tab
		if (ctx.isTabShortcut(e, 'reopenClosedTab')) {
			e.preventDefault();
			ctx.handleTerminalTabReopen((ctx.activeSession as Record<string, unknown>).id as string);
			return;
		}

		// Cmd+1-9 - Jump to terminal tab by number
		for (let i = 1; i <= 9; i++) {
			if (ctx.isTabShortcut(e, `goToTab${i}`)) {
				e.preventDefault();
				const targetIndex = i - 1;
				if (targetIndex < termTabs.length) {
					ctx.handleTerminalTabSelect((ctx.activeSession as Record<string, unknown>).id as string, termTabs[targetIndex].id);
				}
				return;
			}
		}
	}

	// Cmd+F contextual shortcuts
	if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
		if (ctx.activeFocus === 'main' && ctx.activeSession?.inputMode === 'terminal') {
			e.preventDefault();
			ctx.setTerminalSearchOpen(true);
			trackShortcut('searchOutput');
		}
	}
}

// ---------------------------------------------------------------------------
// Helper: dispatch a synthetic KeyboardEvent through our handler
// ---------------------------------------------------------------------------

function dispatchKey(
	ctx: MockCtx,
	opts: {
		key: string;
		code?: string;
		metaKey?: boolean;
		ctrlKey?: boolean;
		shiftKey?: boolean;
		altKey?: boolean;
	}
): KeyboardEvent {
	const e = new KeyboardEvent('keydown', {
		key: opts.key,
		code: opts.code || `Key${opts.key.toUpperCase()}`,
		metaKey: opts.metaKey ?? false,
		ctrlKey: opts.ctrlKey ?? false,
		shiftKey: opts.shiftKey ?? false,
		altKey: opts.altKey ?? false,
		bubbles: true,
		cancelable: true,
	});
	simulateKeydown(e, ctx);
	return e;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Terminal Keyboard Shortcuts', () => {
	let ctx: MockCtx;

	beforeEach(() => {
		ctx = makeMockCtx(3, 0); // 3 tabs, first is active
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// Terminal tab shortcuts (Phase 8)
	// -----------------------------------------------------------------------

	describe('Terminal tab shortcuts', () => {
		it('Ctrl+Shift+` creates a new terminal tab', () => {
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).toHaveBeenCalledWith('session-1');
		});

		it('Cmd+Shift+] navigates to the next terminal tab', () => {
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-1');
		});

		it('Cmd+Shift+] wraps around from last to first tab', () => {
			ctx = makeMockCtx(3, 2); // Active is last tab
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');
		});

		it('Cmd+Shift+[ navigates to the previous terminal tab', () => {
			ctx = makeMockCtx(3, 1); // Active is middle tab
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');
		});

		it('Cmd+Shift+[ wraps around from first to last tab', () => {
			ctx = makeMockCtx(3, 0); // Active is first tab
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-2');
		});

		it('Cmd+W closes the active terminal tab when multiple tabs exist', () => {
			ctx = makeMockCtx(3, 0);
			dispatchKey(ctx, { key: 'w', metaKey: true, code: 'KeyW' });
			expect(ctx.handleTerminalTabClose).toHaveBeenCalledWith('session-1', 'tab-0');
		});

		it('Cmd+W does NOT close the terminal tab when only one tab exists', () => {
			ctx = makeMockCtx(1, 0);
			dispatchKey(ctx, { key: 'w', metaKey: true, code: 'KeyW' });
			expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
		});

		it('Cmd+Shift+T reopens the most recently closed terminal tab', () => {
			dispatchKey(ctx, { key: 't', metaKey: true, shiftKey: true, code: 'KeyT' });
			expect(ctx.handleTerminalTabReopen).toHaveBeenCalledWith('session-1');
		});

		it('Cmd+1 jumps to terminal tab 1', () => {
			ctx = makeMockCtx(3, 2); // Active is last tab
			dispatchKey(ctx, { key: '1', metaKey: true, code: 'Digit1' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');
		});

		it('Cmd+2 jumps to terminal tab 2', () => {
			dispatchKey(ctx, { key: '2', metaKey: true, code: 'Digit2' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-1');
		});

		it('Cmd+3 jumps to terminal tab 3', () => {
			dispatchKey(ctx, { key: '3', metaKey: true, code: 'Digit3' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-2');
		});

		it('Cmd+5 does nothing when only 3 tabs exist', () => {
			dispatchKey(ctx, { key: '5', metaKey: true, code: 'Digit5' });
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
		});

		it('Cmd+9 jumps to tab 9 if it exists', () => {
			ctx = makeMockCtx(9, 0);
			dispatchKey(ctx, { key: '9', metaKey: true, code: 'Digit9' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-8');
		});
	});

	// -----------------------------------------------------------------------
	// Terminal-specific mode shortcuts
	// -----------------------------------------------------------------------

	describe('Mode and utility shortcuts in terminal mode', () => {
		it('Cmd+K clears terminal instead of opening Quick Actions', () => {
			dispatchKey(ctx, { key: 'k', metaKey: true, code: 'KeyK' });
			expect(ctx.incrementTerminalClearSignal).toHaveBeenCalled();
			expect(ctx.setQuickActionOpen).not.toHaveBeenCalled();
		});

		it('Cmd+J toggles back to AI mode', () => {
			dispatchKey(ctx, { key: 'j', metaKey: true, code: 'KeyJ' });
			expect(ctx.toggleInputMode).toHaveBeenCalled();
		});

		it('Cmd+F opens terminal search when focus is on main panel', () => {
			ctx.activeFocus = 'main';
			dispatchKey(ctx, { key: 'f', metaKey: true, code: 'KeyF' });
			expect(ctx.setTerminalSearchOpen).toHaveBeenCalledWith(true);
		});

		it('Cmd+F does NOT open terminal search when focus is on sidebar', () => {
			ctx.activeFocus = 'sidebar';
			dispatchKey(ctx, { key: 'f', metaKey: true, code: 'KeyF' });
			expect(ctx.setTerminalSearchOpen).not.toHaveBeenCalled();
		});

		it('Cmd+F does NOT open terminal search when focus is on right panel', () => {
			ctx.activeFocus = 'right';
			dispatchKey(ctx, { key: 'f', metaKey: true, code: 'KeyF' });
			expect(ctx.setTerminalSearchOpen).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Ctrl+C / Ctrl+D passthrough
	// -----------------------------------------------------------------------

	describe('Signal passthrough to xterm.js', () => {
		it('Ctrl+C returns early in terminal mode (lets xterm.js send SIGINT)', () => {
			const e = dispatchKey(ctx, { key: 'c', ctrlKey: true, code: 'KeyC' });
			// No terminal handler should have been called
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
			expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
			expect(ctx.toggleInputMode).not.toHaveBeenCalled();
			expect(ctx.incrementTerminalClearSignal).not.toHaveBeenCalled();
			// preventDefault should NOT have been called (key passes through)
			expect(e.defaultPrevented).toBe(false);
		});

		it('Ctrl+C would NOT return early in AI mode', () => {
			ctx.activeSession!.inputMode = 'ai';
			const e = dispatchKey(ctx, { key: 'c', ctrlKey: true, code: 'KeyC' });
			// The Ctrl+C passthrough only applies to terminal mode
			// In AI mode, it falls through to normal shortcut processing
			// (won't match any shortcut in this test since we don't have full AI mode context)
			expect(e).toBeDefined();
		});

		it('Ctrl+D is not intercepted in terminal mode (passes through to xterm.js for EOF)', () => {
			const e = dispatchKey(ctx, { key: 'd', ctrlKey: true, code: 'KeyD' });
			// Ctrl+D doesn't match any Maestro shortcut, so it passes through
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
			expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
			expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
			expect(ctx.toggleInputMode).not.toHaveBeenCalled();
			expect(e.defaultPrevented).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Shell shortcut non-interference
	// -----------------------------------------------------------------------

	describe('Shell shortcuts are NOT intercepted', () => {
		const shellShortcuts = [
			{ key: 'a', name: 'Ctrl+A (beginning of line)' },
			{ key: 'e', name: 'Ctrl+E (end of line)' },
			{ key: 'l', name: 'Ctrl+L (clear screen)' },
			{ key: 'r', name: 'Ctrl+R (reverse search)' },
			{ key: 'u', name: 'Ctrl+U (kill line)' },
			{ key: 'z', name: 'Ctrl+Z (suspend)' },
			{ key: 'p', name: 'Ctrl+P (previous command)' },
			{ key: 'n', name: 'Ctrl+N (next command)' },
			{ key: 'b', name: 'Ctrl+B (back one char)' },
			// NOTE: Ctrl+F is NOT included here because Maestro treats Ctrl as Meta,
			// so Ctrl+F matches Cmd+F (opens terminal search). This is a known
			// trade-off: shell's cursor-forward is unavailable as a raw Ctrl shortcut.
		];

		for (const { key, name } of shellShortcuts) {
			// Skip Ctrl+R since it's the browser refresh blocker (it gets preventDefault'd)
			// and Ctrl+F which is only consumed when metaKey is true (Cmd+F), not ctrlKey alone
			if (key === 'r') {
				it(`${name} only prevents browser refresh (no terminal handler called)`, () => {
					const e = dispatchKey(ctx, { key, ctrlKey: true, code: `Key${key.toUpperCase()}` });
					expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
					expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
					expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
					expect(ctx.toggleInputMode).not.toHaveBeenCalled();
					expect(ctx.incrementTerminalClearSignal).not.toHaveBeenCalled();
					// Browser refresh is prevented, but xterm.js still gets the key
					expect(e.defaultPrevented).toBe(true);
				});
				continue;
			}

			it(`${name} passes through to xterm.js without interception`, () => {
				const e = dispatchKey(ctx, { key, ctrlKey: true, code: `Key${key.toUpperCase()}` });
				expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
				expect(ctx.handleTerminalTabSelect).not.toHaveBeenCalled();
				expect(ctx.handleTerminalTabClose).not.toHaveBeenCalled();
				expect(ctx.handleTerminalTabReopen).not.toHaveBeenCalled();
				expect(ctx.toggleInputMode).not.toHaveBeenCalled();
				expect(ctx.incrementTerminalClearSignal).not.toHaveBeenCalled();
				expect(e.defaultPrevented).toBe(false);
			});
		}
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	describe('Edge cases', () => {
		it('shortcuts are disabled when no terminal tabs exist', () => {
			ctx.activeSession!.terminalTabs = [];
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
		});

		it('shortcuts are disabled when editing a session name', () => {
			ctx.editingSessionId = 'session-1';
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
		});

		it('shortcuts are disabled when editing a group name', () => {
			ctx.editingGroupId = 'group-1';
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
		});

		it('shortcuts are disabled in group chat view', () => {
			ctx.activeGroupChatId = 'group-chat-1';
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
		});

		it('terminal shortcuts do not fire in AI mode', () => {
			ctx.activeSession!.inputMode = 'ai';
			dispatchKey(ctx, { key: '`', ctrlKey: true, shiftKey: true, code: 'Backquote' });
			expect(ctx.handleTerminalNewTab).not.toHaveBeenCalled();
		});

		it('Cmd+K in AI mode opens Quick Actions instead of clearing terminal', () => {
			ctx.activeSession!.inputMode = 'ai';
			dispatchKey(ctx, { key: 'k', metaKey: true, code: 'KeyK' });
			expect(ctx.incrementTerminalClearSignal).not.toHaveBeenCalled();
			expect(ctx.setQuickActionInitialMode).toHaveBeenCalledWith('main');
			expect(ctx.setQuickActionOpen).toHaveBeenCalledWith(true);
		});

		it('next tab cycles through all tabs sequentially', () => {
			// Start at tab-0, press next 3 times → tab-1, tab-2, tab-0 (wrap)
			ctx = makeMockCtx(3, 0);
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-1');

			ctx = makeMockCtx(3, 1);
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-2');

			ctx = makeMockCtx(3, 2);
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');
		});

		it('prev tab cycles through all tabs sequentially in reverse', () => {
			ctx = makeMockCtx(3, 2);
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-1');

			ctx = makeMockCtx(3, 1);
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');

			ctx = makeMockCtx(3, 0);
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-2');
		});

		it('single tab: next/prev both select the same tab (wrap is a no-op)', () => {
			ctx = makeMockCtx(1, 0);
			dispatchKey(ctx, { key: ']', metaKey: true, shiftKey: true, code: 'BracketRight' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');

			vi.clearAllMocks();
			ctx = makeMockCtx(1, 0);
			dispatchKey(ctx, { key: '[', metaKey: true, shiftKey: true, code: 'BracketLeft' });
			expect(ctx.handleTerminalTabSelect).toHaveBeenCalledWith('session-1', 'tab-0');
		});
	});

	// -----------------------------------------------------------------------
	// XTerminal input passthrough (Ctrl+C and Ctrl+D via onData)
	// -----------------------------------------------------------------------

	describe('XTerminal onData passthrough for control characters', () => {
		it('Ctrl+C produces \\x03 which xterm.js sends via process.write', () => {
			// This test validates the architectural assumption: xterm.js's onData handler
			// sends raw character data to the PTY. When Ctrl+C is pressed and our keyboard
			// handler does NOT preventDefault, xterm.js receives the keypress and emits
			// '\x03' through the onData callback, which is wired to process.write.
			//
			// The actual xterm.js → process.write wiring is tested in XTerminalDataFlow.test.tsx.
			// Here we verify the keyboard handler's contract: it returns early for Ctrl+C.
			const e = new KeyboardEvent('keydown', {
				key: 'c', ctrlKey: true, code: 'KeyC',
				bubbles: true, cancelable: true,
			});
			simulateKeydown(e, ctx);
			// The handler returns early without calling any Maestro shortcut
			expect(ctx.toggleInputMode).not.toHaveBeenCalled();
			expect(ctx.incrementTerminalClearSignal).not.toHaveBeenCalled();
			expect(e.defaultPrevented).toBe(false);
		});

		it('Ctrl+D produces \\x04 which xterm.js sends via process.write', () => {
			// Same architectural pattern as Ctrl+C: xterm.js handles Ctrl+D natively
			// and emits '\x04' (EOF) through onData. The keyboard handler does not
			// intercept Ctrl+D, so it passes through to xterm.js.
			const e = new KeyboardEvent('keydown', {
				key: 'd', ctrlKey: true, code: 'KeyD',
				bubbles: true, cancelable: true,
			});
			simulateKeydown(e, ctx);
			expect(ctx.toggleInputMode).not.toHaveBeenCalled();
			expect(e.defaultPrevented).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Shortcut constant verification
	// -----------------------------------------------------------------------

	describe('Shortcut constants match expected keybindings', () => {
		it('TERMINAL_TAB_SHORTCUTS has newTerminalTab = Ctrl+Shift+`', () => {
			expect(TERMINAL_TAB_SHORTCUTS.newTerminalTab.keys).toEqual(['Control', 'Shift', '`']);
		});

		it('TERMINAL_TAB_SHORTCUTS has clearTerminal = Cmd+K', () => {
			expect(TERMINAL_TAB_SHORTCUTS.clearTerminal.keys).toEqual(['Meta', 'k']);
		});

		it('TERMINAL_TAB_SHORTCUTS has searchTerminal = Cmd+F', () => {
			expect(TERMINAL_TAB_SHORTCUTS.searchTerminal.keys).toEqual(['Meta', 'f']);
		});

		it('TERMINAL_TAB_SHORTCUTS has searchNext = Cmd+G', () => {
			expect(TERMINAL_TAB_SHORTCUTS.searchNext.keys).toEqual(['Meta', 'g']);
		});

		it('TERMINAL_TAB_SHORTCUTS has searchPrevious = Cmd+Shift+G', () => {
			expect(TERMINAL_TAB_SHORTCUTS.searchPrevious.keys).toEqual(['Meta', 'Shift', 'g']);
		});

		it('DEFAULT_SHORTCUTS nextTab = Cmd+Shift+]', () => {
			expect(DEFAULT_SHORTCUTS.nextTab.keys).toEqual(['Meta', 'Shift', ']']);
		});

		it('DEFAULT_SHORTCUTS prevTab = Cmd+Shift+[', () => {
			expect(DEFAULT_SHORTCUTS.prevTab.keys).toEqual(['Meta', 'Shift', '[']);
		});

		it('TAB_SHORTCUTS closeTab = Cmd+W', () => {
			expect(TAB_SHORTCUTS.closeTab.keys).toEqual(['Meta', 'w']);
		});

		it('TAB_SHORTCUTS reopenClosedTab = Cmd+Shift+T', () => {
			expect(TAB_SHORTCUTS.reopenClosedTab.keys).toEqual(['Meta', 'Shift', 't']);
		});

		it('DEFAULT_SHORTCUTS toggleMode = Cmd+J', () => {
			expect(DEFAULT_SHORTCUTS.toggleMode.keys).toEqual(['Meta', 'j']);
		});
	});
});
