/**
 * Tests for multiple terminal tabs behavior.
 *
 * Verifies:
 * - Creating multiple tabs produces independent XTerminal instances
 * - Each tab gets a unique PTY session ID ({sessionId}-terminal-{tabId})
 * - Switching tabs changes visibility (active = visible, others = invisible)
 * - Each tab spawns its own PTY independently
 * - Tabs maintain isolated state (different cwds, shells, exit codes)
 * - Exit in one tab does not affect sibling tabs
 * - Tab ordering and display names are correct
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalView } from '../../../renderer/components/TerminalView';
import { createTerminalTab, getTerminalSessionId } from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../../../renderer/types';

// Mock XTerminal - we test TerminalView's multi-tab orchestration, not xterm.js internals
const mockXTerminalInstances = new Map<string, { focus: ReturnType<typeof vi.fn> }>();
vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerminal(
		props: { sessionId: string },
		ref: React.Ref<unknown>
	) {
		const focusMock = vi.fn();
		mockXTerminalInstances.set(props.sessionId, { focus: focusMock });
		React.useImperativeHandle(ref, () => ({
			focus: focusMock,
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
	TerminalSearchBar: function MockTerminalSearchBar({ isOpen }: { isOpen: boolean }) {
		if (!isOpen) return null;
		return <div data-testid="terminal-search-bar" />;
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
	AlertCircle: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="alert-circle-icon" className={className} style={style}>!</span>
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

/**
 * Create a test session with the given terminal tabs.
 * Tabs default to idle state with pid=0 (unspawned).
 */
function makeSession(tabOverrides?: Partial<TerminalTab>[], activeTabIndex = 0): Session {
	const tabs = (tabOverrides || [{}]).map((overrides) => ({
		...createTerminalTab('zsh', '/test'),
		...overrides,
	}));
	return {
		id: 'test-session',
		name: 'Test Session',
		mode: 'terminal' as const,
		fullPath: '/test',
		cwd: '/test',
		inputMode: 'terminal',
		logs: [],
		isThinking: false,
		agentType: 'terminal' as const,
		terminalTabs: tabs,
		activeTerminalTabId: tabs[activeTabIndex]?.id,
	} as Session;
}

let mockSpawnTerminalTab: ReturnType<typeof vi.fn>;
let mockProcessKill: ReturnType<typeof vi.fn>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	mockXTerminalInstances.clear();
	exitCallbacks = [];

	// Each call returns an incrementing pid so we can track which tab got which pid
	let pidCounter = 1000;
	mockSpawnTerminalTab = vi.fn().mockImplementation(() => {
		pidCounter += 1;
		return Promise.resolve({ pid: pidCounter, success: true });
	});
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

