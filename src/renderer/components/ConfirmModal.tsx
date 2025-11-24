import React from 'react';
import { X } from 'lucide-react';
import type { Theme } from '../types';

interface ConfirmModalProps {
  theme: Theme;
  message: string;
  onConfirm: (() => void) | null;
  onClose: () => void;
}

export function ConfirmModal({ theme, message, onConfirm, onClose }: ConfirmModalProps) {
  return (
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
      tabIndex={0}
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (onConfirm) {
            onConfirm();
          }
          onClose();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else {
          e.stopPropagation();
        }
      }}
    >
      <div className="w-[450px] border rounded-lg shadow-2xl overflow-hidden" style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: theme.colors.border }}>
          <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Confirm Action</h2>
          <button onClick={onClose} style={{ color: theme.colors.textDim }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-sm leading-relaxed" style={{ color: theme.colors.textMain }}>
            {message}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded border hover:bg-white/5 transition-colors"
              style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (onConfirm) {
                  onConfirm();
                }
                onClose();
              }}
              className="px-4 py-2 rounded text-white"
              style={{ backgroundColor: theme.colors.error }}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
