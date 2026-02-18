/**
 * @file TerminalTabRenameModal.test.tsx
 * @description Tests for the TerminalTabRenameModal component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { TerminalTabRenameModal } from '../../../renderer/components/TerminalTabRenameModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import type { Theme } from '../../../renderer/types';

// Create a mock theme for testing
const createMockTheme = (): Theme => ({
	id: 'test-theme',
	name: 'Test Theme',
	mode: 'dark',
	colors: {
		bgMain: '#1a1a1a',
		bgPanel: '#252525',
		bgSidebar: '#202020',
		bgActivity: '#2d2d2d',
		textMain: '#ffffff',
		textDim: '#888888',
		accent: '#0066ff',
		accentForeground: '#ffffff',
		border: '#333333',
		highlight: '#0066ff33',
		success: '#00aa00',
		warning: '#ffaa00',
		error: '#ff0000',
	},
});

// Wrapper component to provide LayerStackContext
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<LayerStackProvider>{children}</LayerStackProvider>
);

describe('TerminalTabRenameModal', () => {
	const mockTheme = createMockTheme();
	let mockOnClose: ReturnType<typeof vi.fn>;
	let mockOnRename: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockOnClose = vi.fn();
		mockOnRename = vi.fn();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	describe('Basic Rendering', () => {
		it('renders the modal with title', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			expect(screen.getByText('Rename Terminal Tab')).toBeInTheDocument();
		});

		it('renders input with initial name', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			expect(input).toHaveValue('My Terminal');
		});

		it('renders Cancel and Rename buttons', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			expect(screen.getByText('Cancel')).toBeInTheDocument();
			expect(screen.getByText('Rename')).toBeInTheDocument();
		});

		it('has proper dialog accessibility attributes', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const dialog = screen.getByRole('dialog');
			expect(dialog).toHaveAttribute('aria-modal', 'true');
			expect(dialog).toHaveAttribute('aria-label', 'Rename Terminal Tab');
		});
	});

	describe('Placeholder and Helper Text', () => {
		it('shows default name as placeholder', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName=""
						defaultName="Terminal 3"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			expect(input).toHaveAttribute('placeholder', 'Terminal 3');
		});

		it('shows helper text with default name', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName=""
						defaultName="Terminal 2"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			expect(screen.getByText('Leave empty to use default name (Terminal 2)')).toBeInTheDocument();
		});
	});

	describe('Button Actions', () => {
		it('calls onClose when Cancel button is clicked', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

			expect(mockOnClose).toHaveBeenCalledTimes(1);
			expect(mockOnRename).not.toHaveBeenCalled();
		});

		it('calls onRename and onClose when Rename button is clicked', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

			expect(mockOnRename).toHaveBeenCalledWith('My Terminal');
			expect(mockOnClose).toHaveBeenCalledTimes(1);
		});
	});

	describe('Input Handling', () => {
		it('updates value when typing', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			fireEvent.change(input, { target: { value: 'Dev Server' } });

			expect(input).toHaveValue('Dev Server');
		});

		it('submits on Enter key', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			fireEvent.keyDown(input, { key: 'Enter' });

			expect(mockOnRename).toHaveBeenCalledWith('My Terminal');
			expect(mockOnClose).toHaveBeenCalledTimes(1);
		});

		it('trims whitespace when submitting', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="  Padded Name  "
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

			expect(mockOnRename).toHaveBeenCalledWith('Padded Name');
		});
	});

	describe('Auto Focus', () => {
		it('input receives focus on mount', async () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');

			await waitFor(() => {
				expect(document.activeElement).toBe(input);
			});
		});
	});

	describe('Edge Cases', () => {
		it('handles empty initial name', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName=""
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			expect(input).toHaveValue('');
		});

		it('handles renaming to empty string (resets to default)', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="My Terminal"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			fireEvent.change(input, { target: { value: '' } });
			fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

			expect(mockOnRename).toHaveBeenCalledWith('');
		});

		it('handles special characters in name', () => {
			render(
				<TestWrapper>
					<TerminalTabRenameModal
						theme={mockTheme}
						initialName="Terminal <script>alert('xss')</script>"
						defaultName="Terminal 1"
						onClose={mockOnClose}
						onRename={mockOnRename}
					/>
				</TestWrapper>
			);

			const input = screen.getByRole('textbox');
			expect(input).toHaveValue("Terminal <script>alert('xss')</script>");
		});
	});
});
