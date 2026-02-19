/**
 * @file terminalSmoothScrolling.test.tsx
 * @description Tests that smooth scrolling is configured in both terminal components:
 * - XTerminal passes smoothScrollDuration: 125 to the Terminal constructor
 * - EmbeddedTerminal passes smoothScrollDuration: 125 to the Terminal constructor
 * - Value is present alongside other required constructor options
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';

// --- Hoisted mocks ---

const {
	terminalInstances,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	MockSearchAddon,
	MockUnicode11Addon,
	mockSpawn,
	mockOnRawPtyData,
	mockOnExit,
} = vi.hoisted(() => {
	const _terminalInstances: Array<{
		constructorOpts: Record<string, unknown>;
		[key: string]: unknown;
	}> = [];

	const _terminalMethods = {
		open: vi.fn(),
		write: vi.fn(),
		writeln: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		dispose: vi.fn(),
		scrollToBottom: vi.fn(),
		getSelection: vi.fn(() => ''),
		onData: vi.fn(() => ({ dispose: vi.fn() })),
		onResize: vi.fn(() => ({ dispose: vi.fn() })),
		onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.constructorOpts = { ...opts };
		this.options = { ...opts };
		this.unicode = { activeVersion: '' };
		this.cols = 80;
		this.rows = 24;
		_terminalInstances.push(this as typeof _terminalInstances[number]);
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

	return {
		terminalInstances: _terminalInstances,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockSpawn: vi.fn(() => Promise.resolve({ success: true, pid: 1234 })),
		mockWrite: vi.fn(() => Promise.resolve(true)),
		mockKill: vi.fn(() => Promise.resolve(true)),
		mockResize: vi.fn(() => Promise.resolve(true)),
		mockOnRawPtyData: vi.fn(() => vi.fn()),
		mockOnExit: vi.fn(() => vi.fn()),
	};
});

// --- vi.mock calls ---

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: MockWebLinksAddon }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: MockSearchAddon }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: MockUnicode11Addon }));
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
		write: vi.fn(() => Promise.resolve(true)),
		kill: vi.fn(() => Promise.resolve(true)),
		resize: vi.fn(() => Promise.resolve(true)),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
		onExit: (...args: unknown[]) => mockOnExit(...args),
	},
}));

vi.mock('../../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#282a36',
		foreground: '#f8f8f2',
	})),
}));

// --- Import after mocks ---

import XTerminal from '../../../renderer/components/XTerminal/XTerminal';
import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

// --- Fixtures ---

const defaultTheme: Theme = {
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

// --- Tests ---

describe('Terminal smooth scrolling configuration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalInstances.length = 0;
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	describe('XTerminal', () => {
		it('passes smoothScrollDuration: 125 to the Terminal constructor', async () => {
			await act(async () => {
				render(
					<XTerminal
						sessionId="smooth-xt-1"
						theme={defaultTheme}
						fontSize={13}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(terminalInstances).toHaveLength(1);
			expect(terminalInstances[0].constructorOpts.smoothScrollDuration).toBe(125);
		});

		it('includes smoothScrollDuration alongside other expected options', async () => {
			await act(async () => {
				render(
					<XTerminal
						sessionId="smooth-xt-2"
						theme={defaultTheme}
						fontSize={14}
						fontFamily="Monaco"
						isVisible={true}
					/>
				);
			});

			const opts = terminalInstances[0].constructorOpts;
			expect(opts).toMatchObject({
				cursorBlink: true,
				cursorStyle: 'block',
				scrollback: 10000,
				allowProposedApi: true,
				smoothScrollDuration: 125,
			});
		});

		it('sets smoothScrollDuration as a number, not a string', async () => {
			await act(async () => {
				render(
					<XTerminal
						sessionId="smooth-xt-3"
						theme={defaultTheme}
						fontSize={13}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(typeof terminalInstances[0].constructorOpts.smoothScrollDuration).toBe('number');
		});
	});

	describe('EmbeddedTerminal', () => {
		it('passes smoothScrollDuration: 125 to the Terminal constructor', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="smooth-et-1"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				expect(terminalInstances).toHaveLength(1);
			});

			expect(terminalInstances[0].constructorOpts.smoothScrollDuration).toBe(125);
		});

		it('includes smoothScrollDuration alongside other expected options', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="smooth-et-2"
						cwd="/home/user"
						theme={defaultTheme}
						fontFamily="Monaco"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				expect(terminalInstances).toHaveLength(1);
			});

			const opts = terminalInstances[0].constructorOpts;
			expect(opts).toMatchObject({
				cursorBlink: true,
				scrollback: 10000,
				allowProposedApi: true,
				smoothScrollDuration: 125,
			});
		});

		it('sets smoothScrollDuration as a number, not a string', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="smooth-et-3"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				expect(terminalInstances).toHaveLength(1);
			});

			expect(typeof terminalInstances[0].constructorOpts.smoothScrollDuration).toBe('number');
		});
	});

	describe('consistency between terminal components', () => {
		it('both components use the same smoothScrollDuration value', async () => {
			// Render XTerminal
			await act(async () => {
				render(
					<XTerminal
						sessionId="smooth-consistency-xt"
						theme={defaultTheme}
						fontSize={13}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			const xtermDuration = terminalInstances[0].constructorOpts.smoothScrollDuration;

			// Render EmbeddedTerminal
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="smooth-consistency-et"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				expect(terminalInstances).toHaveLength(2);
			});

			const embeddedDuration = terminalInstances[1].constructorOpts.smoothScrollDuration;

			expect(xtermDuration).toBe(embeddedDuration);
			expect(xtermDuration).toBe(125);
		});
	});
});
