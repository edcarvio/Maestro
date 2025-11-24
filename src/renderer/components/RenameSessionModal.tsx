import React from 'react';
import { X } from 'lucide-react';
import type { Theme, Session } from '../types';

interface RenameSessionModalProps {
  theme: Theme;
  value: string;
  setValue: (value: string) => void;
  onClose: () => void;
  sessions: Session[];
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  activeSessionId: string;
}

export function RenameSessionModal(props: RenameSessionModalProps) {
  const { theme, value, setValue, onClose, sessions, setSessions, activeSessionId } = props;

  const handleRename = () => {
    if (value.trim()) {
      setSessions(prev => prev.map(s =>
        s.id === activeSessionId ? { ...s, name: value.trim() } : s
      ));
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') {
          e.stopPropagation();
        }
      }}
    >
      <div className="w-[400px] border rounded-lg shadow-2xl overflow-hidden" style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: theme.colors.border }}>
          <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Rename Instance</h2>
          <button onClick={onClose} style={{ color: theme.colors.textDim }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Enter agent name..."
            className="w-full p-3 rounded border bg-transparent outline-none"
            style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded border hover:bg-white/5 transition-colors"
              style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
            >
              Cancel
            </button>
            <button
              onClick={handleRename}
              disabled={!value.trim()}
              className="px-4 py-2 rounded text-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: theme.colors.accent }}
            >
              Rename
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
