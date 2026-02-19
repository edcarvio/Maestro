/**
 * XTerminal - xterm.js wrapper component for full terminal emulation
 *
 * Manages:
 * - xterm.js Terminal instance lifecycle
 * - Addon loading (fit, webgl, web-links, search, unicode11)
 * - IPC communication with main process PTY
 * - Resize handling with debouncing
 * - Theme synchronization with Maestro themes
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

interface XTerminalProps {
	sessionId: string;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	onData?: (data: string) => void;
	onResize?: (cols: number, rows: number) => void;
	onTitleChange?: (title: string) => void;
}

export interface XTerminalHandle {
	write: (data: string) => void;
	focus: () => void;
	clear: () => void;
	scrollToBottom: () => void;
	search: (query: string) => boolean;
	searchNext: () => boolean;
	searchPrevious: () => boolean;
	getSelection: () => string;
	resize: () => void;
}

/**
 * Map Maestro theme colors to xterm.js ITheme.
 * Uses theme semantic colors with sensible ANSI defaults.
 */
function mapMaestroThemeToXterm(theme: Theme) {
	const isDark = theme.mode !== 'light';
	return {
		background: theme.colors.bgMain,
		foreground: theme.colors.textMain,
		cursor: theme.colors.textMain,
		cursorAccent: theme.colors.bgMain,
		selectionBackground: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)',
		selectionForeground: undefined,
		// ANSI color palette - sensible defaults for both light and dark themes
		black: isDark ? '#1e1e1e' : '#000000',
		red: '#e06c75',
		green: '#98c379',
		yellow: '#e5c07b',
		blue: '#61afef',
		magenta: '#c678dd',
		cyan: '#56b6c2',
		white: isDark ? '#abb2bf' : '#d4d4d4',
		brightBlack: '#5c6370',
		brightRed: '#e06c75',
		brightGreen: '#98c379',
		brightYellow: '#e5c07b',
		brightBlue: '#61afef',
		brightMagenta: '#c678dd',
		brightCyan: '#56b6c2',
		brightWhite: '#ffffff',
	};
}

export const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(function XTerminal(
	{ sessionId, theme, fontFamily, fontSize = 14, onData, onResize, onTitleChange },
	ref
) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const searchAddonRef = useRef<SearchAddon | null>(null);
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sessionIdRef = useRef(sessionId);

	// Keep sessionId ref current for IPC callbacks
	useEffect(() => {
		sessionIdRef.current = sessionId;
	}, [sessionId]);

	// Initialize xterm.js terminal
	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			cursorBlink: true,
			cursorStyle: 'block',
			fontFamily: fontFamily || 'Menlo, Monaco, "Courier New", monospace',
			fontSize,
			theme: mapMaestroThemeToXterm(theme),
			allowProposedApi: true,
			scrollback: 10000,
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
			webglAddon?.dispose();
			term.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			searchAddonRef.current = null;
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Update theme when it changes
	useEffect(() => {
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

	// Handle PTY data from main process
	useEffect(() => {
		const unsubscribe = window.maestro.process.onData((sid: string, data: string) => {
			if (sid === sessionIdRef.current && terminalRef.current) {
				terminalRef.current.write(data);
			}
		});
		return unsubscribe;
	}, []);

	// Handle user input -> main process PTY
	useEffect(() => {
		if (!terminalRef.current) return;
		const disposable = terminalRef.current.onData((data: string) => {
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

	// Handle PTY exit
	useEffect(() => {
		const unsubscribe = window.maestro.process.onExit((sid: string, code: number) => {
			if (sid === sessionIdRef.current && terminalRef.current) {
				terminalRef.current.write(`\r\n\x1b[2m[Process exited with code ${code}]\x1b[0m\r\n`);
			}
		});
		return unsubscribe;
	}, []);

	// Expose imperative handle for parent components
	useImperativeHandle(ref, () => ({
		write: (data: string) => terminalRef.current?.write(data),
		focus: () => terminalRef.current?.focus(),
		clear: () => terminalRef.current?.clear(),
		scrollToBottom: () => terminalRef.current?.scrollToBottom(),
		search: (query: string) => searchAddonRef.current?.findNext(query) ?? false,
		searchNext: () => searchAddonRef.current?.findNext('') ?? false,
		searchPrevious: () => searchAddonRef.current?.findPrevious('') ?? false,
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
