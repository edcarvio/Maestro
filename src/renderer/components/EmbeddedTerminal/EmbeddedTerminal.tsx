/**
 * EmbeddedTerminal — Full xterm.js terminal emulator
 *
 * Renders a real terminal (iTerm2-like) inside Maestro's tab panel.
 * Supports TUI programs (vim, htop, etc.) by using raw PTY data without
 * any ANSI stripping or buffering.
 *
 * Each terminal tab gets its own EmbeddedTerminal instance. The terminalTabId
 * is used as the process manager session key, allowing multiple terminals
 * within the same Maestro agent session.
 *
 * Performance:
 * - PTY data is batched via requestAnimationFrame to avoid flooding xterm.js
 *   with individual write() calls during high-throughput output (e.g. find /,
 *   cat large-file, yes). This matches the RAF batching pattern used for
 *   thinking stream chunks.
 * - WebGL renderer is used when available for GPU-accelerated rendering,
 *   with automatic fallback to canvas.
 * - Terminal instances are CSS-hidden (not destroyed) when tabs switch,
 *   preserving scrollback and cursor state with zero re-initialization cost.
 *
 * Lifecycle:
 * - On mount: creates xterm.js Terminal, spawns PTY, subscribes to raw data
 * - On theme change: updates terminal colors
 * - On visibility change: re-fits terminal dimensions
 * - On unmount: disposes terminal, unsubscribes listeners, kills process
 */

import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { AlertCircle, RotateCcw } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

import type { Theme } from '../../types';
import { toXtermTheme } from '../../utils/xtermTheme';
import { processService } from '../../services/process';

interface EmbeddedTerminalProps {
	terminalTabId: string;  // Process manager key (tab.id, not session.id)
	cwd: string;
	theme: Theme;
	fontFamily: string;
	isVisible: boolean;
	onProcessExit?: (tabId: string, exitCode: number) => void;
	onRequestClose?: (tabId: string) => void;
}

/**
 * Imperative handle exposed via ref for parent component control.
 * Used for search UI (Phase 9), clear (Cmd+K), and programmatic interaction.
 */
export interface EmbeddedTerminalHandle {
	write: (data: string) => void;
	focus: () => void;
	clear: () => void;
	scrollToBottom: () => void;
	search: (query: string) => boolean;
	searchNext: () => boolean;
	searchPrevious: () => boolean;
	clearSearch: () => void;
	getSelection: () => string;
	resize: () => void;
}

/**
 * Global shortcuts that should bypass xterm.js and be handled by Maestro.
 * Returns true if the key event is a Maestro shortcut (xterm should NOT handle it).
 */
function isMaestroShortcut(ev: KeyboardEvent): boolean {
	const meta = ev.metaKey || ev.ctrlKey;
	if (!meta) return false;

	const key = ev.key.toLowerCase();

	// Cmd+K (quick action), Cmd+, (settings), Cmd+J (toggle mode)
	// Cmd+N (new agent), Cmd+W (close tab), Cmd+T (new tab)
	// Cmd+. (focus input), Cmd+/ (help), Cmd+F (search in terminal)
	if (!ev.shiftKey && !ev.altKey) {
		if (['k', ',', 'j', 'n', 'w', 't', '.', '/', 'f'].includes(key)) return true;
		// Cmd+1-9,0 (go to tab)
		if (/^[0-9]$/.test(key)) return true;
		// Cmd+[ and Cmd+] (cycle agents)
		if (key === '[' || key === ']') return true;
	}

	// Cmd+Shift shortcuts
	if (ev.shiftKey && !ev.altKey) {
		if (
			[
				'n', // new wizard
				'p', // prompt composer
				'f', // go to files
				'h', // go to history
				'm', // move to group
				'a', // focus sidebar
				'd', // git diff
				'g', // git log
				'l', // agent sessions
				'j', // jump to bottom
				'b', // toggle bookmark
				't', // reopen closed tab
				'r', // rename tab
				'k', // toggle thinking
				's', // toggle tab star
				'[', // prev tab
				']', // next tab
				'e', // toggle auto run expanded
				'backspace', // kill instance
			].includes(key)
		) {
			return true;
		}
		// Cmd+Shift+` (new terminal tab)
		if (key === '`' || key === '~') return true;
	}

	// Alt+Cmd shortcuts
	if (ev.altKey) {
		if (
			[
				'arrowleft', // toggle sidebar
				'arrowright', // toggle right panel
				'c', // new group chat
				'l', // system logs
				'p', // process monitor
				'u', // usage dashboard
				't', // tab switcher
				's', // toggle auto-scroll
			].includes(key)
		) {
			return true;
		}
		// Alt+Cmd+1-0 (jump to session)
		if (/^[0-9]$/.test(key)) return true;
	}

	return false;
}

