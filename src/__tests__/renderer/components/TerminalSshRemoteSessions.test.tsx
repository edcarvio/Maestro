/**
 * TerminalSshRemoteSessions.test.tsx — Tests for terminal tab behavior
 * when the parent session has SSH remote configuration.
 *
 * Key architectural invariant: Terminal tabs are ALWAYS local PTY spawns.
 * SSH remote execution is reserved for AI agent sessions. The process:spawn
 * handler explicitly excludes toolType === 'terminal' from SSH wrapping
 * (process.ts line 335). The spawnTerminalTab IPC doesn't accept SSH config.
 *
 * Covers:
 * 1. Terminal tabs spawn locally even when session has SSH remote config enabled
 * 2. spawnTerminalTab IPC receives no SSH config parameters
 * 3. Multiple tabs in SSH-configured session all spawn locally
 * 4. PTY data flow (onData/onExit) works regardless of session SSH config
 * 5. Resize IPC works regardless of session SSH config
 * 6. Tab lifecycle (close/reopen) ignores SSH config
 * 7. Session SSH config changes don't affect running terminal tabs
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalView } from '../../../renderer/components/TerminalView';
import {
	createTerminalTab,
	getTerminalSessionId,
	parseTerminalSessionId,
} from '../../../renderer/utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../../../renderer/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock XTerminal with imperative handle and resize tracking
const mockXTerminalFocus = vi.fn();
const mockXTerminalClear = vi.fn();
const mockXTerminalResize = vi.fn();

vi.mock('../../../renderer/components/XTerminal', () => ({
	XTerminal: React.forwardRef(function MockXTerminal(
		props: { sessionId: string; onResize?: (cols: number, rows: number) => void },
		ref: React.Ref<unknown>
	) {
		React.useImperativeHandle(ref, () => ({
			focus: mockXTerminalFocus,
			search: vi.fn().mockReturnValue(true),
			searchNext: vi.fn().mockReturnValue(true),
			searchPrevious: vi.fn().mockReturnValue(true),
			clearSearch: vi.fn(),
			write: vi.fn(),
			clear: mockXTerminalClear,
			scrollToBottom: vi.fn(),
			getSelection: vi.fn().mockReturnValue(''),
			resize: mockXTerminalResize,
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

/** SSH remote config that would be on a session configured for SSH */
const sshRemoteConfig = {
	enabled: true,
	remoteId: 'ssh-remote-server-1',
	workingDirOverride: '/home/user/project',
};

/** Create a session with SSH remote config and terminal tabs */
function makeSessionWithSsh(
	tabOverrides?: Partial<TerminalTab>[],
	activeTabIndex = 0,
	sshConfig = sshRemoteConfig
): Session {
	const tabs = (tabOverrides || [{}]).map((overrides) => ({
		...createTerminalTab('zsh', '/test'),
		...overrides,
	}));
	return {
		id: 'ssh-session',
		name: 'SSH Session',
		mode: 'terminal' as const,
		fullPath: '/test',
		cwd: '/test',
		inputMode: 'terminal',
		logs: [],
		isThinking: false,
		agentType: 'claude-code' as const,
		terminalTabs: tabs,
		activeTerminalTabId: tabs[activeTabIndex]?.id,
		sessionSshRemoteConfig: sshConfig,
	} as Session;
}

/** Create a session WITHOUT SSH remote config for comparison */
function makeLocalSession(
	tabOverrides?: Partial<TerminalTab>[],
	activeTabIndex = 0
): Session {
	const tabs = (tabOverrides || [{}]).map((overrides) => ({
		...createTerminalTab('zsh', '/local-project'),
		...overrides,
	}));
	return {
		id: 'local-session',
		name: 'Local Session',
		mode: 'terminal' as const,
		fullPath: '/local-project',
		cwd: '/local-project',
		inputMode: 'terminal',
		logs: [],
		isThinking: false,
		agentType: 'claude-code' as const,
		terminalTabs: tabs,
		activeTerminalTabId: tabs[activeTabIndex]?.id,
	} as Session;
}

