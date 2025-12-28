/**
 * Tests for GistPublishModal component
 *
 * Tests the core behavior of the gist publishing modal:
 * - Rendering with filename and options
 * - Button click handlers (Publish Secret, Publish Public, Cancel)
 * - Focus management (default focus on Secret button)
 * - Loading and error states
 * - API integration
 * - Layer stack integration
 * - Accessibility
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GistPublishModal } from '../../../renderer/components/GistPublishModal';
import { LayerStackProvider } from '../../../renderer/contexts/LayerStackContext';
import type { Theme } from '../../../renderer/types';

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Share2: () => <svg data-testid="share-icon" />,
  X: () => <svg data-testid="x-icon" />,
}));

// Mock window.maestro.git.createGist
const mockCreateGist = vi.fn();

beforeEach(() => {
  (window as any).maestro = {
    git: {
      createGist: mockCreateGist,
    },
  };
});

// Create a test theme
const testTheme: Theme = {
  id: 'test-theme',
  name: 'Test Theme',
  mode: 'dark',
  colors: {
    bgMain: '#1e1e1e',
    bgSidebar: '#252526',
    bgActivity: '#333333',
    textMain: '#d4d4d4',
    textDim: '#808080',
    accent: '#007acc',
    accentForeground: '#ffffff',
    border: '#404040',
    error: '#f14c4c',
    warning: '#cca700',
    success: '#89d185',
    info: '#3794ff',
    textInverse: '#000000',
  },
};

// Helper to render with LayerStackProvider
const renderWithLayerStack = (ui: React.ReactElement) => {
  return render(<LayerStackProvider>{ui}</LayerStackProvider>);
};

describe('GistPublishModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGist.mockResolvedValue({ success: true, gistUrl: 'https://gist.github.com/test123' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rendering', () => {
    it('renders with filename and all buttons', () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test-file.md"
          content="# Test content"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText('Publish as GitHub Gist')).toBeInTheDocument();
      expect(screen.getByText('test-file.md')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Publish Public' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Publish Secret' })).toBeInTheDocument();
    });

    it('renders visibility explanations', () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText(/Not searchable, only accessible via direct link/)).toBeInTheDocument();
      expect(screen.getByText(/Visible on your public profile and searchable/)).toBeInTheDocument();
    });

    it('renders share icon in header', () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByTestId('share-icon')).toBeInTheDocument();
    });
  });

  describe('focus management', () => {
    it('focuses Publish Secret button on mount', async () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish Secret' }));
      });
    });
  });

  describe('button handlers', () => {
    it('calls onClose when Cancel is clicked', () => {
      const onClose = vi.fn();
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={onClose}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls createGist with isPublic=false when Publish Secret is clicked', async () => {
      const onSuccess = vi.fn();
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(mockCreateGist).toHaveBeenCalledWith('test.js', 'const x = 1;', '', false);
      });
    });

    it('calls createGist with isPublic=true when Publish Public is clicked', async () => {
      const onSuccess = vi.fn();
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Public' }));

      await waitFor(() => {
        expect(mockCreateGist).toHaveBeenCalledWith('test.js', 'const x = 1;', '', true);
      });
    });

    it('calls onSuccess with gistUrl and isPublic=false for secret gist', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      mockCreateGist.mockResolvedValue({ success: true, gistUrl: 'https://gist.github.com/secret123' });

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith('https://gist.github.com/secret123', false);
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('calls onSuccess with gistUrl and isPublic=true for public gist', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      mockCreateGist.mockResolvedValue({ success: true, gistUrl: 'https://gist.github.com/public123' });

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Public' }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith('https://gist.github.com/public123', true);
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('loading state', () => {
    it('shows Publishing... text while loading', async () => {
      // Make createGist hang
      mockCreateGist.mockImplementation(() => new Promise(() => {}));

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Publishing...' })).toBeInTheDocument();
      });
    });

    it('disables all buttons while publishing', async () => {
      mockCreateGist.mockImplementation(() => new Promise(() => {}));

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Publish Public' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Publishing...' })).toBeDisabled();
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when createGist fails', async () => {
      mockCreateGist.mockResolvedValue({ success: false, error: 'GitHub CLI not authenticated' });

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByText('GitHub CLI not authenticated')).toBeInTheDocument();
      });
    });

    it('displays error message when createGist throws', async () => {
      mockCreateGist.mockRejectedValue(new Error('Network error'));

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('re-enables buttons after error', async () => {
      mockCreateGist.mockResolvedValue({ success: false, error: 'Failed' });

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });

      // Buttons should be re-enabled
      expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Publish Public' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Publish Secret' })).not.toBeDisabled();
    });

    it('does not call onSuccess or onClose on error', async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      mockCreateGist.mockResolvedValue({ success: false, error: 'Failed' });

      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Publish Secret' }));

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('layer stack integration', () => {
    it('registers and unregisters without errors', () => {
      const { unmount } = renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText('Publish as GitHub Gist')).toBeInTheDocument();
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('accessibility', () => {
    it('has semantic button elements', () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      // Cancel, Publish Public, Publish Secret, and X (close) buttons
      expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(3);
    });

    it('has heading for modal title', () => {
      renderWithLayerStack(
        <GistPublishModal
          theme={testTheme}
          filename="test.js"
          content="const x = 1;"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      );

      expect(screen.getByText('Publish as GitHub Gist')).toBeInTheDocument();
    });
  });
});
