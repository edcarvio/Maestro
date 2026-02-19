/**
 * Tests for terminal tab persistence across app restarts.
 *
 * Terminal tabs persist their metadata (name, cwd, position in unified tab order)
 * across app restarts. PTY processes are ephemeral — they die on quit and are
 * respawned fresh by EmbeddedTerminal on mount. These tests verify:
 *
 * - Terminal tab metadata survives serialization round-trip
 * - Runtime-only fields (processRunning, exitCode) are reset on restore
 * - Terminal tabs remain in unifiedTabOrder after restore
 * - activeTerminalTabId is preserved when tabs exist
 * - Edge cases: empty tabs, missing fields, mixed tab types
 */

import { describe, it, expect, vi } from 'vitest';
import type { Session, TerminalTab, UnifiedTabRef, AITab, LogEntry, ClosedTerminalTab } from '../../../renderer/types';
import { createDefaultTerminalTab } from '../../../renderer/utils/terminalTabHelpers';

// Mock the generateId function for predictable test IDs
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => 'mock-generated-id'),
}));

/**
 * Simulate the terminal tab restore logic from App.tsx restoreSession.
 * This is extracted here to test the contract without needing the full React component.
 */
function restoreTerminalTabs(session: Partial<Session>): {
	terminalTabs: TerminalTab[];
	activeTerminalTabId: string | null;
	unifiedTabOrder: UnifiedTabRef[];
} {
	const terminalTabs = (session.terminalTabs || []).map((t) => ({
		...t,
		processRunning: undefined,
		exitCode: undefined,
	}));

	const activeTerminalTabId = session.terminalTabs?.length
		? session.activeTerminalTabId ?? null
		: null;

	// Preserve unifiedTabOrder including terminal refs (no filtering)
	const unifiedTabOrder = session.unifiedTabOrder || [];

	return { terminalTabs, activeTerminalTabId, unifiedTabOrder };
}

// Helpers

function createMockTerminalTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
	return {
		id: 'term-tab-1',
		name: null,
		createdAt: Date.now(),
		cwd: '/test/project',
		...overrides,
	};
}

function createMockAITab(overrides: Partial<AITab> = {}): AITab {
	return {
		id: 'ai-tab-1',
		agentSessionId: null,
		name: null,
		starred: false,
		logs: [],
		inputValue: '',
		stagedImages: [],
		createdAt: Date.now(),
		state: 'idle',
		...overrides,
	};
}