function defaultProps(overrides?: Partial<Parameters<typeof TerminalView>[0]>) {
	return {
		theme,
		fontFamily: 'Menlo',
		fontSize: 14,
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
// IPC Mocks
// ---------------------------------------------------------------------------

let mockSpawnTerminalTab: ReturnType<typeof vi.fn>;
let mockProcessKill: ReturnType<typeof vi.fn>;
let mockProcessResize: ReturnType<typeof vi.fn>;
let mockProcessWrite: ReturnType<typeof vi.fn>;
let exitCallbacks: Array<(sid: string, code: number) => void>;
let dataCallbacks: Array<(sid: string, data: string) => void>;

beforeEach(() => {
	vi.clearAllMocks();
	exitCallbacks = [];
	dataCallbacks = [];

	mockSpawnTerminalTab = vi.fn().mockResolvedValue({ pid: 1234, success: true });
	mockProcessKill = vi.fn().mockResolvedValue(undefined);
	mockProcessResize = vi.fn().mockResolvedValue(undefined);
	mockProcessWrite = vi.fn().mockResolvedValue(undefined);

	(window.maestro.process as Record<string, unknown>).spawnTerminalTab = mockSpawnTerminalTab;
	(window.maestro.process as Record<string, unknown>).kill = mockProcessKill;
	(window.maestro.process as Record<string, unknown>).resize = mockProcessResize;
	(window.maestro.process as Record<string, unknown>).write = mockProcessWrite;
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn(
		(cb: (sid: string, code: number) => void) => {
			exitCallbacks.push(cb);
			return () => {
				const idx = exitCallbacks.indexOf(cb);
				if (idx >= 0) exitCallbacks.splice(idx, 1);
			};
		}
	);
	(window.maestro.process as Record<string, unknown>).onData = vi.fn(
		(cb: (sid: string, data: string) => void) => {
			dataCallbacks.push(cb);
			return () => {
				const idx = dataCallbacks.indexOf(cb);
				if (idx >= 0) dataCallbacks.splice(idx, 1);
			};
		}
	);
});

// ===========================================================================
// Tests
// ===========================================================================

describe('Terminal SSH Remote Sessions', () => {

	// -----------------------------------------------------------------------
	// 1. Terminal tabs spawn locally despite SSH config
	// -----------------------------------------------------------------------
	describe('Local-only PTY spawning (SSH sessions)', () => {

		it('spawns PTY via spawnTerminalTab (not process:spawn) when session has SSH enabled', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Verify the call was to spawnTerminalTab, not the generic spawn
			// spawnTerminalTab does not accept SSH config
			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call).toHaveProperty('sessionId');
			expect(call).toHaveProperty('cwd');
			expect(call).not.toHaveProperty('sessionSshRemoteConfig');
			expect(call).not.toHaveProperty('sshRemoteConfig');
			expect(call).not.toHaveProperty('sshConfig');
		});

		it('uses local cwd (not SSH workingDirOverride) for PTY spawn', async () => {
			const session = makeSessionWithSsh([{ cwd: '/local/path' }]);
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call.cwd).toBe('/local/path');
			// Should NOT use the SSH workingDirOverride
			expect(call.cwd).not.toBe('/home/user/project');
		});

		it('falls back to session.cwd when tab has no cwd', async () => {
			const tab = createTerminalTab('zsh', '');
			// Clear the cwd to test fallback
			tab.cwd = '';
			const session = makeSessionWithSsh([tab]);

			render(<TerminalView session={session} {...defaultProps()} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			// Falls back to session.cwd ('/test'), not SSH override
			expect(call.cwd).toBe('/test');
		});

		it('spawn call structure is identical for SSH and non-SSH sessions', async () => {
			// First render: SSH session
			const sshSession = makeSessionWithSsh([{ cwd: '/project' }]);
			const sshProps = defaultProps();
			const { unmount: unmount1 } = render(<TerminalView session={sshSession} {...sshProps} />);
			await waitFor(() => expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1));
			const sshCall = mockSpawnTerminalTab.mock.calls[0][0];
			unmount1();

			vi.clearAllMocks();
			exitCallbacks = [];

			// Re-register mocks after clearAllMocks
			(window.maestro.process as Record<string, unknown>).spawnTerminalTab = mockSpawnTerminalTab;
			(window.maestro.process as Record<string, unknown>).kill = mockProcessKill;
			(window.maestro.process as Record<string, unknown>).onExit = vi.fn(
				(cb: (sid: string, code: number) => void) => {
					exitCallbacks.push(cb);
					return () => {
						const idx = exitCallbacks.indexOf(cb);
						if (idx >= 0) exitCallbacks.splice(idx, 1);
					};
				}
			);

			// Second render: local session
			const localSession = makeLocalSession([{ cwd: '/project' }]);
			const localProps = defaultProps();
			render(<TerminalView session={localSession} {...localProps} />);
			await waitFor(() => expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1));
			const localCall = mockSpawnTerminalTab.mock.calls[0][0];

			// Both calls should have the same keys (no SSH-specific keys)
			expect(Object.keys(sshCall).sort()).toEqual(Object.keys(localCall).sort());
		});

		it('does not pass SSH environment variables to terminal spawn', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps({
				shellEnvVars: { TERM: 'xterm-256color', LOCAL_VAR: 'value' },
			});

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			// shellEnvVars are the local shell env vars, not SSH-tunneled env
			if (call.shellEnvVars) {
				expect(call.shellEnvVars).toEqual({ TERM: 'xterm-256color', LOCAL_VAR: 'value' });
			}
		});

		it('passes shell configuration to spawn regardless of SSH config', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps({
				defaultShell: 'bash',
				shellArgs: '--login',
				shellEnvVars: { MY_VAR: '1' },
			});

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call.shell).toBe('bash');
			expect(call.shellArgs).toBe('--login');
			expect(call.shellEnvVars).toEqual({ MY_VAR: '1' });
		});
	});

	// -----------------------------------------------------------------------
	// 2. Multiple terminal tabs in SSH session
	// -----------------------------------------------------------------------
	describe('Multiple tabs in SSH-configured session', () => {

		it('spawns only the active tab PTY initially (SSH session)', async () => {
			const session = makeSessionWithSsh([{}, {}, {}], 0);
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Only the active tab (index 0) should be spawned
			const call = mockSpawnTerminalTab.mock.calls[0][0];
			const expectedSessionId = getTerminalSessionId('ssh-session', session.terminalTabs![0].id);
			expect(call.sessionId).toBe(expectedSessionId);
		});

		it('spawns PTY on tab switch (demand-based spawn in SSH session)', async () => {
			const tabs = [
				{ ...createTerminalTab('zsh', '/test'), pid: 1234 },
				createTerminalTab('zsh', '/other'),
			];
			const session = makeSessionWithSsh(tabs, 0);
			const props = defaultProps();

			const { rerender } = render(<TerminalView session={session} {...props} />);

			// Switch to second tab (which has pid=0)
			const updatedSession = {
				...session,
				activeTerminalTabId: session.terminalTabs![1].id,
			};
			rerender(<TerminalView session={updatedSession} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			const expectedSessionId = getTerminalSessionId('ssh-session', session.terminalTabs![1].id);
			expect(call.sessionId).toBe(expectedSessionId);
		});

		it('renders XTerminal instances for all tabs in SSH session', () => {
			const session = makeSessionWithSsh([{}, {}, {}], 1);
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			// All 3 tabs should have XTerminal instances
			const tabs = session.terminalTabs!;
			for (const tab of tabs) {
				const expectedSessionId = getTerminalSessionId('ssh-session', tab.id);
				expect(screen.getByTestId(`xterminal-${expectedSessionId}`)).toBeTruthy();
			}
		});
	});

	// -----------------------------------------------------------------------
	// 3. PTY data flow with SSH session config
	// -----------------------------------------------------------------------
	describe('PTY data flow (SSH session)', () => {

		it('routes PTY exit events correctly in SSH-configured session', async () => {
			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			const tabId = session.terminalTabs![0].id;
			const terminalSessionId = getTerminalSessionId('ssh-session', tabId);

			// Fire exit event
			act(() => {
				for (const cb of exitCallbacks) {
					cb(terminalSessionId, 0);
				}
			});

			expect(onTabStateChange).toHaveBeenCalledWith(tabId, 'exited', 0);
		});

		it('routes non-zero exit codes in SSH-configured session', async () => {
			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			const tabId = session.terminalTabs![0].id;
			const terminalSessionId = getTerminalSessionId('ssh-session', tabId);

			act(() => {
				for (const cb of exitCallbacks) {
					cb(terminalSessionId, 137); // SIGKILL
				}
			});

			expect(onTabStateChange).toHaveBeenCalledWith(tabId, 'exited', 137);
		});

		it('ignores exit events from actual SSH agent sessions', () => {
			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			// Fire exit for an AI agent session (not a terminal tab)
			act(() => {
				for (const cb of exitCallbacks) {
					cb('ssh-session', 0); // This is the agent session ID, not terminal
				}
			});

			// parseTerminalSessionId returns null for non-terminal session IDs
			expect(onTabStateChange).not.toHaveBeenCalled();
		});

		it('isolates exit events between tabs in SSH session', () => {
			const session = makeSessionWithSsh([{}, {}], 0);
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			const tab1Id = session.terminalTabs![0].id;
			const tab1SessionId = getTerminalSessionId('ssh-session', tab1Id);

			// Only tab 1 exits
			act(() => {
				for (const cb of exitCallbacks) {
					cb(tab1SessionId, 0);
				}
			});

			// Only tab 1 should be marked as exited
			expect(onTabStateChange).toHaveBeenCalledTimes(1);
			expect(onTabStateChange).toHaveBeenCalledWith(tab1Id, 'exited', 0);
		});
	});

	// -----------------------------------------------------------------------
	// 4. Tab lifecycle in SSH session (close/reopen)
	// -----------------------------------------------------------------------
	describe('Tab lifecycle in SSH session', () => {

		it('kills local PTY (not SSH process) when closing tab in SSH session', async () => {
			const tab = { ...createTerminalTab('zsh', '/test'), pid: 5678 };
			const session = makeSessionWithSsh([tab, {}], 0);
			const onTabClose = vi.fn();
			const props = defaultProps({ onTabClose });

			render(<TerminalView session={session} {...props} />);

			// Find and click the close button for the first tab
			const closeButtons = screen.getAllByTestId('x-icon');
			act(() => {
				closeButtons[0].closest('button')?.click();
			});

			await waitFor(() => {
				expect(mockProcessKill).toHaveBeenCalledTimes(1);
			});

			// Kill uses the terminal session ID format (local PTY)
			const expectedSessionId = getTerminalSessionId('ssh-session', session.terminalTabs![0].id);
			expect(mockProcessKill).toHaveBeenCalledWith(expectedSessionId);
			expect(onTabClose).toHaveBeenCalledWith(session.terminalTabs![0].id);
		});

		it('kills all local PTYs on unmount in SSH session', async () => {
			// Both tabs start with pid=0 so they go through the spawn flow
			// (spawnedTabsRef is only populated during spawn, not based on pid)
			const tab1 = createTerminalTab('zsh', '/test');
			const tab2 = createTerminalTab('zsh', '/test');
			const session = makeSessionWithSsh([tab1, tab2], 0);
			const props = defaultProps();

			const { unmount, rerender } = render(<TerminalView session={session} {...props} />);

			// First tab spawned (pid=0 → spawnTerminalTab called → tracked in spawnedTabsRef)
			await waitFor(() => expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1));

			// Switch to second tab to trigger its spawn
			const updatedSession = {
				...session,
				activeTerminalTabId: session.terminalTabs![1].id,
			};
			rerender(<TerminalView session={updatedSession} {...props} />);
			await waitFor(() => expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(2));

			// Unmount triggers cleanup — both spawned tabs should be killed
			unmount();

			expect(mockProcessKill).toHaveBeenCalledWith(
				getTerminalSessionId('ssh-session', session.terminalTabs![0].id)
			);
			expect(mockProcessKill).toHaveBeenCalledWith(
				getTerminalSessionId('ssh-session', session.terminalTabs![1].id)
			);
		});

		it('does not re-spawn PTY for already-running tab in SSH session', async () => {
			const tab = { ...createTerminalTab('zsh', '/test'), pid: 9999 };
			const session = makeSessionWithSsh([tab]);
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			// Wait a tick to ensure no async spawn
			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
			});

			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
		});

		it('does not spawn PTY for exited tab in SSH session', async () => {
			const tab = { ...createTerminalTab('zsh', '/test'), state: 'exited' as const, exitCode: 0 };
			const session = makeSessionWithSsh([tab]);
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
			});

			expect(mockSpawnTerminalTab).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// 5. Session SSH config changes don't affect terminal tabs
	// -----------------------------------------------------------------------
	describe('SSH config mutation isolation', () => {

		it('adding SSH config to session does not affect running terminal tabs', async () => {
			// Start with a local session
			const localSession = makeLocalSession();
			const props = defaultProps();

			const { rerender } = render(<TerminalView session={localSession} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Now add SSH config to the session (simulating user enabling SSH)
			const updatedSession = {
				...localSession,
				sessionSshRemoteConfig: sshRemoteConfig,
			} as Session;

			rerender(<TerminalView session={updatedSession} {...props} />);

			// No new spawn should occur (tab already has a PTY)
			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
			});

			// Still only 1 spawn call (the original one)
			expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
		});

		it('removing SSH config from session does not affect running terminal tabs', async () => {
			// Start with SSH session
			const sshSession = makeSessionWithSsh();
			const props = defaultProps();

			const { rerender } = render(<TerminalView session={sshSession} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Remove SSH config
			const updatedSession = { ...sshSession };
			delete (updatedSession as any).sessionSshRemoteConfig;

			rerender(<TerminalView session={updatedSession as Session} {...props} />);

			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
			});

			// Still only 1 spawn call
			expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
		});

		it('toggling SSH enabled flag does not trigger new terminal spawn', async () => {
			const sshSession = makeSessionWithSsh();
			const props = defaultProps();

			const { rerender } = render(<TerminalView session={sshSession} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Toggle SSH off
			const disabledSshSession = makeSessionWithSsh(
				sshSession.terminalTabs!.map(t => ({ ...t })),
				0,
				{ enabled: false, remoteId: null }
			);
			disabledSshSession.id = 'ssh-session'; // Keep same ID
			disabledSshSession.terminalTabs = sshSession.terminalTabs; // Keep same tabs

			rerender(<TerminalView session={disabledSshSession} {...props} />);

			await act(async () => {
				await new Promise(resolve => setTimeout(resolve, 50));
			});

			// No new spawns
			expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
		});
	});

	// -----------------------------------------------------------------------
	// 6. Terminal session ID format (SSH sessions)
	// -----------------------------------------------------------------------
	describe('Terminal session ID format with SSH sessions', () => {

		it('uses standard terminal session ID format in SSH session', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			const tabId = session.terminalTabs![0].id;

			// Format: {sessionId}-terminal-{tabId}
			expect(call.sessionId).toBe(`ssh-session-terminal-${tabId}`);

			// Verify it can be parsed back
			const parsed = parseTerminalSessionId(call.sessionId);
			expect(parsed).not.toBeNull();
			expect(parsed!.sessionId).toBe('ssh-session');
			expect(parsed!.tabId).toBe(tabId);
		});

		it('terminal session IDs are distinct from agent SSH session IDs', () => {
			const tabId = 'tab-123';
			const terminalSessionId = getTerminalSessionId('ssh-session', tabId);

			// Terminal session ID should contain '-terminal-' marker
			expect(terminalSessionId).toContain('-terminal-');

			// Agent session ID is just the session ID (no terminal marker)
			const agentSessionId = 'ssh-session';
			expect(agentSessionId).not.toContain('-terminal-');

			// Parsing: terminal session IDs parse, agent session IDs don't
			expect(parseTerminalSessionId(terminalSessionId)).not.toBeNull();
			expect(parseTerminalSessionId(agentSessionId)).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// 7. Spawn failure handling in SSH session
	// -----------------------------------------------------------------------
	describe('Spawn failure handling (SSH session)', () => {

		it('handles spawn failure gracefully in SSH session', async () => {
			mockSpawnTerminalTab.mockResolvedValue({ pid: 0, success: false });

			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(onTabStateChange).toHaveBeenCalledWith(
					session.terminalTabs![0].id,
					'exited',
					-1
				);
			});
		});

		it('handles spawn rejection gracefully in SSH session', async () => {
			mockSpawnTerminalTab.mockRejectedValue(new Error('PTY spawn failed'));

			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const props = defaultProps({ onTabStateChange });

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(onTabStateChange).toHaveBeenCalledWith(
					session.terminalTabs![0].id,
					'exited',
					1
				);
			});
		});

		it('allows retry after spawn failure in SSH session', async () => {
			// First call fails, second succeeds
			mockSpawnTerminalTab
				.mockResolvedValueOnce({ pid: 0, success: false })
				.mockResolvedValueOnce({ pid: 5555, success: true });

			const session = makeSessionWithSsh();
			const onTabStateChange = vi.fn();
			const onTabPidChange = vi.fn();
			const props = defaultProps({ onTabStateChange, onTabPidChange });

			const { rerender } = render(<TerminalView session={session} {...props} />);

			// Wait for first (failed) spawn
			await waitFor(() => {
				expect(onTabStateChange).toHaveBeenCalledWith(
					session.terminalTabs![0].id,
					'exited',
					-1
				);
			});

			// Step 1: Parent propagates the state change (exited state)
			// This mirrors real behavior where parent updates session after callback
			const exitedSession = {
				...session,
				terminalTabs: session.terminalTabs!.map(t => ({
					...t,
					state: 'exited' as const,
					exitCode: -1,
				})),
			} as Session;
			rerender(<TerminalView session={exitedSession} {...props} />);

			// Step 2: User triggers retry — parent resets tab state back to idle
			// The state change from 'exited' → 'idle' re-triggers the spawn useEffect
			const retriedSession = {
				...session,
				terminalTabs: session.terminalTabs!.map(t => ({
					...t,
					state: 'idle' as const,
					pid: 0,
					exitCode: undefined,
				})),
			} as Session;
			rerender(<TerminalView session={retriedSession} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(2);
			});
		});
	});

	// -----------------------------------------------------------------------
	// 8. spawnTerminalTab IPC contract verification
	// -----------------------------------------------------------------------
	describe('spawnTerminalTab IPC contract (no SSH params)', () => {

		it('spawnTerminalTab config only contains local PTY parameters', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps({
				defaultShell: '/usr/local/bin/zsh',
				shellArgs: '--login --interactive',
				shellEnvVars: { TERM: 'xterm-256color' },
			});

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];

			// These keys SHOULD be present (local PTY config)
			expect(call).toHaveProperty('sessionId');
			expect(call).toHaveProperty('cwd');

			// These keys MUST NOT be present (SSH-specific)
			const sshForbiddenKeys = [
				'sessionSshRemoteConfig',
				'sshRemoteConfig',
				'sshConfig',
				'sshRemoteId',
				'sshRemoteHost',
				'sshStdinScript',
				'remoteCommand',
				'agentBinaryName',
			];

			for (const key of sshForbiddenKeys) {
				expect(call).not.toHaveProperty(key);
			}
		});

		it('spawnTerminalTab uses shell from props, not from SSH remote config', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps({ defaultShell: '/bin/bash' });

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call.shell).toBe('/bin/bash');
		});
	});

	// -----------------------------------------------------------------------
	// 9. Resize behavior (always local IPC)
	// -----------------------------------------------------------------------
	describe('Resize in SSH session', () => {

		it('process:resize IPC uses terminal session ID format in SSH session', async () => {
			const session = makeSessionWithSsh();
			const props = defaultProps();

			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Verify the sessionId passed to XTerminal follows the terminal format
			const tabId = session.terminalTabs![0].id;
			const expectedSessionId = getTerminalSessionId('ssh-session', tabId);
			expect(screen.getByTestId(`xterminal-${expectedSessionId}`)).toBeTruthy();

			// The resize call would go to process:resize with this session ID
			// (actual resize is tested in XTerminalResize.test.tsx; here we verify
			// the session ID plumbing is correct for SSH sessions)
		});
	});

	// -----------------------------------------------------------------------
	// 10. Mixed mode: AI tab uses SSH, terminal tabs stay local
	// -----------------------------------------------------------------------
	describe('Mixed mode verification', () => {

		it('session can have SSH config for AI agent while terminal tabs stay local', async () => {
			// Session configured for SSH (for AI agent) but with terminal tabs
			const session = makeSessionWithSsh([
				{ ...createTerminalTab('zsh', '/local-project') },
			]);

			// Verify the session itself has SSH config
			expect(session.sessionSshRemoteConfig).toEqual(sshRemoteConfig);
			expect(session.sessionSshRemoteConfig!.enabled).toBe(true);

			const props = defaultProps();
			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			// Terminal tab spawned locally (via spawnTerminalTab, not spawn)
			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call.cwd).toBe('/local-project');
			// No SSH wrapping applied
			expect(call).not.toHaveProperty('sessionSshRemoteConfig');
		});

		it('disabled SSH config is also correctly ignored for terminal tabs', async () => {
			const session = makeSessionWithSsh(
				[{}],
				0,
				{ enabled: false, remoteId: 'some-remote' }
			);

			const props = defaultProps();
			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call).not.toHaveProperty('sessionSshRemoteConfig');
		});

		it('SSH config with workingDirOverride does not affect terminal cwd', async () => {
			const sshConfigWithOverride = {
				enabled: true,
				remoteId: 'remote-1',
				workingDirOverride: '/remote/special/path',
			};
			const session = makeSessionWithSsh(
				[{ cwd: '/my/local/dir' }],
				0,
				sshConfigWithOverride
			);

			const props = defaultProps();
			render(<TerminalView session={session} {...props} />);

			await waitFor(() => {
				expect(mockSpawnTerminalTab).toHaveBeenCalledTimes(1);
			});

			const call = mockSpawnTerminalTab.mock.calls[0][0];
			expect(call.cwd).toBe('/my/local/dir');
			expect(call.cwd).not.toBe('/remote/special/path');
		});
	});
});
