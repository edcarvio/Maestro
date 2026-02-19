/**
 * @file terminalLoadingIndicator.test.tsx
 * @description Tests for terminal tab loading indicator (spinner while PTY spawns):
 * - Spinner shown in tab when processRunning is undefined (PTY spawning)
 * - Green dot shown when processRunning is true (PTY running)
 * - Gray dot shown when processRunning is false (PTY exited)
 * - onSpawned callback fired after successful PTY spawn
 * - onSpawned not fired on spawn failure
 * - Spinner → dot transition on spawn completion
 * - Theme integration (accent color on spinner)
 * - Multiple tabs with mixed states
 */

import React from 'react';
import { render, act, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme, TerminalTab, UnifiedTab } from '../../../renderer/types';

// ============================================================================
// Part 1: EmbeddedTerminal onSpawned callback tests
// ============================================================================

// --- Hoisted mocks ---

const {
	terminalMethods,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	MockSearchAddon,
	MockUnicode11Addon,
	mockSpawn,
	mockWrite,
	mockKill,
	mockResize,
	mockOnRawPtyData,
	mockOnExit,
} = vi.hoisted(() => {
	const _terminalMethods = {
		open: vi.fn(),
		write: vi.fn(),
		writeln: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		dispose: vi.fn(),
		scrollToBottom: vi.fn(),
		getSelection: vi.fn(() => 'selected text'),
		onData: vi.fn(() => ({ dispose: vi.fn() })),
		onResize: vi.fn(() => ({ dispose: vi.fn() })),
		onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
	});

	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = vi.fn();
		this.dispose = vi.fn();
	});

	const _MockWebLinksAddon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _MockSearchAddon = vi.fn(function (this: Record<string, unknown>) {
		this.findNext = vi.fn(() => true);
		this.findPrevious = vi.fn(() => true);
		this.clearDecorations = vi.fn();
		this.dispose = vi.fn();
	});

	const _MockUnicode11Addon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _mockSpawn = vi.fn(() => Promise.resolve({ success: true, pid: 1234 }));
	const _mockWrite = vi.fn(() => Promise.resolve(true));
	const _mockKill = vi.fn(() => Promise.resolve(true));
	const _mockResize = vi.fn(() => Promise.resolve(true));
	const _mockOnRawPtyData = vi.fn(() => vi.fn());
	const _mockOnExit = vi.fn(() => vi.fn());

	return {
		terminalMethods: _terminalMethods,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockSpawn: _mockSpawn,
		mockWrite: _mockWrite,
		mockKill: _mockKill,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
		mockOnExit: _mockOnExit,
	};
});

// --- vi.mock calls ---

vi.mock('@xterm/xterm', () => ({
	Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: MockWebLinksAddon,
}));

vi.mock('@xterm/addon-search', () => ({
	SearchAddon: MockSearchAddon,
}));

vi.mock('@xterm/addon-unicode11', () => ({
	Unicode11Addon: MockUnicode11Addon,
}));

vi.mock('@xterm/addon-webgl', () => ({
	WebglAddon: vi.fn(function (this: Record<string, unknown>) {
		this.onContextLoss = vi.fn();
		this.dispose = vi.fn();
	}),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('../../../renderer/services/process', () => ({
	processService: {
		spawn: (...args: unknown[]) => mockSpawn(...args),
		write: (...args: unknown[]) => mockWrite(...args),
		kill: (...args: unknown[]) => mockKill(...args),
		resize: (...args: unknown[]) => mockResize(...args),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
		onExit: (...args: unknown[]) => mockOnExit(...args),
	},
}));

vi.mock('../../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#000',
		foreground: '#fff',
	})),
}));

// --- Import after mocks ---

import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import { TabBar } from '../../../renderer/components/TabBar';

// --- Test helpers ---

const darkTheme: Theme = {
	id: 'dracula',
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#44475a',
		border: '#6272a4',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: 'rgba(189, 147, 249, 0.2)',
		accentText: '#bd93f9',
		accentForeground: '#ffffff',
		success: '#50fa7b',
		warning: '#f1fa8c',
		error: '#ff5555',
	},
};

const lightTheme: Theme = {
	id: 'github-light',
	name: 'GitHub Light',
	mode: 'light',
	colors: {
		bgMain: '#ffffff',
		bgSidebar: '#f6f8fa',
		bgActivity: '#e1e4e8',
		border: '#e1e4e8',
		textMain: '#24292e',
		textDim: '#6a737d',
		accent: '#0366d6',
		accentDim: 'rgba(3, 102, 214, 0.2)',
		accentText: '#0366d6',
		accentForeground: '#ffffff',
		success: '#28a745',
		warning: '#f9c513',
		error: '#d73a49',
	},
};

