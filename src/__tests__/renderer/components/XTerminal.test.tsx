/**
 * @file XTerminal.test.tsx
 * @description Tests for XTerminal component (xterm.js wrapper)
 *
 * Since xterm.js requires a real DOM with canvas/WebGL, we mock the xterm
 * packages and test the component's integration logic: addon loading,
 * data routing, resize handling, theme updates, and imperative handle.
 */

import React, { createRef } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
	mockWrite,
	mockResize,
	mockOnRawPtyData,
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
		onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
		this.cols = 80;
		this.rows = 24;
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

	const _mockWrite = vi.fn(() => Promise.resolve(true));
	const _mockResize = vi.fn(() => Promise.resolve(true));
	const _mockOnRawPtyData = vi.fn(() => vi.fn());

	return {
		terminalMethods: _terminalMethods,
		MockTerminal: _MockTerminal,
		MockFitAddon: _MockFitAddon,
		MockWebLinksAddon: _MockWebLinksAddon,
		searchMethods: _searchMethods,
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockFit: _mockFit,
		mockWrite: _mockWrite,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
	};
});

// --- vi.mock calls ---

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
		write: (...args: unknown[]) => mockWrite(...args),
		resize: (...args: unknown[]) => mockResize(...args),
		onRawPtyData: (...args: unknown[]) => mockOnRawPtyData(...args),
	},
}));

vi.mock('../../../renderer/utils/xtermTheme', () => ({
	toXtermTheme: vi.fn(() => ({
		background: '#000',
		foreground: '#fff',
	})),
}));

// --- Import after mocks ---

import XTerminal from '../../../renderer/components/XTerminal/XTerminal';
import type { XTerminalHandle } from '../../../renderer/components/XTerminal/XTerminal';

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

