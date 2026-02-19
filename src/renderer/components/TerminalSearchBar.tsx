/**
 * TerminalSearchBar - Floating search bar for xterm.js terminal
 *
 * Features:
 * - Positioned top-right, similar to VS Code terminal search
 * - Incremental search as you type
 * - Enter/Shift+Enter for next/previous match
 * - Escape to close (returns focus to terminal)
 * - "No results" indicator when query doesn't match
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { Theme } from '../types';

interface TerminalSearchBarProps {
	theme: Theme;
	isOpen: boolean;
	onClose: () => void;
	onSearch: (query: string) => boolean;
	onSearchNext: () => boolean;
	onSearchPrevious: () => boolean;
}

export const TerminalSearchBar = memo(function TerminalSearchBar({
	theme,
	isOpen,
	onClose,
	onSearch,
	onSearchNext,
	onSearchPrevious,
}: TerminalSearchBarProps) {
	const [query, setQuery] = useState('');
	const [hasResults, setHasResults] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus input when opened
	useEffect(() => {
		if (isOpen && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isOpen]);

	// Search as user types
	useEffect(() => {
		if (isOpen && query) {
			const found = onSearch(query);
			setHasResults(found);
		} else {
			setHasResults(false);
		}
	}, [query, onSearch, isOpen]);

	// Reset query when closed
	useEffect(() => {
		if (!isOpen) {
			setQuery('');
			setHasResults(false);
		}
	}, [isOpen]);

	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) {
				const found = onSearchPrevious();
				setHasResults(found);
			} else {
				const found = onSearchNext();
				setHasResults(found);
			}
		}
	}, [onClose, onSearchNext, onSearchPrevious]);

	if (!isOpen) return null;

	return (
		<div
			className="absolute top-2 right-2 z-50 flex items-center gap-1 px-2 py-1.5 rounded-md shadow-lg border"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
			onKeyDown={(e) => {
				// Prevent xterm.js from capturing keyboard events while search is focused
				e.stopPropagation();
			}}
		>
			<Search
				className="w-4 h-4 flex-shrink-0"
				style={{ color: theme.colors.textDim }}
			/>

			<input
				ref={inputRef}
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Search..."
				className="w-48 px-2 py-0.5 text-sm bg-transparent outline-none"
				style={{ color: theme.colors.textMain }}
			/>

			{query && (
				<span
					className="text-xs px-1 whitespace-nowrap"
					style={{ color: hasResults ? theme.colors.textDim : theme.colors.error }}
				>
					{hasResults ? '' : 'No results'}
				</span>
			)}

			<button
				onClick={onSearchPrevious}
				disabled={!hasResults}
				className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
				title="Previous match (Shift+Enter)"
			>
				<ChevronUp className="w-4 h-4" style={{ color: theme.colors.textMain }} />
			</button>
			<button
				onClick={onSearchNext}
				disabled={!hasResults}
				className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
				title="Next match (Enter)"
			>
				<ChevronDown className="w-4 h-4" style={{ color: theme.colors.textMain }} />
			</button>

			<button
				onClick={onClose}
				className="p-0.5 rounded hover:bg-white/10 ml-1"
				title="Close (Escape)"
			>
				<X className="w-4 h-4" style={{ color: theme.colors.textDim }} />
			</button>
		</div>
	);
});