const noop = () => {};

/** Helper: minimal AI tab for TabBar (required prop) */
const minimalAiTab = {
	id: 'ai-1',
	name: 'AI Tab',
	agentSessionId: null,
	isGeneratingName: false,
	messages: [],
	autoScrollEnabled: true,
	scrollPosition: 0,
	isAtBottom: true,
	createdAt: Date.now(),
	saveToHistory: true,
	showThinking: true,
	unread: false,
	starred: false,
	hasUserMessages: false,
	inputDraft: '',
	stagedImages: [],
};

/** Build a terminal tab with specified state */
function makeTerminalTab(
	overrides: Partial<TerminalTab> & { id: string }
): TerminalTab {
	return {
		name: null,
		createdAt: Date.now(),
		cwd: '/tmp',
		...overrides,
	};
}

/** Build unified tab list including terminal tabs */
function buildUnifiedTabs(terminalTabs: TerminalTab[]): UnifiedTab[] {
	return [
		{ type: 'ai' as const, id: 'ai-1', data: minimalAiTab },
		...terminalTabs.map((t) => ({
			type: 'terminal' as const,
			id: t.id,
			data: t,
		})),
	];
}

/** Render TabBar with terminal tabs in specified states */
function renderTabBar(
	terminalTabs: TerminalTab[],
	activeTerminalTabId: string | null = null,
	theme: Theme = darkTheme,
) {
	return render(
		<TabBar
			tabs={[minimalAiTab]}
			activeTabId="ai-1"
			theme={theme}
			onTabSelect={noop}
			onTabClose={noop}
			onNewTab={noop}
			unifiedTabs={buildUnifiedTabs(terminalTabs)}
			activeTerminalTabId={activeTerminalTabId}
			onTerminalTabSelect={noop}
			onTerminalTabClose={noop}
			onNewTerminalTab={noop}
		/>
	);
}

// ============================================================================
// Tests
// ============================================================================

