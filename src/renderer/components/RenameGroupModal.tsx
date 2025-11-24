import React, { useState } from 'react';
import { X } from 'lucide-react';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import type { Theme, Group } from '../types';

interface RenameGroupModalProps {
  theme: Theme;
  groupId: string;
  groupName: string;
  setGroupName: (name: string) => void;
  groupEmoji: string;
  setGroupEmoji: (emoji: string) => void;
  onClose: () => void;
  groups: Group[];
  setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
}

export function RenameGroupModal(props: RenameGroupModalProps) {
  const {
    theme, groupId, groupName, setGroupName, groupEmoji, setGroupEmoji,
    onClose, groups, setGroups
  } = props;

  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const handleRename = () => {
    if (groupName.trim() && groupId) {
      setGroups(prev => prev.map(g =>
        g.id === groupId ? { ...g, name: groupName.trim().toUpperCase(), emoji: groupEmoji } : g
      ));
      setEmojiPickerOpen(false);
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
          <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Rename Group</h2>
          <button onClick={onClose} style={{ color: theme.colors.textDim }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">
          <div className="flex gap-4 items-end">
            {/* Emoji Selector - Left Side */}
            <div className="flex flex-col gap-2">
              <label className="block text-xs font-bold opacity-70 uppercase" style={{ color: theme.colors.textMain }}>
                Icon
              </label>
              <button
                onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                className="p-3 rounded border bg-transparent text-3xl hover:bg-white/5 transition-colors w-16 h-[52px] flex items-center justify-center"
                style={{ borderColor: theme.colors.border }}
                type="button"
              >
                {groupEmoji}
              </button>
            </div>

            {/* Group Name Input - Right Side */}
            <div className="flex-1 flex flex-col gap-2">
              <label className="block text-xs font-bold opacity-70 uppercase" style={{ color: theme.colors.textMain }}>
                Group Name
              </label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onClose();
                  }
                }}
                placeholder="Enter group name..."
                className="w-full p-3 rounded border bg-transparent outline-none h-[52px]"
                style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                autoFocus={!emojiPickerOpen}
              />
            </div>
          </div>

          {/* Emoji Picker Overlay */}
          {emojiPickerOpen && (
            <div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]"
              onClick={() => setEmojiPickerOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEmojiPickerOpen(false);
                }
              }}
              tabIndex={0}
              ref={(el) => el?.focus()}
            >
              <div
                className="rounded-lg border-2 shadow-2xl overflow-visible relative"
                style={{ borderColor: theme.colors.accent, backgroundColor: theme.colors.bgSidebar }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Close button */}
                <button
                  onClick={() => setEmojiPickerOpen(false)}
                  className="absolute -top-3 -right-3 z-10 p-2 rounded-full shadow-lg hover:scale-110 transition-transform"
                  style={{ backgroundColor: theme.colors.bgSidebar, color: theme.colors.textMain, border: `2px solid ${theme.colors.border}` }}
                >
                  <X className="w-4 h-4" />
                </button>
                <Picker
                  data={data}
                  onEmojiSelect={(emoji: any) => {
                    setGroupEmoji(emoji.native);
                    setEmojiPickerOpen(false);
                  }}
                  theme={theme.mode}
                  previewPosition="none"
                  searchPosition="sticky"
                  perLine={9}
                  set="native"
                  autoFocus
                />
              </div>
            </div>
          )}
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
              disabled={!groupName.trim()}
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
