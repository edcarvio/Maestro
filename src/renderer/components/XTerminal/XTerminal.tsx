/**
 * XTerminal - xterm.js wrapper component for full terminal emulation
 *
 * This component manages:
 * - xterm.js Terminal instance lifecycle
 * - Addon loading (fit, webgl, web-links, search, unicode11)
 * - IPC communication with main process PTY via processService
 * - Resize handling with ResizeObserver + debouncing
 * - Theme synchronization with Maestro themes
 *
 * Unlike EmbeddedTerminal, XTerminal does not spawn its own PTY process.
 * It exposes a generic interface for parent components to wire up data flow,
 * while also supporting direct IPC routing via sessionId when connected to
 * an existing PTY.
 *
 * Performance:
 * - PTY data is batched via requestAnimationFrame to avoid flooding xterm.js
 * - WebGL renderer is used when available, with automatic canvas fallback
 */

import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

import type { Theme } from '../../types';
import { toXtermTheme } from '../../utils/xtermTheme';
import { processService } from '../../services/process';

/**
 * Props for the XTerminal component.
 *
 * XTerminal is a generic xterm.js wrapper — it does NOT spawn its own PTY.
 * The parent component is responsible for wiring up data flow via the
 * imperative handle and/or the sessionId-based IPC routing.
 */
interface XTerminalProps {
	/** IPC routing key — format: `{sessionId}-terminal-{tabId}` */
	sessionId: string;
	/** Maestro theme, converted to xterm.js ITheme via `toXtermTheme()` */
	theme: Theme;
	/** User's configured monospace font family */
	fontFamily: string;
	/** Font size in pixels (default: 14) */
	fontSize?: number;
	/** Called when the user types — allows parent to handle input externally */
	onData?: (data: string) => void;
	/** Called when the terminal grid dimensions change after a fit */
	onResize?: (cols: number, rows: number) => void;
	/** Called when the shell sets the window title via escape sequence (e.g. `\e]0;title\a`) */
	onTitleChange?: (title: string) => void;
}

/**
 * Imperative handle exposed via `React.forwardRef` for parent control.
 *
 * Used by the search bar, keyboard shortcut handlers, and programmatic
 * interaction (e.g., writing exit messages after shell exit).
 */
