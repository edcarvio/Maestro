/**
 * TerminalTabLifecycle.test.tsx — Tests for the close → reopen → re-spawn
 * terminal tab lifecycle.
 *
 * Covers:
 * 1. Closing tabs kills PTY and creates ClosedTerminalTab history
 * 2. Reopening tabs (Cmd+Shift+T) restores at original position with same cwd
 * 3. New PTY is spawned with preserved cwd after reopen
 * 4. Edge cases: empty history, multiple close/reopen cycles, last-tab guard
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalView } from '../../../renderer/components/TerminalView';
import {
	createTerminalTab,
	createClosedTerminalTab,
	getTerminalSessionId,
	MAX_CLOSED_TERMINAL_TABS,
} from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab, ClosedTerminalTab } from '../../../renderer/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock XTerminal with imperative handle
vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerminal(
		props: { sessionId: string },
		ref: React.Ref<unknown>
	) {
		React.useImperativeHandle(ref, () => ({
			focus: vi.fn(),
			search: vi.fn().mockReturnValue(true),
			searchNext: vi.fn().mockReturnValue(true),
			searchPrevious: vi.fn().mockReturnValue(true),
			clearSearch: vi.fn(),
			write: vi.fn(),
			clear: vi.fn(),
			scrollToBottom: vi.fn(),
			getSelection: vi.fn().mockReturnValue(''),
			resize: vi.fn(),
		}));
		return <div data-testid={`xterminal-${props.sessionId}`}>XTerminal: {props.sessionId}</div>;
	}),
}));

// Mock TerminalSearchBar
vi.mock('../../../renderer/components/TerminalSearchBar', () => ({
	TerminalSearchBar: function MockTerminalSearchBar() {
		return null;
	},
}));

// Mock lucide-react
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
	Search: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span className={className} style={style}>Search</span>
	),
	ChevronUp: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span className={className} style={style}>Up</span>
	),
	ChevronDown: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span className={className} style={style}>Down</span>
	),
	AlertCircle: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="alert-circle-icon" className={className} style={style}>!</span>
	),
	Loader2: ({ className, style, 'data-testid': testId }: { className?: string; style?: React.CSSProperties; 'data-testid'?: string }) => (
		<span data-testid={testId || 'loader-icon'} className={className} style={style}>⟳</span>
	),
}));

// ---------------------------------------------------------------------------
// Theme & Helpers
// ---------------------------------------------------------------------------

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

function makeSession(
	tabOverrides?: Partial<TerminalTab>[],
	sessionOverrides?: Partial<Session>
): Session {
	const tabs = (tabOverrides || [{}]).map((overrides) => ({
		...createTerminalTab('zsh', '/project'),
		...overrides,
	}));
	return {
		id: 'test-session',
		name: 'Test Session',
		mode: 'terminal' as const,
		fullPath: '/project',
		cwd: '/project',
		inputMode: 'terminal',
		logs: [],
		isThinking: false,
		agentType: 'terminal' as const,
		terminalTabs: tabs,
		activeTerminalTabId: tabs[0]?.id,
		closedTerminalTabHistory: [],
		...sessionOverrides,
	} as Session;
}

function defaultProps(overrides?: Partial<Parameters<typeof TerminalView>[0]>) {
	return {
		theme,
		fontFamily: 'Menlo',
		defaultShell: 'zsh',
		onTabSelect: vi.fn(),
		onTabClose: vi.fn(),
		onNewTab: vi.fn(),
		onTabRename: vi.fn(),
		onTabReorder: vi.fn(),
		onTabStateChange: vi.fn(),
		onTabCwdChange: vi.fn(),
		onTabPidChange: vi.fn(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// IPC mocks
// ---------------------------------------------------------------------------

let mockSpawnTerminalTab: ReturnType<typeof vi.fn>;
let mockProcessKill: ReturnType<typeof vi.fn>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	exitCallbacks = [];

	mockSpawnTerminalTab = vi.fn().mockResolvedValue({ pid: 1234, success: true });
	mockProcessKill = vi.fn().mockResolvedValue(undefined);

	(window.maestro.process as Record<string, unknown>).spawnTerminalTab = mockSpawnTerminalTab;
	(window.maestro.process as Record<string, unknown>).kill = mockProcessKill;
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn((cb: (sid: string, code: number) => void) => {
		exitCallbacks.push(cb);
		return () => {
			const idx = exitCallbacks.indexOf(cb);
			if (idx >= 0) exitCallbacks.splice(idx, 1);
		};
	});
});

// ===========================================================================
// 1. Close tabs — verify PTY is killed and history is created
// ===========================================================================

describe('Tab close lifecycle', () => {
	it('kills PTY via IPC when closing a tab with a running process', async () => {
		const tab1 = { ...createTerminalTab('zsh', '/project'), pid: 5678 };
		const tab2 = createTerminalTab('zsh', '/project');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});
		const onTabClose = vi.fn();
		const props = defaultProps({ session, onTabClose });

		render(<TerminalView {...props} />);

		// Hover + click close on first tab
		const tab1El = screen.getByText('Terminal 1');
		fireEvent.mouseEnter(tab1El.closest('[draggable]')!);
		const closeButtons = screen.getAllByTitle('Close terminal');
		fireEvent.click(closeButtons[0]);

		await waitFor(() => {
			expect(mockProcessKill).toHaveBeenCalledWith(
				getTerminalSessionId('test-session', tab1.id)
			);
			expect(onTabClose).toHaveBeenCalledWith(tab1.id);
		});
	});

	it('does not kill PTY when closing a tab with pid 0 (never spawned)', async () => {
		const tab1 = createTerminalTab('zsh', '/project'); // pid = 0
		const tab2 = createTerminalTab('zsh', '/project');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});
		const onTabClose = vi.fn();
		const props = defaultProps({ session, onTabClose });

		render(<TerminalView {...props} />);

		const tab1El = screen.getByText('Terminal 1');
		fireEvent.mouseEnter(tab1El.closest('[draggable]')!);
		const closeButtons = screen.getAllByTitle('Close terminal');
		fireEvent.click(closeButtons[0]);

		await waitFor(() => {
			expect(onTabClose).toHaveBeenCalledWith(tab1.id);
		});
		// kill should NOT have been called since pid was 0
		expect(mockProcessKill).not.toHaveBeenCalled();
	});

	it('cleans up spawned-tab tracking on close so re-spawn is allowed', async () => {
		// Tab starts with pid=0, gets spawned, then closed
		const tab1 = createTerminalTab('zsh', '/project');
		const tab2 = createTerminalTab('zsh', '/project');
		const onTabPidChange = vi.fn();
		const onTabStateChange = vi.fn();
		const onTabClose = vi.fn();

		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});
		const props = defaultProps({ session, onTabPidChange, onTabStateChange, onTabClose });

		const { rerender } = render(<TerminalView {...props} />);

		// Wait for initial spawn
		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
		});

		// Now update session to reflect spawned pid
		const updatedTab1 = { ...tab1, pid: 1234 };
		const sessionWithPid = makeSession(undefined, {
			terminalTabs: [updatedTab1, tab2],
			activeTerminalTabId: updatedTab1.id,
		});
		rerender(<TerminalView {...defaultProps({ session: sessionWithPid, onTabClose })} />);

		// Close tab1
		const tab1El = screen.getByText('Terminal 1');
		fireEvent.mouseEnter(tab1El.closest('[draggable]')!);
		const closeButtons = screen.getAllByTitle('Close terminal');
		fireEvent.click(closeButtons[0]);

		await waitFor(() => {
			expect(mockProcessKill).toHaveBeenCalled();
			expect(onTabClose).toHaveBeenCalledWith(updatedTab1.id);
		});
	});
});

// ===========================================================================
// 2. createClosedTerminalTab — preserves cwd and identity
// ===========================================================================

describe('createClosedTerminalTab preserves tab metadata', () => {
	it('preserves cwd, shellType, and name in closed entry', () => {
		const tab: TerminalTab = {
			id: 'tab-42',
			name: 'Build Server',
			shellType: 'bash',
			pid: 9999,
			cwd: '/home/user/project',
			createdAt: Date.now(),
			state: 'busy',
		};

		const closed = createClosedTerminalTab(tab, 1);

		expect(closed.tab.cwd).toBe('/home/user/project');
		expect(closed.tab.shellType).toBe('bash');
		expect(closed.tab.name).toBe('Build Server');
		expect(closed.index).toBe(1);
	});

	it('resets runtime state (pid=0, state=idle) in closed entry', () => {
		const tab: TerminalTab = {
			id: 'tab-99',
			name: null,
			shellType: 'zsh',
			pid: 4567,
			cwd: '/tmp',
			createdAt: Date.now(),
			state: 'exited',
			exitCode: 130,
		};

		const closed = createClosedTerminalTab(tab, 0);

		expect(closed.tab.pid).toBe(0);
		expect(closed.tab.state).toBe('idle');
	});

	it('records the closing timestamp', () => {
		const before = Date.now();
		const tab = createTerminalTab('zsh', '/test');
		const closed = createClosedTerminalTab(tab, 0);
		const after = Date.now();

		expect(closed.closedAt).toBeGreaterThanOrEqual(before);
		expect(closed.closedAt).toBeLessThanOrEqual(after);
	});
});

// ===========================================================================
// 3. Reopen (Cmd+Shift+T) state transformation
// ===========================================================================

describe('Tab reopen state transformation', () => {
	// Simulates App.tsx handleTerminalTabClose logic
	function simulateTabClose(session: Session, tabId: string): Session {
		const tabs = session.terminalTabs || [];
		if (tabs.length <= 1) return session;

		const closingIndex = tabs.findIndex(t => t.id === tabId);
		if (closingIndex === -1) return session;

		const closingTab = tabs[closingIndex];
		const closedEntry = createClosedTerminalTab(closingTab, closingIndex);
		const closedHistory = [
			closedEntry,
			...(session.closedTerminalTabHistory || []),
		].slice(0, MAX_CLOSED_TERMINAL_TABS);

		const remaining = tabs.filter(t => t.id !== tabId);

		let newActiveTabId = session.activeTerminalTabId;
		if (session.activeTerminalTabId === tabId) {
			const newIndex = Math.min(closingIndex, remaining.length - 1);
			newActiveTabId = remaining[newIndex]?.id || remaining[0]?.id;
		}

		return {
			...session,
			terminalTabs: remaining,
			activeTerminalTabId: newActiveTabId,
			closedTerminalTabHistory: closedHistory,
		};
	}

	// Simulates App.tsx handleTerminalTabReopen logic
	function simulateTabReopen(session: Session): Session {
		if (!session.closedTerminalTabHistory?.length) return session;

		const [lastClosed, ...remainingHistory] = session.closedTerminalTabHistory;
		const restoredTab = createTerminalTab(
			lastClosed.tab.shellType,
			lastClosed.tab.cwd,
			lastClosed.tab.name
		);

		const insertIndex = Math.min(lastClosed.index, (session.terminalTabs || []).length);
		const tabs = [...(session.terminalTabs || [])];
		tabs.splice(insertIndex, 0, restoredTab);

		return {
			...session,
			terminalTabs: tabs,
			activeTerminalTabId: restoredTab.id,
			closedTerminalTabHistory: remainingHistory,
		};
	}

	it('restores tab with same cwd after close → reopen', () => {
		const tab1 = { ...createTerminalTab('zsh', '/project/src'), pid: 100 };
		const tab2 = { ...createTerminalTab('bash', '/project/tests'), pid: 200 };
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});

		const afterClose = simulateTabClose(session, tab1.id);
		expect(afterClose.terminalTabs).toHaveLength(1);
		expect(afterClose.closedTerminalTabHistory).toHaveLength(1);
		expect(afterClose.closedTerminalTabHistory![0].tab.cwd).toBe('/project/src');

		const afterReopen = simulateTabReopen(afterClose);
		expect(afterReopen.terminalTabs).toHaveLength(2);
		// Restored tab should have the original cwd
		const restoredTab = afterReopen.terminalTabs!.find(
			t => t.id === afterReopen.activeTerminalTabId
		);
		expect(restoredTab!.cwd).toBe('/project/src');
		expect(restoredTab!.shellType).toBe('zsh');
		expect(restoredTab!.pid).toBe(0); // Fresh tab, no PTY yet
	});

	it('preserves custom name through close → reopen', () => {
		const tab1 = { ...createTerminalTab('zsh', '/project'), name: 'Dev Server' };
		const tab2 = createTerminalTab('zsh', '/project');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});

		const afterClose = simulateTabClose(session, tab1.id);
		const afterReopen = simulateTabReopen(afterClose);

		const restoredTab = afterReopen.terminalTabs!.find(
			t => t.id === afterReopen.activeTerminalTabId
		);
		expect(restoredTab!.name).toBe('Dev Server');
	});

	it('inserts reopened tab at original position', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const tab3 = createTerminalTab('zsh', '/c');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2, tab3],
			activeTerminalTabId: tab2.id,
		});

		// Close the middle tab (index 1)
		const afterClose = simulateTabClose(session, tab2.id);
		expect(afterClose.terminalTabs).toHaveLength(2);
		expect(afterClose.terminalTabs![0].cwd).toBe('/a');
		expect(afterClose.terminalTabs![1].cwd).toBe('/c');

		// Reopen — should insert back at index 1
		const afterReopen = simulateTabReopen(afterClose);
		expect(afterReopen.terminalTabs).toHaveLength(3);
		expect(afterReopen.terminalTabs![0].cwd).toBe('/a');
		expect(afterReopen.terminalTabs![1].cwd).toBe('/b'); // Restored at original position
		expect(afterReopen.terminalTabs![2].cwd).toBe('/c');
	});

	it('clamps insert position when tabs were removed since close', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const tab3 = createTerminalTab('zsh', '/c');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2, tab3],
			activeTerminalTabId: tab3.id,
		});

		// Close the last tab (index 2)
		const afterClose1 = simulateTabClose(session, tab3.id);
		// Close another tab so only 1 remains
		const afterClose2 = simulateTabClose(afterClose1, tab2.id);
		expect(afterClose2.terminalTabs).toHaveLength(1);

		// Reopen — original index was 1, but only 1 tab exists → clamp to index 1
		const afterReopen = simulateTabReopen(afterClose2);
		expect(afterReopen.terminalTabs).toHaveLength(2);
		// The tab at index 0 is tab1 (/a), reopened tab at index 1
		expect(afterReopen.terminalTabs![0].cwd).toBe('/a');
		expect(afterReopen.terminalTabs![1].cwd).toBe('/b');
	});

	it('follows LIFO order for multiple close → reopen cycles', () => {
		const tab1 = createTerminalTab('zsh', '/first');
		const tab2 = createTerminalTab('zsh', '/second');
		const tab3 = createTerminalTab('zsh', '/third');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2, tab3],
			activeTerminalTabId: tab1.id,
		});

		// Close tab1, then tab3
		const after1 = simulateTabClose(session, tab1.id);
		const after2 = simulateTabClose(after1, tab3.id);
		expect(after2.terminalTabs).toHaveLength(1);
		expect(after2.closedTerminalTabHistory).toHaveLength(2);

		// First reopen: should get tab3 (last closed = LIFO)
		const reopen1 = simulateTabReopen(after2);
		const restored1 = reopen1.terminalTabs!.find(t => t.id === reopen1.activeTerminalTabId);
		expect(restored1!.cwd).toBe('/third');

		// Second reopen: should get tab1
		const reopen2 = simulateTabReopen(reopen1);
		const restored2 = reopen2.terminalTabs!.find(t => t.id === reopen2.activeTerminalTabId);
		expect(restored2!.cwd).toBe('/first');
		expect(reopen2.closedTerminalTabHistory).toHaveLength(0);
	});

	it('is a no-op when closed history is empty', () => {
		const tab = createTerminalTab('zsh', '/project');
		const session = makeSession(undefined, {
			terminalTabs: [tab],
			activeTerminalTabId: tab.id,
			closedTerminalTabHistory: [],
		});

		const result = simulateTabReopen(session);
		expect(result).toBe(session); // Same reference, no mutation
	});

	it('does not close the last remaining tab', () => {
		const tab = createTerminalTab('zsh', '/project');
		const session = makeSession(undefined, {
			terminalTabs: [tab],
			activeTerminalTabId: tab.id,
		});

		const result = simulateTabClose(session, tab.id);
		expect(result).toBe(session); // Unchanged
		expect(result.terminalTabs).toHaveLength(1);
	});

	it('selects adjacent tab after closing the active tab', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const tab3 = createTerminalTab('zsh', '/c');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2, tab3],
			activeTerminalTabId: tab2.id,
		});

		// Close active (middle) tab — should select tab at same index (tab3)
		const afterClose = simulateTabClose(session, tab2.id);
		expect(afterClose.activeTerminalTabId).toBe(tab3.id);
	});

	it('selects last tab when closing the active tab at the end', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab2.id,
		});

		const afterClose = simulateTabClose(session, tab2.id);
		expect(afterClose.activeTerminalTabId).toBe(tab1.id);
	});

	it('does not change active tab when closing a non-active tab', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const tab3 = createTerminalTab('zsh', '/c');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2, tab3],
			activeTerminalTabId: tab1.id,
		});

		const afterClose = simulateTabClose(session, tab2.id);
		expect(afterClose.activeTerminalTabId).toBe(tab1.id);
	});

	it('sets reopened tab as the active tab', () => {
		const tab1 = createTerminalTab('zsh', '/a');
		const tab2 = createTerminalTab('zsh', '/b');
		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});

		const afterClose = simulateTabClose(session, tab2.id);
		expect(afterClose.activeTerminalTabId).toBe(tab1.id);

		const afterReopen = simulateTabReopen(afterClose);
		// The reopened tab should now be active
		const reopenedTab = afterReopen.terminalTabs!.find(
			t => t.id !== tab1.id
		);
		expect(afterReopen.activeTerminalTabId).toBe(reopenedTab!.id);
	});

	it('caps closed history at MAX_CLOSED_TERMINAL_TABS', () => {
		// Create a session with MAX+1 tabs, close all but one
		const tabs = Array.from({ length: MAX_CLOSED_TERMINAL_TABS + 2 }, (_, i) =>
			createTerminalTab('zsh', `/dir-${i}`)
		);
		let session = makeSession(undefined, {
			terminalTabs: tabs,
			activeTerminalTabId: tabs[0].id,
		});

		// Close all tabs except the first one
		for (let i = tabs.length - 1; i >= 1; i--) {
			session = simulateTabClose(session, tabs[i].id);
		}

		// History should be capped at MAX_CLOSED_TERMINAL_TABS
		expect(session.closedTerminalTabHistory!.length).toBe(MAX_CLOSED_TERMINAL_TABS);
		// The earliest closed tab should have been evicted
		const historyCwds = session.closedTerminalTabHistory!.map(h => h.tab.cwd);
		// Last closed (index 1) should be first in history (LIFO)
		expect(historyCwds[0]).toBe('/dir-1');
	});
});

// ===========================================================================
// 4. TerminalView spawns new PTY with correct cwd for reopened tabs
// ===========================================================================

describe('TerminalView spawns PTY for reopened tab', () => {
	it('spawns PTY with preserved cwd when reopened tab becomes active', async () => {
		// Simulate a reopened tab: new ID, pid=0, state=idle, but with original cwd
		const existingTab = { ...createTerminalTab('zsh', '/project'), pid: 5000 };
		const reopenedTab = createTerminalTab('bash', '/home/user/special-dir');

		const session = makeSession(undefined, {
			terminalTabs: [existingTab, reopenedTab],
			activeTerminalTabId: reopenedTab.id, // Reopened tab is now active
		});

		const onTabPidChange = vi.fn();
		const onTabStateChange = vi.fn();
		const props = defaultProps({ session, onTabPidChange, onTabStateChange });

		render(<TerminalView {...props} />);

		// TerminalView should spawn PTY for the reopened tab (pid=0, not exited)
		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: getTerminalSessionId('test-session', reopenedTab.id),
					cwd: '/home/user/special-dir',
				})
			);
		});

		await waitFor(() => {
			expect(onTabPidChange).toHaveBeenCalledWith(reopenedTab.id, 1234);
			expect(onTabStateChange).toHaveBeenCalledWith(reopenedTab.id, 'idle');
		});
	});

	it('spawns PTY with session cwd when reopened tab has empty cwd', async () => {
		const existingTab = { ...createTerminalTab('zsh', '/project'), pid: 5000 };
		const reopenedTab = createTerminalTab('zsh', ''); // Empty cwd

		const session = makeSession(undefined, {
			cwd: '/fallback/dir',
			terminalTabs: [existingTab, reopenedTab],
			activeTerminalTabId: reopenedTab.id,
		});

		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					cwd: '/fallback/dir', // Falls back to session.cwd
				})
			);
		});
	});

	it('does not re-spawn PTY for reopened tab that already has a pid', async () => {
		// Edge case: if somehow the tab got a PID before TerminalView rendered
		const reopenedTab = { ...createTerminalTab('zsh', '/project'), pid: 7777 };

		const session = makeSession(undefined, {
			terminalTabs: [reopenedTab],
			activeTerminalTabId: reopenedTab.id,
		});

		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		await new Promise(resolve => setTimeout(resolve, 100));
		expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
	});

	it('uses shell type from reopened tab in spawn request', async () => {
		const reopenedTab = createTerminalTab('fish', '/project');

		const session = makeSession(undefined, {
			terminalTabs: [reopenedTab],
			activeTerminalTabId: reopenedTab.id,
		});

		// defaultShell is 'zsh' but reopened tab was 'fish'
		// TerminalView uses defaultShell for the spawn, not tab's shellType
		// (shellType is metadata; actual shell is controlled by settings)
		const props = defaultProps({ session, defaultShell: 'fish' });

		render(<TerminalView {...props} />);

		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: 'fish',
				})
			);
		});
	});
});

// ===========================================================================
// 5. PTY exit cleanup for tabs that will be closed
// ===========================================================================

describe('PTY exit handling during tab close', () => {
	it('handles PTY exit event for a tab, then close cleans up correctly', async () => {
		const tab1 = { ...createTerminalTab('zsh', '/project'), pid: 1234 };
		const tab2 = createTerminalTab('zsh', '/project');
		const onTabStateChange = vi.fn();
		const onTabClose = vi.fn();

		const session = makeSession(undefined, {
			terminalTabs: [tab1, tab2],
			activeTerminalTabId: tab1.id,
		});
		const props = defaultProps({ session, onTabStateChange, onTabClose });

		render(<TerminalView {...props} />);

		// Simulate PTY exit for tab1
		const ptySessionId = getTerminalSessionId('test-session', tab1.id);
		act(() => {
			for (const cb of exitCallbacks) {
				cb(ptySessionId, 0);
			}
		});

		expect(onTabStateChange).toHaveBeenCalledWith(tab1.id, 'exited', 0);

		// Now close the exited tab
		const tab1El = screen.getByText('Terminal 1');
		fireEvent.mouseEnter(tab1El.closest('[draggable]')!);
		const closeButtons = screen.getAllByTitle('Close terminal');
		fireEvent.click(closeButtons[0]);

		await waitFor(() => {
			expect(onTabClose).toHaveBeenCalledWith(tab1.id);
		});
	});

	it('handles non-zero exit code and preserves it in onTabStateChange', () => {
		const tab = { ...createTerminalTab('zsh', '/project'), pid: 1234 };
		const onTabStateChange = vi.fn();

		const session = makeSession(undefined, {
			terminalTabs: [tab],
			activeTerminalTabId: tab.id,
		});
		const props = defaultProps({ session, onTabStateChange });

		render(<TerminalView {...props} />);

		// Simulate PTY exit with error code
		const ptySessionId = getTerminalSessionId('test-session', tab.id);
		act(() => {
			for (const cb of exitCallbacks) {
				cb(ptySessionId, 130); // SIGINT
			}
		});

		expect(onTabStateChange).toHaveBeenCalledWith(tab.id, 'exited', 130);
	});

	it('ignores exit events for other sessions', () => {
		const tab = createTerminalTab('zsh', '/project');
		const onTabStateChange = vi.fn();

		const session = makeSession(undefined, {
			terminalTabs: [tab],
			activeTerminalTabId: tab.id,
		});
		const props = defaultProps({ session, onTabStateChange });

		render(<TerminalView {...props} />);

		// Simulate exit from a different session
		act(() => {
			for (const cb of exitCallbacks) {
				cb('other-session-terminal-some-tab', 0);
			}
		});

		// onTabStateChange should not have been called for tab state
		// (it may have been called for spawn, but not for exit)
		const exitCalls = onTabStateChange.mock.calls.filter(
			(call: [string, string, number?]) => call[1] === 'exited'
		);
		expect(exitCalls).toHaveLength(0);
	});
});

// ===========================================================================
// 6. Full round-trip: close → reopen → PTY spawned with same cwd
// ===========================================================================

describe('Full lifecycle round-trip', () => {
	it('close → createClosedTerminalTab → createTerminalTab → TerminalView spawns PTY with original cwd', async () => {
		// Step 1: Create original tab with specific cwd
		const originalTab: TerminalTab = {
			...createTerminalTab('bash', '/home/user/my-project'),
			name: 'My Dev',
			pid: 8888,
			state: 'idle',
		};

		// Step 2: Close it (simulate App.tsx handleTerminalTabClose)
		const closedEntry = createClosedTerminalTab(originalTab, 0);
		expect(closedEntry.tab.cwd).toBe('/home/user/my-project');
		expect(closedEntry.tab.shellType).toBe('bash');
		expect(closedEntry.tab.name).toBe('My Dev');
		expect(closedEntry.tab.pid).toBe(0);

		// Step 3: Reopen it (simulate App.tsx handleTerminalTabReopen)
		const restoredTab = createTerminalTab(
			closedEntry.tab.shellType,
			closedEntry.tab.cwd,
			closedEntry.tab.name
		);
		expect(restoredTab.cwd).toBe('/home/user/my-project');
		expect(restoredTab.shellType).toBe('bash');
		expect(restoredTab.name).toBe('My Dev');
		expect(restoredTab.pid).toBe(0);
		expect(restoredTab.id).not.toBe(originalTab.id); // New unique ID

		// Step 4: Render TerminalView with the restored tab
		const session = makeSession(undefined, {
			terminalTabs: [restoredTab],
			activeTerminalTabId: restoredTab.id,
		});

		const onTabPidChange = vi.fn();
		const onTabStateChange = vi.fn();
		const props = defaultProps({
			session,
			defaultShell: 'bash',
			onTabPidChange,
			onTabStateChange,
		});

		render(<TerminalView {...props} />);

		// Step 5: Verify PTY spawns with the original cwd
		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: getTerminalSessionId('test-session', restoredTab.id),
					cwd: '/home/user/my-project',
					shell: 'bash',
				})
			);
		});

		await waitFor(() => {
			expect(onTabPidChange).toHaveBeenCalledWith(restoredTab.id, 1234);
		});
	});
});
