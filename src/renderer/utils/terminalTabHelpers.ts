/**
 * Terminal tab helper utilities.
 * Mirrors the pattern from tabHelpers.ts for AI tabs.
 */

import type { Session, TerminalTab, ClosedTerminalTab } from '../types';
import { generateId } from './ids';

/**
 * Get the active terminal tab for a session.
 */
export function getActiveTerminalTab(session: Session): TerminalTab | undefined {
	return session.terminalTabs?.find(tab => tab.id === session.activeTerminalTabId);
}

/**
 * Create a new terminal tab with default values.
 */
export function createTerminalTab(
	shellType: string = 'zsh',
	cwd: string = '',
	name: string | null = null
): TerminalTab {
	return {
		id: generateId(),
		name,
		shellType,
		pid: 0,
		cwd,
		createdAt: Date.now(),
		state: 'idle',
	};
}

/**
 * Get display name for a terminal tab.
 * Priority: name > "Terminal N" (by index)
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
 * Create a closed terminal tab entry for undo stack.
 */
export function createClosedTerminalTab(tab: TerminalTab, index: number): ClosedTerminalTab {
	return {
		tab: { ...tab, pid: 0, state: 'idle' },
		index,
		closedAt: Date.now(),
	};
}

/** Maximum closed terminal tabs to keep in history */
export const MAX_CLOSED_TERMINAL_TABS = 10;

/**
 * Ensure a session has terminal tabs initialized.
 * Used as a migration utility - sessions created before terminal tabs
 * support won't have these fields. This function lazily initializes them.
 * Returns the session unchanged if terminal tabs already exist.
 */
export function ensureTerminalTabs(session: Session, defaultShell: string = 'zsh'): Session {
	if (session.terminalTabs && session.terminalTabs.length > 0) {
		// Already has terminal tabs - just ensure closedTerminalTabHistory exists
		if (!session.closedTerminalTabHistory) {
			return { ...session, closedTerminalTabHistory: [] };
		}
		return session;
	}

	const defaultTab = createTerminalTab(defaultShell, session.cwd, null);
	return {
		...session,
		terminalTabs: [defaultTab],
		activeTerminalTabId: defaultTab.id,
		closedTerminalTabHistory: [],
	};
}

/**
 * Migrate an array of sessions to ensure all have terminal tabs.
 * Used at app startup when loading sessions from storage to handle
 * sessions created before terminal tabs support was added.
 * Returns the migrated sessions (unchanged sessions are returned as-is).
 */
export function migrateSessionsTerminalTabs(sessions: Session[], defaultShell: string = 'zsh'): Session[] {
	return sessions.map(session => {
		const migrated = ensureTerminalTabs(session, defaultShell);
		if (migrated !== session) {
			console.log(`[migrateSessionsTerminalTabs] Migrated session ${session.id} to terminal tabs`);
		}
		return migrated;
	});
}

/**
 * Clean terminal tab runtime state for persistence.
 * PIDs and state shouldn't be saved - they won't be valid after restart.
 */
export function cleanTerminalTabsForPersistence(tabs: TerminalTab[] | undefined): TerminalTab[] {
	if (!tabs) return [];
	return tabs.map(tab => ({
		id: tab.id,
		name: tab.name,
		shellType: tab.shellType,
		pid: 0,
		cwd: tab.cwd,
		createdAt: tab.createdAt,
		state: 'idle' as const,
	}));
}