export interface XTerminalHandle {
	/** Write data directly to the xterm.js terminal (bypasses PTY) */
	write: (data: string) => void;
	/** Focus the terminal's internal textarea for keyboard input */
	focus: () => void;
	/** Clear the terminal viewport (scrollback is preserved) */
	clear: () => void;
	/** Scroll to the bottom of the terminal output */
	scrollToBottom: () => void;
	/** Start a new search — highlights the first match and returns true if found */
	search: (query: string) => boolean;
	/** Advance to the next search match */
	searchNext: () => boolean;
	/** Return to the previous search match */
	searchPrevious: () => boolean;
	/** Clear search decorations/highlights from the terminal */
	clearSearch: () => void;
	/** Get the currently selected text in the terminal */
	getSelection: () => string;
	/** Re-fit the terminal to its container dimensions */
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
		// Cmd+1-9,0 (jump to tab)
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

const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(({
	sessionId,
	theme,
	fontFamily,
	fontSize = 14,
	onData,
	onResize,
	onTitleChange,
}, ref) => {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const initRef = useRef(false);
	const cleanupFnsRef = useRef<Array<() => void>>([]);
	const lastSearchQueryRef = useRef<string>('');
	const [isFocused, setIsFocused] = useState(false);

	// Write batching: accumulates PTY data and flushes once per animation frame
	const writeBufferRef = useRef<string>('');
	const writeRafRef = useRef<number | null>(null);

	// Debounced resize
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Expose imperative methods to parent via ref
	useImperativeHandle(ref, () => ({
		write: (data: string) => terminalRef.current?.write(data),
		focus: () => terminalRef.current?.focus(),
		clear: () => terminalRef.current?.clear(),
		scrollToBottom: () => terminalRef.current?.scrollToBottom(),
		search: (query: string) => {
			if (!searchAddonRef.current || !query) return false;
			lastSearchQueryRef.current = query;
			return searchAddonRef.current.findNext(query, {
				caseSensitive: false,
				wholeWord: false,
				regex: false,
				incremental: true,
			});
		},
		searchNext: () => {
			if (!searchAddonRef.current || !lastSearchQueryRef.current) return false;
			return searchAddonRef.current.findNext(lastSearchQueryRef.current);
		},
		searchPrevious: () => {
			if (!searchAddonRef.current || !lastSearchQueryRef.current) return false;
			return searchAddonRef.current.findPrevious(lastSearchQueryRef.current);
		},
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

	// Debounced resize handler
	const handleResize = useCallback(() => {
		if (resizeTimeoutRef.current) {
			clearTimeout(resizeTimeoutRef.current);
		}
		resizeTimeoutRef.current = setTimeout(() => {
			if (fitAddonRef.current && terminalRef.current) {
				try {
					fitAddonRef.current.fit();
				} catch {
					// Ignore fit errors during rapid resizing
					return;
				}
				const { cols, rows } = terminalRef.current;
				onResize?.(cols, rows);
				processService.resize(sessionId, cols, rows);
			}
		}, 100);
	}, [sessionId, onResize]);

	// Initialize terminal on mount
	useEffect(() => {
		if (!containerRef.current || initRef.current) return;
		initRef.current = true;

		const term = new Terminal({
			cursorBlink: true,
			cursorStyle: 'block',
			fontFamily: fontFamily || 'Menlo, Monaco, "Courier New", monospace',
			fontSize,
			theme: toXtermTheme(theme),
			allowProposedApi: true,
			scrollback: 10000,
			smoothScrollDuration: 125,
		});

		// Load addons
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		term.loadAddon(new WebLinksAddon());

		const searchAddon = new SearchAddon();
		term.loadAddon(searchAddon);

		const unicode11Addon = new Unicode11Addon();
		term.loadAddon(unicode11Addon);
		term.unicode.activeVersion = '11';

		// WebGL addon (with canvas fallback)
		(async () => {
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
		})();

		// Mount to DOM
		term.open(containerRef.current);
		fitAddon.fit();

		// Store refs
		terminalRef.current = term;
		fitAddonRef.current = fitAddon;
		searchAddonRef.current = searchAddon;

		// Bypass Maestro global shortcuts
		term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
			if (isMaestroShortcut(ev)) {
				return false; // Let Maestro handle it
			}
			return true; // xterm handles it
		});

		// Title change handler
		if (onTitleChange) {
			const titleDisposable = term.onTitleChange((title) => {
				onTitleChange(title);
			});
			cleanupFnsRef.current.push(() => titleDisposable.dispose());
		}

		return () => {
			// Cancel pending write RAF
			if (writeRafRef.current !== null) {
				cancelAnimationFrame(writeRafRef.current);
				writeRafRef.current = null;
			}
			// Flush remaining buffered data
			if (writeBufferRef.current && terminalRef.current) {
				terminalRef.current.write(writeBufferRef.current);
			}
			writeBufferRef.current = '';

			// Clear resize timeout
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
				resizeTimeoutRef.current = null;
			}

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

			initRef.current = false;
		};
	}, [sessionId]);

	// Handle data from PTY (main process -> renderer) with RAF batching
	useEffect(() => {
		const unsubscribe = processService.onRawPtyData((sid, data) => {
			if (sid !== sessionId) return;

			writeBufferRef.current += data;

			if (writeRafRef.current === null) {
				writeRafRef.current = requestAnimationFrame(() => {
					const buffered = writeBufferRef.current;
					writeBufferRef.current = '';
					writeRafRef.current = null;
					if (buffered && terminalRef.current) {
						terminalRef.current.write(buffered);
					}
				});
			}
		});

		cleanupFnsRef.current.push(unsubscribe);
		return unsubscribe;
	}, [sessionId]);

	// Handle user input (renderer -> main process)
	useEffect(() => {
		if (!terminalRef.current) return;

		const disposable = terminalRef.current.onData((data) => {
			processService.write(sessionId, data);
			onData?.(data);
		});

		cleanupFnsRef.current.push(() => disposable.dispose());
		return () => disposable.dispose();
	}, [sessionId, onData]);

	// ResizeObserver for container size changes
	useEffect(() => {
		if (!containerRef.current) return;

		const resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(containerRef.current);

		return () => resizeObserver.disconnect();
	}, [handleResize]);

	// Update theme when it changes
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.options.theme = toXtermTheme(theme);
		}
	}, [theme]);

	// Update font family when it changes
	useEffect(() => {
		if (terminalRef.current && fontFamily) {
			terminalRef.current.options.fontFamily = fontFamily;
		}
	}, [fontFamily]);

	// Update font size when it changes
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.options.fontSize = fontSize;
		}
	}, [fontSize]);

	// Window focus/blur handling — auto-focus terminal on window regain,
	// pause cursor blink when window is in background
	useEffect(() => {
		const handleWindowFocus = () => {
			if (terminalRef.current) {
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
	}, []);

	return (
		<div
			ref={containerRef}
			onFocus={() => setIsFocused(true)}
			onBlur={() => setIsFocused(false)}
			style={{
				width: '100%',
				height: '100%',
				overflow: 'hidden',
				padding: '8px',
				boxShadow: isFocused ? `inset 0 0 0 1px ${theme.colors.accent}` : 'none',
				borderRadius: '4px',
				transition: 'box-shadow 0.15s ease',
			}}
		/>
	);
});

XTerminal.displayName = 'XTerminal';

export default XTerminal;
