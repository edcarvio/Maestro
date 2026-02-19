import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalSearchBar } from '../../../renderer/components/TerminalSearchBar';
import type { Theme } from '../../../renderer/types';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
	Search: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="search-icon" className={className} style={style}>
			Search
		</span>
	),
	X: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="x-icon" className={className} style={style}>
			X
		</span>
	),
	ChevronUp: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevron-up-icon" className={className} style={style}>
			Up
		</span>
	),
	ChevronDown: ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
		<span data-testid="chevron-down-icon" className={className} style={style}>
			Down
		</span>
	),
}));

const theme: Theme = {
	id: 'dracula' as any,
	name: 'Dracula',
	mode: 'dark',
	colors: {
		bgMain: '#282a36',
		bgSidebar: '#21222c',
		bgActivity: '#343746',
		border: '#6272a4',
		textMain: '#f8f8f2',
		textDim: '#6272a4',
		accent: '#bd93f9',
		accentDim: 'rgba(189, 147, 249, 0.3)',
		accentText: '#bd93f9',
		accentForeground: '#ffffff',
		success: '#50fa7b',
		warning: '#f1fa8c',
		error: '#ff5555',
	},
};

describe('TerminalSearchBar', () => {
	let onClose: ReturnType<typeof vi.fn>;
	let onSearch: ReturnType<typeof vi.fn>;
	let onSearchNext: ReturnType<typeof vi.fn>;
	let onSearchPrevious: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onClose = vi.fn();
		onSearch = vi.fn().mockReturnValue(true);
		onSearchNext = vi.fn().mockReturnValue(true);
		onSearchPrevious = vi.fn().mockReturnValue(true);
	});

	it('does not render when isOpen is false', () => {
		const { container } = render(
			<TerminalSearchBar
				theme={theme}
				isOpen={false}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		expect(container.innerHTML).toBe('');
	});

	it('renders search input when isOpen is true', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
	});

	it('focuses input when opened', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		expect(document.activeElement).toBe(input);
	});

	it('calls onSearch when user types', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'hello' } });
		expect(onSearch).toHaveBeenCalledWith('hello');
	});

	it('calls onClose when Escape is pressed', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.keyDown(input, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onSearchNext when Enter is pressed', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'test' } });
		fireEvent.keyDown(input, { key: 'Enter' });
		expect(onSearchNext).toHaveBeenCalledTimes(1);
	});

	it('calls onSearchPrevious when Shift+Enter is pressed', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'test' } });
		fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
		expect(onSearchPrevious).toHaveBeenCalledTimes(1);
	});

	it('shows "No results" when search returns false', () => {
		onSearch.mockReturnValue(false);
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'nonexistent' } });
		expect(screen.getByText('No results')).toBeTruthy();
	});

	it('disables navigation buttons when no results', () => {
		onSearch.mockReturnValue(false);
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'nonexistent' } });

		const prevButton = screen.getByTitle('Previous match (Shift+Enter)');
		const nextButton = screen.getByTitle('Next match (Enter)');
		expect(prevButton).toHaveProperty('disabled', true);
		expect(nextButton).toHaveProperty('disabled', true);
	});

	it('enables navigation buttons when results found', () => {
		onSearch.mockReturnValue(true);
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'found' } });

		const prevButton = screen.getByTitle('Previous match (Shift+Enter)');
		const nextButton = screen.getByTitle('Next match (Enter)');
		expect(prevButton).toHaveProperty('disabled', false);
		expect(nextButton).toHaveProperty('disabled', false);
	});

	it('calls onClose when close button is clicked', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const closeButton = screen.getByTitle('Close (Escape)');
		fireEvent.click(closeButton);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onSearchPrevious when up button is clicked', () => {
		onSearch.mockReturnValue(true);
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'test' } });

		const prevButton = screen.getByTitle('Previous match (Shift+Enter)');
		fireEvent.click(prevButton);
		expect(onSearchPrevious).toHaveBeenCalledTimes(1);
	});

	it('calls onSearchNext when down button is clicked', () => {
		onSearch.mockReturnValue(true);
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'test' } });

		const nextButton = screen.getByTitle('Next match (Enter)');
		fireEvent.click(nextButton);
		expect(onSearchNext).toHaveBeenCalledTimes(1);
	});

	it('resets query when closed and reopened', () => {
		const { rerender } = render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		fireEvent.change(input, { target: { value: 'test' } });
		expect((input as HTMLInputElement).value).toBe('test');

		// Close
		rerender(
			<TerminalSearchBar
				theme={theme}
				isOpen={false}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);

		// Reopen
		rerender(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const reopenedInput = screen.getByPlaceholderText('Search...');
		expect((reopenedInput as HTMLInputElement).value).toBe('');
	});

	it('uses theme colors for styling', () => {
		render(
			<TerminalSearchBar
				theme={theme}
				isOpen={true}
				onClose={onClose}
				onSearch={onSearch}
				onSearchNext={onSearchNext}
				onSearchPrevious={onSearchPrevious}
			/>
		);
		const input = screen.getByPlaceholderText('Search...');
		// jsdom normalises hex to rgb, so just check that the style is set
		expect(input.style.color).toBeTruthy();
	});
});
