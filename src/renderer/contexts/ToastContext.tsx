import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
  group?: string;
  project?: string;
  duration?: number;
  taskDuration?: number; // How long the task took in ms
  claudeSessionId?: string; // Claude Code session UUID for traceability
  tabName?: string; // Tab name or short UUID for display
  timestamp: number;
  // Session navigation - allows clicking toast to jump to session
  sessionId?: string; // Maestro session ID for navigation
  tabId?: string; // Tab ID within the session for navigation
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  defaultDuration: number;
  setDefaultDuration: (duration: number) => void;
  // Audio feedback configuration
  setAudioFeedback: (enabled: boolean, command: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastProviderProps {
  children: React.ReactNode;
  defaultDuration?: number; // Duration in seconds, 0 = never auto-dismiss
}

export function ToastProvider({ children, defaultDuration: initialDuration = 20 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [defaultDuration, setDefaultDuration] = useState(initialDuration);
  const toastIdCounter = useRef(0);

  // Audio feedback state (configured from App.tsx via setAudioFeedback)
  const audioFeedbackRef = useRef({ enabled: false, command: '' });

  const setAudioFeedback = useCallback((enabled: boolean, command: string) => {
    audioFeedbackRef.current = { enabled, command };
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id' | 'timestamp'>) => {
    const id = `toast-${Date.now()}-${toastIdCounter.current++}`;
    // Convert seconds to ms, use 0 for "never dismiss"
    const durationMs = toast.duration !== undefined
      ? toast.duration
      : (defaultDuration > 0 ? defaultDuration * 1000 : 0);

    const newToast: Toast = {
      ...toast,
      id,
      timestamp: Date.now(),
      duration: durationMs,
    };

    setToasts(prev => [...prev, newToast]);

    // Log toast to system logs
    window.maestro.logger.toast(toast.title, {
      type: toast.type,
      message: toast.message,
      group: toast.group,
      project: toast.project,
      taskDuration: toast.taskDuration,
      claudeSessionId: toast.claudeSessionId,
      tabName: toast.tabName
    });

    // Speak toast via TTS if audio feedback is enabled and command is configured
    const { enabled, command } = audioFeedbackRef.current;
    if (enabled && command) {
      window.maestro.notification.speak(toast.message, command).catch(err => {
        console.error('[ToastContext] Failed to speak toast:', err);
      });
    }

    // Auto-remove after duration (only if duration > 0)
    if (durationMs > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, durationMs);
    }
  }, [defaultDuration]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearToasts, defaultDuration, setDefaultDuration, setAudioFeedback }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
