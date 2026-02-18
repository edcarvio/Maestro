/**
 * XTerminal - xterm.js wrapper component for full terminal emulation
 *
 * Manages:
 * - xterm.js Terminal instance lifecycle
 * - Addon loading (fit, webgl, web-links, search, unicode11)
 * - IPC communication with main process PTY via onRawPtyData
 * - Resize handling with debouncing via ResizeObserver
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
import type { ITheme } from '@xterm/xterm';

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
	clearSearch: () => void;
	getSelection: () => string;
	resize: () => void;
}

/**
 * Map Maestro theme colors to xterm.js ITheme.
 * Falls back to sensible ANSI defaults when theme doesn't define terminal-specific colors.
 */
function mapMaestroThemeToXterm(theme: Theme): ITheme {
	const colors = theme.colors;
	return {
		background: colors.bgMain,
		foreground: colors.textMain,
		cursor: colors.textMain,
		cursorAccent: colors.bgMain,
		selectionBackground: 'rgba(255, 255, 255, 0.3)',
		selectionForeground: colors.textMain,
		// ANSI color palette — use theme accent/status colors where meaningful,
		// fall back to One Dark defaults for a consistent terminal experience
		black: '#000000',
		red: colors.error || '#e06c75',
		green: colors.success || '#98c379',
		yellow: colors.warning || '#e5c07b',
		blue: colors.accent || '#61afef',
		magenta: '#c678dd',
		cyan: '#56b6c2',
		white: '#abb2bf',
		brightBlack: '#5c6370',
		brightRed: colors.error || '#e06c75',
		brightGreen: colors.success || '#98c379',
		brightYellow: colors.warning || '#e5c07b',
		brightBlue: colors.accent || '#61afef',
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
	const webglAddonRef = useRef<WebglAddon | null>(null);
	const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSearchTermRef = useRef<string>('');

	// Initialize xterm.js terminal and addons
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

		// Mount to DOM
		term.open(containerRef.current);
		fitAddon.fit();

		// WebGL addon — load after open() for canvas access, with fallback
		let webglAddon: WebglAddon | null = null;
		try {
			webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon?.dispose();
				webglAddonRef.current = null;
			});
			term.loadAddon(webglAddon);
		} catch {
			// Canvas renderer fallback — WebGL not available on this system
		}

		// Store refs
		terminalRef.current = term;
		fitAddonRef.current = fitAddon;
		searchAddonRef.current = searchAddon;
		webglAddonRef.current = webglAddon;

		return () => {
			webglAddon?.dispose();
			term.dispose();
			terminalRef.current = null;
			fitAddonRef.current = null;
			searchAddonRef.current = null;
			webglAddonRef.current = null;
		};
	}, []);

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

	// Title change handler
	useEffect(() => {
		if (!terminalRef.current || !onTitleChange) return;
		const disposable = terminalRef.current.onTitleChange(onTitleChange);
		return () => disposable.dispose();
	}, [onTitleChange]);

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
				window.maestro.process.resize(sessionId, cols, rows);
			}
		}, 100);
	}, [sessionId, onResize]);

	// ResizeObserver for container size changes
	useEffect(() => {
		if (!containerRef.current) return;
		const resizeObserver = new ResizeObserver(handleResize);
		resizeObserver.observe(containerRef.current);
		return () => {
			resizeObserver.disconnect();
			if (resizeTimeoutRef.current) {
				clearTimeout(resizeTimeoutRef.current);
			}
		};
	}, [handleResize]);

	// Handle data from PTY (main process -> renderer) via raw channel
	useEffect(() => {
		const unsubscribe = window.maestro.process.onRawPtyData((sid, data) => {
			if (sid === sessionId && terminalRef.current) {
				terminalRef.current.write(data);
			}
		});
		return unsubscribe;
	}, [sessionId]);

	// Handle user input (renderer -> main process)
	useEffect(() => {
		if (!terminalRef.current) return;
		const disposable = terminalRef.current.onData((data) => {
			window.maestro.process.write(sessionId, data);
			onData?.(data);
		});
		return () => disposable.dispose();
	}, [sessionId, onData]);

	// Imperative handle for parent component control
	useImperativeHandle(ref, () => ({
		write: (data: string) => terminalRef.current?.write(data),
		focus: () => terminalRef.current?.focus(),
		clear: () => terminalRef.current?.clear(),
		scrollToBottom: () => terminalRef.current?.scrollToBottom(),
		search: (query: string) => {
			lastSearchTermRef.current = query;
			return searchAddonRef.current?.findNext(query, { decorations: { matchBackground: '#555555', matchOverviewRuler: '#888888', activeMatchBackground: '#ffff00', activeMatchColorOverviewRuler: '#ffff00' } }) ?? false;
		},
		searchNext: () => {
			if (!lastSearchTermRef.current) return false;
			return searchAddonRef.current?.findNext(lastSearchTermRef.current) ?? false;
		},
		searchPrevious: () => {
			if (!lastSearchTermRef.current) return false;
			return searchAddonRef.current?.findPrevious(lastSearchTermRef.current) ?? false;
		},
		clearSearch: () => {
			lastSearchTermRef.current = '';
			searchAddonRef.current?.clearDecorations();
		},
		getSelection: () => terminalRef.current?.getSelection() ?? '',
		resize: () => fitAddonRef.current?.fit(),
	}), []);

	return (
		<div
			ref={containerRef}
			style={{ width: '100%', height: '100%' }}
			tabIndex={-1}
		/>
	);
});
