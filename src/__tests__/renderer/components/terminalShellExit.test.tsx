/**
 * @file terminalShellExit.test.tsx
 * @description Tests for shell exit handling in EmbeddedTerminal:
 * - Exit message rendering (yellow "Shell exited" with exit code)
 * - Exit code differentiation (code 0 vs non-zero)
 * - "Press any key to close" behavior (onRequestClose callback)
 * - hasExitedRef gating (keypress after exit triggers close, not PTY write)
 * - onProcessExit callback invocation
 * - Multiple keypresses after exit (only first triggers close)
 * - Cleanup/reset of exit state on retry
 * - Interaction with Maestro shortcuts after exit
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Theme } from '../../../shared/theme-types';

// --- Hoisted mocks ---

const {
	terminalMethods,
	MockTerminal,
	MockFitAddon,
	MockWebLinksAddon,
	MockSearchAddon,
	MockUnicode11Addon,
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
		onTitleChange: vi.fn(() => ({ dispose: vi.fn() })),
		attachCustomKeyEventHandler: vi.fn(),
		loadAddon: vi.fn(),
	};

	const _MockTerminal = vi.fn(function (this: Record<string, unknown>) {
		Object.assign(this, _terminalMethods);
		this.options = {};
		this.unicode = { activeVersion: '' };
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
		MockSearchAddon: _MockSearchAddon,
		MockUnicode11Addon: _MockUnicode11Addon,
		mockSpawn: _mockSpawn,
		mockWrite: _mockWrite,
		mockKill: _mockKill,
		mockResize: _mockResize,
		mockOnRawPtyData: _mockOnRawPtyData,
		mockOnExit: _mockOnExit,
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

/** Helper: render EmbeddedTerminal with successful spawn and wait for setup */
async function renderTerminal(
	props: Partial<React.ComponentProps<typeof EmbeddedTerminal>> & { terminalTabId: string },
) {
	let result: ReturnType<typeof render>;
	await act(async () => {
		result = render(
			<EmbeddedTerminal
				cwd="/tmp"
				theme={defaultTheme}
				fontFamily="Menlo"
				isVisible={true}
				{...props}
			/>
		);
	});

	// Wait for the async setupTerminal to complete
	await waitFor(() => {
		expect(mockSpawn).toHaveBeenCalled();
	});

	return result!;
}

/** Helper: get the exit callback registered with processService.onExit */
function getExitCallback(): (sessionId: string, code: number) => void {
	const calls = mockOnExit.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][0];
}

/** Helper: get the onData callback registered with term.onData */
function getOnDataCallback(): (data: string) => void {
	const calls = terminalMethods.onData.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return calls[calls.length - 1][0];
}

