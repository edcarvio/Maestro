import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalView, TerminalViewHandle } from '../../../renderer/components/TerminalView';
import { createTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../../../renderer/types';

// Mock XTerminal - we test TerminalView's container logic, not xterm.js internals
const mockXTerminalFocus = vi.fn();
const mockXTerminalClear = vi.fn();
const mockXTerminalSearch = vi.fn().mockReturnValue(true);
const mockXTerminalSearchNext = vi.fn().mockReturnValue(true);
const mockXTerminalSearchPrevious = vi.fn().mockReturnValue(true);
const mockXTerminalClearSearch = vi.fn();

vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerminal(
		props: { sessionId: string },
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
});
