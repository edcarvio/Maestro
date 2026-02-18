/**
 * TerminalSearchBar — In-terminal search overlay for xterm.js scrollback
 *
 * Renders a floating search bar above the terminal. Drives the xterm.js
 * SearchAddon via the EmbeddedTerminalHandle imperative ref. Supports:
 * - Incremental search as the user types
 * - Enter/Shift+Enter for next/previous match
 * - Up/Down arrows for next/previous match
 * - Escape to close and return focus to terminal
 * - Layer stack integration for proper Escape key handling
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { Theme } from '../../types';
import type { EmbeddedTerminalHandle } from './EmbeddedTerminal';
import { useLayerStack } from '../../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';

interface TerminalSearchBarProps {
	terminalRef: React.RefObject<EmbeddedTerminalHandle | null>;
	theme: Theme;
	onClose: () => void;
}

const TERMINAL_SEARCH_PRIORITY = MODAL_PRIORITIES.TERMINAL_SEARCH;

export function TerminalSearchBar({ terminalRef, theme, onClose }: TerminalSearchBarProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const queryRef = useRef('');
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();

	const handleClose = useCallback(() => {
		terminalRef.current?.clearSearch();
		terminalRef.current?.focus();
		onClose();
	}, [terminalRef, onClose]);

	// Register with layer stack
	useEffect(() => {
		layerIdRef.current = registerLayer({
			type: 'overlay',
			priority: TERMINAL_SEARCH_PRIORITY,
			blocksLowerLayers: false,
			capturesFocus: true,
			focusTrap: 'none',
			onEscape: handleClose,
			allowClickOutside: true,
			ariaLabel: 'Terminal Search',
		});

		return () => {
			if (layerIdRef.current) {
				unregisterLayer(layerIdRef.current);
			}
		};
	}, [registerLayer, unregisterLayer, handleClose]);

	// Update handler when dependencies change
	useEffect(() => {
		if (layerIdRef.current) {
			updateLayerHandler(layerIdRef.current, handleClose);
		}
	}, [handleClose, updateLayerHandler]);

	// Auto-focus the input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		queryRef.current = value;
		if (value) {
			terminalRef.current?.search(value);
		} else {
			terminalRef.current?.clearSearch();
		}
	}, [terminalRef]);

	const handleNext = useCallback(() => {
		terminalRef.current?.searchNext();
	}, [terminalRef]);

	const handlePrevious = useCallback(() => {
		terminalRef.current?.searchPrevious();
	}, [terminalRef]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				handlePrevious();
			} else {
				handleNext();
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			handlePrevious();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			handleNext();
		}
		// Escape is handled by layer stack
	}, [handleNext, handlePrevious]);

	return (
		<div
			className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded px-2 py-1 shadow-lg border"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
		>
			<input
				ref={inputRef}
				type="text"
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				placeholder="Search..."
				className="bg-transparent outline-none text-sm w-48"
				style={{ color: theme.colors.textMain }}
			/>
			<button
				onClick={handlePrevious}
				className="p-0.5 rounded hover:opacity-80"
				title="Previous match (Shift+Enter)"
				style={{ color: theme.colors.textDim }}
			>
				<ChevronUp className="w-4 h-4" />
			</button>
			<button
				onClick={handleNext}
				className="p-0.5 rounded hover:opacity-80"
				title="Next match (Enter)"
				style={{ color: theme.colors.textDim }}
			>
				<ChevronDown className="w-4 h-4" />
			</button>
			<button
				onClick={handleClose}
				className="p-0.5 rounded hover:opacity-80"
				title="Close (Esc)"
				style={{ color: theme.colors.textDim }}
			>
				<X className="w-4 h-4" />
			</button>
		</div>
	);
}
