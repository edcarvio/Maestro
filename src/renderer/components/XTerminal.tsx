/**
 * XTerminal - xterm.js wrapper component for full terminal emulation
 *
 * Manages:
 * - xterm.js Terminal instance lifecycle
 * - Addon loading (fit, webgl, web-links, search, unicode11)
 * - IPC communication with main process PTY
 * - Resize handling with debouncing
 * - Theme synchronization with Maestro themes
 * - RAF-based write batching for high-throughput PTY data
 */

import React, { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { Theme } from '../types';

/** Default scrollback buffer size (lines). Balances memory usage vs. history retention. */
export const DEFAULT_SCROLLBACK_LINES = 10000;

/**
 * Maximum write buffer size (bytes) before forcing a synchronous flush.
 * Prevents unbounded memory growth when PTY emits faster than the display refreshes.
 * At ~80 chars/line, 512KB ≈ 6,500 lines of buffered output.
 */
export const WRITE_BUFFER_FORCE_FLUSH_SIZE = 512 * 1024;

/** Duration in milliseconds for smooth scrolling animation. 125ms feels snappy without jarring. */
export const SMOOTH_SCROLL_DURATION_MS = 125;

/** Cursor shape options supported by xterm.js */
export type CursorStyle = 'block' | 'underline' | 'bar';

interface XTerminalProps {
	sessionId: string;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	scrollbackLines?: number;
	cursorStyle?: CursorStyle;
	cursorBlink?: boolean;
	onData?: (data: string) => void;
	onResize?: (cols: number, rows: number) => void;
	onTitleChange?: (title: string) => void;
	/** Called when the user presses any key after the shell has exited */
	onCloseRequest?: () => void;
}

export interface XTerminalHandle {
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
 * Mix a foreground hex color onto a background hex color at a given opacity.
 * Both inputs must be #RRGGBB strings. Returns #RRGGBB.
 */
export function mixHexColors(fg: string, bg: string, alpha: number): string {
	const parse = (hex: string) => [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
	const [fR, fG, fB] = parse(fg);
	const [bR, bG, bB] = parse(bg);
	const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
	const toHex = (n: number) => n.toString(16).padStart(2, '0');
	return `#${toHex(mix(fR, bR))}${toHex(mix(fG, bG))}${toHex(mix(fB, bB))}`;
}

/**
 * Build xterm.js search decoration options from a Maestro theme.
 * Uses the theme's warning color (yellow tones) for all-match highlights
 * and the accent color for the active/current match.
 */
export function buildSearchDecorations(theme: Theme) {
	const { warning, accent, bgMain } = theme.colors;
	return {
		matchBackground: mixHexColors(warning, bgMain, 0.3),
		matchBorder: mixHexColors(warning, bgMain, 0.5),
		matchOverviewRuler: warning,
		activeMatchBackground: mixHexColors(accent, bgMain, 0.6),
		activeMatchBorder: accent,
		activeMatchColorOverviewRuler: accent,
	};
}

/**
 * Map Maestro theme colors to xterm.js ITheme.
 * Uses per-theme ANSI colors when available, falling back to sensible defaults.
 */
export function mapMaestroThemeToXterm(theme: Theme) {
	const isDark = theme.mode !== 'light';
	const c = theme.colors;

	// Default ANSI palette used when theme doesn't define its own colors
	const defaultAnsi = isDark ? {
		black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
		blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
		brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
		brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
	} : {
		black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
		blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
		brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#859900', brightYellow: '#b58900',
		brightBlue: '#268bd2', brightMagenta: '#6c71c4', brightCyan: '#2aa198', brightWhite: '#fdf6e3',
	};

	return {
		background: c.bgMain,
		foreground: c.textMain,
		cursor: c.accent,
		cursorAccent: c.bgMain,
		selectionBackground: c.ansiSelection || (isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)'),
		selectionForeground: undefined,
		// ANSI colors — prefer theme-defined, fall back to defaults
		black: c.ansiBlack || defaultAnsi.black,
		red: c.ansiRed || defaultAnsi.red,
		green: c.ansiGreen || defaultAnsi.green,
		yellow: c.ansiYellow || defaultAnsi.yellow,
		blue: c.ansiBlue || defaultAnsi.blue,
		magenta: c.ansiMagenta || defaultAnsi.magenta,
		cyan: c.ansiCyan || defaultAnsi.cyan,
		white: c.ansiWhite || defaultAnsi.white,
		brightBlack: c.ansiBrightBlack || defaultAnsi.brightBlack,
		brightRed: c.ansiBrightRed || defaultAnsi.brightRed,
		brightGreen: c.ansiBrightGreen || defaultAnsi.brightGreen,
		brightYellow: c.ansiBrightYellow || defaultAnsi.brightYellow,
		brightBlue: c.ansiBrightBlue || defaultAnsi.brightBlue,
		brightMagenta: c.ansiBrightMagenta || defaultAnsi.brightMagenta,
		brightCyan: c.ansiBrightCyan || defaultAnsi.brightCyan,
		brightWhite: c.ansiBrightWhite || defaultAnsi.brightWhite,
	};
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(function XTerminal(
	{ sessionId, theme, fontFamily, fontSize = 14, scrollbackLines, cursorStyle = 'block', cursorBlink = true, onData, onResize, onTitleChange, onCloseRequest },
	ref
) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sessionIdRef = useRef(sessionId);
	const themeRef = useRef(theme);

	// Tracks whether the shell has exited — used to intercept user input for close-on-keypress
	const exitedRef = useRef(false);
	const onCloseRequestRef = useRef(onCloseRequest);

	// RAF write batching: accumulate PTY data chunks, flush once per animation frame.
	// This dramatically reduces terminal.write() call frequency during high-throughput
	// output (e.g. build logs, `cat` of large files) from potentially thousands/sec
	// to ~60/sec (matching display refresh rate).
	const writeBufferRef = useRef<string>('');
	const rafIdRef = useRef<number>(0);

	// Keep refs current for IPC callbacks
	useEffect(() => {
		sessionIdRef.current = sessionId;
		exitedRef.current = false; // Reset exited state when session changes
	}, [sessionId]);

	useEffect(() => {
		onCloseRequestRef.current = onCloseRequest;
	}, [onCloseRequest]);

	// Initialize xterm.js terminal
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			cursorBlink,
			cursorStyle,
			fontFamily: fontFamily || 'Menlo, Monaco, "Courier New", monospace',
			fontSize,
			theme: mapMaestroThemeToXterm(theme),
			allowProposedApi: true,
			scrollback: scrollbackLines || DEFAULT_SCROLLBACK_LINES,
			smoothScrollDuration: SMOOTH_SCROLL_DURATION_MS,
		});

		// Load addons
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		const webLinksAddon = new WebLinksAddon();
		term.loadAddon(webLinksAddon);

		const searchAddon = new SearchAddon();
		term.loadAddon(searchAddon);

		const unicode11Addon = new Unicode11Addon();
		term.loadAddon(unicode11Addon);
		term.unicode.activeVersion = '11';

		// WebGL addon with fallback to canvas
		let webglAddon: WebglAddon | null = null;
		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon?.dispose();
				webglAddon = null;
			});
			term.loadAddon(webglAddon);
		} catch {
			// Canvas renderer is the default fallback
		}

		// Mount to DOM
		term.open(containerRef.current);
		fitAddon.fit();

		// Store refs
		terminalRef.current = term;
		fitAddonRef.current = fitAddon;
		searchAddonRef.current = searchAddon;

		return () => {
			// Cancel any pending write-batch RAF before disposing the terminal
			if (rafIdRef.current) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = 0;
			}
			writeBufferRef.current = '';
			webglAddon?.dispose();
			term.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
	}, []);

	// Update theme when it changes
	useEffect(() => {
		themeRef.current = theme;
		if (terminalRef.current) {
			terminalRef.current.options.theme = mapMaestroThemeToXterm(theme);
		}
	}, [theme]);

	// Update font when it changes
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.options.fontFamily = fontFamily || 'Menlo, Monaco, "Courier New", monospace';
			terminalRef.current.options.fontSize = fontSize;
			fitAddonRef.current?.fit();
		}
	}, [fontFamily, fontSize]);

	// Update cursor when style or blink changes
	useEffect(() => {
		if (terminalRef.current) {
			terminalRef.current.options.cursorStyle = cursorStyle;
			terminalRef.current.options.cursorBlink = cursorBlink;
		}
	}, [cursorStyle, cursorBlink]);

	// Window focus/blur handling:
	// - On focus: re-focus the terminal so typing works immediately after Alt-Tab
	// - On blur: pause cursor blink to reduce visual noise / unnecessary repaints
	useEffect(() => {
		const handleFocus = () => {
			terminalRef.current?.focus();
			if (terminalRef.current && cursorBlink) {
				terminalRef.current.options.cursorBlink = true;
			}
		};
		const handleBlur = () => {
			if (terminalRef.current) {
				terminalRef.current.options.cursorBlink = false;
			}
		};
		window.addEventListener('focus', handleFocus);
		window.addEventListener('blur', handleBlur);
		return () => {
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('blur', handleBlur);
		};
	}, [cursorBlink]);

	// Debounced resize handler
	const handleResize = useCallback(() => {
		if (resizeTimeoutRef.current) {
			clearTimeout(resizeTimeoutRef.current);
		}
		resizeTimeoutRef.current = setTimeout(() => {
			if (fitAddonRef.current && terminalRef.current) {
				fitAddonRef.current.fit();
				const { cols, rows } = terminalRef.current;
				onResize?.(cols, rows);
				window.maestro.process.resize(sessionIdRef.current, cols, rows);
			}
		}, 100);
	}, [onResize]);

	// ResizeObserver for container size changes
	useEffect(() => {
		if (!containerRef.current) return;
		const resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(containerRef.current);
		return () => resizeObserver.disconnect();
	}, [handleResize]);

	// Flush accumulated write buffer to xterm.js terminal
	const flushWriteBuffer = useCallback(() => {
		rafIdRef.current = 0;
		if (writeBufferRef.current && terminalRef.current) {
			terminalRef.current.write(writeBufferRef.current);
			writeBufferRef.current = '';
		}
	}, []);

	// Handle PTY data from main process with RAF batching.
	// Multiple IPC data events arriving within a single animation frame are coalesced
	// into one terminal.write() call, reducing parse/render overhead during heavy output.
	useEffect(() => {
		const unsubscribe = window.maestro.process.onData((sid: string, data: string) => {
			if (sid !== sessionIdRef.current) return;

			writeBufferRef.current += data;

			// Force-flush if buffer exceeds safety threshold (prevents unbounded growth)
			if (writeBufferRef.current.length >= WRITE_BUFFER_FORCE_FLUSH_SIZE) {
				if (rafIdRef.current) {
					cancelAnimationFrame(rafIdRef.current);
				}
				flushWriteBuffer();
				return;
			}

			// Schedule RAF flush if not already pending
			if (!rafIdRef.current) {
				rafIdRef.current = requestAnimationFrame(flushWriteBuffer);
			}
		});
		return () => {
			unsubscribe();
			// Cancel pending RAF and flush remaining data synchronously on unmount
			if (rafIdRef.current) {
				cancelAnimationFrame(rafIdRef.current);
				rafIdRef.current = 0;
			}
			if (writeBufferRef.current && terminalRef.current) {
				terminalRef.current.write(writeBufferRef.current);
				writeBufferRef.current = '';
			}
		};
	}, [flushWriteBuffer]);

	// Handle user input -> main process PTY (or close request if shell exited)
	useEffect(() => {
		if (!terminalRef.current) return;
		const disposable = terminalRef.current.onData((data: string) => {
			if (exitedRef.current) {
				onCloseRequestRef.current?.();
				return;
			}
			window.maestro.process.write(sessionIdRef.current, data);
			onData?.(data);
		});
		return () => disposable.dispose();
	}, [onData]);

	// Handle title change from shell
	useEffect(() => {
		if (!terminalRef.current || !onTitleChange) return;
		const disposable = terminalRef.current.onTitleChange((title: string) => {
			onTitleChange(title);
		});
		return () => disposable.dispose();
	}, [onTitleChange]);

	// Handle PTY exit — show exit message and enable close-on-keypress
	useEffect(() => {
		const unsubscribe = window.maestro.process.onExit((sid: string, code: number) => {
			if (sid === sessionIdRef.current && terminalRef.current) {
				exitedRef.current = true;
				terminalRef.current.write(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m\r\n`);
				terminalRef.current.write('\r\n\x1b[33mShell exited.\x1b[0m Press any key to close, or Ctrl+Shift+` for new terminal.\r\n');
			}
		});
		return unsubscribe;
	}, []);

	// Track the last search query so searchNext/searchPrevious can repeat it
	const lastSearchQueryRef = useRef<string>('');

	// Expose imperative handle for parent components
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
				decorations: buildSearchDecorations(themeRef.current),
			});
		},
		searchNext: () => {
			if (!searchAddonRef.current || !lastSearchQueryRef.current) return false;
			return searchAddonRef.current.findNext(lastSearchQueryRef.current, {
				decorations: buildSearchDecorations(themeRef.current),
			});
		},
		searchPrevious: () => {
			if (!searchAddonRef.current || !lastSearchQueryRef.current) return false;
			return searchAddonRef.current.findPrevious(lastSearchQueryRef.current, {
				decorations: buildSearchDecorations(themeRef.current),
			});
		},
		clearSearch: () => {
			lastSearchQueryRef.current = '';
			searchAddonRef.current?.clearDecorations();
		},
		getSelection: () => terminalRef.current?.getSelection() ?? '',
		resize: () => fitAddonRef.current?.fit(),
	}), []);

	return (
		<div
			ref={containerRef}
			className="w-full h-full"
			style={{ backgroundColor: theme.colors.bgMain }}
		/>
	);
});
