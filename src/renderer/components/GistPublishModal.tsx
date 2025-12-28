import React, { useRef, useState, useCallback } from 'react';
import { Share2 } from 'lucide-react';
import type { Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';

interface GistPublishModalProps {
  theme: Theme;
  filename: string;
  content: string;
  onClose: () => void;
  onSuccess: (gistUrl: string, isPublic: boolean) => void;
}

/**
 * Modal for publishing a file as a GitHub Gist.
 * Offers three options: Publish Secret (default), Publish Public, or Cancel.
 * The default option (Secret) is focused for Enter key submission.
 */
export function GistPublishModal({
  theme,
  filename,
  content,
  onClose,
  onSuccess,
}: GistPublishModalProps) {
  const secretButtonRef = useRef<HTMLButtonElement>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = useCallback(async (isPublic: boolean) => {
    setIsPublishing(true);
    setError(null);

    try {
      const result = await window.maestro.git.createGist(
        filename,
        content,
        '', // No description - file name serves as context
        isPublic
      );

      if (result.success && result.gistUrl) {
        onSuccess(result.gistUrl, isPublic);
        onClose();
      } else {
        setError(result.error || 'Failed to create gist');
        setIsPublishing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create gist');
      setIsPublishing(false);
    }
  }, [filename, content, onSuccess, onClose]);

  const handlePublishSecret = useCallback(() => {
    handlePublish(false);
  }, [handlePublish]);

  const handlePublishPublic = useCallback(() => {
    handlePublish(true);
  }, [handlePublish]);

  return (
    <Modal
      theme={theme}
      title="Publish as GitHub Gist"
      headerIcon={<Share2 className="w-4 h-4" style={{ color: theme.colors.accent }} />}
      priority={MODAL_PRIORITIES.GIST_PUBLISH}
      onClose={onClose}
      width={450}
      zIndex={10000}
      initialFocusRef={secretButtonRef}
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className="px-4 py-2 rounded border hover:bg-white/5 transition-colors outline-none focus:ring-2 focus:ring-offset-1"
            style={{
              borderColor: theme.colors.border,
              color: theme.colors.textMain,
              opacity: isPublishing ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePublishPublic}
              disabled={isPublishing}
              className="px-4 py-2 rounded border hover:bg-white/5 transition-colors outline-none focus:ring-2 focus:ring-offset-1"
              style={{
                borderColor: theme.colors.border,
                color: theme.colors.textMain,
                opacity: isPublishing ? 0.5 : 1,
              }}
            >
              Publish Public
            </button>
            <button
              ref={secretButtonRef}
              type="button"
              onClick={handlePublishSecret}
              disabled={isPublishing}
              className="px-4 py-2 rounded transition-colors outline-none focus:ring-2 focus:ring-offset-1"
              style={{
                backgroundColor: theme.colors.accent,
                color: theme.colors.accentForeground,
                opacity: isPublishing ? 0.5 : 1,
              }}
            >
              {isPublishing ? 'Publishing...' : 'Publish Secret'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: theme.colors.textMain }}>
          Publish <span className="font-medium" style={{ color: theme.colors.accent }}>{filename}</span> as a GitHub Gist?
        </p>

        <div className="text-xs space-y-2" style={{ color: theme.colors.textDim }}>
          <p>
            <span className="font-medium" style={{ color: theme.colors.textMain }}>Secret:</span>{' '}
            Not searchable, only accessible via direct link
          </p>
          <p>
            <span className="font-medium" style={{ color: theme.colors.textMain }}>Public:</span>{' '}
            Visible on your public profile and searchable
          </p>
        </div>

        {error && (
          <div
            className="px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: `${theme.colors.error}20`,
              color: theme.colors.error,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
