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

import React, { useRef, useState, useCallback, useEffect, memo, forwardRef, useImperativeHandle } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
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

/** Props for the TerminalView component. */
interface TerminalViewProps {
	/** The session whose terminal tabs are rendered. */
	session: Session;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	/** Shell binary to use when spawning new PTYs (e.g. 'zsh', 'bash'). */
	defaultShell: string;
	shellArgs?: string;
	shellEnvVars?: Record<string, string>;
	// Callbacks to update session state (lifted to parent for persistence)
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	onTabRename: (tabId: string, name: string) => void;
	onTabReorder: (fromIndex: number, toIndex: number) => void;
	onTabStateChange: (tabId: string, state: TerminalTab['state'], exitCode?: number) => void;
	onTabCwdChange: (tabId: string, cwd: string) => void;
	onTabPidChange: (tabId: string, pid: number) => void;
	/** Open a rename modal/dialog for the given tab. */
	onRequestRename?: (tabId: string) => void;
	/** Whether the Cmd+F search bar is open. */
	searchOpen?: boolean;
	/** Called when the search bar should close. */
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
	// Track which terminal tab currently has focus (for visual indicator)
	const [focusedTabId, setFocusedTabId] = useState<string | null>(null);

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

	/**
	 * Spawn a PTY process for the given tab.
	 * Guards against double-spawn via `spawnedTabsRef`. On failure, marks the
	 * tab as exited so the error overlay is shown.
	 */
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

	/** Close all tabs except `keepTabId` — kills their PTYs and delegates removal to parent. */
	const handleCloseOtherTabs = useCallback(async (keepTabId: string) => {
		const tabsToClose = tabs.filter(t => t.id !== keepTabId);
		for (const tab of tabsToClose) {
			if (tab.pid > 0) {
				const terminalSessionId = getTerminalSessionId(session.id, tab.id);
				await window.maestro.process.kill(terminalSessionId);
			}
			spawnedTabsRef.current.delete(tab.id);
			terminalRefs.current.delete(tab.id);
			onTabClose(tab.id);
		}
	}, [session.id, tabs, onTabClose]);

	/** Close all tabs to the right of `tabId` — kills their PTYs and delegates removal to parent. */
	const handleCloseTabsToRight = useCallback(async (tabId: string) => {
		const tabIndex = tabs.findIndex(t => t.id === tabId);
		if (tabIndex === -1) return;
		const tabsToClose = tabs.slice(tabIndex + 1);
		for (const tab of tabsToClose) {
			if (tab.pid > 0) {
				const terminalSessionId = getTerminalSessionId(session.id, tab.id);
				await window.maestro.process.kill(terminalSessionId);
			}
			spawnedTabsRef.current.delete(tab.id);
			terminalRefs.current.delete(tab.id);
			onTabClose(tab.id);
		}
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
				onCloseOtherTabs={handleCloseOtherTabs}
				onCloseTabsToRight={handleCloseTabsToRight}
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

				{/*
			  All XTerminal instances remain mounted (stacked absolutely) so switching
			  tabs doesn't destroy the xterm.js buffer. Only the active tab is visible;
			  inactive tabs use CSS `invisible` (keeps layout, hides rendering).
			*/}
				{tabs.map(tab => {
					const isSpawnFailed = tab.state === 'exited' && tab.exitCode !== 0 && tab.pid === 0;
					const isActive = tab.id === session.activeTerminalTabId;
					const isFocused = focusedTabId === tab.id;
					return (
						<div
							key={tab.id}
							className={`absolute inset-0 ${isActive ? '' : 'invisible'}`}
							style={{
								// Use inset box-shadow instead of border to avoid layout shifts
								// when gaining/losing focus.
								boxShadow: isActive && isFocused
									? `inset 0 0 0 1px ${theme.colors.accent}`
									: undefined,
							}}
							data-testid={`terminal-container-${tab.id}`}
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
								<>
									<XTerminal
										ref={(ref) => setTerminalRef(tab.id, ref)}
										sessionId={getTerminalSessionId(session.id, tab.id)}
										theme={theme}
										fontFamily={fontFamily}
										fontSize={fontSize}
										onCloseRequest={() => handleTabClose(tab.id)}
										onFocus={() => setFocusedTabId(tab.id)}
										onBlur={() => setFocusedTabId((prev) => prev === tab.id ? null : prev)}
									/>
									{/* Loading overlay while PTY is spawning */}
									{tab.pid === 0 && tab.state === 'idle' && (
										<div
											className="absolute inset-0 flex items-center justify-center pointer-events-none"
											style={{ backgroundColor: theme.colors.bgMain }}
											data-testid={`spawn-loading-${tab.id}`}
										>
											<div className="flex flex-col items-center gap-2">
												<Loader2
													className="w-6 h-6 animate-spin"
													style={{ color: theme.colors.accent }}
												/>
												<span
													className="text-xs"
													style={{ color: theme.colors.textDim }}
												>
													Starting terminal...
												</span>
											</div>
										</div>
									)}
								</>
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