describe('Multiple Terminal Tabs', () => {
	describe('Tab creation and rendering', () => {
		it('renders an XTerminal instance per tab', () => {
			const session = makeSession([{}, {}, {}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabs = session.terminalTabs!;
			for (const tab of tabs) {
				const sessionId = getTerminalSessionId('test-session', tab.id);
				expect(screen.getByTestId(`xterminal-${sessionId}`)).toBeTruthy();
			}
		});

		it('displays correct tab names (Terminal 1, Terminal 2, Terminal 3)', () => {
			const session = makeSession([{}, {}, {}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			expect(screen.getByText('Terminal 1')).toBeTruthy();
			expect(screen.getByText('Terminal 2')).toBeTruthy();
			expect(screen.getByText('Terminal 3')).toBeTruthy();
		});

		it('renders custom-named tabs alongside default-named tabs', () => {
			const session = makeSession([
				{ name: 'Build' },
				{},
				{ name: 'Dev Server' },
			]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			expect(screen.getByText('Build')).toBeTruthy();
			expect(screen.getByText('Terminal 2')).toBeTruthy();
			expect(screen.getByText('Dev Server')).toBeTruthy();
		});

		it('each tab gets a unique terminal session ID', () => {
			const session = makeSession([{}, {}]);
			const tabs = session.terminalTabs!;

			const sessionId1 = getTerminalSessionId('test-session', tabs[0].id);
			const sessionId2 = getTerminalSessionId('test-session', tabs[1].id);

			expect(sessionId1).not.toBe(sessionId2);
			expect(sessionId1).toMatch(/^test-session-terminal-.+$/);
			expect(sessionId2).toMatch(/^test-session-terminal-.+$/);
		});
	});

	describe('Tab switching and visibility', () => {
		it('only the active tab is visible; others have invisible class', () => {
			const session = makeSession([{}, {}, {}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabs = session.terminalTabs!;
			for (let i = 0; i < tabs.length; i++) {
				const sessionId = getTerminalSessionId('test-session', tabs[i].id);
				const container = screen.getByTestId(`xterminal-${sessionId}`).parentElement!;

				if (i === 0) {
					// Active tab (index 0 by default)
					expect(container.className).not.toContain('invisible');
				} else {
					expect(container.className).toContain('invisible');
				}
			}
		});

		it('re-renders with correct visibility when activeTerminalTabId changes', () => {
			const session = makeSession([{}, {}, {}]);
			const props = defaultProps({ session });

			const { rerender } = render(<TerminalView {...props} />);

			const tabs = session.terminalTabs!;

			// Switch to second tab
			const updatedSession = {
				...session,
				activeTerminalTabId: tabs[1].id,
			} as Session;
			rerender(<TerminalView {...defaultProps({ session: updatedSession })} />);

			for (let i = 0; i < tabs.length; i++) {
				const sessionId = getTerminalSessionId('test-session', tabs[i].id);
				const container = screen.getByTestId(`xterminal-${sessionId}`).parentElement!;

				if (i === 1) {
					expect(container.className).not.toContain('invisible');
				} else {
					expect(container.className).toContain('invisible');
				}
			}
		});

		it('calls onTabSelect when clicking a non-active tab', () => {
			const session = makeSession([{}, {}, {}]);
			const onTabSelect = vi.fn();
			const props = defaultProps({ session, onTabSelect });

			render(<TerminalView {...props} />);

			// Click the third tab
			fireEvent.click(screen.getByText('Terminal 3'));
			expect(onTabSelect).toHaveBeenCalledWith(session.terminalTabs![2].id);

			// Click the second tab
			fireEvent.click(screen.getByText('Terminal 2'));
			expect(onTabSelect).toHaveBeenCalledWith(session.terminalTabs![1].id);
		});

		it('calls onNewTab when + button is clicked', () => {
			const session = makeSession([{}, {}]);
			const onNewTab = vi.fn();
			const props = defaultProps({ session, onNewTab });

			render(<TerminalView {...props} />);

			const plusButton = screen.getByTitle(/New terminal/);
			fireEvent.click(plusButton);
			expect(onNewTab).toHaveBeenCalledTimes(1);
		});
	});

	describe('Independent PTY spawning per tab', () => {
		it('spawns PTY only for the active tab on mount', async () => {
			const session = makeSession([{}, {}, {}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const activeTab = session.terminalTabs![0];
			const expectedSessionId = getTerminalSessionId('test-session', activeTab.id);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						sessionId: expectedSessionId,
					})
				);
			});
		});

		it('spawns a new PTY when switching to an unspawned tab', async () => {
			const session = makeSession([{ pid: 5000 }, {}, {}]);
			const onTabPidChange = vi.fn();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabPidChange, onTabStateChange });

			const { rerender } = render(<TerminalView {...props} />);

			// First tab already has a pid, so no spawn on mount
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();

			// Switch to second tab (pid=0, state=idle → should trigger spawn)
			const updatedSession = {
				...session,
				activeTerminalTabId: session.terminalTabs![1].id,
			} as Session;
			rerender(<TerminalView {...defaultProps({ session: updatedSession, onTabPidChange, onTabStateChange })} />);

			const tab2 = session.terminalTabs![1];
			const expectedSessionId = getTerminalSessionId('test-session', tab2.id);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						sessionId: expectedSessionId,
					})
				);
			});

			await waitFor(() => {
				expect(onTabPidChange).toHaveBeenCalledWith(tab2.id, expect.any(Number));
			});
		});

		it('does not re-spawn PTY for a tab that already has a pid', async () => {
			const session = makeSession([{ pid: 5000 }, { pid: 6000 }]);
			const props = defaultProps({ session });

			const { rerender } = render(<TerminalView {...props} />);

			// Switch to second tab
			const updatedSession = {
				...session,
				activeTerminalTabId: session.terminalTabs![1].id,
			} as Session;
			rerender(<TerminalView {...defaultProps({ session: updatedSession })} />);

			await new Promise(resolve => setTimeout(resolve, 100));
			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
		});

		it('spawns each tab with its own cwd', async () => {
			// Tab 1 has cwd /project-a, Tab 2 has cwd /project-b
			const session = makeSession([
				{ cwd: '/project-a' },
				{ cwd: '/project-b' },
			]);
			const onTabPidChange = vi.fn();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabPidChange, onTabStateChange });

			const { rerender } = render(<TerminalView {...props} />);

			// First tab spawns on mount
			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						cwd: '/project-a',
						sessionId: getTerminalSessionId('test-session', session.terminalTabs![0].id),
					})
				);
			});

			// Switch to second tab (simulate parent updating active tab + giving it a pid after spawn)
			const updatedSession = {
				...session,
				activeTerminalTabId: session.terminalTabs![1].id,
			} as Session;
			rerender(<TerminalView {...defaultProps({ session: updatedSession, onTabPidChange, onTabStateChange })} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						cwd: '/project-b',
						sessionId: getTerminalSessionId('test-session', session.terminalTabs![1].id),
					})
				);
			});
		});
	});

	describe('Session isolation', () => {
		it('PTY exit on one tab does not affect sibling tabs', async () => {
			const session = makeSession([
				{ pid: 5000 },
				{ pid: 6000 },
				{ pid: 7000 },
			]);
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabStateChange });

			render(<TerminalView {...props} />);

			// Simulate PTY exit for second tab only
			const tab2Id = session.terminalTabs![1].id;
			const tab2SessionId = getTerminalSessionId('test-session', tab2Id);

			act(() => {
				for (const cb of exitCallbacks) {
					cb(tab2SessionId, 0);
				}
			});

			// Only tab 2 should receive the state change
			expect(onTabStateChange).toHaveBeenCalledTimes(1);
			expect(onTabStateChange).toHaveBeenCalledWith(tab2Id, 'exited', 0);

			// Tab 1 and 3 should NOT have been affected
			const tab1Id = session.terminalTabs![0].id;
			const tab3Id = session.terminalTabs![2].id;
			expect(onTabStateChange).not.toHaveBeenCalledWith(tab1Id, expect.any(String), expect.any(Number));
			expect(onTabStateChange).not.toHaveBeenCalledWith(tab3Id, expect.any(String), expect.any(Number));
		});

		it('PTY exit events are correctly routed by tab ID', async () => {
			const session = makeSession([
				{ pid: 5000 },
				{ pid: 6000 },
			]);
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabStateChange });

			render(<TerminalView {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab2Id = session.terminalTabs![1].id;

			// Exit tab 1 with code 1 (error)
			act(() => {
				for (const cb of exitCallbacks) {
					cb(getTerminalSessionId('test-session', tab1Id), 1);
				}
			});

			// Exit tab 2 with code 0 (success)
			act(() => {
				for (const cb of exitCallbacks) {
					cb(getTerminalSessionId('test-session', tab2Id), 0);
				}
			});

			expect(onTabStateChange).toHaveBeenCalledWith(tab1Id, 'exited', 1);
			expect(onTabStateChange).toHaveBeenCalledWith(tab2Id, 'exited', 0);
			expect(onTabStateChange).toHaveBeenCalledTimes(2);
		});

		it('ignores exit events from unrelated sessions', () => {
			const session = makeSession([{ pid: 5000 }]);
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabStateChange });

			render(<TerminalView {...props} />);

			// Fire an exit event for a different session entirely
			act(() => {
				for (const cb of exitCallbacks) {
					cb('other-session-terminal-some-tab-id', 0);
				}
			});

			expect(onTabStateChange).not.toHaveBeenCalled();
		});

		it('each tab can have a different shell type', async () => {
			// Tabs request different shells via their shellType, but TerminalView
			// passes defaultShell to spawnTerminalTab. The shell type on the tab
			// is metadata; the actual shell used comes from the parent's defaultShell prop.
			// This test verifies that tab identity (session ID) is unique per tab
			// regardless of shell metadata.
			const session = makeSession([
				{ shellType: 'zsh', cwd: '/test' },
				{ shellType: 'bash', cwd: '/test' },
				{ shellType: 'fish', cwd: '/test' },
			]);

			const props = defaultProps({ session });
			render(<TerminalView {...props} />);

			// All three tabs should be rendered
			expect(screen.getByText('Terminal 1')).toBeTruthy();
			expect(screen.getByText('Terminal 2')).toBeTruthy();
			expect(screen.getByText('Terminal 3')).toBeTruthy();

			// All three XTerminal instances should exist
			const tabs = session.terminalTabs!;
			for (const tab of tabs) {
				const sessionId = getTerminalSessionId('test-session', tab.id);
				expect(screen.getByTestId(`xterminal-${sessionId}`)).toBeTruthy();
			}
		});
	});

	describe('Tab close with multiple tabs', () => {
		it('kills the PTY for the specific closed tab', async () => {
			const session = makeSession([{ pid: 5000 }, { pid: 6000 }, { pid: 7000 }]);
			const onTabClose = vi.fn();
			const props = defaultProps({ session, onTabClose });

			render(<TerminalView {...props} />);

			// Hover over second tab to show its close button
			const tab2Element = screen.getByText('Terminal 2');
			const tab2Draggable = tab2Element.closest('[draggable]')!;
			fireEvent.mouseEnter(tab2Draggable);

			// Find the close button specifically within Tab 2's draggable container
			// (Active tab also shows a close button, so getAllByTitle returns multiple)
			const closeButton = tab2Draggable.querySelector('button[title="Close terminal"]')!;
			fireEvent.click(closeButton);

			const tab2Id = session.terminalTabs![1].id;
			const tab2SessionId = getTerminalSessionId('test-session', tab2Id);

			await waitFor(() => {
				expect(mockProcessKill).toHaveBeenCalledWith(tab2SessionId);
				expect(onTabClose).toHaveBeenCalledWith(tab2Id);
			});

			// Should NOT have killed the other tabs' PTYs
			const tab1SessionId = getTerminalSessionId('test-session', session.terminalTabs![0].id);
			const tab3SessionId = getTerminalSessionId('test-session', session.terminalTabs![2].id);
			expect(mockProcessKill).not.toHaveBeenCalledWith(tab1SessionId);
			expect(mockProcessKill).not.toHaveBeenCalledWith(tab3SessionId);
		});

		it('does not show close button when only one tab exists', () => {
			const session = makeSession([{ pid: 5000 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// Hover over the only tab
			const tab = screen.getByText('Terminal 1');
			fireEvent.mouseEnter(tab.closest('[draggable]')!);

			// No close button should be rendered (canClose = tabs.length > 1)
			expect(screen.queryAllByTitle('Close terminal')).toHaveLength(0);
		});
	});

	describe('Tab reordering', () => {
		it('calls onTabReorder on drop', () => {
			const session = makeSession([{}, {}, {}]);
			const onTabReorder = vi.fn();
			const props = defaultProps({ session, onTabReorder });

			render(<TerminalView {...props} />);

			const tab1 = screen.getByText('Terminal 1').closest('[draggable]')!;
			const tab3 = screen.getByText('Terminal 3').closest('[draggable]')!;

			// Simulate drag from tab 1 to tab 3
			fireEvent.dragStart(tab1, {
				dataTransfer: {
					effectAllowed: 'move',
					setData: vi.fn(),
				},
			});

			fireEvent.dragOver(tab3, {
				dataTransfer: {
					dropEffect: 'move',
				},
			});

			fireEvent.drop(tab3, {
				dataTransfer: {
					getData: () => '0', // from index 0
				},
			});

			expect(onTabReorder).toHaveBeenCalledWith(0, 2);
		});
	});

	describe('Mixed tab states', () => {
		it('renders tabs with mixed states (idle, busy, exited) correctly', () => {
			const session = makeSession([
				{ pid: 5000, state: 'idle' as const },
				{ pid: 6000, state: 'busy' as const },
				{ pid: 0, state: 'exited' as const, exitCode: 1 },
			]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// All tabs should be rendered regardless of state
			expect(screen.getByText('Terminal 1')).toBeTruthy();
			expect(screen.getByText('Terminal 2')).toBeTruthy();
			expect(screen.getByText('Terminal 3')).toBeTruthy();

			// Exited tab with non-zero exit code should show the code
			expect(screen.getByText('(1)')).toBeTruthy();
		});

		it('does not spawn PTY for an exited active tab', async () => {
			const session = makeSession([
				{ pid: 0, state: 'exited' as const, exitCode: 0 },
			]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			await new Promise(resolve => setTimeout(resolve, 100));
			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
		});
	});
});
