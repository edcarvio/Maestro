/**
 * TerminalView - Full terminal emulation view with tabs
 *
 * This component manages:
 * - Terminal tab bar (create, close, rename, reorder)
 * - EmbeddedTerminal instance per tab
 * - Tab switching with proper focus handling
 * - Terminal search (Cmd+F)
 *
 * Each tab's PTY lifecycle is managed by EmbeddedTerminal internally:
 * - Spawn on mount, kill on unmount
 * - Raw PTY data routed via processService
 * - Retry UI on spawn failure
 *
 * Tabs are rendered in a stack with only the active one visible
 * (not destroyed on switch), preserving scrollback and cursor state.
 */

import React, { useState, useRef, useCallback, useEffect, memo } from 'react';
import { EmbeddedTerminal, TerminalSearchBar } from './EmbeddedTerminal';
import type { EmbeddedTerminalHandle } from './EmbeddedTerminal';
import { TerminalTabBar } from './TerminalTabBar';
import type { Session, Theme } from '../types';

interface TerminalViewProps {
	session: Session;
	theme: Theme;
	fontFamily: string;
	// Callbacks to update session state
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	onTabExit?: (tabId: string, exitCode: number) => void;
	onTabSpawned?: (tabId: string) => void;
	// Rename modal trigger
	onRequestRename?: (tabId: string) => void;
	onTabReorder?: (fromIndex: number, toIndex: number) => void;
	onCloseOtherTabs?: (tabId: string) => void;
	onCloseTabsToRight?: (tabId: string) => void;
}

export const TerminalView = memo(function TerminalView({
	session,
	theme,
	fontFamily,
	onTabSelect,
	onTabClose,
	onNewTab,
	onTabExit,
	onTabSpawned,
	onRequestRename,
	onTabReorder,
	onCloseOtherTabs,
	onCloseTabsToRight,
}: TerminalViewProps) {
	// Refs for terminal instances (one per tab)
	const terminalRefsMap = useRef<Map<string, React.RefObject<EmbeddedTerminalHandle>>>(new Map());

	// Terminal search state
	const [terminalSearchOpen, setTerminalSearchOpen] = useState(false);

	// Get or create a stable ref for an EmbeddedTerminal by tab ID
	const getTerminalRef = useCallback((tabId: string) => {
		let ref = terminalRefsMap.current.get(tabId);
		if (!ref) {
			ref = React.createRef<EmbeddedTerminalHandle>();
			terminalRefsMap.current.set(tabId, ref);
		}
		return ref;
	}, []);

	// Close terminal search when no active terminal tab
	useEffect(() => {
		if (!session.activeTerminalTabId) {
			setTerminalSearchOpen(false);
		}
	}, [session.activeTerminalTabId]);

	// Cmd+F handler for terminal search
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.key === 'f' &&
				(e.metaKey || e.ctrlKey) &&
				!e.shiftKey &&
				!e.altKey &&
				session.activeTerminalTabId
			) {
				e.preventDefault();
				setTerminalSearchOpen((prev) => !prev);
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [session.activeTerminalTabId]);

	return (
		<div className="flex flex-col h-full" data-testid="terminal-view">
			{/* Terminal Tab Bar */}
			<TerminalTabBar
				tabs={session.terminalTabs || []}
				activeTabId={session.activeTerminalTabId}
				theme={theme}
				onTabSelect={onTabSelect}
				onTabClose={onTabClose}
				onNewTab={onNewTab}
				onRequestRename={onRequestRename}
				onTabReorder={onTabReorder}
				onCloseOtherTabs={onCloseOtherTabs}
				onCloseTabsToRight={onCloseTabsToRight}
			/>

			{/* Terminal Content Area — flex-col container so tab panes can flex-1 to fill height */}
			<div className="flex-1 flex flex-col relative overflow-hidden">
				{session.terminalTabs?.map((tab) => {
					const isActive = session.activeTerminalTabId === tab.id;
					const termRef = getTerminalRef(tab.id);
					return (
						<div
							key={tab.id}
							data-testid={`terminal-pane-${tab.id}`}
							style={{
								display: isActive ? 'flex' : 'none',
								flex: 1,
								overflow: 'hidden',
								position: 'relative',
							}}
						>
							<EmbeddedTerminal
								ref={termRef}
								terminalTabId={tab.id}
								cwd={tab.cwd}
								theme={theme}
								fontFamily={fontFamily}
								isVisible={isActive}
								onProcessExit={onTabExit}
								onRequestClose={onTabClose}
								onSpawned={onTabSpawned}
							/>
							{isActive && terminalSearchOpen && (
								<TerminalSearchBar
									terminalRef={termRef}
									theme={theme}
									onClose={() => {
										setTerminalSearchOpen(false);
										termRef.current?.focus();
									}}
								/>
							)}
						</div>
					);
				})}

				{/* Show message if no tabs */}
				{(!session.terminalTabs || session.terminalTabs.length === 0) && (
					<div
						className="flex items-center justify-center h-full text-sm"
						style={{ color: theme.colors.textDim }}
						data-testid="terminal-view-empty"
					>
						No terminal tabs. Click + to create one.
					</div>
				)}
			</div>
		</div>
	);
});
