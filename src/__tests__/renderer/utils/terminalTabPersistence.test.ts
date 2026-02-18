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
import type { Session, TerminalTab, UnifiedTabRef, AITab } from '../../../renderer/types';

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
});