describe('terminal tab persistence', () => {
	describe('metadata preservation', () => {
		it('preserves terminal tab name across restore', () => {
			const tab = createMockTerminalTab({ name: 'Build Server' });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].name).toBe('Build Server');
		});

		it('preserves terminal tab cwd across restore', () => {
			const tab = createMockTerminalTab({ cwd: '/home/user/project' });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].cwd).toBe('/home/user/project');
		});

		it('preserves terminal tab id across restore', () => {
			const tab = createMockTerminalTab({ id: 'unique-tab-id-123' });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].id).toBe('unique-tab-id-123');
		});

		it('preserves terminal tab createdAt across restore', () => {
			const timestamp = 1700000000000;
			const tab = createMockTerminalTab({ createdAt: timestamp });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].createdAt).toBe(timestamp);
		});

		it('preserves multiple terminal tabs in order', () => {
			const tabs = [
				createMockTerminalTab({ id: 'tab-a', name: 'Server', cwd: '/project/server' }),
				createMockTerminalTab({ id: 'tab-b', name: 'Client', cwd: '/project/client' }),
				createMockTerminalTab({ id: 'tab-c', name: null, cwd: '/project' }),
			];
			const result = restoreTerminalTabs({ terminalTabs: tabs });

			expect(result.terminalTabs).toHaveLength(3);
			expect(result.terminalTabs[0].id).toBe('tab-a');
			expect(result.terminalTabs[1].id).toBe('tab-b');
			expect(result.terminalTabs[2].id).toBe('tab-c');
		});
	});

	describe('runtime state reset', () => {
		it('resets processRunning to undefined on restore', () => {
			const tab = createMockTerminalTab({ processRunning: true });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].processRunning).toBeUndefined();
		});

		it('resets exitCode to undefined on restore', () => {
			const tab = createMockTerminalTab({ exitCode: 0 });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].exitCode).toBeUndefined();
		});

		it('resets runtime state for tabs that had processRunning=false and exitCode set', () => {
			const tab = createMockTerminalTab({ processRunning: false, exitCode: 137 });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].processRunning).toBeUndefined();
			expect(result.terminalTabs[0].exitCode).toBeUndefined();
		});

		it('handles tabs that already have undefined runtime fields', () => {
			const tab = createMockTerminalTab();
			// Ensure no runtime fields are set
			delete (tab as any).processRunning;
			delete (tab as any).exitCode;

			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].processRunning).toBeUndefined();
			expect(result.terminalTabs[0].exitCode).toBeUndefined();
		});
	});

	describe('activeTerminalTabId preservation', () => {
		it('preserves activeTerminalTabId when terminal tabs exist', () => {
			const tab = createMockTerminalTab({ id: 'active-term' });
			const result = restoreTerminalTabs({
				terminalTabs: [tab],
				activeTerminalTabId: 'active-term',
			});

			expect(result.activeTerminalTabId).toBe('active-term');
		});

		it('returns null activeTerminalTabId when no terminal tabs exist', () => {
			const result = restoreTerminalTabs({
				terminalTabs: [],
				activeTerminalTabId: 'stale-id',
			});

			expect(result.activeTerminalTabId).toBeNull();
		});

		it('returns null activeTerminalTabId when terminalTabs is undefined', () => {
			const result = restoreTerminalTabs({
				activeTerminalTabId: 'stale-id',
			});

			expect(result.activeTerminalTabId).toBeNull();
		});

		it('defaults activeTerminalTabId to null when not set but tabs exist', () => {
			const tab = createMockTerminalTab({ id: 'tab-1' });
			const result = restoreTerminalTabs({
				terminalTabs: [tab],
			});

			expect(result.activeTerminalTabId).toBeNull();
		});
	});

	describe('unifiedTabOrder preservation', () => {
		it('preserves terminal refs in unifiedTabOrder', () => {
			const order: UnifiedTabRef[] = [
				{ type: 'ai', id: 'ai-1' },
				{ type: 'terminal', id: 'term-1' },
				{ type: 'file', id: 'file-1' },
				{ type: 'terminal', id: 'term-2' },
			];

			const result = restoreTerminalTabs({ unifiedTabOrder: order });

			const terminalRefs = result.unifiedTabOrder.filter((r) => r.type === 'terminal');
			expect(terminalRefs).toHaveLength(2);
			expect(terminalRefs[0].id).toBe('term-1');
			expect(terminalRefs[1].id).toBe('term-2');
		});

		it('preserves interleaving order of all tab types', () => {
			const order: UnifiedTabRef[] = [
				{ type: 'ai', id: 'ai-1' },
				{ type: 'terminal', id: 'term-1' },
				{ type: 'file', id: 'file-1' },
			];

			const result = restoreTerminalTabs({ unifiedTabOrder: order });

			expect(result.unifiedTabOrder).toEqual(order);
		});

		it('returns empty unifiedTabOrder when not set', () => {
			const result = restoreTerminalTabs({});

			expect(result.unifiedTabOrder).toEqual([]);
		});
	});

	describe('edge cases', () => {
		it('handles empty terminalTabs array', () => {
			const result = restoreTerminalTabs({ terminalTabs: [] });

			expect(result.terminalTabs).toEqual([]);
			expect(result.activeTerminalTabId).toBeNull();
		});

		it('handles undefined terminalTabs', () => {
			const result = restoreTerminalTabs({});

			expect(result.terminalTabs).toEqual([]);
			expect(result.activeTerminalTabId).toBeNull();
		});

		it('handles terminal tab with null name (default terminal)', () => {
			const tab = createMockTerminalTab({ name: null });
			const result = restoreTerminalTabs({ terminalTabs: [tab] });

			expect(result.terminalTabs[0].name).toBeNull();
		});

		it('handles legacy session with shellLogs but no terminalTabs', () => {
			// Legacy session from pre-xterm.js era
			const result = restoreTerminalTabs({
				shellLogs: [
					{ id: 'log-1', timestamp: Date.now(), source: 'stdout', text: 'npm start' },
				] as LogEntry[],
				// No terminalTabs field at all
			});

			// Should initialize empty terminalTabs (shellLogs are not convertible)
			expect(result.terminalTabs).toEqual([]);
			expect(result.activeTerminalTabId).toBeNull();
		});

		it('full serialization round-trip: create → persist → restore', () => {
			// Simulate creating terminal tabs during a session
			const sessionTerminalTabs: TerminalTab[] = [
				{
					id: 'term-uuid-1',
					name: 'Dev Server',
					createdAt: 1700000000000,
					cwd: '/home/user/frontend',
					processRunning: true,
				},
				{
					id: 'term-uuid-2',
					name: null,
					createdAt: 1700000001000,
					cwd: '/home/user/backend',
					processRunning: true,
				},
			];

			const sessionUnifiedTabOrder: UnifiedTabRef[] = [
				{ type: 'ai', id: 'ai-tab-1' },
				{ type: 'terminal', id: 'term-uuid-1' },
				{ type: 'file', id: 'file-tab-1' },
				{ type: 'terminal', id: 'term-uuid-2' },
			];

			// Simulate JSON serialization (what electron-store does)
			const serialized = JSON.parse(JSON.stringify({
				terminalTabs: sessionTerminalTabs,
				activeTerminalTabId: 'term-uuid-1',
				unifiedTabOrder: sessionUnifiedTabOrder,
			}));

			// Simulate restore
			const result = restoreTerminalTabs(serialized);

			// Metadata preserved
			expect(result.terminalTabs).toHaveLength(2);
			expect(result.terminalTabs[0].name).toBe('Dev Server');
			expect(result.terminalTabs[0].cwd).toBe('/home/user/frontend');
			expect(result.terminalTabs[1].name).toBeNull();
			expect(result.terminalTabs[1].cwd).toBe('/home/user/backend');

			// Runtime state reset
			expect(result.terminalTabs[0].processRunning).toBeUndefined();
			expect(result.terminalTabs[0].exitCode).toBeUndefined();
			expect(result.terminalTabs[1].processRunning).toBeUndefined();

			// Active tab preserved
			expect(result.activeTerminalTabId).toBe('term-uuid-1');

			// Unified tab order preserved with terminal refs
			expect(result.unifiedTabOrder).toEqual(sessionUnifiedTabOrder);
			const termRefs = result.unifiedTabOrder.filter((r) => r.type === 'terminal');
			expect(termRefs).toHaveLength(2);
		});
	});

	describe('restoreSession terminal tab migration', () => {
		/**
		 * Simulate the broadened migration logic from App.tsx restoreSession.
		 * ANY session without terminal tabs (or with empty array) gets a default tab.
		 * Also ensures closedTerminalTabHistory is initialized.
		 */
		function migrateSessionTerminalTabs(session: Partial<Session>): Partial<Session> {
			let result = { ...session };

			if (!result.terminalTabs || result.terminalTabs.length === 0) {
				const defaultTerminalTab = createDefaultTerminalTab(result.cwd || '');
				result = {
					...result,
					terminalTabs: [defaultTerminalTab],
					activeTerminalTabId: defaultTerminalTab.id,
					closedTerminalTabHistory: [],
				};
			}

			if (!result.closedTerminalTabHistory) {
				result = { ...result, closedTerminalTabHistory: [] };
			}

			return result;
		}

		it('creates a default terminal tab for session with no terminalTabs', () => {
			const session: Partial<Session> = {
				id: 'session-1',
				cwd: '/home/user/project',
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.terminalTabs).toHaveLength(1);
			expect(migrated.terminalTabs![0].id).toBe('mock-generated-id');
			expect(migrated.terminalTabs![0].cwd).toBe('/home/user/project');
			expect(migrated.activeTerminalTabId).toBe('mock-generated-id');
		});

		it('creates a default terminal tab for session with empty terminalTabs array', () => {
			const session: Partial<Session> = {
				id: 'session-2',
				cwd: '/test/dir',
				terminalTabs: [],
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.terminalTabs).toHaveLength(1);
			expect(migrated.activeTerminalTabId).toBe('mock-generated-id');
		});

		it('does not modify session that already has terminal tabs', () => {
			const existingTab = createMockTerminalTab({ id: 'existing-tab', cwd: '/existing' });
			const session: Partial<Session> = {
				id: 'session-3',
				cwd: '/home/user',
				terminalTabs: [existingTab],
				activeTerminalTabId: 'existing-tab',
				closedTerminalTabHistory: [],
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.terminalTabs).toHaveLength(1);
			expect(migrated.terminalTabs![0].id).toBe('existing-tab');
			expect(migrated.activeTerminalTabId).toBe('existing-tab');
		});

		it('initializes closedTerminalTabHistory as empty array', () => {
			const session: Partial<Session> = {
				id: 'session-4',
				cwd: '/test',
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.closedTerminalTabHistory).toEqual([]);
		});

		it('ensures closedTerminalTabHistory exists even when terminal tabs are present', () => {
			const tab = createMockTerminalTab({ id: 'tab-1' });
			const session: Partial<Session> = {
				terminalTabs: [tab],
				activeTerminalTabId: 'tab-1',
				// closedTerminalTabHistory is missing
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.closedTerminalTabHistory).toEqual([]);
		});

		it('preserves existing closedTerminalTabHistory when present', () => {
			const tab = createMockTerminalTab({ id: 'tab-1' });
			const closedTab: ClosedTerminalTab = {
				tab: createMockTerminalTab({ id: 'closed-tab' }),
				index: 0,
				closedAt: Date.now(),
			};
			const session: Partial<Session> = {
				terminalTabs: [tab],
				activeTerminalTabId: 'tab-1',
				closedTerminalTabHistory: [closedTab],
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.closedTerminalTabHistory).toHaveLength(1);
			expect(migrated.closedTerminalTabHistory![0].tab.id).toBe('closed-tab');
		});

		it('uses session cwd for the default terminal tab', () => {
			const session: Partial<Session> = {
				cwd: '/custom/path/to/project',
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.terminalTabs![0].cwd).toBe('/custom/path/to/project');
		});

		it('handles session with undefined cwd gracefully', () => {
			const session: Partial<Session> = {};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.terminalTabs).toHaveLength(1);
			expect(migrated.terminalTabs![0].cwd).toBe('');
		});

		it('migrates legacy session with shellLogs and no terminalTabs', () => {
			const session: Partial<Session> = {
				id: 'legacy-session',
				cwd: '/legacy/project',
				shellLogs: [
					{ id: 'log-1', timestamp: Date.now(), source: 'stdout', text: 'npm start' } as LogEntry,
				],
			};

			const migrated = migrateSessionTerminalTabs(session);

			// Should create a default tab (broader migration catches this)
			expect(migrated.terminalTabs).toHaveLength(1);
			expect(migrated.activeTerminalTabId).toBe('mock-generated-id');
			// shellLogs preserved for backwards compatibility
			expect(migrated.shellLogs).toHaveLength(1);
		});

		it('preserves all other session fields during migration', () => {
			const session: Partial<Session> = {
				id: 'session-preserve',
				cwd: '/project',
				inputMode: 'ai',
				projectRoot: '/project',
			};

			const migrated = migrateSessionTerminalTabs(session);

			expect(migrated.id).toBe('session-preserve');
			expect(migrated.inputMode).toBe('ai');
			expect(migrated.projectRoot).toBe('/project');
		});
	});

	describe('shellLogs to terminalTabs migration', () => {
		/**
		 * Simulate the migration logic from App.tsx restoreSession.
		 * Sessions with shellLogs but no terminalTabs are from the pre-xterm.js era.
		 * shellLogs content is NOT converted to terminal tabs — they represent
		 * fundamentally different paradigms (discrete log entries vs live PTY sessions).
		 */
		function migrateShellLogsSession(session: Partial<Session>): Partial<Session> {
			if (session.shellLogs?.length && !session.terminalTabs?.length) {
				return {
					...session,
					terminalTabs: [],
					activeTerminalTabId: null,
				};
			}
			return session;
		}

		function createMockLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
			return {
				id: 'log-1',
				timestamp: Date.now(),
				source: 'stdout',
				text: 'test output',
				...overrides,
			};
		}

		it('migrates session with shellLogs and no terminalTabs', () => {
			const session: Partial<Session> = {
				shellLogs: [createMockLogEntry({ text: 'ls -la' })],
				// terminalTabs is undefined (pre-xterm.js session)
			};

			const migrated = migrateShellLogsSession(session);

			expect(migrated.terminalTabs).toEqual([]);
			expect(migrated.activeTerminalTabId).toBeNull();
		});

		it('migrates session with multiple shellLogs entries', () => {
			const session: Partial<Session> = {
				shellLogs: [
					createMockLogEntry({ text: 'npm install' }),
					createMockLogEntry({ text: 'npm start' }),
					createMockLogEntry({ text: 'curl localhost:3000' }),
				],
			};

			const migrated = migrateShellLogsSession(session);

			expect(migrated.terminalTabs).toEqual([]);
			expect(migrated.activeTerminalTabId).toBeNull();
		});

		it('preserves shellLogs during migration (not deleted)', () => {
			const logs = [createMockLogEntry({ text: 'npm install' })];
			const session: Partial<Session> = { shellLogs: logs };

			const migrated = migrateShellLogsSession(session);

			expect(migrated.shellLogs).toBe(logs);
		});

		it('does not migrate session that already has terminalTabs', () => {
			const tab = createMockTerminalTab({ id: 'existing-tab' });
			const session: Partial<Session> = {
				shellLogs: [createMockLogEntry()],
				terminalTabs: [tab],
				activeTerminalTabId: 'existing-tab',
			};

			const migrated = migrateShellLogsSession(session);

			// Should not be modified — terminalTabs already exists
			expect(migrated.terminalTabs).toEqual([tab]);
			expect(migrated.activeTerminalTabId).toBe('existing-tab');
		});

		it('does not migrate session with empty shellLogs', () => {
			const session: Partial<Session> = {
				shellLogs: [],
			};

			const migrated = migrateShellLogsSession(session);

			// No migration needed — shellLogs is empty
			expect(migrated).toBe(session); // Same reference, not modified
		});

		it('does not migrate session with no shellLogs field', () => {
			const session: Partial<Session> = {};

			const migrated = migrateShellLogsSession(session);

			// No migration needed — no shellLogs at all
			expect(migrated).toBe(session);
		});

		it('preserves other session fields during migration', () => {
			const session: Partial<Session> = {
				id: 'session-123',
				cwd: '/home/user/project',
				shellLogs: [createMockLogEntry()],
				inputMode: 'ai',
			};

			const migrated = migrateShellLogsSession(session);

			expect(migrated.id).toBe('session-123');
			expect(migrated.cwd).toBe('/home/user/project');
			expect(migrated.inputMode).toBe('ai');
		});

		it('handles session with shellLogs and empty terminalTabs array', () => {
			const session: Partial<Session> = {
				shellLogs: [createMockLogEntry()],
				terminalTabs: [], // Explicitly empty (not undefined)
			};

			const migrated = migrateShellLogsSession(session);

			// Empty array is falsy for .length — migration triggers
			expect(migrated.terminalTabs).toEqual([]);
			expect(migrated.activeTerminalTabId).toBeNull();
		});
	});
});