describe('Terminal loading indicator', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	// ================================================================
	// EmbeddedTerminal onSpawned callback
	// ================================================================

	describe('EmbeddedTerminal onSpawned callback', () => {
		it('calls onSpawned with tab ID after successful PTY spawn', async () => {
			const onSpawned = vi.fn();

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="tab-spawned-1"
						cwd="/tmp"
						theme={darkTheme}
						fontFamily="Menlo"
						isVisible={true}
						onSpawned={onSpawned}
					/>
				);
			});

			// Wait for async setupTerminal → spawn → onSpawned to complete
			await waitFor(() => {
				expect(onSpawned).toHaveBeenCalledTimes(1);
			});
			expect(onSpawned).toHaveBeenCalledWith('tab-spawned-1');
		});

		it('does not call onSpawned when spawn fails', async () => {
			const onSpawned = vi.fn();
			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'fail' });

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="tab-spawned-fail"
						cwd="/tmp"
						theme={darkTheme}
						fontFamily="Menlo"
						isVisible={true}
						onSpawned={onSpawned}
					/>
				);
			});

			await waitFor(() => {
				expect(screen.getByTestId('spawn-error-overlay')).toBeTruthy();
			});

			expect(onSpawned).not.toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it('works without onSpawned prop (optional callback)', async () => {
			// Should not throw when onSpawned is not provided
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="tab-no-callback"
						cwd="/tmp"
						theme={darkTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(mockSpawn).toHaveBeenCalled();
			// No assertion on onSpawned — just verifying no crash
		});

		it('calls onSpawned on successful retry after initial failure', async () => {
			const onSpawned = vi.fn();

			// First spawn fails
			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'temp error' });

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="tab-retry-spawned"
						cwd="/tmp"
						theme={darkTheme}
						fontFamily="Menlo"
						isVisible={true}
						onSpawned={onSpawned}
					/>
				);
			});

			await waitFor(() => {
				expect(screen.getByTestId('spawn-error-overlay')).toBeTruthy();
			});

			expect(onSpawned).not.toHaveBeenCalled();

			// Retry succeeds
			mockSpawn.mockResolvedValueOnce({ success: true, pid: 5678 });

			await act(async () => {
				screen.getByTestId('spawn-retry-button').click();
				await new Promise((r) => setTimeout(r, 150));
			});

			expect(onSpawned).toHaveBeenCalledTimes(1);
			expect(onSpawned).toHaveBeenCalledWith('tab-retry-spawned');
		});

		it('calls onSpawned before subscribing to PTY data', async () => {
			const callOrder: string[] = [];
			const onSpawned = vi.fn(() => callOrder.push('onSpawned'));
			mockOnRawPtyData.mockImplementation(() => {
				callOrder.push('onRawPtyData');
				return vi.fn();
			});

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="tab-order"
						cwd="/tmp"
						theme={darkTheme}
						fontFamily="Menlo"
						isVisible={true}
						onSpawned={onSpawned}
					/>
				);
			});

			expect(callOrder).toEqual(['onSpawned', 'onRawPtyData']);
		});
	});

	// ================================================================
	// TabBar spinner vs status dot rendering
	// ================================================================

	describe('TabBar terminal tab status indicator', () => {
		it('shows spinner when processRunning is undefined (spawning)', () => {
			const tab = makeTerminalTab({ id: 'term-spawning' });
			// processRunning defaults to undefined
			renderTabBar([tab], 'term-spawning');

			expect(screen.getByTestId('terminal-tab-spinner')).toBeTruthy();
			expect(screen.queryByTestId('terminal-tab-status-dot')).toBeNull();
		});

		it('shows green dot when processRunning is true (running)', () => {
			const tab = makeTerminalTab({
				id: 'term-running',
				processRunning: true,
			});
			renderTabBar([tab], 'term-running');

			const dot = screen.getByTestId('terminal-tab-status-dot');
			expect(dot).toBeTruthy();
			expect(dot.style.backgroundColor).toBe('rgb(34, 197, 94)'); // #22c55e
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
		});

		it('shows gray dot when processRunning is false (exited)', () => {
			const tab = makeTerminalTab({
				id: 'term-exited',
				processRunning: false,
				exitCode: 0,
			});
			renderTabBar([tab], 'term-exited');

			const dot = screen.getByTestId('terminal-tab-status-dot');
			expect(dot).toBeTruthy();
			// Gray dot should use textDim color from theme
			expect(dot.style.backgroundColor).toBeTruthy();
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
		});

		it('shows dot (not spinner) when processRunning is undefined but exitCode is set', () => {
			// Edge case: tab reopened from history with partial state
			const tab = makeTerminalTab({
				id: 'term-partial',
				processRunning: undefined,
				exitCode: 1,
			});
			renderTabBar([tab], 'term-partial');

			expect(screen.getByTestId('terminal-tab-status-dot')).toBeTruthy();
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
		});

		it('spinner uses theme accent color', () => {
			const tab = makeTerminalTab({ id: 'term-accent' });
			renderTabBar([tab], 'term-accent', darkTheme);

			const spinnerWrapper = screen.getByTestId('terminal-tab-spinner');
			const svgIcon = spinnerWrapper.querySelector('svg')!;
			// JSDOM converts hex to rgb, so check for rgb equivalent of #bd93f9
			expect(svgIcon.style.color).toBe('rgb(189, 147, 249)');
		});

		it('spinner uses different accent color for light theme', () => {
			const tab = makeTerminalTab({ id: 'term-light-accent' });
			renderTabBar([tab], 'term-light-accent', lightTheme);

			const spinnerWrapper = screen.getByTestId('terminal-tab-spinner');
			const svgIcon = spinnerWrapper.querySelector('svg')!;
			// JSDOM converts hex to rgb, so check for rgb equivalent of #0366d6
			expect(svgIcon.style.color).toBe('rgb(3, 102, 214)');
		});

		it('spinner has animate-spin class for CSS animation', () => {
			const tab = makeTerminalTab({ id: 'term-spin-class' });
			renderTabBar([tab], 'term-spin-class');

			const spinnerWrapper = screen.getByTestId('terminal-tab-spinner');
			const svgIcon = spinnerWrapper.querySelector('svg')!;
			expect(svgIcon.classList.contains('animate-spin')).toBe(true);
		});

		it('spinner has correct size classes (w-3 h-3)', () => {
			const tab = makeTerminalTab({ id: 'term-spin-size' });
			renderTabBar([tab], 'term-spin-size');

			const spinnerWrapper = screen.getByTestId('terminal-tab-spinner');
			const svgIcon = spinnerWrapper.querySelector('svg')!;
			expect(svgIcon.classList.contains('w-3')).toBe(true);
			expect(svgIcon.classList.contains('h-3')).toBe(true);
		});
	});

	// ================================================================
	// Multiple tabs with mixed states
	// ================================================================

	describe('multiple tabs with mixed states', () => {
		it('shows spinner for spawning tab and dot for running tab', () => {
			const tabs = [
				makeTerminalTab({ id: 'term-a', processRunning: true }),
				makeTerminalTab({ id: 'term-b' }), // spawning (undefined)
			];
			renderTabBar(tabs, 'term-a');

			const spinners = screen.getAllByTestId('terminal-tab-spinner');
			const dots = screen.getAllByTestId('terminal-tab-status-dot');

			expect(spinners).toHaveLength(1);
			expect(dots).toHaveLength(1);
		});

		it('shows correct indicators for three tabs in different states', () => {
			const tabs = [
				makeTerminalTab({ id: 'term-1' }), // spawning
				makeTerminalTab({ id: 'term-2', processRunning: true }), // running
				makeTerminalTab({ id: 'term-3', processRunning: false, exitCode: 0 }), // exited
			];
			renderTabBar(tabs, 'term-1');

			const spinners = screen.getAllByTestId('terminal-tab-spinner');
			const dots = screen.getAllByTestId('terminal-tab-status-dot');

			expect(spinners).toHaveLength(1); // only term-1
			expect(dots).toHaveLength(2); // term-2 (green) + term-3 (gray)
		});

		it('all tabs show dots when all are running', () => {
			const tabs = [
				makeTerminalTab({ id: 'term-r1', processRunning: true }),
				makeTerminalTab({ id: 'term-r2', processRunning: true }),
			];
			renderTabBar(tabs, 'term-r1');

			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
			expect(screen.getAllByTestId('terminal-tab-status-dot')).toHaveLength(2);
		});

		it('all tabs show spinners when all are spawning', () => {
			const tabs = [
				makeTerminalTab({ id: 'term-s1' }),
				makeTerminalTab({ id: 'term-s2' }),
			];
			renderTabBar(tabs, 'term-s1');

			expect(screen.getAllByTestId('terminal-tab-spinner')).toHaveLength(2);
			expect(screen.queryByTestId('terminal-tab-status-dot')).toBeNull();
		});
	});

	// ================================================================
	// Full lifecycle: spawning → running transition
	// ================================================================

	describe('full lifecycle transition', () => {
		it('tab transitions from spinner to green dot when processRunning changes', () => {
			const tab = makeTerminalTab({ id: 'term-lifecycle' });
			const { rerender } = renderTabBar([tab], 'term-lifecycle');

			// Initially spawning — spinner shown
			expect(screen.getByTestId('terminal-tab-spinner')).toBeTruthy();

			// Update tab to running
			const runningTab = { ...tab, processRunning: true as const };
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([runningTab])}
					activeTerminalTabId="term-lifecycle"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>
			);

			// Now should show green dot
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
			const dot = screen.getByTestId('terminal-tab-status-dot');
			expect(dot.style.backgroundColor).toBe('rgb(34, 197, 94)'); // green
		});

		it('tab transitions from green dot to gray dot when process exits', () => {
			const runningTab = makeTerminalTab({
				id: 'term-exit-transition',
				processRunning: true,
			});
			const { rerender } = renderTabBar([runningTab], 'term-exit-transition');

			// Running — green dot
			const greenDot = screen.getByTestId('terminal-tab-status-dot');
			expect(greenDot.style.backgroundColor).toBe('rgb(34, 197, 94)');

			// Process exits
			const exitedTab = {
				...runningTab,
				processRunning: false as const,
				exitCode: 0,
			};
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([exitedTab])}
					activeTerminalTabId="term-exit-transition"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>
			);

			// Gray dot
			const grayDot = screen.getByTestId('terminal-tab-status-dot');
			expect(grayDot.style.backgroundColor).not.toBe('rgb(34, 197, 94)');
		});

		it('full spawn→run→exit cycle shows correct indicators', () => {
			// Phase 1: Spawning
			const spawningTab = makeTerminalTab({ id: 'term-full-cycle' });
			const { rerender } = renderTabBar([spawningTab], 'term-full-cycle');
			expect(screen.getByTestId('terminal-tab-spinner')).toBeTruthy();

			// Phase 2: Running
			const runningTab = { ...spawningTab, processRunning: true as const };
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([runningTab])}
					activeTerminalTabId="term-full-cycle"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>
			);
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
			expect(screen.getByTestId('terminal-tab-status-dot').style.backgroundColor).toBe('rgb(34, 197, 94)');

			// Phase 3: Exited
			const exitedTab = { ...runningTab, processRunning: false as const, exitCode: 0 };
			rerender(
				<TabBar
					tabs={[minimalAiTab]}
					activeTabId="ai-1"
					theme={darkTheme}
					onTabSelect={noop}
					onTabClose={noop}
					onNewTab={noop}
					unifiedTabs={buildUnifiedTabs([exitedTab])}
					activeTerminalTabId="term-full-cycle"
					onTerminalTabSelect={noop}
					onTerminalTabClose={noop}
					onNewTerminalTab={noop}
				/>
			);
			expect(screen.queryByTestId('terminal-tab-spinner')).toBeNull();
			expect(screen.getByTestId('terminal-tab-status-dot').style.backgroundColor).not.toBe('rgb(34, 197, 94)');
		});
	});
});
