/**
 * @file terminalSpawnFailure.test.tsx
 * @description Tests for PTY spawn failure handling in EmbeddedTerminal:
 * - Error overlay rendering (AlertCircle icon, message, cwd)
 * - Retry button functionality (cleanup + re-spawn)
 * - xterm container visibility toggling
 * - Terminal disposal on spawn failure
 * - Multiple retry attempts
 * - Successful retry clears error state
 */

import React from 'react';
import { render, act, screen, fireEvent, waitFor } from '@testing-library/react';
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

/** Helper: render with spawn failure and wait for error overlay to appear */
async function renderWithSpawnFailure(
	props: Partial<React.ComponentProps<typeof EmbeddedTerminal>> & { terminalTabId: string },
	errorMsg = 'spawn error',
) {
	mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: errorMsg });

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

	// Wait for the async setupTerminal to complete and state to settle
	await waitFor(() => {
		expect(screen.getByTestId('spawn-error-overlay')).toBeTruthy();
	});

	return result!;
}

describe('EmbeddedTerminal — PTY spawn failure handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSpawn.mockImplementation(() => Promise.resolve({ success: true, pid: 1234 }));
	});

	// ================================================================
	// Error overlay rendering
	// ================================================================

	describe('error overlay rendering', () => {
		it('shows error overlay when spawn fails', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-overlay' }, 'No shell found');

			expect(screen.getByText('Failed to start terminal')).toBeTruthy();
		});

		it('displays the error message from spawn result', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-msg' }, 'Shell /bin/zsh not found');

			expect(screen.getByText('Shell /bin/zsh not found')).toBeTruthy();
		});

		it('uses default error message when spawn result has no error string', async () => {
			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0 });

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="fail-default"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				expect(screen.getByText('Failed to start terminal process')).toBeTruthy();
			});
		});

		it('shows the cwd in the error overlay', async () => {
			await renderWithSpawnFailure({
				terminalTabId: 'fail-cwd',
				cwd: '/home/user/project',
			});

			expect(screen.getByText('cwd: /home/user/project')).toBeTruthy();
		});

		it('shows a Retry button in the error overlay', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-retry-btn' });

			const retryButton = screen.getByTestId('spawn-retry-button');
			expect(retryButton).toBeTruthy();
			expect(retryButton.textContent).toContain('Retry');
		});

		it('applies theme background color to error overlay', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-color' });

			const overlay = screen.getByTestId('spawn-error-overlay');
			// JSDOM converts hex to rgb format, so check that the style is applied
			expect(overlay.style.backgroundColor).toBeTruthy();
			expect(overlay.style.backgroundColor).not.toBe('');
		});
	});

	// ================================================================
	// xterm container visibility
	// ================================================================

	describe('xterm container visibility', () => {
		it('hides xterm container when spawn error is active', async () => {
			const { container } = await renderWithSpawnFailure({ terminalTabId: 'fail-hide' });

			// The outer container has two children: xterm div (hidden) and error overlay
			const outerDiv = container.firstChild as HTMLElement;
			const xtermDiv = outerDiv.firstChild as HTMLElement;
			expect(xtermDiv.style.display).toBe('none');
		});

		it('shows xterm container when no spawn error (normal operation)', async () => {
			let container: HTMLElement;
			await act(async () => {
				const result = render(
					<EmbeddedTerminal
						terminalTabId="success-show"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
				container = result.container;
			});

			const outerDiv = container!.firstChild as HTMLElement;
			const xtermDiv = outerDiv.firstChild as HTMLElement;
			expect(xtermDiv.style.display).toBe('block');
		});

		it('does not show error overlay when spawn succeeds', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="success-no-overlay"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(screen.queryByTestId('spawn-error-overlay')).toBeNull();
		});
	});

	// ================================================================
	// Terminal disposal on spawn failure
	// ================================================================

	describe('terminal disposal on failure', () => {
		it('disposes xterm instance when spawn fails', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-dispose' });

			expect(terminalMethods.dispose).toHaveBeenCalled();
		});

		it('does not subscribe to PTY data when spawn fails', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'fail-no-sub' });

			// onRawPtyData and onExit should not be called (early return before subscription)
			expect(mockOnRawPtyData).not.toHaveBeenCalled();
			expect(mockOnExit).not.toHaveBeenCalled();
		});

		it('logs error to console when spawn fails', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await renderWithSpawnFailure({
				terminalTabId: 'fail-log',
				cwd: '/tmp/badpath',
			}, 'ENOENT: shell not found');

			expect(consoleSpy).toHaveBeenCalledWith(
				'[EmbeddedTerminal] Spawn failed:',
				expect.objectContaining({
					terminalTabId: 'fail-log',
					cwd: '/tmp/badpath',
				})
			);

			consoleSpy.mockRestore();
		});
	});

	// ================================================================
	// Retry functionality
	// ================================================================

	describe('retry functionality', () => {
		it('retries spawn when Retry button is clicked', async () => {
			// First call fails
			await renderWithSpawnFailure({ terminalTabId: 'retry-success' }, 'temporary failure');

			// Second call succeeds
			mockSpawn.mockResolvedValueOnce({ success: true, pid: 5678 });

			expect(mockSpawn).toHaveBeenCalledTimes(1);

			// Click retry
			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				// Allow the setTimeout(100) in handleRetry to resolve
				await new Promise((r) => setTimeout(r, 150));
			});

			// Spawn should be called a second time
			expect(mockSpawn).toHaveBeenCalledTimes(2);
		});

		it('clears error overlay on successful retry', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'retry-clears' }, 'temporary failure');

			mockSpawn.mockResolvedValueOnce({ success: true, pid: 5678 });

			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				await new Promise((r) => setTimeout(r, 150));
			});

			// Error overlay should be gone after successful retry
			await waitFor(() => {
				expect(screen.queryByTestId('spawn-error-overlay')).toBeNull();
			});
		});

		it('shows error overlay again if retry also fails', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'retry-fails' }, 'first failure');

			expect(screen.getByText('first failure')).toBeTruthy();

			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'second failure' });

			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				await new Promise((r) => setTimeout(r, 150));
			});

			// Should show the new error message
			await waitFor(() => {
				expect(screen.getByText('second failure')).toBeTruthy();
			});
		});

		it('can retry multiple times until success', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'retry-multi' }, 'fail 1');

			expect(screen.getByText('fail 1')).toBeTruthy();

			// First retry → second failure
			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'fail 2' });
			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				await new Promise((r) => setTimeout(r, 150));
			});

			await waitFor(() => {
				expect(screen.getByText('fail 2')).toBeTruthy();
			});

			// Second retry → success
			mockSpawn.mockResolvedValueOnce({ success: true, pid: 9999 });
			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				await new Promise((r) => setTimeout(r, 150));
			});

			await waitFor(() => {
				expect(screen.queryByTestId('spawn-error-overlay')).toBeNull();
			});
			expect(mockSpawn).toHaveBeenCalledTimes(3);
		});

		it('creates a new Terminal instance for each retry attempt', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'retry-new-term' });

			const initialTerminalCount = MockTerminal.mock.calls.length;

			mockSpawn.mockResolvedValueOnce({ success: true, pid: 5678 });
			await act(async () => {
				fireEvent.click(screen.getByTestId('spawn-retry-button'));
				await new Promise((r) => setTimeout(r, 150));
			});

			expect(MockTerminal.mock.calls.length).toBeGreaterThan(initialTerminalCount);
		});
	});

	// ================================================================
	// Normal operation (regression: no overlay in normal flow)
	// ================================================================

	describe('normal operation (no spawn failure)', () => {
		it('subscribes to PTY data and exit events on success', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="success-subs"
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

		it('does not dispose terminal on success', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="success-no-dispose"
						cwd="/tmp"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(terminalMethods.dispose).not.toHaveBeenCalled();
		});

		it('spawns with correct config on success', async () => {
			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="success-config"
						cwd="/home/dev"
						theme={defaultTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({
				sessionId: 'success-config',
				toolType: 'embedded-terminal',
				cwd: '/home/dev',
			}));
		});
	});

	// ================================================================
	// Theme integration with error overlay
	// ================================================================

	describe('error overlay theming', () => {
		it('applies background color to error overlay', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'theme-bg' });

			const overlay = screen.getByTestId('spawn-error-overlay');
			// JSDOM converts hex (#282a36) to rgb format, so just verify it's set
			expect(overlay.style.backgroundColor).toBeTruthy();
		});

		it('applies accent color to retry button', async () => {
			await renderWithSpawnFailure({ terminalTabId: 'theme-btn' });

			const retryButton = screen.getByTestId('spawn-retry-button');
			expect(retryButton.style.backgroundColor).toBeTruthy();
		});

		it('adapts to different themes', async () => {
			const lightTheme: Theme = {
				...defaultTheme,
				id: 'github-light',
				name: 'GitHub Light',
				mode: 'light',
				colors: {
					...defaultTheme.colors,
					bgMain: '#ffffff',
					textMain: '#24292e',
					textDim: '#6a737d',
					error: '#d73a49',
					accent: '#0366d6',
				},
			};

			mockSpawn.mockResolvedValueOnce({ success: false, pid: 0, error: 'error' });

			await act(async () => {
				render(
					<EmbeddedTerminal
						terminalTabId="theme-light"
						cwd="/tmp"
						theme={lightTheme}
						fontFamily="Menlo"
						isVisible={true}
					/>
				);
			});

			await waitFor(() => {
				const overlay = screen.getByTestId('spawn-error-overlay');
				// Light theme background should be applied (rgb(255, 255, 255) for #ffffff)
				expect(overlay.style.backgroundColor).toBeTruthy();
			});
		});
	});
});
