import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalView, TerminalViewHandle } from '../../../renderer/components/TerminalView';
import { createTerminalTab, ensureTerminalTabs } from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../../../renderer/types';

// Mock XTerminal - we test TerminalView's container logic, not xterm.js internals
const mockXTerminalFocus = vi.fn();
const mockXTerminalClear = vi.fn();
const mockXTerminalSearch = vi.fn().mockReturnValue(true);
const mockXTerminalSearchNext = vi.fn().mockReturnValue(true);
const mockXTerminalSearchPrevious = vi.fn().mockReturnValue(true);
const mockXTerminalClearSearch = vi.fn();

// Capture onCloseRequest callbacks keyed by sessionId for testing wiring
const capturedCloseRequests = new Map<string, () => void>();
// Capture onFocus/onBlur callbacks keyed by sessionId for focus indicator tests
const capturedFocusCallbacks = new Map<string, () => void>();
const capturedBlurCallbacks = new Map<string, () => void>();

vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerminal(
		props: { sessionId: string; onCloseRequest?: () => void; onFocus?: () => void; onBlur?: () => void },
		ref: React.Ref<unknown>
	) {
		React.useImperativeHandle(ref, () => ({
			focus: mockXTerminalFocus,
			search: mockXTerminalSearch,
			searchNext: mockXTerminalSearchNext,
			searchPrevious: mockXTerminalSearchPrevious,
			clearSearch: mockXTerminalClearSearch,
			write: vi.fn(),
			clear: mockXTerminalClear,
			scrollToBottom: vi.fn(),
			getSelection: vi.fn().mockReturnValue(''),
			resize: vi.fn(),
		}));
		// Store the onCloseRequest callback for testing
		if (props.onCloseRequest) {
			capturedCloseRequests.set(props.sessionId, props.onCloseRequest);
		}
		// Store focus/blur callbacks for testing
		if (props.onFocus) {
			capturedFocusCallbacks.set(props.sessionId, props.onFocus);
		}
		if (props.onBlur) {
			capturedBlurCallbacks.set(props.sessionId, props.onBlur);
		}
		return <div data-testid={`xterminal-${props.sessionId}`}>XTerminal: {props.sessionId}</div>;
	}),
}));

// Mock TerminalSearchBar
vi.mock('../../../renderer/components/TerminalSearchBar', () => ({
	TerminalSearchBar: function MockTerminalSearchBar({
		isOpen,
		onClose,
		onSearch,
		onSearchNext,
		onSearchPrevious,
	}: {
		isOpen: boolean;
		onClose: () => void;
		onSearch: (q: string) => boolean;
		onSearchNext: () => boolean;
		onSearchPrevious: () => boolean;
		theme: Theme;
	}) {
		if (!isOpen) return null;
		return (
			<div data-testid="terminal-search-bar">
				<button data-testid="search-close" onClick={onClose}>Close</button>
				<button data-testid="search-find" onClick={() => onSearch('test')}>Find</button>
				<button data-testid="search-next" onClick={onSearchNext}>Next</button>
				<button data-testid="search-prev" onClick={onSearchPrevious}>Prev</button>
			</div>
		);
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
	Edit3: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="edit3-icon" className={className} style={style}>✎</span>
	),
	ChevronsRight: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevrons-right-icon" className={className} style={style}>»</span>
	),
}));

// Minimal theme
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

