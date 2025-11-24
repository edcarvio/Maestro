import React from 'react';
import { X, Wand2, ExternalLink, FileCode } from 'lucide-react';
import type { Theme } from '../types';

interface AboutModalProps {
  theme: Theme;
  onClose: () => void;
}

export function AboutModal({ theme, onClose }: AboutModalProps) {
  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="w-[450px] border rounded-lg shadow-2xl overflow-hidden" style={{ backgroundColor: theme.colors.bgSidebar, borderColor: theme.colors.border }}>
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: theme.colors.border }}>
          <h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>About Maestro</h2>
          <button onClick={onClose} style={{ color: theme.colors.textDim }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Logo and Title */}
          <div className="flex items-center gap-4">
            <Wand2 className="w-12 h-12" style={{ color: theme.colors.accent }} />
            <div>
              <h1 className="text-2xl font-bold tracking-widest" style={{ color: theme.colors.textMain }}>MAESTRO</h1>
              <p className="text-xs opacity-70" style={{ color: theme.colors.textDim }}>Agent Orchestration Command Center</p>
            </div>
          </div>

          {/* Author Section */}
          <div className="flex items-center gap-4 p-4 rounded border" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgActivity }}>
            <img
              src="https://avatars.githubusercontent.com/u/1253573?v=4"
              alt="Pedram Amini"
              className="w-16 h-16 rounded-full border-2"
              style={{ borderColor: theme.colors.accent }}
            />
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: theme.colors.textMain }}>Pedram Amini</div>
              <div className="text-xs opacity-70 mb-2" style={{ color: theme.colors.textDim }}>Founder, Hacker, Investor, Advisor</div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => window.maestro.shell.openExternal('https://github.com/pedramamini')}
                  className="inline-flex items-center gap-1 text-xs hover:underline cursor-pointer text-left"
                  style={{ color: theme.colors.accent, background: 'none', border: 'none', padding: 0 }}
                >
                  <ExternalLink className="w-3 h-3" />
                  GitHub Profile
                </button>
                <button
                  onClick={() => window.maestro.shell.openExternal('https://www.linkedin.com/in/pedramamini/')}
                  className="inline-flex items-center gap-1 text-xs hover:underline cursor-pointer text-left"
                  style={{ color: theme.colors.accent, background: 'none', border: 'none', padding: 0 }}
                >
                  <ExternalLink className="w-3 h-3" />
                  LinkedIn Profile
                </button>
              </div>
            </div>
          </div>

          {/* Project Link */}
          <div className="pt-2 border-t" style={{ borderColor: theme.colors.border }}>
            <button
              onClick={() => window.maestro.shell.openExternal('https://github.com/pedramamini/Maestro')}
              className="w-full flex items-center justify-between p-3 rounded border hover:bg-white/5 transition-colors"
              style={{ borderColor: theme.colors.border }}
            >
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4" style={{ color: theme.colors.accent }} />
                <span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>View on GitHub</span>
              </div>
              <ExternalLink className="w-4 h-4" style={{ color: theme.colors.textDim }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
