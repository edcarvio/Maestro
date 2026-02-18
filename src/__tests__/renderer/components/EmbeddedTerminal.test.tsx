/**
 * @file EmbeddedTerminal.test.tsx
 * @description Tests for EmbeddedTerminal component (xterm.js wrapper)
 *
 * Since xterm.js requires a real DOM with canvas/WebGL, we mock the xterm
 * packages and test the component's integration logic: addon loading,
 * PTY spawning, data routing, resize handling, and imperative handle.
 */

import React, { createRef } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';

// --- Hoisted mocks (vi.hoisted runs before vi.mock) ---

const {
	terminalMethods,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	searchMethods,
	MockSearchAddon,
	MockUnicode11Addon,
	mockFit,
	mockSpawn,
	mockWrite,
	mockKill,
	mockResize,
	mockOnRawPtyData,
	mockOnExit,
} = vi.hoisted(() => {
	const _terminalMethods = {
		open: vi.fn(),
		write: vi.fn(),
		writeln: vi.fn(),
		clear: vi.fn(),
		focus: vi.fn(),
		dispose: vi.fn(),
		scrollToBottom: vi.fn(),
		getSelection: vi.fn(() => 'selected text'),
		onData: vi.fn(() => ({ dispose: vi.fn() })),
		onResize: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
	});

	const _mockFit = vi.fn();
	const _MockFitAddon = vi.fn(function (this: Record<string, unknown>) {
		this.fit = _mockFit;
		this.dispose = vi.fn();
	});

	const _MockWebLinksAddon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _searchMethods = {
		findNext: vi.fn(() => true),
		findPrevious: vi.fn(() => true),
		clearDecorations: vi.fn(),
		dispose: vi.fn(),
	};
	const _MockSearchAddon = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _searchMethods);
	});

	const _MockUnicode11Addon = vi.fn(function (this: Record<string, unknown>) {
		this.dispose = vi.fn();
	});

	const _mockSpawn = vi.fn(() => Promise.resolve({ success: true, pid: 1234 }));
	const _mockWrite = vi.fn(() => Promise.resolve(true));
	const _mockKill = vi.fn(() => Promise.resolve(true));
	const _mockResize = vi.fn(() => Promise.resolve(true));
	const _mockOnRawPtyData = vi.fn(() => vi.fn());
	const _mockOnExit = vi.fn(() => vi.fn());

	return {
		terminalMethods: _terminalMethods,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		searchMethods: _searchMethods,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockFit: _mockFit,
		mockSpawn: _mockSpawn,
		mockWrite: _mockWrite,
		mockKill: _mockKill,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
		mockOnExit: _mockOnExit,
	};
});

// --- vi.mock calls (hoisted, but can now reference hoisted values) ---

vi.mock('@xterm/xterm', () => ({
	Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
	WebLinksAddon: MockWebLinksAddon,
}));

vi.mock('@xterm/addon-search', () => ({
	SearchAddon: MockSearchAddon,
}));

vi.mock('@xterm/addon-unicode11', () => ({
	Unicode11Addon: MockUnicode11Addon,
}));

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
		write: (...args: unknown[]) => mockWrite(...args),
		kill: (...args: unknown[]) => mockKill(...args),
		resize: (...args: unknown[]) => mockResize(...args),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
		onExit: (...args: unknown[]) => mockOnExit(...args),
	},
}));

vi.mock('../../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#000',
		foreground: '#fff',
	})),
}));

// --- Import after mocks ---

import EmbeddedTerminal from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';
import type { EmbeddedTerminalHandle } from '../../../renderer/components/EmbeddedTerminal/EmbeddedTerminal';

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