function makeSession(tabOverrides?: Partial<TerminalTab>[], activeTabIndex = 0): Session {
	const tabs = (tabOverrides || [{}]).map((overrides, i) => ({
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

// Mock spawnTerminalTab on the process API
let mockSpawnTerminalTab: ReturnType<typeof vi.fn>;
let mockProcessKill: ReturnType<typeof vi.fn>;
let exitCallbacks: Array<(sid: string, code: number) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	exitCallbacks = [];
	capturedCloseRequests.clear();
	capturedFocusCallbacks.clear();
	capturedBlurCallbacks.clear();

	mockSpawnTerminalTab = vi.fn().mockResolvedValue({ pid: 1234, success: true });
	mockProcessKill = vi.fn().mockResolvedValue(undefined);

	// Extend existing mock with spawnTerminalTab
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

describe('TerminalView', () => {
	it('renders terminal tab bar and XTerminal instances', () => {
		const session = makeSession([{}, {}]);
		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		// Tab bar should show tabs
		expect(screen.getByText('Terminal 1')).toBeTruthy();
		expect(screen.getByText('Terminal 2')).toBeTruthy();

		// XTerminal instances should be rendered for each tab
		const tabs = session.terminalTabs!;
		expect(screen.getByTestId(`xterminal-test-session-terminal-${tabs[0].id}`)).toBeTruthy();
		expect(screen.getByTestId(`xterminal-test-session-terminal-${tabs[1].id}`)).toBeTruthy();
	});

	it('spawns PTY for active tab on mount', async () => {
		const session = makeSession([{}]);
		const onTabPidChange = vi.fn();
		const onTabStateChange = vi.fn();
		const props = defaultProps({ session, onTabPidChange, onTabStateChange });

		render(<TerminalView {...props} />);

		await waitFor(() => {
			expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: `test-session-terminal-${session.terminalTabs![0].id}`,
					cwd: '/test',
					shell: 'zsh',
				})
			);
		});

		await waitFor(() => {
			expect(onTabPidChange).toHaveBeenCalledWith(session.terminalTabs![0].id, 1234);
			expect(onTabStateChange).toHaveBeenCalledWith(session.terminalTabs![0].id, 'idle');
		});
	});

	it('does not spawn PTY for tab that already has a pid', async () => {
		const session = makeSession([{ pid: 5678 }]);
		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		// Wait a tick to ensure no async spawn happens
		await new Promise(resolve => setTimeout(resolve, 100));
		expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
	});

	it('does not spawn PTY for exited tab', async () => {
		const session = makeSession([{ state: 'exited' as const, exitCode: 0 }]);
		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		await new Promise(resolve => setTimeout(resolve, 100));
		expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
	});

	it('kills PTY when tab is closed', async () => {
		const session = makeSession([{ pid: 1234 }, {}]);
		const onTabClose = vi.fn();
		const props = defaultProps({ session, onTabClose });

		render(<TerminalView {...props} />);

		// Click close button on first tab (need to hover first to show close button)
		const tab1 = screen.getByText('Terminal 1');
		fireEvent.mouseEnter(tab1.closest('[draggable]')!);

		const closeButtons = screen.getAllByTitle('Close terminal');
		fireEvent.click(closeButtons[0]);

		await waitFor(() => {
			expect(mockProcessKill).toHaveBeenCalledWith(
				`test-session-terminal-${session.terminalTabs![0].id}`
			);
			expect(onTabClose).toHaveBeenCalledWith(session.terminalTabs![0].id);
		});
	});

	it('handles PTY exit event and updates tab state', async () => {
		const session = makeSession([{}]);
		const onTabStateChange = vi.fn();
		const props = defaultProps({ session, onTabStateChange });

		render(<TerminalView {...props} />);

		// Simulate PTY exit
		const tabId = session.terminalTabs![0].id;
		const ptySessionId = `test-session-terminal-${tabId}`;

		act(() => {
			for (const cb of exitCallbacks) {
				cb(ptySessionId, 0);
			}
		});

		expect(onTabStateChange).toHaveBeenCalledWith(tabId, 'exited', 0);
	});

	it('shows empty message when no tabs exist', () => {
		const session = {
			...makeSession([]),
			terminalTabs: [],
		} as Session;
		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		expect(screen.getByText('No terminal tabs. Click + to create one.')).toBeTruthy();
	});

	it('only shows active tab as visible (non-active tabs are invisible)', () => {
		const session = makeSession([{}, {}]);
		const props = defaultProps({ session });

		render(<TerminalView {...props} />);

		const tabs = session.terminalTabs!;
		const activeContainer = screen.getByTestId(`xterminal-test-session-terminal-${tabs[0].id}`).parentElement;
		const inactiveContainer = screen.getByTestId(`xterminal-test-session-terminal-${tabs[1].id}`).parentElement;

		// Active tab should NOT have 'invisible' class
		expect(activeContainer!.className).not.toContain('invisible');
		// Inactive tab SHOULD have 'invisible' class
		expect(inactiveContainer!.className).toContain('invisible');
	});

	it('calls onNewTab when the + button is clicked', () => {
		const session = makeSession([{}]);
		const onNewTab = vi.fn();
		const props = defaultProps({ session, onNewTab });

		render(<TerminalView {...props} />);

		const plusButton = screen.getByTitle(/New terminal/);
		fireEvent.click(plusButton);
		expect(onNewTab).toHaveBeenCalled();
	});

	it('calls onTabSelect when a tab is clicked', () => {
		const session = makeSession([{}, {}]);
		const onTabSelect = vi.fn();
		const props = defaultProps({ session, onTabSelect });

		render(<TerminalView {...props} />);

		fireEvent.click(screen.getByText('Terminal 2'));
		expect(onTabSelect).toHaveBeenCalledWith(session.terminalTabs![1].id);
	});

	it('renders search bar when searchOpen is true', () => {
		const session = makeSession([{}]);
		const props = defaultProps({ session, searchOpen: true });

		render(<TerminalView {...props} />);

		expect(screen.getByTestId('terminal-search-bar')).toBeTruthy();
	});

	it('does not render search bar when searchOpen is false', () => {
		const session = makeSession([{}]);
		const props = defaultProps({ session, searchOpen: false });

		render(<TerminalView {...props} />);

		expect(screen.queryByTestId('terminal-search-bar')).toBeNull();
	});

	it('delegates search to active terminal XTerminal handle', async () => {
		const session = makeSession([{ pid: 1234 }]);
		const props = defaultProps({ session, searchOpen: true });

		render(<TerminalView {...props} />);

		// Use the mock search bar's find button
		fireEvent.click(screen.getByTestId('search-find'));

		// The mock XTerminal's search should have been called
		await waitFor(() => {
			expect(mockXTerminalSearch).toHaveBeenCalledWith('test');
		});
	});

	it('delegates searchNext to active terminal', async () => {
		const session = makeSession([{ pid: 1234 }]);
		const props = defaultProps({ session, searchOpen: true });

		render(<TerminalView {...props} />);

		fireEvent.click(screen.getByTestId('search-next'));

		await waitFor(() => {
			expect(mockXTerminalSearchNext).toHaveBeenCalled();
		});
	});

	it('clears search and focuses terminal on search close', async () => {
		const session = makeSession([{ pid: 1234 }]);
		const onSearchClose = vi.fn();
		const props = defaultProps({ session, searchOpen: true, onSearchClose });

		render(<TerminalView {...props} />);

		fireEvent.click(screen.getByTestId('search-close'));

		await waitFor(() => {
			expect(mockXTerminalClearSearch).toHaveBeenCalled();
			expect(mockXTerminalFocus).toHaveBeenCalled();
			expect(onSearchClose).toHaveBeenCalled();
		});
	});

	it('handles spawn failure gracefully', async () => {
		mockSpawnTerminalTab.mockResolvedValueOnce({ pid: 0, success: false });

		const session = makeSession([{}]);
		const onTabStateChange = vi.fn();
		const props = defaultProps({ session, onTabStateChange });

		render(<TerminalView {...props} />);

		await waitFor(() => {
			expect(onTabStateChange).toHaveBeenCalledWith(
				session.terminalTabs![0].id,
				'exited',
				-1
			);
		});
	});

	it('handles spawn exception gracefully', async () => {
		mockSpawnTerminalTab.mockRejectedValueOnce(new Error('spawn error'));

		const session = makeSession([{}]);
		const onTabStateChange = vi.fn();
		const props = defaultProps({ session, onTabStateChange });

		render(<TerminalView {...props} />);

		await waitFor(() => {
			expect(onTabStateChange).toHaveBeenCalledWith(
				session.terminalTabs![0].id,
				'exited',
				1
			);
		});
	});

	describe('Terminal spawn on session creation', () => {
		it('spawns PTY when session is freshly created via ensureTerminalTabs', async () => {
			// Simulate a new session without terminal tabs (session creation flow)
			const bareSession = {
				id: 'new-session',
				name: 'New Session',
				mode: 'terminal' as const,
				fullPath: '/project',
				cwd: '/project',
				inputMode: 'terminal',
				logs: [],
				isThinking: false,
				agentType: 'terminal' as const,
			} as Session;

			// ensureTerminalTabs adds terminal tabs (what App.tsx does on session creation)
			const session = ensureTerminalTabs(bareSession, 'zsh');

			expect(session.terminalTabs).toHaveLength(1);
			expect(session.activeTerminalTabId).toBeTruthy();

			const onTabPidChange = vi.fn();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ session, onTabPidChange, onTabStateChange });

			render(<TerminalView {...props} />);

			// PTY should be spawned for the auto-created terminal tab
			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						sessionId: `new-session-terminal-${session.terminalTabs![0].id}`,
						cwd: '/project',
						shell: 'zsh',
					})
				);
			});

			await waitFor(() => {
				expect(onTabPidChange).toHaveBeenCalledWith(session.terminalTabs![0].id, 1234);
				expect(onTabStateChange).toHaveBeenCalledWith(session.terminalTabs![0].id, 'idle');
			});
		});

		it('falls back to session cwd when tab cwd is empty', async () => {
			const session = makeSession([{ cwd: '' }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						cwd: '/test', // Falls back to session.cwd
					})
				);
			});
		});

		it('passes shell args and env vars to spawned PTY', async () => {
			const session = makeSession([{}]);
			const props = defaultProps({
				session,
				defaultShell: 'bash',
				shellArgs: '--login',
				shellEnvVars: { TERM_PROGRAM: 'Maestro' },
			});

			render(<TerminalView {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledWith(
					expect.objectContaining({
						shell: 'bash',
						shellArgs: '--login',
						shellEnvVars: { TERM_PROGRAM: 'Maestro' },
					})
				);
			});
		});

		it('generates correct terminal session ID format for spawn', async () => {
			const session = makeSession([{}]);
			const tabId = session.terminalTabs![0].id;
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			await waitFor(() => {
				const call = mockSpawnTerminalTab.mock.calls[0][0];
				expect(call.sessionId).toBe(`test-session-terminal-${tabId}`);
				// Verify it matches the expected format: {sessionId}-terminal-{tabId}
				expect(call.sessionId).toMatch(/^test-session-terminal-.+$/);
			});
		});
	});

	describe('TerminalViewHandle (ref API)', () => {
		it('exposes clearActiveTerminal via ref', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const ref = React.createRef<TerminalViewHandle>();
			const props = defaultProps({ session });

			render(<TerminalView ref={ref} {...props} />);

			// Wait for XTerminal refs to be set up
			await waitFor(() => {
				expect(ref.current).not.toBeNull();
			});

			act(() => {
				ref.current!.clearActiveTerminal();
			});

			expect(mockXTerminalClear).toHaveBeenCalled();
		});

		it('exposes focusActiveTerminal via ref', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const ref = React.createRef<TerminalViewHandle>();
			const props = defaultProps({ session });

			render(<TerminalView ref={ref} {...props} />);

			await waitFor(() => {
				expect(ref.current).not.toBeNull();
			});

			// Clear the auto-focus calls that happen on mount
			mockXTerminalFocus.mockClear();

			act(() => {
				ref.current!.focusActiveTerminal();
			});

			expect(mockXTerminalFocus).toHaveBeenCalled();
		});

		it('exposes searchActiveTerminal via ref', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const ref = React.createRef<TerminalViewHandle>();
			const props = defaultProps({ session });

			render(<TerminalView ref={ref} {...props} />);

			await waitFor(() => {
				expect(ref.current).not.toBeNull();
			});

			let result: boolean;
			act(() => {
				result = ref.current!.searchActiveTerminal('hello');
			});

			expect(mockXTerminalSearch).toHaveBeenCalledWith('hello');
			expect(result!).toBe(true);
		});

		it('exposes searchNext and searchPrevious via ref', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const ref = React.createRef<TerminalViewHandle>();
			const props = defaultProps({ session });

			render(<TerminalView ref={ref} {...props} />);

			await waitFor(() => {
				expect(ref.current).not.toBeNull();
			});

			act(() => {
				ref.current!.searchNext();
			});
			expect(mockXTerminalSearchNext).toHaveBeenCalled();

			act(() => {
				ref.current!.searchPrevious();
			});
			expect(mockXTerminalSearchPrevious).toHaveBeenCalled();
		});

		it('returns false from search methods when no active terminal', async () => {
			// Session with no tabs = no active terminal
			const session = {
				...makeSession([]),
				terminalTabs: [],
				activeTerminalTabId: undefined,
			} as Session;
			const ref = React.createRef<TerminalViewHandle>();
			const props = defaultProps({ session });

			render(<TerminalView ref={ref} {...props} />);

			await waitFor(() => {
				expect(ref.current).not.toBeNull();
			});

			let searchResult: boolean;
			let nextResult: boolean;
			let prevResult: boolean;
			act(() => {
				searchResult = ref.current!.searchActiveTerminal('test');
				nextResult = ref.current!.searchNext();
				prevResult = ref.current!.searchPrevious();
			});

			expect(searchResult!).toBe(false);
			expect(nextResult!).toBe(false);
			expect(prevResult!).toBe(false);
		});
	});

	describe('PTY spawn failure error UI', () => {
		it('shows error overlay when tab spawn failed (state=exited, pid=0, exitCode!=0)', () => {
			const tabId = 'fail-tab';
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// Error overlay should be visible
			expect(screen.getByTestId(`spawn-error-${tabId}`)).toBeTruthy();
			expect(screen.getByText('Failed to start terminal')).toBeTruthy();
			expect(screen.getByText('Retry')).toBeTruthy();
			expect(screen.getByTestId('alert-circle-icon')).toBeTruthy();

			// XTerminal should NOT be rendered for this tab
			expect(screen.queryByTestId(`xterminal-test-session-terminal-${tabId}`)).toBeNull();
		});

		it('does not show error overlay for normally exited tab (pid > 0)', () => {
			const session = makeSession([{
				state: 'exited' as const,
				exitCode: 1,
				pid: 5678,
			}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// No error overlay — XTerminal should still be rendered
			const tabId = session.terminalTabs![0].id;
			expect(screen.queryByTestId(`spawn-error-${tabId}`)).toBeNull();
			expect(screen.getByTestId(`xterminal-test-session-terminal-${tabId}`)).toBeTruthy();
		});

		it('does not show error overlay for idle tab (not yet spawned)', () => {
			const session = makeSession([{
				state: 'idle' as const,
				pid: 0,
			}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			expect(screen.queryByTestId(`spawn-error-${tabId}`)).toBeNull();
			expect(screen.getByTestId(`xterminal-test-session-terminal-${tabId}`)).toBeTruthy();
		});

		it('does not show error overlay for exited tab with exitCode 0 (clean exit)', () => {
			const session = makeSession([{
				state: 'exited' as const,
				exitCode: 0,
				pid: 0,
			}]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			expect(screen.queryByTestId(`spawn-error-${tabId}`)).toBeNull();
		});

		it('calls onTabStateChange with idle when retry button is clicked', () => {
			const tabId = 'fail-tab';
			const onTabStateChange = vi.fn();
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session, onTabStateChange });

			render(<TerminalView {...props} />);

			fireEvent.click(screen.getByText('Retry'));
			expect(onTabStateChange).toHaveBeenCalledWith(tabId, 'idle');
		});

		it('transitions from error overlay to XTerminal after successful retry', async () => {
			const tabId = 'fail-tab';
			const onTabStateChange = vi.fn();
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session, onTabStateChange });

			const { rerender } = render(<TerminalView {...props} />);

			// Error overlay should be visible
			expect(screen.getByTestId(`spawn-error-${tabId}`)).toBeTruthy();

			// Simulate retry: parent resets state to 'idle' (as handleRetrySpawn requests)
			const retriedSession = makeSession([{
				id: tabId,
				state: 'idle' as const,
				exitCode: undefined,
				pid: 0,
			}]);
			(retriedSession as Record<string, unknown>).activeTerminalTabId = tabId;
			rerender(<TerminalView {...defaultProps({ session: retriedSession })} />);

			// Error overlay should be gone, XTerminal should be rendered
			expect(screen.queryByTestId(`spawn-error-${tabId}`)).toBeNull();
			expect(screen.getByTestId(`xterminal-test-session-terminal-${tabId}`)).toBeTruthy();
		});

		it('shows error overlay with spawn rejection (exitCode=1)', () => {
			const tabId = 'reject-tab';
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: 1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			expect(screen.getByTestId(`spawn-error-${tabId}`)).toBeTruthy();
			expect(screen.getByText('Failed to start terminal')).toBeTruthy();
		});

		it('renders error overlay only for spawn-failed tab, not sibling tabs', () => {
			const failTab = {
				id: 'fail-tab',
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			};
			const okTab = {
				id: 'ok-tab',
				state: 'idle' as const,
				pid: 1234,
			};
			const session = makeSession([failTab, okTab]);
			(session as Record<string, unknown>).activeTerminalTabId = 'fail-tab';
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// Failed tab shows error overlay
			expect(screen.getByTestId('spawn-error-fail-tab')).toBeTruthy();
			// OK tab shows XTerminal
			expect(screen.getByTestId('xterminal-test-session-terminal-ok-tab')).toBeTruthy();
			expect(screen.queryByTestId('spawn-error-ok-tab')).toBeNull();
		});

		it('styles error overlay with theme colors', () => {
			const tabId = 'fail-tab';
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// jsdom converts hex to rgb in computed style, so use toHaveStyle
			// which handles color format normalization
			const icon = screen.getByTestId('alert-circle-icon');
			expect(icon).toHaveStyle({ color: theme.colors.error });

			const message = screen.getByText('Failed to start terminal');
			expect(message).toHaveStyle({ color: theme.colors.textMain });

			const retryButton = screen.getByText('Retry');
			expect(retryButton).toHaveStyle({ backgroundColor: theme.colors.accent });
			expect(retryButton).toHaveStyle({ color: theme.colors.accentForeground });

			const overlay = screen.getByTestId(`spawn-error-${tabId}`);
			expect(overlay).toHaveStyle({ backgroundColor: theme.colors.bgMain });
		});

		it('auto-spawns PTY after retry resets state to idle', async () => {
			// Start with a failed tab
			const tabId = 'fail-tab';
			const session = makeSession([{
				id: tabId,
				state: 'exited' as const,
				exitCode: -1,
				pid: 0,
			}]);
			(session as Record<string, unknown>).activeTerminalTabId = tabId;
			const props = defaultProps({ session });

			const { rerender } = render(<TerminalView {...props} />);

			// No spawn should have happened (tab is exited)
			await act(async () => {
				await new Promise((r) => setTimeout(r, 50));
			});
			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();

			// Simulate retry: parent resets state to idle
			const retriedSession = makeSession([{
				id: tabId,
				state: 'idle' as const,
				pid: 0,
			}]);
			(retriedSession as Record<string, unknown>).activeTerminalTabId = tabId;
			rerender(<TerminalView {...defaultProps({ session: retriedSession })} />);

			// useEffect should trigger spawnPtyForTab since state is no longer 'exited'
			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe('Shell exit close-on-keypress wiring', () => {
		it('passes onCloseRequest callback to XTerminal', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const onTabClose = vi.fn();
			const props = defaultProps({ session, onTabClose });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const terminalSessionId = `test-session-terminal-${tabId}`;

			// The mock XTerminal should have captured the onCloseRequest callback
			await waitFor(() => {
				expect(capturedCloseRequests.has(terminalSessionId)).toBe(true);
			});
		});

		it('onCloseRequest triggers tab close (kills PTY and calls onTabClose)', async () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const onTabClose = vi.fn();
			const props = defaultProps({ session, onTabClose });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const terminalSessionId = `test-session-terminal-${tabId}`;

			// Wait for the callback to be captured
			await waitFor(() => {
				expect(capturedCloseRequests.has(terminalSessionId)).toBe(true);
			});

			// Simulate what happens when XTerminal calls onCloseRequest (user pressed key after exit)
			act(() => {
				capturedCloseRequests.get(terminalSessionId)!();
			});

			await waitFor(() => {
				expect(mockProcessKill).toHaveBeenCalledWith(terminalSessionId);
				expect(onTabClose).toHaveBeenCalledWith(tabId);
			});
		});

		it('each tab gets its own onCloseRequest that closes the correct tab', async () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const onTabClose = vi.fn();
			const props = defaultProps({ session, onTabClose });

			render(<TerminalView {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab2Id = session.terminalTabs![1].id;
			const sessionId1 = `test-session-terminal-${tab1Id}`;
			const sessionId2 = `test-session-terminal-${tab2Id}`;

			await waitFor(() => {
				expect(capturedCloseRequests.has(sessionId1)).toBe(true);
				expect(capturedCloseRequests.has(sessionId2)).toBe(true);
			});

			// Invoke close for second tab
			act(() => {
				capturedCloseRequests.get(sessionId2)!();
			});

			await waitFor(() => {
				expect(onTabClose).toHaveBeenCalledWith(tab2Id);
				// First tab's PTY should NOT be killed
				expect(mockProcessKill).not.toHaveBeenCalledWith(sessionId1);
			});
		});
	});

	describe('Focus indicator', () => {
		it('passes onFocus and onBlur callbacks to each XTerminal', async () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab2Id = session.terminalTabs![1].id;
			const sessionId1 = `test-session-terminal-${tab1Id}`;
			const sessionId2 = `test-session-terminal-${tab2Id}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId1)).toBe(true);
				expect(capturedBlurCallbacks.has(sessionId1)).toBe(true);
				expect(capturedFocusCallbacks.has(sessionId2)).toBe(true);
				expect(capturedBlurCallbacks.has(sessionId2)).toBe(true);
			});
		});

		it('shows focus ring when active terminal gains focus', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const sessionId = `test-session-terminal-${tabId}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId)).toBe(true);
			});

			// Before focus: no box-shadow
			const container = screen.getByTestId(`terminal-container-${tabId}`);
			expect(container.style.boxShadow).toBe('');

			// Focus the terminal
			act(() => {
				capturedFocusCallbacks.get(sessionId)!();
			});

			// After focus: box-shadow with accent color
			expect(container.style.boxShadow).toBe(`inset 0 0 0 1px ${theme.colors.accent}`);
		});

		it('removes focus ring when terminal loses focus', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const sessionId = `test-session-terminal-${tabId}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId)).toBe(true);
			});

			// Focus then blur
			act(() => {
				capturedFocusCallbacks.get(sessionId)!();
			});
			const container = screen.getByTestId(`terminal-container-${tabId}`);
			expect(container.style.boxShadow).toContain('inset');

			act(() => {
				capturedBlurCallbacks.get(sessionId)!();
			});

			expect(container.style.boxShadow).toBe('');
		});

		it('does not show focus ring on inactive tab even when focused', async () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			// Tab 2 is inactive (tab 1 is active by default)
			const tab2Id = session.terminalTabs![1].id;
			const sessionId2 = `test-session-terminal-${tab2Id}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId2)).toBe(true);
			});

			// Focus the inactive terminal
			act(() => {
				capturedFocusCallbacks.get(sessionId2)!();
			});

			// Inactive tab container should have invisible class (hidden) so no visual effect
			const container = screen.getByTestId(`terminal-container-${tab2Id}`);
			expect(container.className).toContain('invisible');
		});

		it('uses theme accent color for the focus ring', async () => {
			const customTheme: Theme = {
				...theme,
				colors: { ...theme.colors, accent: '#ff5733' },
			};
			const session = makeSession([{ pid: 1234 }]);
			const props = defaultProps({ session, theme: customTheme });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const sessionId = `test-session-terminal-${tabId}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId)).toBe(true);
			});

			act(() => {
				capturedFocusCallbacks.get(sessionId)!();
			});

			const container = screen.getByTestId(`terminal-container-${tabId}`);
			expect(container.style.boxShadow).toBe('inset 0 0 0 1px #ff5733');
		});

		it('blur of one tab does not affect focus state of another tab', async () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab2Id = session.terminalTabs![1].id;
			const sessionId1 = `test-session-terminal-${tab1Id}`;
			const sessionId2 = `test-session-terminal-${tab2Id}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId1)).toBe(true);
				expect(capturedBlurCallbacks.has(sessionId2)).toBe(true);
			});

			// Focus tab 1
			act(() => {
				capturedFocusCallbacks.get(sessionId1)!();
			});

			const container1 = screen.getByTestId(`terminal-container-${tab1Id}`);
			expect(container1.style.boxShadow).toContain('inset');

			// Blur from tab 2 (which was never focused) should not affect tab 1
			act(() => {
				capturedBlurCallbacks.get(sessionId2)!();
			});

			expect(container1.style.boxShadow).toContain('inset');
		});

		it('handles rapid focus/blur cycles correctly', async () => {
			const session = makeSession([{ pid: 1234 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const sessionId = `test-session-terminal-${tabId}`;

			await waitFor(() => {
				expect(capturedFocusCallbacks.has(sessionId)).toBe(true);
			});

			// Rapid focus/blur/focus/blur/focus
			act(() => {
				capturedFocusCallbacks.get(sessionId)!();
				capturedBlurCallbacks.get(sessionId)!();
				capturedFocusCallbacks.get(sessionId)!();
				capturedBlurCallbacks.get(sessionId)!();
				capturedFocusCallbacks.get(sessionId)!();
			});

			const container = screen.getByTestId(`terminal-container-${tabId}`);
			expect(container.style.boxShadow).toContain('inset');
		});

		it('no focus ring initially (before any focus event)', () => {
			const session = makeSession([{ pid: 1234 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tabId = session.terminalTabs![0].id;
			const container = screen.getByTestId(`terminal-container-${tabId}`);
			expect(container.style.boxShadow).toBe('');
		});

		it('adds data-testid to terminal containers', () => {
			const session = makeSession([{ pid: 1234 }, { pid: 5678 }]);
			const props = defaultProps({ session });

			render(<TerminalView {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab2Id = session.terminalTabs![1].id;
			expect(screen.getByTestId(`terminal-container-${tab1Id}`)).toBeTruthy();
			expect(screen.getByTestId(`terminal-container-${tab2Id}`)).toBeTruthy();
		});
	});
});
