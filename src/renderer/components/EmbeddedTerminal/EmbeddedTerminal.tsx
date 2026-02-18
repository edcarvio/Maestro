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
 * Lifecycle:
 * - On mount: creates xterm.js Terminal, spawns PTY, subscribes to raw data
 * - On theme change: updates terminal colors
 * - On visibility change: re-fits terminal dimensions
 * - On unmount: disposes terminal, unsubscribes listeners, kills process
 */

import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
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
	// Cmd+. (focus input), Cmd+/ (help)
	if (!ev.shiftKey && !ev.altKey) {
		if (['k', ',', 'j', 'n', 'w', 't', '.', '/'].includes(key)) return true;
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
}, ref) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const spawnedRef = useRef(false);
	const cleanupFnsRef = useRef<Array<() => void>>([]);

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

	// Spawn PTY and wire up data flow
	const setupTerminal = useCallback(async () => {
		if (!containerRef.current || spawnedRef.current) return;
		spawnedRef.current = true;

		const term = new Terminal({
			scrollback: 10000,
			theme: toXtermTheme(theme),
			fontFamily: fontFamily || 'Menlo, Monaco, "Courier New", monospace',
			fontSize: 13,
			cursorBlink: true,
			allowProposedApi: true,
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

		term.open(containerRef.current);
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
			term.writeln('\r\n\x1b[31mFailed to spawn terminal process.\x1b[0m');
			if (result.error) {
				term.writeln(`\x1b[90m${result.error}\x1b[0m`);
			}
			term.writeln(`\x1b[90mcwd: ${cwd}\x1b[0m`);
			console.error('[EmbeddedTerminal] Spawn failed:', { terminalTabId, cwd, result });
			return;
		}

		// Subscribe to raw PTY data — write directly to xterm.js
		const unsubData = processService.onRawPtyData((sessionId, data) => {
			if (sessionId === terminalTabId) {
				term.write(data);
			}
		});
		cleanupFnsRef.current.push(unsubData);

		// Forward keystrokes from xterm.js → PTY stdin
		const dataDisposable = term.onData((data) => {
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
		resizeObserver.observe(containerRef.current);
		cleanupFnsRef.current.push(() => resizeObserver.disconnect());

		// Handle process exit
		const unsubExit = processService.onExit((sessionId, code) => {
			if (sessionId === terminalTabId) {
				term.writeln(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m`);
				onProcessExit?.(terminalTabId, code);
			}
		});
		cleanupFnsRef.current.push(unsubExit);
	}, [terminalTabId, cwd, theme, fontFamily, onProcessExit]);

	// Initialize on mount
	useEffect(() => {
		setupTerminal();

		return () => {
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

			// Kill the PTY process
			if (spawnedRef.current) {
				processService.kill(terminalTabId);
				spawnedRef.current = false;
			}
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

	return (
		<div
			ref={containerRef}
			style={{
				width: '100%',
				height: '100%',
				overflow: 'hidden',
				padding: '8px',
			}}
		/>
	);
});

EmbeddedTerminal.displayName = 'EmbeddedTerminal';

export default EmbeddedTerminal;