describe('XTerminal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders a container div with correct styles', () => {
		const { container } = render(
			<XTerminal
				sessionId="test-session-1"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		const div = container.firstChild as HTMLElement;
		expect(div).toBeTruthy();
		expect(div.style.width).toBe('100%');
		expect(div.style.height).toBe('100%');
		expect(div.style.overflow).toBe('hidden');
	});

	it('creates xterm Terminal with correct options and loads all addons', () => {
		render(
			<XTerminal
				sessionId="test-session-2"
				theme={defaultTheme}
				fontFamily="JetBrains Mono"
				fontSize={16}
			/>
		);

		expect(MockTerminal).toHaveBeenCalledWith(expect.objectContaining({
			cursorBlink: true,
			cursorStyle: 'block',
			fontFamily: 'JetBrains Mono',
			fontSize: 16,
			scrollback: 10000,
			allowProposedApi: true,
		}));

		expect(MockFitAddon).toHaveBeenCalled();
		expect(MockWebLinksAddon).toHaveBeenCalled();
		expect(MockSearchAddon).toHaveBeenCalled();
		expect(MockUnicode11Addon).toHaveBeenCalled();
		// 4 addons loaded: fit, web-links, search, unicode11
		expect(terminalMethods.loadAddon).toHaveBeenCalledTimes(4);
	});

	it('uses default fontSize of 14 when not specified', () => {
		render(
			<XTerminal
				sessionId="test-session-default-font"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		expect(MockTerminal).toHaveBeenCalledWith(expect.objectContaining({
			fontSize: 14,
		}));
	});

	it('uses fallback fontFamily when empty string is provided', () => {
		render(
			<XTerminal
				sessionId="test-session-fallback-font"
				theme={defaultTheme}
				fontFamily=""
			/>
		);

		expect(MockTerminal).toHaveBeenCalledWith(expect.objectContaining({
			fontFamily: 'Menlo, Monaco, "Courier New", monospace',
		}));
	});

	it('subscribes to raw PTY data on mount', () => {
		render(
			<XTerminal
				sessionId="test-session-sub"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		expect(mockOnRawPtyData).toHaveBeenCalled();
	});

	it('attaches Maestro shortcut bypass handler', () => {
		render(
			<XTerminal
				sessionId="test-session-keys"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		expect(terminalMethods.attachCustomKeyEventHandler).toHaveBeenCalled();
	});

	it('exposes all imperative handle methods via ref', () => {
		const ref = createRef<XTerminalHandle>();

		render(
			<XTerminal
				ref={ref}
				sessionId="test-session-handle"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		expect(ref.current).toBeTruthy();
		expect(typeof ref.current!.write).toBe('function');
		expect(typeof ref.current!.focus).toBe('function');
		expect(typeof ref.current!.clear).toBe('function');
		expect(typeof ref.current!.scrollToBottom).toBe('function');
		expect(typeof ref.current!.search).toBe('function');
		expect(typeof ref.current!.searchNext).toBe('function');
		expect(typeof ref.current!.searchPrevious).toBe('function');
		expect(typeof ref.current!.getSelection).toBe('function');
		expect(typeof ref.current!.resize).toBe('function');
	});

	it('imperative search delegates to SearchAddon', () => {
		const ref = createRef<XTerminalHandle>();

		render(
			<XTerminal
				ref={ref}
				sessionId="test-session-search"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		ref.current!.search('hello');
		expect(searchMethods.findNext).toHaveBeenCalledWith('hello');

		ref.current!.searchPrevious();
		expect(searchMethods.findPrevious).toHaveBeenCalled();
	});

	it('imperative getSelection delegates to Terminal', () => {
		const ref = createRef<XTerminalHandle>();

		render(
			<XTerminal
				ref={ref}
				sessionId="test-session-selection"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		const selection = ref.current!.getSelection();
		expect(selection).toBe('selected text');
	});

	it('disposes terminal on unmount', () => {
		const { unmount } = render(
			<XTerminal
				sessionId="test-session-cleanup"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		unmount();

		expect(terminalMethods.dispose).toHaveBeenCalled();
	});

	it('blocks Cmd+F so Maestro handles terminal search', () => {
		let keyHandler: (ev: KeyboardEvent) => boolean;

		terminalMethods.attachCustomKeyEventHandler.mockImplementation((handler: (ev: KeyboardEvent) => boolean) => {
			keyHandler = handler;
		});

		render(
			<XTerminal
				sessionId="test-session-cmdf"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		const cmdF = new KeyboardEvent('keydown', {
			key: 'f',
			metaKey: true,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
		});
		expect(keyHandler!(cmdF)).toBe(false);
	});

	it('does not block Ctrl+C (allows xterm to handle it)', () => {
		let keyHandler: (ev: KeyboardEvent) => boolean;

		terminalMethods.attachCustomKeyEventHandler.mockImplementation((handler: (ev: KeyboardEvent) => boolean) => {
			keyHandler = handler;
		});

		render(
			<XTerminal
				sessionId="test-session-ctrlc"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

		const ctrlC = new KeyboardEvent('keydown', {
			key: 'c',
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			altKey: false,
		});
		expect(keyHandler!(ctrlC)).toBe(true);
	});

	it('does not block other terminal Ctrl combos (Ctrl+A, Ctrl+D, Ctrl+Z)', () => {
		let keyHandler: (ev: KeyboardEvent) => boolean;

		terminalMethods.attachCustomKeyEventHandler.mockImplementation((handler: (ev: KeyboardEvent) => boolean) => {
			keyHandler = handler;
		});

		render(
			<XTerminal
				sessionId="test-session-ctrl-keys"
				theme={defaultTheme}
				fontFamily="Menlo"
			/>
		);

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

	it('forwards user input to processService.write and calls onData', () => {
		let dataCallback: (data: string) => void;

		terminalMethods.onData.mockImplementation((handler: (data: string) => void) => {
			dataCallback = handler;
			return { dispose: vi.fn() };
		});

		const onData = vi.fn();

		render(
			<XTerminal
				sessionId="test-session-input"
				theme={defaultTheme}
				fontFamily="Menlo"
				onData={onData}
			/>
		);

		act(() => {
			dataCallback!('hello\r');
		});

		expect(mockWrite).toHaveBeenCalledWith('test-session-input', 'hello\r');
		expect(onData).toHaveBeenCalledWith('hello\r');
	});

	it('registers onTitleChange handler when prop is provided', () => {
		const onTitleChange = vi.fn();

		render(
			<XTerminal
				sessionId="test-session-title"
				theme={defaultTheme}
				fontFamily="Menlo"
				onTitleChange={onTitleChange}
			/>
		);

		expect(terminalMethods.onTitleChange).toHaveBeenCalled();
	});

	describe('RAF write batching for PTY data', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		const flushRaf = () => act(() => {
			vi.advanceTimersByTime(16);
		});

		it('batches PTY data via RAF and writes to terminal', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;

			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			await act(async () => {
				render(
					<XTerminal
						sessionId="test-session-batch"
						theme={defaultTheme}
						fontFamily="Menlo"
					/>
				);
			});

			await act(async () => {
				rawPtyCallback!('test-session-batch', 'line 1\n');
				rawPtyCallback!('test-session-batch', 'line 2\n');
				rawPtyCallback!('test-session-batch', 'line 3\n');
			});

			await flushRaf();

			// All chunks batched into a single write
			const writeCall = terminalMethods.write.mock.calls.find(
				(call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('line 1')
			);
			expect(writeCall).toBeTruthy();
			expect(writeCall![0]).toBe('line 1\nline 2\nline 3\n');
		});

		it('ignores PTY data from other session IDs', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;

			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			await act(async () => {
				render(
					<XTerminal
						sessionId="test-session-mine"
						theme={defaultTheme}
						fontFamily="Menlo"
					/>
				);
			});

			await act(async () => {
				rawPtyCallback!('other-session', 'foreign data\n');
			});

			await flushRaf();

			expect(terminalMethods.write).not.toHaveBeenCalled();
		});

		it('preserves ANSI codes and carriage returns in batched writes', async () => {
			let rawPtyCallback: (sessionId: string, data: string) => void;

			mockOnRawPtyData.mockImplementation((handler: (sessionId: string, data: string) => void) => {
				rawPtyCallback = handler;
				return vi.fn();
			});

			await act(async () => {
				render(
					<XTerminal
						sessionId="test-session-ansi"
						theme={defaultTheme}
						fontFamily="Menlo"
					/>
				);
			});

			const coloredOutput = '\x1b[32mSuccess\x1b[0m\rProgress: 100%\n';
			await act(async () => {
				rawPtyCallback!('test-session-ansi', coloredOutput);
			});

			await flushRaf();

			const writeCall = terminalMethods.write.mock.calls.find(
				(call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('\x1b[32m')
			);
			expect(writeCall).toBeTruthy();
			expect(writeCall![0]).toBe(coloredOutput);
		});
	});
});
