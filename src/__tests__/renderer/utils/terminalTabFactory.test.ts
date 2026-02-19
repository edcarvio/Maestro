/**
 * Tests for createDefaultTerminalTab factory from terminalTabHelpers.ts
 *
 * Verifies the lightweight terminal tab factory used during session initialization.
 * This factory creates a TerminalTab without requiring an existing Session object,
 * making it suitable for use during session creation (before the session exists).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDefaultTerminalTab } from '../../../renderer/utils/terminalTabHelpers';
import type { TerminalTab } from '../../../renderer/types';

// Mock generateId for predictable IDs
let mockIdCounter = 0;
vi.mock('../../../renderer/utils/ids', () => ({
	generateId: vi.fn(() => `mock-id-${++mockIdCounter}`),
}));

describe('createDefaultTerminalTab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIdCounter = 0;
	});

	it('creates a terminal tab with the given cwd', () => {
		const tab = createDefaultTerminalTab('/home/user/project');

		expect(tab.id).toBe('mock-id-1');
		expect(tab.cwd).toBe('/home/user/project');
		expect(tab.name).toBeNull();
		expect(tab.createdAt).toBeGreaterThan(0);
	});

	it('defaults cwd to empty string when not provided', () => {
		const tab = createDefaultTerminalTab();

		expect(tab.cwd).toBe('');
	});

	it('accepts a custom name', () => {
		const tab = createDefaultTerminalTab('/test', 'My Terminal');

		expect(tab.name).toBe('My Terminal');
	});

	it('defaults name to null', () => {
		const tab = createDefaultTerminalTab('/test');

		expect(tab.name).toBeNull();
	});

	it('generates unique IDs for each tab', () => {
		const tab1 = createDefaultTerminalTab('/test');
		const tab2 = createDefaultTerminalTab('/test');

		expect(tab1.id).toBe('mock-id-1');
		expect(tab2.id).toBe('mock-id-2');
		expect(tab1.id).not.toBe(tab2.id);
	});

	it('does not include runtime-only fields', () => {
		const tab = createDefaultTerminalTab('/test');

		expect(tab.processRunning).toBeUndefined();
		expect(tab.exitCode).toBeUndefined();
	});

	it('returns a valid TerminalTab shape', () => {
		const tab = createDefaultTerminalTab('/test/path');

		// Verify all required TerminalTab fields exist
		expect(tab).toHaveProperty('id');
		expect(tab).toHaveProperty('name');
		expect(tab).toHaveProperty('createdAt');
		expect(tab).toHaveProperty('cwd');

		// Verify types
		expect(typeof tab.id).toBe('string');
		expect(typeof tab.createdAt).toBe('number');
		expect(typeof tab.cwd).toBe('string');
	});
});

describe('Session initialization with default terminal tab', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIdCounter = 0;
	});

	it('produces a tab that can be used as initial terminalTabs entry', () => {
		const cwd = '/Users/test/project';
		const defaultTerminalTab = createDefaultTerminalTab(cwd);

		// Simulate session creation pattern from App.tsx
		const sessionFields = {
			terminalTabs: [defaultTerminalTab],
			activeTerminalTabId: defaultTerminalTab.id,
			closedTerminalTabHistory: [] as any[],
		};

		expect(sessionFields.terminalTabs).toHaveLength(1);
		expect(sessionFields.terminalTabs[0].cwd).toBe(cwd);
		expect(sessionFields.activeTerminalTabId).toBe(defaultTerminalTab.id);
		expect(sessionFields.closedTerminalTabHistory).toEqual([]);
	});

	it('creates tab with matching cwd for different session types', () => {
		// Main session
		const mainTab = createDefaultTerminalTab('/home/user/project');
		expect(mainTab.cwd).toBe('/home/user/project');

		// Worktree session
		const worktreeTab = createDefaultTerminalTab('/home/user/project/.worktrees/feature-branch');
		expect(worktreeTab.cwd).toBe('/home/user/project/.worktrees/feature-branch');

		// All tabs should have unique IDs
		expect(mainTab.id).not.toBe(worktreeTab.id);
	});
});
