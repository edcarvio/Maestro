/**
 * Terminal tab helper utilities
 * Provides session ID formatting, display name logic, and state query functions.
 * For tab CRUD operations (create, close, reopen), see tabHelpers.ts which
 * manages terminal tabs as part of the unified tab system.
 */

import type { Session, TerminalTab } from '../types';

/**
 * Get the active terminal tab for a session.
 */
export function getActiveTerminalTab(session: Session): TerminalTab | undefined {
	return session.terminalTabs?.find(tab => tab.id === session.activeTerminalTabId);
}

/**
 * Get display name for a terminal tab.
 * Priority: user-defined name > "Terminal N" (by index)
 */
export function getTerminalTabDisplayName(tab: TerminalTab, index: number): string {
	if (tab.name) {
		return tab.name;
	}
	return `Terminal ${index + 1}`;
}

/**
 * Generate the PTY session ID for a terminal tab.
 * Format: {sessionId}-terminal-{tabId}
 * Used for IPC routing between renderer and main process.
 */
export function getTerminalSessionId(sessionId: string, tabId: string): string {
	return `${sessionId}-terminal-${tabId}`;
}

/**
 * Parse a terminal session ID to extract session ID and tab ID.
 * Returns null if the format doesn't match.
 */
export function parseTerminalSessionId(terminalSessionId: string): { sessionId: string; tabId: string } | null {
	const match = terminalSessionId.match(/^(.+)-terminal-(.+)$/);
	if (!match) return null;
	return { sessionId: match[1], tabId: match[2] };
}

/**
 * Check if any terminal tab in a session has a running process.
 */
export function hasRunningTerminalProcess(session: Session): boolean {
	return session.terminalTabs?.some(tab => tab.state === 'busy') ?? false;
}

/**
 * Get the count of active (non-exited) terminal tabs.
 */
export function getActiveTerminalTabCount(session: Session): number {
	return session.terminalTabs?.filter(tab => tab.state !== 'exited').length ?? 0;
}

/**
 * Maximum closed terminal tabs to keep in history.
 * Terminal tabs use the unified closed tab history (ClosedTabEntry) in tabHelpers.ts,
 * but this constant is provided for reference and potential standalone usage.
 */
export const MAX_CLOSED_TERMINAL_TABS = 10;
