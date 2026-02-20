import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalTabBar } from '../../../renderer/components/TerminalTabBar';
import { TerminalView } from '../../../renderer/components/TerminalView';
import { createTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../../../renderer/types';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock XTerminal
const mockXTerminalFocus = vi.fn();
const mockXTerminalClear = vi.fn();
const mockXTerminalSearch = vi.fn().mockReturnValue(true);
const mockXTerminalSearchNext = vi.fn().mockReturnValue(true);
const mockXTerminalSearchPrevious = vi.fn().mockReturnValue(true);
const mockXTerminalClearSearch = vi.fn();

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
		return <div data-testid={`xterminal-${props.sessionId}`}>XTerminal: {props.sessionId}</div>;
	}),
}));

// Mock TerminalSearchBar
vi.mock('../../../renderer/components/TerminalSearchBar', () => ({
	TerminalSearchBar: function MockTerminalSearchBar({ isOpen }: { isOpen: boolean }) {
		if (!isOpen) return null;
		return <div data-testid="terminal-search-bar">Search</div>;
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
	Loader2: ({ className, style, 'data-testid': testId }: { className?: string; style?: React.CSSProperties; 'data-testid'?: string }) => (
		<span data-testid={testId || 'loader-icon'} className={className} style={style}>⟳</span>
	),
	AlertCircle: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="alert-circle-icon" className={className} style={style}>!</span>
	),
	Edit3: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="edit3-icon" className={className} style={style}>✎</span>
	),
	ChevronsRight: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevrons-right-icon" className={className} style={style}>»</span>
	),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

const lightTheme: Theme = {
	...theme,
	id: 'test-light',
	name: 'Test Light',
	mode: 'light',
	colors: {
		...theme.colors,
		accent: '#0066cc',
		textDim: '#666666',
		bgMain: '#ffffff',
	},
};

function makeTabs(count: number, overrides?: Partial<TerminalTab>[]): TerminalTab[] {
	return Array.from({ length: count }, (_, i) => ({
		...createTerminalTab('zsh', '/test'),
		...(overrides?.[i] || {}),
	}));
}

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

// Mock process API
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

function defaultViewProps(overrides?: Partial<Parameters<typeof TerminalView>[0]>) {
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

// ─── Tests: Tab bar spinner ──────────────────────────────────────────────────

describe('TerminalTabBar loading indicator', () => {
	it('shows Loader2 spinner when tab is spawning (pid=0, state=idle)', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		expect(screen.getByTestId('loader-icon')).toBeTruthy();
		expect(screen.queryByTestId('terminal-icon')).toBeNull();
	});

	it('shows TerminalIcon when tab has a pid (spawned)', () => {
		const tabs = makeTabs(1, [{ pid: 1234, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		expect(screen.getByTestId('terminal-icon')).toBeTruthy();
		expect(screen.queryByTestId('loader-icon')).toBeNull();
	});

	it('shows TerminalIcon when tab is exited (not spawning)', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'exited', exitCode: 1 }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		expect(screen.getByTestId('terminal-icon')).toBeTruthy();
		expect(screen.queryByTestId('loader-icon')).toBeNull();
	});

	it('shows TerminalIcon when tab is busy', () => {
		const tabs = makeTabs(1, [{ pid: 1234, state: 'busy' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		expect(screen.getByTestId('terminal-icon')).toBeTruthy();
		expect(screen.queryByTestId('loader-icon')).toBeNull();
	});

	it('spinner uses animate-spin class', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		const loader = screen.getByTestId('loader-icon');
		expect(loader.className).toContain('animate-spin');
	});

	it('spinner uses accent color when tab is active', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		const loader = screen.getByTestId('loader-icon');
		expect(loader).toHaveStyle({ color: theme.colors.accent });
	});

	it('spinner uses textDim color when tab is inactive', () => {
		const tabs = makeTabs(2, [{ pid: 1234, state: 'idle' }, { pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		// Second tab is inactive and spawning
		const loaders = screen.getAllByTestId('loader-icon');
		expect(loaders).toHaveLength(1); // Only inactive tab shows loader
		expect(loaders[0]).toHaveStyle({ color: theme.colors.textDim });
	});

	it('shows mixed icons: spinner for spawning tab, TerminalIcon for running tab', () => {
		const tabs = makeTabs(3, [
			{ pid: 1234, state: 'idle' },     // running → TerminalIcon
			{ pid: 0, state: 'idle' },         // spawning → Loader2
			{ pid: 5678, state: 'exited', exitCode: 0 }, // exited → TerminalIcon
		]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		expect(screen.getAllByTestId('terminal-icon')).toHaveLength(2);
		expect(screen.getAllByTestId('loader-icon')).toHaveLength(1);
	});

	it('spinner has same sizing class as TerminalIcon (w-3.5 h-3.5)', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		const loader = screen.getByTestId('loader-icon');
		expect(loader.className).toContain('w-3.5');
		expect(loader.className).toContain('h-3.5');
		expect(loader.className).toContain('flex-shrink-0');
	});

	it('transitions from spinner to TerminalIcon after PTY spawns', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		const { rerender } = render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		// Spawning: spinner visible
		expect(screen.getByTestId('loader-icon')).toBeTruthy();
		expect(screen.queryByTestId('terminal-icon')).toBeNull();

		// After spawn: update pid
		const spawnedTabs = makeTabs(1, [{ pid: 1234, state: 'idle' }]);
		// Preserve IDs from original tabs
		spawnedTabs[0].id = tabs[0].id;
		rerender(
			<TerminalTabBar
				tabs={spawnedTabs}
				activeTabId={spawnedTabs[0].id}
				theme={theme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		// After spawn: TerminalIcon visible, spinner gone
		expect(screen.getByTestId('terminal-icon')).toBeTruthy();
		expect(screen.queryByTestId('loader-icon')).toBeNull();
	});

	it('spinner works correctly with light theme', () => {
		const tabs = makeTabs(1, [{ pid: 0, state: 'idle' }]);
		render(
			<TerminalTabBar
				tabs={tabs}
				activeTabId={tabs[0].id}
				theme={lightTheme}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onNewTab={vi.fn()}
			/>
		);

		const loader = screen.getByTestId('loader-icon');
		expect(loader).toHaveStyle({ color: lightTheme.colors.accent });
	});
});

// ─── Tests: Content area loading overlay ─────────────────────────────────────

describe('TerminalView loading overlay', () => {
	it('shows loading overlay when tab is spawning (pid=0, state=idle)', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		expect(screen.getByTestId(`spawn-loading-${tabId}`)).toBeTruthy();
		expect(screen.getByText('Starting terminal...')).toBeTruthy();
	});

	it('does not show loading overlay when tab has a pid', () => {
		const session = makeSession([{ pid: 1234, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		expect(screen.queryByTestId(`spawn-loading-${tabId}`)).toBeNull();
	});

	it('does not show loading overlay when tab is exited', () => {
		const session = makeSession([{ pid: 0, state: 'exited', exitCode: 0 }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		expect(screen.queryByTestId(`spawn-loading-${tabId}`)).toBeNull();
	});

	it('does not show loading overlay when tab is busy', () => {
		const session = makeSession([{ pid: 1234, state: 'busy' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		expect(screen.queryByTestId(`spawn-loading-${tabId}`)).toBeNull();
	});

	it('loading overlay uses theme colors', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		const overlay = screen.getByTestId(`spawn-loading-${tabId}`);
		expect(overlay).toHaveStyle({ backgroundColor: theme.colors.bgMain });

		const text = screen.getByText('Starting terminal...');
		expect(text).toHaveStyle({ color: theme.colors.textDim });
	});

	it('loading overlay has pointer-events-none to not block terminal', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		const overlay = screen.getByTestId(`spawn-loading-${tabId}`);
		expect(overlay.className).toContain('pointer-events-none');
	});

	it('loading overlay disappears when PTY spawns', async () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		const { rerender } = render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		expect(screen.getByTestId(`spawn-loading-${tabId}`)).toBeTruthy();

		// Simulate PTY spawn completing
		const spawnedSession = makeSession([{ pid: 1234, state: 'idle' }]);
		// Preserve tab ID
		spawnedSession.terminalTabs![0].id = tabId;
		spawnedSession.activeTerminalTabId = tabId;
		rerender(<TerminalView {...defaultViewProps({ session: spawnedSession })} />);

		expect(screen.queryByTestId(`spawn-loading-${tabId}`)).toBeNull();
	});

	it('XTerminal is still rendered behind the loading overlay', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		// Both XTerminal and loading overlay should exist
		expect(screen.getByTestId(`xterminal-test-session-terminal-${tabId}`)).toBeTruthy();
		expect(screen.getByTestId(`spawn-loading-${tabId}`)).toBeTruthy();
	});

	it('shows loading overlay only for spawning tab, not sibling running tab', () => {
		const session = makeSession([
			{ pid: 0, state: 'idle' },      // spawning
			{ pid: 5678, state: 'idle' },    // running
		]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const spawningTabId = session.terminalTabs![0].id;
		const runningTabId = session.terminalTabs![1].id;

		expect(screen.getByTestId(`spawn-loading-${spawningTabId}`)).toBeTruthy();
		expect(screen.queryByTestId(`spawn-loading-${runningTabId}`)).toBeNull();
	});

	it('does not show loading overlay for spawn-failed tab (shows error instead)', () => {
		const tabId = 'fail-tab';
		const session = makeSession([{
			id: tabId,
			state: 'exited' as const,
			exitCode: -1,
			pid: 0,
		}]);
		(session as Record<string, unknown>).activeTerminalTabId = tabId;
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		// Should show error overlay, not loading overlay
		expect(screen.getByTestId(`spawn-error-${tabId}`)).toBeTruthy();
		expect(screen.queryByTestId(`spawn-loading-${tabId}`)).toBeNull();
	});

	it('loading overlay works with light theme', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session, theme: lightTheme });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		const overlay = screen.getByTestId(`spawn-loading-${tabId}`);
		expect(overlay).toHaveStyle({ backgroundColor: lightTheme.colors.bgMain });
	});

	it('loading overlay contains animated spinner', () => {
		const session = makeSession([{ pid: 0, state: 'idle' }]);
		const props = defaultViewProps({ session });

		render(<TerminalView {...props} />);

		const tabId = session.terminalTabs![0].id;
		const overlay = screen.getByTestId(`spawn-loading-${tabId}`);
		// The Loader2 mock renders with animate-spin class
		const spinner = overlay.querySelector('[class*="animate-spin"]');
		expect(spinner).toBeTruthy();
	});
});