const EmbeddedTerminal = forwardRef<EmbeddedTerminalHandle, EmbeddedTerminalProps>(({
	terminalTabId,
	cwd,
	theme,
	fontFamily,
	isVisible,
	onProcessExit,
	onRequestClose,
}, ref) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const xtermContainerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const spawnedRef = useRef(false);
	const hasExitedRef = useRef(false);
	const cleanupFnsRef = useRef<Array<() => void>>([]);

	// Spawn failure state — shown as overlay when PTY fails to start
	const [spawnError, setSpawnError] = useState<string | null>(null);
	const [isRetrying, setIsRetrying] = useState(false);

	// Write batching: accumulates PTY data and flushes once per animation frame
	// to avoid flooding xterm.js with individual write() calls during high-throughput output
	const writeBufferRef = useRef<string>('');
	const writeRafRef = useRef<number | null>(null);

	// Expose imperative methods to parent via ref
	useImperativeHandle(ref, () => ({
		write: (data: string) => terminalRef.current?.write(data),
		focus: () => terminalRef.current?.focus(),
		clear: () => terminalRef.current?.clear(),
		scrollToBottom: () => terminalRef.current?.scrollToBottom(),
		search: (query: string) => searchAddonRef.current?.findNext(query) ?? false,
		searchNext: () => searchAddonRef.current?.findNext('') ?? false,
		searchPrevious: () => searchAddonRef.current?.findPrevious('') ?? false,
		clearSearch: () => searchAddonRef.current?.clearDecorations(),
		getSelection: () => terminalRef.current?.getSelection() ?? '',
		resize: () => {
			try {
				fitAddonRef.current?.fit();
			} catch {
				// Ignore fit errors
			}
		},
	}), []);

	// Clean up existing terminal instance (used before retry)
	const cleanupTerminal = useCallback(() => {
		// Cancel pending write RAF
		if (writeRafRef.current !== null) {
			cancelAnimationFrame(writeRafRef.current);
			writeRafRef.current = null;
		}
		writeBufferRef.current = '';

		// Cleanup all subscriptions
		for (const cleanup of cleanupFnsRef.current) {
			cleanup();
		}
		cleanupFnsRef.current = [];

		// Dispose xterm.js terminal
		if (terminalRef.current) {
			terminalRef.current.dispose();
			terminalRef.current = null;
		}

		fitAddonRef.current = null;
		searchAddonRef.current = null;
		spawnedRef.current = false;
		hasExitedRef.current = false;
	}, []);

	// Spawn PTY and wire up data flow
	const setupTerminal = useCallback(async () => {
		if (!xtermContainerRef.current || spawnedRef.current) return;
		spawnedRef.current = true;
		setSpawnError(null);

		const term = new Terminal({
			scrollback: 10000,
			theme: toXtermTheme(theme),
			fontFamily: fontFamily || 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 13,
			cursorBlink: true,
			allowProposedApi: true,
			smoothScrollDuration: 125,
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(new WebLinksAddon());

		const searchAddon = new SearchAddon();
		term.loadAddon(searchAddon);
		searchAddonRef.current = searchAddon;

		const unicode11Addon = new Unicode11Addon();
		term.loadAddon(unicode11Addon);
		term.unicode.activeVersion = '11';

		// Try WebGL addon for performance, fall back to canvas
		try {
			const { WebglAddon } = await import('@xterm/addon-webgl');
			const webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon.dispose();
			});
			term.loadAddon(webglAddon);
		} catch {
			// WebGL not available — canvas renderer is the default fallback
		}

		term.open(xtermContainerRef.current);
		fitAddon.fit();

		terminalRef.current = term;
		fitAddonRef.current = fitAddon;

		// Bypass Maestro global shortcuts
		term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
			if (isMaestroShortcut(ev)) {
				return false; // Let Maestro handle it
			}
			return true; // xterm handles it
		});

		// Spawn the PTY process using terminalTabId as the session key
		const result = await processService.spawn({
			sessionId: terminalTabId,
			toolType: 'embedded-terminal',
			cwd,
			command: '',
			args: [],
		});

		if (!result.success) {
			console.error('[EmbeddedTerminal] Spawn failed:', { terminalTabId, cwd, result });
			// Dispose the terminal — we'll show an error overlay instead
			term.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			searchAddonRef.current = null;
			setSpawnError(result.error || 'Failed to start terminal process');
			return;
		}

		// Subscribe to raw PTY data — batch writes via RAF for performance.
		// High-throughput commands (find /, cat large-file, yes) can produce
		// thousands of data events per second. Batching into a single write()
		// per animation frame reduces xterm.js rendering overhead significantly.
		const unsubData = processService.onRawPtyData((sessionId, data) => {
			if (sessionId !== terminalTabId) return;

			writeBufferRef.current += data;

			if (writeRafRef.current === null) {
				writeRafRef.current = requestAnimationFrame(() => {
					const buffered = writeBufferRef.current;
					writeBufferRef.current = '';
					writeRafRef.current = null;
					if (buffered) {
						term.write(buffered);
					}
				});
			}
		});
		cleanupFnsRef.current.push(unsubData);

		// Forward keystrokes from xterm.js → PTY stdin.
		// After shell exit, any keypress triggers tab close instead.
		const dataDisposable = term.onData((data) => {
			if (hasExitedRef.current) {
				onRequestClose?.(terminalTabId);
				return;
			}
			processService.write(terminalTabId, data);
		});
		cleanupFnsRef.current.push(() => dataDisposable.dispose());

		// Handle terminal resize → PTY resize
		const resizeDisposable = term.onResize(({ cols, rows }) => {
			processService.resize(terminalTabId, cols, rows);
		});
		cleanupFnsRef.current.push(() => resizeDisposable.dispose());

		// ResizeObserver for container size changes → fit terminal
		const resizeObserver = new ResizeObserver(() => {
			if (fitAddonRef.current) {
				try {
					fitAddonRef.current.fit();
				} catch {
					// Ignore fit errors during rapid resizing
				}
			}
		});
		resizeObserver.observe(xtermContainerRef.current);
		cleanupFnsRef.current.push(() => resizeObserver.disconnect());

		// Handle process exit — show message and enable "press any key to close"
		const unsubExit = processService.onExit((sessionId, code) => {
			if (sessionId === terminalTabId) {
				hasExitedRef.current = true;
				const codeMsg = code !== 0 ? ` with code ${code}` : '';
				term.write(`\r\n\x1b[33mShell exited${codeMsg}.\x1b[0m \x1b[90mPress any key to close, or Ctrl+Shift+\` for new terminal.\x1b[0m\r\n`);
				onProcessExit?.(terminalTabId, code);
			}
		});
		cleanupFnsRef.current.push(unsubExit);
	}, [terminalTabId, cwd, theme, fontFamily, onProcessExit, onRequestClose]);

	// Retry handler — clean up old state and re-attempt spawn
	const handleRetry = useCallback(async () => {
		setIsRetrying(true);
		cleanupTerminal();
		// Small delay to allow DOM cleanup before re-initializing
		await new Promise((resolve) => setTimeout(resolve, 100));
		await setupTerminal();
		setIsRetrying(false);
	}, [cleanupTerminal, setupTerminal]);

	// Initialize on mount
	useEffect(() => {
		setupTerminal();

		return () => {
			// Flush remaining buffered data before disposing
			if (writeBufferRef.current && terminalRef.current) {
				terminalRef.current.write(writeBufferRef.current);
			}
			cleanupTerminal();

			// Kill the PTY process (only if spawn succeeded)
			processService.kill(terminalTabId);
		};
		// Only run on mount/unmount — terminalTabId is stable
	}, [terminalTabId]);

	// Update theme when it changes
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.options.theme = toXtermTheme(theme);
		}
	}, [theme]);

	// Update font when it changes
	useEffect(() => {
		if (terminalRef.current && fontFamily) {
			terminalRef.current.options.fontFamily = fontFamily;
		}
	}, [fontFamily]);

	// Re-fit when becoming visible (tab switch)
	useEffect(() => {
		if (isVisible && fitAddonRef.current) {
			// Small delay to ensure the container has its final dimensions
			const timer = setTimeout(() => {
				try {
					fitAddonRef.current?.fit();
				} catch {
					// Ignore
				}
			}, 50);
			return () => clearTimeout(timer);
		}
	}, [isVisible]);

	// Window focus/blur handling — auto-focus terminal on window regain,
	// pause cursor blink when window is in background
	useEffect(() => {
		const handleWindowFocus = () => {
			if (isVisible && terminalRef.current && !hasExitedRef.current && !spawnError) {
				terminalRef.current.options.cursorBlink = true;
				terminalRef.current.focus();
			}
		};
		const handleWindowBlur = () => {
			if (terminalRef.current) {
				terminalRef.current.options.cursorBlink = false;
			}
		};

		window.addEventListener('focus', handleWindowFocus);
		window.addEventListener('blur', handleWindowBlur);
		return () => {
			window.removeEventListener('focus', handleWindowFocus);
			window.removeEventListener('blur', handleWindowBlur);
		};
	}, [isVisible, spawnError]);

	return (
		<div
			ref={containerRef}
			style={{
				width: '100%',
				height: '100%',
				overflow: 'hidden',
				position: 'relative',
			}}
		>
			{/* xterm.js container — hidden when spawn error is active */}
			<div
				ref={xtermContainerRef}
				style={{
					width: '100%',
					height: '100%',
					padding: '8px',
					display: spawnError ? 'none' : 'block',
				}}
			/>

			{/* Spawn failure overlay */}
			{spawnError && (
				<div
					data-testid="spawn-error-overlay"
					style={{
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: theme.colors.bgMain,
					}}
				>
					<div style={{ textAlign: 'center', maxWidth: 320 }}>
						<AlertCircle
							style={{
								width: 32,
								height: 32,
								margin: '0 auto 8px',
								color: theme.colors.error,
							}}
						/>
						<p
							style={{
								color: theme.colors.textMain,
								fontSize: 14,
								fontWeight: 500,
								margin: '0 0 4px',
							}}
						>
							Failed to start terminal
						</p>
						<p
							style={{
								color: theme.colors.textDim,
								fontSize: 12,
								margin: '0 0 4px',
							}}
						>
							{spawnError}
						</p>
						<p
							style={{
								color: theme.colors.textDim,
								fontSize: 11,
								margin: '0 0 16px',
								fontFamily: 'monospace',
							}}
						>
							cwd: {cwd}
						</p>
						<button
							data-testid="spawn-retry-button"
							onClick={handleRetry}
							disabled={isRetrying}
							style={{
								display: 'inline-flex',
								alignItems: 'center',
								gap: 6,
								padding: '6px 16px',
								fontSize: 13,
								fontWeight: 500,
								borderRadius: 6,
								border: `1px solid ${theme.colors.border}`,
								backgroundColor: theme.colors.accent,
								color: theme.colors.accentForeground || '#ffffff',
								cursor: isRetrying ? 'not-allowed' : 'pointer',
								opacity: isRetrying ? 0.6 : 1,
							}}
						>
							<RotateCcw style={{ width: 14, height: 14 }} />
							{isRetrying ? 'Retrying…' : 'Retry'}
						</button>
					</div>
				</div>
			)}
		</div>
	);
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';

export default EmbeddedTerminal;
