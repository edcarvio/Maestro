/**
 * TerminalView - Full terminal emulation view with tabs
 *
 * This component manages:
 * - Terminal tab bar (create, close, rename, reorder)
 * - XTerminal instance per tab (stacked with CSS visibility toggling)
 * - PTY lifecycle (spawn on demand, cleanup on close/unmount)
 * - Tab switching with proper focus handling
 * - Search bar delegation to active terminal's search methods
 *
 * All terminal instances remain mounted when switching tabs to preserve
 * buffer content and avoid expensive xterm.js re-initialization.
 */

import React, { useRef, useCallback, useEffect, memo, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle } from 'lucide-react';
import { XTerminal, XTerminalHandle } from './XTerminal';
import { TerminalTabBar } from './TerminalTabBar';
import { TerminalSearchBar } from './TerminalSearchBar';
import type { Session, Theme, TerminalTab } from '../types';
import {
	getActiveTerminalTab,
	getTerminalSessionId,
	parseTerminalSessionId,
} from '../utils/terminalTabHelpers';
import { useUIStore } from '../stores/uiStore';

interface TerminalViewProps {
	session: Session;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	defaultShell: string;
	shellArgs?: string;
	shellEnvVars?: Record<string, string>;
	// Callbacks to update session state (sessionId is added by the parent)
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	onTabRename: (tabId: string, name: string) => void;
	onTabReorder: (fromIndex: number, toIndex: number) => void;
	onTabStateChange: (tabId: string, state: TerminalTab['state'], exitCode?: number) => void;
	onTabCwdChange: (tabId: string, cwd: string) => void;
	onTabPidChange: (tabId: string, pid: number) => void;
	// Rename modal trigger
	onRequestRename?: (tabId: string) => void;
	// Search bar integration
	searchOpen?: boolean;
	onSearchClose?: () => void;
}

/**
 * Imperative handle for TerminalView, allowing parent components to
 * invoke clear/focus/search on the active terminal without coupling
 * to xterm.js internals.
 */
export interface TerminalViewHandle {
	clearActiveTerminal: () => void;
	focusActiveTerminal: () => void;
	searchActiveTerminal: (query: string) => boolean;
	searchNext: () => boolean;
	searchPrevious: () => boolean;
}