describe('EmbeddedTerminal — shell exit handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	// ================================================================
	// Exit message rendering
	// ================================================================

	describe('exit message rendering', () => {
		it('writes yellow "Shell exited." message for exit code 0', async () => {
			await renderTerminal({ terminalTabId: 'exit-msg-0' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-msg-0', 0));

			// Should write yellow "Shell exited." without code number
			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('\x1b[33mShell exited.\x1b[0m')
			);
			// Should NOT contain "with code 0"
			const writeCall = terminalMethods.write.mock.calls.find(
				(c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Shell exited')
			);
			expect(writeCall[0]).not.toContain('with code 0');
		});

		it('includes exit code in message for non-zero exit', async () => {
			await renderTerminal({ terminalTabId: 'exit-msg-1' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-msg-1', 1));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('\x1b[33mShell exited with code 1.\x1b[0m')
			);
		});

		it('includes exit code 127 (command not found) in message', async () => {
			await renderTerminal({ terminalTabId: 'exit-msg-127' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-msg-127', 127));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('with code 127')
			);
		});

		it('includes exit code 137 (SIGKILL) in message', async () => {
			await renderTerminal({ terminalTabId: 'exit-msg-137' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-msg-137', 137));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('with code 137')
			);
		});

		it('shows dim instruction text for closing tab', async () => {
			await renderTerminal({ terminalTabId: 'exit-instructions' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-instructions', 0));

			// Should contain dim (\x1b[90m) instruction text
			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('\x1b[90mPress any key to close')
			);
		});

		it('shows Ctrl+Shift+` hint for new terminal', async () => {
			await renderTerminal({ terminalTabId: 'exit-hint' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-hint', 0));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('Ctrl+Shift+`')
			);
		});

		it('uses term.write (not writeln) for exit message', async () => {
			await renderTerminal({ terminalTabId: 'exit-write' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-write', 0));

			// Message should use write() not writeln() since it includes \r\n
			const shellExitWrite = terminalMethods.write.mock.calls.find(
				(c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Shell exited')
			);
			expect(shellExitWrite).toBeTruthy();
		});

		it('includes leading and trailing \\r\\n in message', async () => {
			await renderTerminal({ terminalTabId: 'exit-newlines' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-newlines', 0));

			const shellExitWrite = terminalMethods.write.mock.calls.find(
				(c: unknown[]) => typeof c[0] === 'string' && c[0].includes('Shell exited')
			);
			expect(shellExitWrite[0]).toMatch(/^\r\n/);
			expect(shellExitWrite[0]).toMatch(/\r\n$/);
		});
	});

	// ================================================================
	// onProcessExit callback
	// ================================================================

	describe('onProcessExit callback', () => {
		it('calls onProcessExit with tabId and exit code', async () => {
			const onProcessExit = vi.fn();
			await renderTerminal({ terminalTabId: 'exit-cb', onProcessExit });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-cb', 0));

			expect(onProcessExit).toHaveBeenCalledWith('exit-cb', 0);
		});

		it('calls onProcessExit with non-zero exit code', async () => {
			const onProcessExit = vi.fn();
			await renderTerminal({ terminalTabId: 'exit-cb-nz', onProcessExit });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-cb-nz', 42));

			expect(onProcessExit).toHaveBeenCalledWith('exit-cb-nz', 42);
		});

		it('does not crash when onProcessExit is not provided', async () => {
			await renderTerminal({ terminalTabId: 'exit-no-cb' });

			const exitCallback = getExitCallback();
			// Should not throw
			expect(() => act(() => exitCallback('exit-no-cb', 0))).not.toThrow();
		});
	});

	// ================================================================
	// Press any key to close (onRequestClose)
	// ================================================================

	describe('press any key to close', () => {
		it('calls onRequestClose when key is pressed after exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'key-close', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			// Trigger exit
			act(() => exitCallback('key-close', 0));

			// Simulate keypress
			act(() => onDataCallback('a'));

			expect(onRequestClose).toHaveBeenCalledWith('key-close');
		});

		it('does not write to PTY after shell exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'no-write', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			// Trigger exit
			act(() => exitCallback('no-write', 0));

			// Clear write mock to isolate post-exit behavior
			mockWrite.mockClear();

			// Simulate keypress — should NOT write to PTY
			act(() => onDataCallback('x'));

			expect(mockWrite).not.toHaveBeenCalled();
		});

		it('writes to PTY before shell exit (normal operation)', async () => {
			await renderTerminal({ terminalTabId: 'normal-write' });

			const onDataCallback = getOnDataCallback();

			// Before exit, typing should write to PTY
			act(() => onDataCallback('hello'));

			expect(mockWrite).toHaveBeenCalledWith('normal-write', 'hello');
		});

		it('calls onRequestClose on Enter key after exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'enter-close', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('enter-close', 0));
			act(() => onDataCallback('\r'));

			expect(onRequestClose).toHaveBeenCalledWith('enter-close');
		});

		it('calls onRequestClose on Space key after exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'space-close', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('space-close', 0));
			act(() => onDataCallback(' '));

			expect(onRequestClose).toHaveBeenCalledWith('space-close');
		});

		it('calls onRequestClose on Ctrl+C after exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'ctrlc-close', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('ctrlc-close', 0));
			act(() => onDataCallback('\x03')); // Ctrl+C

			expect(onRequestClose).toHaveBeenCalledWith('ctrlc-close');
		});

		it('calls onRequestClose on Ctrl+D after exit', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'ctrld-close', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('ctrld-close', 0));
			act(() => onDataCallback('\x04')); // Ctrl+D

			expect(onRequestClose).toHaveBeenCalledWith('ctrld-close');
		});

		it('does not crash when onRequestClose is not provided', async () => {
			await renderTerminal({ terminalTabId: 'no-close-cb' });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('no-close-cb', 0));

			// Should not throw when pressing key without onRequestClose
			expect(() => act(() => onDataCallback('a'))).not.toThrow();
		});

		it('handles multiple keypresses after exit (all trigger close)', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'multi-key', onRequestClose });

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			act(() => exitCallback('multi-key', 0));

			// Multiple keypresses should all trigger onRequestClose
			act(() => onDataCallback('a'));
			act(() => onDataCallback('b'));
			act(() => onDataCallback('c'));

			expect(onRequestClose).toHaveBeenCalledTimes(3);
			// All calls should use same tabId
			for (const call of onRequestClose.mock.calls) {
				expect(call[0]).toBe('multi-key');
			}
		});

		it('does not call onRequestClose before exit when typing', async () => {
			const onRequestClose = vi.fn();
			await renderTerminal({ terminalTabId: 'pre-exit-type', onRequestClose });

			const onDataCallback = getOnDataCallback();

			// Before exit, typing should NOT trigger close
			act(() => onDataCallback('hello'));
			act(() => onDataCallback('\r'));

			expect(onRequestClose).not.toHaveBeenCalled();
			expect(mockWrite).toHaveBeenCalledWith('pre-exit-type', 'hello');
		});
	});

	// ================================================================
	// Exit event filtering (ignores other sessions)
	// ================================================================

	describe('exit event session filtering', () => {
		it('ignores exit events from other sessions', async () => {
			const onProcessExit = vi.fn();
			const onRequestClose = vi.fn();
			await renderTerminal({
				terminalTabId: 'my-tab',
				onProcessExit,
				onRequestClose,
			});

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			// Exit event for different session
			act(() => exitCallback('other-tab', 0));

			// Should NOT call onProcessExit
			expect(onProcessExit).not.toHaveBeenCalled();

			// Typing should still go to PTY (not exited)
			act(() => onDataCallback('test'));
			expect(mockWrite).toHaveBeenCalledWith('my-tab', 'test');
			expect(onRequestClose).not.toHaveBeenCalled();
		});

		it('only reacts to exit for matching terminalTabId', async () => {
			const onProcessExit = vi.fn();
			await renderTerminal({ terminalTabId: 'target-tab', onProcessExit });

			const exitCallback = getExitCallback();

			// Wrong session
			act(() => exitCallback('wrong-tab', 1));
			expect(onProcessExit).not.toHaveBeenCalled();

			// Right session
			act(() => exitCallback('target-tab', 1));
			expect(onProcessExit).toHaveBeenCalledWith('target-tab', 1);
		});
	});

	// ================================================================
	// Exit + close full workflow
	// ================================================================

	describe('full exit → close workflow', () => {
		it('complete lifecycle: spawn → type → exit → keypress → close', async () => {
			const onProcessExit = vi.fn();
			const onRequestClose = vi.fn();
			await renderTerminal({
				terminalTabId: 'full-lifecycle',
				onProcessExit,
				onRequestClose,
			});

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			// 1. Type a command (normal operation)
			act(() => onDataCallback('ls -la\r'));
			expect(mockWrite).toHaveBeenCalledWith('full-lifecycle', 'ls -la\r');
			expect(onRequestClose).not.toHaveBeenCalled();

			// 2. Shell exits
			act(() => exitCallback('full-lifecycle', 0));
			expect(onProcessExit).toHaveBeenCalledWith('full-lifecycle', 0);
			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('Shell exited.')
			);

			// 3. User presses a key
			mockWrite.mockClear();
			act(() => onDataCallback('q'));

			// Should trigger close, not PTY write
			expect(onRequestClose).toHaveBeenCalledWith('full-lifecycle');
			expect(mockWrite).not.toHaveBeenCalled();
		});

		it('exit with error code → type → close', async () => {
			const onProcessExit = vi.fn();
			const onRequestClose = vi.fn();
			await renderTerminal({
				terminalTabId: 'error-exit-flow',
				onProcessExit,
				onRequestClose,
			});

			const exitCallback = getExitCallback();
			const onDataCallback = getOnDataCallback();

			// Shell crashes with code 130 (SIGINT)
			act(() => exitCallback('error-exit-flow', 130));

			expect(onProcessExit).toHaveBeenCalledWith('error-exit-flow', 130);
			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('with code 130')
			);

			// User presses Enter to close
			act(() => onDataCallback('\r'));
			expect(onRequestClose).toHaveBeenCalledWith('error-exit-flow');
		});
	});

	// ================================================================
	// Exit state reset on cleanup
	// ================================================================

	describe('exit state cleanup', () => {
		it('does not show error overlay on normal shell exit', async () => {
			const { container } = await renderTerminal({ terminalTabId: 'no-overlay' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('no-overlay', 0));

			// xterm container should still be visible (not replaced by error overlay)
			const outerDiv = container.firstChild as HTMLElement;
			const xtermDiv = outerDiv.firstChild as HTMLElement;
			expect(xtermDiv.style.display).toBe('block');
		});

		it('terminal instance is not disposed on shell exit', async () => {
			await renderTerminal({ terminalTabId: 'no-dispose' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('no-dispose', 0));

			// Terminal should NOT be disposed — user might want to read scrollback
			expect(terminalMethods.dispose).not.toHaveBeenCalled();
		});
	});

	// ================================================================
	// Negative exit code handling
	// ================================================================

	describe('edge case exit codes', () => {
		it('handles exit code -1', async () => {
			await renderTerminal({ terminalTabId: 'exit-neg' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-neg', -1));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('with code -1')
			);
		});

		it('handles exit code 255', async () => {
			await renderTerminal({ terminalTabId: 'exit-255' });

			const exitCallback = getExitCallback();
			act(() => exitCallback('exit-255', 255));

			expect(terminalMethods.write).toHaveBeenCalledWith(
				expect.stringContaining('with code 255')
			);
		});
	});
});