describe('EmbeddedTerminal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a container div', () => {
		const { container } = render(
			<EmbeddedTerminal
				terminalTabId="test-tab-1"
				cwd="/tmp"
				theme={defaultTheme}
				fontFamily="Menlo"
				isVisible={true}
			/>
		);

		const div = container.firstChild as HTMLElement;
		expect(div).toBeTruthy();
		expect(div.style.width).toBe('100%');
		expect(div.style.height).toBe('100%');
		expect(div.style.overflow).toBe('hidden');
	});

	it('creates xterm Terminal and loads addons on mount', async () => {
		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-2"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(MockTerminal).toHaveBeenCalled();
		expect(MockFitAddon).toHaveBeenCalled();
		expect(MockSearchAddon).toHaveBeenCalled();
		expect(MockUnicode11Addon).toHaveBeenCalled();
		expect(terminalMethods.loadAddon).toHaveBeenCalled();
	});

	it('spawns PTY with embedded-terminal tool type', async () => {
		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-spawn"
					cwd="/home/user"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({
			sessionId: 'test-tab-spawn',
			toolType: 'embedded-terminal',
			cwd: '/home/user',
		}));
	});

	it('subscribes to raw PTY data and process exit', async () => {
		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-sub"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(mockOnRawPtyData).toHaveBeenCalled();
		expect(mockOnExit).toHaveBeenCalled();
	});

	it('attaches Maestro shortcut bypass handler', async () => {
		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-keys"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(terminalMethods.attachCustomKeyEventHandler).toHaveBeenCalled();
	});

	it('exposes imperative handle methods via ref', async () => {
		const ref = createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="test-tab-handle"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(ref.current).toBeTruthy();
		expect(typeof ref.current!.write).toBe('function');
		expect(typeof ref.current!.focus).toBe('function');
		expect(typeof ref.current!.clear).toBe('function');
		expect(typeof ref.current!.scrollToBottom).toBe('function');
		expect(typeof ref.current!.search).toBe('function');
		expect(typeof ref.current!.searchNext).toBe('function');
		expect(typeof ref.current!.searchPrevious).toBe('function');
		expect(typeof ref.current!.clearSearch).toBe('function');
		expect(typeof ref.current!.getSelection).toBe('function');
		expect(typeof ref.current!.resize).toBe('function');
	});

	it('imperative search delegates to SearchAddon', async () => {
		const ref = createRef<EmbeddedTerminalHandle>();

		await act(async () => {
			render(
				<EmbeddedTerminal
					ref={ref}
					terminalTabId="test-tab-search"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		ref.current!.search('hello');
		expect(searchMethods.findNext).toHaveBeenCalledWith('hello');

		ref.current!.searchPrevious();
		expect(searchMethods.findPrevious).toHaveBeenCalled();

		ref.current!.clearSearch();
		expect(searchMethods.clearDecorations).toHaveBeenCalled();
	});

	it('kills PTY process on unmount', async () => {
		let unmount: () => void;

		await act(async () => {
			const result = render(
				<EmbeddedTerminal
					terminalTabId="test-tab-cleanup"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
			unmount = result.unmount;
		});

		act(() => {
			unmount!();
		});

		expect(terminalMethods.dispose).toHaveBeenCalled();
		expect(mockKill).toHaveBeenCalledWith('test-tab-cleanup');
	});

	it('does not block Ctrl+C in custom key handler (allows xterm to send \\x03)', async () => {
		let keyHandler: (ev: KeyboardEvent) => boolean;

		// Capture the key handler when attachCustomKeyEventHandler is called
		terminalMethods.attachCustomKeyEventHandler.mockImplementation((handler: (ev: KeyboardEvent) => boolean) => {
			keyHandler = handler;
		});

		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-ctrlc"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(terminalMethods.attachCustomKeyEventHandler).toHaveBeenCalled();

		// Simulate Ctrl+C keydown — should return true (xterm handles it)
		const ctrlC = new KeyboardEvent('keydown', {
			key: 'c',
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			altKey: false,
		});
		expect(keyHandler!(ctrlC)).toBe(true);
	});

	it('forwards \\x03 (Ctrl+C) from xterm onData to processService.write', async () => {
		let dataCallback: (data: string) => void;

		// Capture the onData callback that EmbeddedTerminal registers
		terminalMethods.onData.mockImplementation((handler: (data: string) => void) => {
			dataCallback = handler;
			return { dispose: vi.fn() };
		});

		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-ctrlc-write"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		// Simulate xterm.js sending \x03 (what happens when user presses Ctrl+C)
		await act(async () => {
			dataCallback!('\x03');
		});

		expect(mockWrite).toHaveBeenCalledWith('test-tab-ctrlc-write', '\x03');
	});

	it('does not block other Ctrl key combos needed by terminal (Ctrl+A, Ctrl+D, Ctrl+Z)', async () => {
		let keyHandler: (ev: KeyboardEvent) => boolean;

		terminalMethods.attachCustomKeyEventHandler.mockImplementation((handler: (ev: KeyboardEvent) => boolean) => {
			keyHandler = handler;
		});

		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-ctrl-keys"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		// All of these should return true (xterm handles them, not Maestro)
		for (const key of ['a', 'c', 'd', 'z', 'l']) {
			const ev = new KeyboardEvent('keydown', {
				key,
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				altKey: false,
			});
			expect(keyHandler!(ev)).toBe(true);
		}
	});

	it('shows error message when spawn fails', async () => {
		mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'No shell found' });

		await act(async () => {
			render(
				<EmbeddedTerminal
					terminalTabId="test-tab-fail"
					cwd="/tmp"
					theme={defaultTheme}
					fontFamily="Menlo"
					isVisible={true}
				/>
			);
		});

		expect(terminalMethods.writeln).toHaveBeenCalledWith(
			expect.stringContaining('Failed to spawn terminal process')
		);
	});
});