export const TerminalView = memo(forwardRef<TerminalViewHandle, TerminalViewProps>(
	function TerminalView({
		session,
		theme,
		fontFamily,
		fontSize = 14,
		defaultShell,
		shellArgs,
		shellEnvVars,
		onTabSelect,
		onTabClose,
		onNewTab,
		onTabReorder,
		onTabStateChange,
		onTabPidChange,
		onRequestRename,
		searchOpen = false,
		onSearchClose,
	}, ref) {
	// Refs for terminal instances (one per tab)
	const terminalRefs = useRef<Map<string, XTerminalHandle>>(new Map());
	// Track which tabs have had PTYs spawned (prevents double-spawn)
	const spawnedTabsRef = useRef<Set<string>>(new Set());

	// Get active terminal tab
	const activeTab = getActiveTerminalTab(session);
	const tabs = session.terminalTabs || [];

	// Expose imperative methods to parent via ref
	useImperativeHandle(ref, () => ({
		clearActiveTerminal: () => {
			const activeTerminal = terminalRefs.current.get(session.activeTerminalTabId || '');
			activeTerminal?.clear();
		},
		focusActiveTerminal: () => {
			const activeTerminal = terminalRefs.current.get(session.activeTerminalTabId || '');
			activeTerminal?.focus();
		},
		searchActiveTerminal: (query: string) => {
			const activeTerminal = terminalRefs.current.get(session.activeTerminalTabId || '');
			return activeTerminal?.search(query) ?? false;
		},
		searchNext: () => {
			const activeTerminal = terminalRefs.current.get(session.activeTerminalTabId || '');
			return activeTerminal?.searchNext() ?? false;
		},
		searchPrevious: () => {
			const activeTerminal = terminalRefs.current.get(session.activeTerminalTabId || '');
			return activeTerminal?.searchPrevious() ?? false;
		},
	}), [session.activeTerminalTabId]);

	// Spawn PTY for a tab if not already running
	const spawnPtyForTab = useCallback(async (tab: TerminalTab) => {
		if (tab.pid > 0 || spawnedTabsRef.current.has(tab.id)) return;

		const terminalSessionId = getTerminalSessionId(session.id, tab.id);
		spawnedTabsRef.current.add(tab.id);

		try {
			const result = await window.maestro.process.spawnTerminalTab({
				sessionId: terminalSessionId,
				cwd: tab.cwd || session.cwd,
				shell: defaultShell || undefined,
				shellArgs: shellArgs || undefined,
				shellEnvVars: shellEnvVars || undefined,
			});

			if (result.success && result.pid > 0) {
				onTabPidChange(tab.id, result.pid);
				onTabStateChange(tab.id, 'idle');
			} else {
				spawnedTabsRef.current.delete(tab.id);
				onTabStateChange(tab.id, 'exited', -1);
			}
		} catch (error) {
			console.error('[TerminalView] Failed to spawn PTY:', error);
			spawnedTabsRef.current.delete(tab.id);
			onTabStateChange(tab.id, 'exited', 1);
		}
	}, [session.id, session.cwd, defaultShell, shellArgs, shellEnvVars, onTabPidChange, onTabStateChange]);

	// Spawn PTY when active tab changes and doesn't have one
	useEffect(() => {
		if (activeTab && activeTab.pid === 0 && activeTab.state !== 'exited') {
			spawnPtyForTab(activeTab);
		}
	}, [activeTab?.id, activeTab?.pid, activeTab?.state, spawnPtyForTab]);

	// Focus terminal when active tab changes
	useEffect(() => {
		if (activeTab) {
			// Small delay to ensure DOM is ready after visibility change
			const timer = setTimeout(() => {
				const terminalHandle = terminalRefs.current.get(activeTab.id);
				terminalHandle?.focus();
			}, 50);
			return () => clearTimeout(timer);
		}
	}, [activeTab?.id]);

	// Clear active terminal when Cmd+K signal is received
	const terminalClearSignal = useUIStore((s) => s.terminalClearSignal);
	useEffect(() => {
		if (terminalClearSignal > 0 && activeTab) {
			const handle = terminalRefs.current.get(activeTab.id);
			handle?.clear();
		}
	}, [terminalClearSignal, activeTab?.id]);

	// Handle PTY exit for ALL tabs using session ID parsing
	useEffect(() => {
		const unsubscribe = window.maestro.process.onExit((sid: string, code: number) => {
			const parsed = parseTerminalSessionId(sid);
			if (parsed && parsed.sessionId === session.id) {
				spawnedTabsRef.current.delete(parsed.tabId);
				onTabStateChange(parsed.tabId, 'exited', code);
			}
		});

		return unsubscribe;
	}, [session.id, onTabStateChange]);

	// Kill all PTYs on unmount (e.g., switching from terminal mode to AI mode)
	useEffect(() => {
		const sessionId = session.id;
		const spawned = spawnedTabsRef.current;
		return () => {
			for (const tabId of spawned) {
				const terminalSessionId = getTerminalSessionId(sessionId, tabId);
				window.maestro.process.kill(terminalSessionId);
			}
			spawned.clear();
		};
	}, [session.id]);

	// Handle tab close - kill PTY if running
	const handleTabClose = useCallback(async (tabId: string) => {
		const tab = tabs.find(t => t.id === tabId);
		if (tab && tab.pid > 0) {
			const terminalSessionId = getTerminalSessionId(session.id, tabId);
			await window.maestro.process.kill(terminalSessionId);
		}
		spawnedTabsRef.current.delete(tabId);
		terminalRefs.current.delete(tabId);
		onTabClose(tabId);
	}, [session.id, tabs, onTabClose]);

	// Retry spawning PTY for a tab that failed to start.
	// Resetting state to 'idle' triggers the useEffect that auto-spawns for the active tab.
	const handleRetrySpawn = useCallback((tabId: string) => {
		onTabStateChange(tabId, 'idle');
	}, [onTabStateChange]);

	// Store terminal ref
	const setTerminalRef = useCallback((tabId: string, ref: XTerminalHandle | null) => {
		if (ref) {
			terminalRefs.current.set(tabId, ref);
		} else {
			terminalRefs.current.delete(tabId);
		}
	}, []);

	// Search callbacks - delegate to active terminal's XTerminal handle
	const handleSearch = useCallback((query: string) => {
		if (!activeTab) return false;
		const handle = terminalRefs.current.get(activeTab.id);
		return handle?.search(query) ?? false;
	}, [activeTab?.id]);

	const handleSearchNext = useCallback(() => {
		if (!activeTab) return false;
		const handle = terminalRefs.current.get(activeTab.id);
		return handle?.searchNext() ?? false;
	}, [activeTab?.id]);

	const handleSearchPrevious = useCallback(() => {
		if (!activeTab) return false;
		const handle = terminalRefs.current.get(activeTab.id);
		return handle?.searchPrevious() ?? false;
	}, [activeTab?.id]);

	const handleSearchClose = useCallback(() => {
		if (activeTab) {
			const handle = terminalRefs.current.get(activeTab.id);
			handle?.clearSearch();
			handle?.focus();
		}
		onSearchClose?.();
	}, [activeTab?.id, onSearchClose]);

	return (
		<div className="flex-1 flex flex-col min-h-0">
			{/* Terminal Tab Bar */}
			<TerminalTabBar
				tabs={tabs}
				activeTabId={session.activeTerminalTabId || ''}
				theme={theme}
				onTabSelect={onTabSelect}
				onTabClose={handleTabClose}
				onNewTab={onNewTab}
				onRequestRename={onRequestRename}
				onTabReorder={onTabReorder}
			/>

			{/* Terminal Content Area */}
			<div className="flex-1 relative overflow-hidden">
				{/* Search bar - floating over the active terminal */}
				<TerminalSearchBar
					theme={theme}
					isOpen={searchOpen}
					onClose={handleSearchClose}
					onSearch={handleSearch}
					onSearchNext={handleSearchNext}
					onSearchPrevious={handleSearchPrevious}
				/>

				{/* All terminal instances stacked absolutely; only active is visible */}
				{tabs.map(tab => {
					const isSpawnFailed = tab.state === 'exited' && tab.exitCode !== 0 && tab.pid === 0;
					return (
						<div
							key={tab.id}
							className={`absolute inset-0 ${tab.id === session.activeTerminalTabId ? '' : 'invisible'}`}
						>
							{isSpawnFailed ? (
								<div
									className="flex items-center justify-center h-full"
									style={{ backgroundColor: theme.colors.bgMain }}
									data-testid={`spawn-error-${tab.id}`}
								>
									<div className="text-center">
										<AlertCircle className="w-8 h-8 mx-auto mb-2" style={{ color: theme.colors.error }} />
										<p className="mb-3 text-sm" style={{ color: theme.colors.textMain }}>
											Failed to start terminal
										</p>
										<button
											className="px-3 py-1.5 rounded text-xs font-medium transition-colors hover:opacity-90"
											style={{
												backgroundColor: theme.colors.accent,
												color: theme.colors.accentForeground,
											}}
											onClick={() => handleRetrySpawn(tab.id)}
										>
											Retry
										</button>
									</div>
								</div>
							) : (
								<XTerminal
									ref={(ref) => setTerminalRef(tab.id, ref)}
									sessionId={getTerminalSessionId(session.id, tab.id)}
									theme={theme}
									fontFamily={fontFamily}
									fontSize={fontSize}
									onCloseRequest={() => handleTabClose(tab.id)}
								/>
							)}
						</div>
					);
				})}

				{/* Show message if no tabs */}
				{tabs.length === 0 && (
					<div
						className="flex items-center justify-center h-full text-sm"
						style={{ color: theme.colors.textDim }}
					>
						No terminal tabs. Click + to create one.
					</div>
				)}
			</div>
		</div>
	);
}));
