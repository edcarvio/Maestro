/**
 * Maestro Mobile Web App
 *
 * Lightweight remote control interface for mobile devices.
 * Focused on quick command input and session monitoring.
 *
 * Phase 1 implementation will expand this component.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useThemeColors } from '../components/ThemeProvider';
import { useWebSocket, type WebSocketState } from '../hooks/useWebSocket';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { Badge, type BadgeVariant } from '../components/Badge';
import { PullToRefreshIndicator } from '../components/PullToRefresh';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useOfflineStatus } from '../main';
import { triggerHaptic, HAPTIC_PATTERNS } from './index';
import { SessionPillBar } from './SessionPillBar';
import { AllSessionsView } from './AllSessionsView';
import { CommandInputBar, type InputMode } from './CommandInputBar';
import { CommandHistoryDrawer } from './CommandHistoryDrawer';
import { RecentCommandChips } from './RecentCommandChips';
import { SessionStatusBanner } from './SessionStatusBanner';
import type { Session } from '../hooks/useSessions';

/**
 * Map WebSocket state to display properties
 */
interface ConnectionStatusConfig {
  label: string;
  variant: BadgeVariant;
  pulse: boolean;
}

const CONNECTION_STATUS_CONFIG: Record<WebSocketState | 'offline', ConnectionStatusConfig> = {
  offline: {
    label: 'Offline',
    variant: 'error',
    pulse: false,
  },
  disconnected: {
    label: 'Disconnected',
    variant: 'error',
    pulse: false,
  },
  connecting: {
    label: 'Connecting...',
    variant: 'connecting',
    pulse: true,
  },
  authenticating: {
    label: 'Authenticating...',
    variant: 'connecting',
    pulse: true,
  },
  connected: {
    label: 'Connected',
    variant: 'success',
    pulse: false,
  },
  authenticated: {
    label: 'Connected',
    variant: 'success',
    pulse: false,
  },
};

/**
 * Header component for the mobile app
 * Displays app title and connection status indicator
 */
interface MobileHeaderProps {
  connectionState: WebSocketState;
  isOffline: boolean;
  onRetry?: () => void;
}

function MobileHeader({ connectionState, isOffline, onRetry }: MobileHeaderProps) {
  const colors = useThemeColors();
  // Show offline status if device is offline, otherwise show connection state
  const effectiveState = isOffline ? 'offline' : connectionState;
  const statusConfig = CONNECTION_STATUS_CONFIG[effectiveState];

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        paddingTop: 'max(12px, env(safe-area-inset-top))',
        borderBottom: `1px solid ${colors.border}`,
        backgroundColor: colors.bgSidebar,
        minHeight: '56px',
      }}
    >
      <h1
        style={{
          fontSize: '18px',
          fontWeight: 600,
          margin: 0,
          color: colors.textMain,
        }}
      >
        Maestro
      </h1>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Badge
          variant={statusConfig.variant}
          badgeStyle="subtle"
          size="sm"
          pulse={statusConfig.pulse}
          onClick={!isOffline && connectionState === 'disconnected' ? onRetry : undefined}
          style={{
            cursor: !isOffline && connectionState === 'disconnected' ? 'pointer' : 'default',
          }}
        >
          {statusConfig.label}
        </Badge>
      </div>
    </header>
  );
}

/**
 * Main mobile app component with WebSocket connection management
 */
export default function MobileApp() {
  const colors = useThemeColors();
  const isOffline = useOfflineStatus();
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [commandInput, setCommandInput] = useState('');
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  // Command history hook
  const {
    history: commandHistory,
    addCommand: addToHistory,
    removeCommand: removeFromHistory,
    clearHistory,
    getUniqueCommands,
  } = useCommandHistory();

  const { state: connectionState, connect, send, error, reconnectAttempts } = useWebSocket({
    autoReconnect: true,
    maxReconnectAttempts: 10,
    reconnectDelay: 2000,
    handlers: {
      onConnectionChange: (newState) => {
        console.log('[Mobile] Connection state:', newState);
      },
      onError: (err) => {
        console.error('[Mobile] WebSocket error:', err);
      },
      onSessionsUpdate: (newSessions) => {
        console.log('[Mobile] Sessions updated:', newSessions.length);
        setSessions(newSessions as Session[]);
        // Auto-select first session if none selected
        if (!activeSessionId && newSessions.length > 0) {
          setActiveSessionId(newSessions[0].id);
        }
      },
      onSessionStateChange: (sessionId, state, additionalData) => {
        setSessions(prev => prev.map(s =>
          s.id === sessionId
            ? { ...s, state, ...additionalData }
            : s
        ));
      },
      onSessionAdded: (session) => {
        setSessions(prev => {
          if (prev.some(s => s.id === session.id)) return prev;
          return [...prev, session as Session];
        });
      },
      onSessionRemoved: (sessionId) => {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          setActiveSessionId(null);
        }
      },
    },
  });

  // Connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Handle refresh - request updated session list
  const handleRefresh = useCallback(async () => {
    console.log('[Mobile] Pull-to-refresh triggered');

    // Provide haptic feedback
    triggerHaptic(HAPTIC_PATTERNS.tap);

    // Send request to get updated sessions
    const isConnected = connectionState === 'connected' || connectionState === 'authenticated';
    if (isConnected) {
      send({ type: 'get_sessions' });
    }

    // Simulate a minimum refresh time for better UX
    await new Promise((resolve) => setTimeout(resolve, 500));

    setLastRefreshTime(new Date());

    // Provide success haptic feedback
    triggerHaptic(HAPTIC_PATTERNS.success);
  }, [connectionState, send]);

  // Pull-to-refresh hook
  const {
    pullDistance,
    progress,
    isRefreshing,
    isThresholdReached,
    containerProps,
  } = usePullToRefresh({
    onRefresh: handleRefresh,
    enabled: !isOffline && (connectionState === 'connected' || connectionState === 'authenticated'),
  });

  // Retry connection handler
  const handleRetry = useCallback(() => {
    connect();
  }, [connect]);

  // Handle session selection
  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    triggerHaptic(HAPTIC_PATTERNS.tap);
  }, []);

  // Handle opening All Sessions view
  const handleOpenAllSessions = useCallback(() => {
    setShowAllSessions(true);
    triggerHaptic(HAPTIC_PATTERNS.tap);
  }, []);

  // Handle closing All Sessions view
  const handleCloseAllSessions = useCallback(() => {
    setShowAllSessions(false);
  }, []);

  // Handle command submission
  const handleCommandSubmit = useCallback((command: string) => {
    if (!activeSessionId) return;

    // Get the current input mode for history tracking
    const currentMode = (activeSession?.inputMode as InputMode) || 'ai';

    // Provide haptic feedback on send
    triggerHaptic(HAPTIC_PATTERNS.send);

    // Add to command history
    addToHistory(command, activeSessionId, currentMode);

    // Send the command to the active session
    send({
      type: 'send_command',
      sessionId: activeSessionId,
      command,
    });

    // Clear the input
    setCommandInput('');

    console.log('[Mobile] Command sent:', command, 'to session:', activeSessionId);
  }, [activeSessionId, activeSession?.inputMode, send, addToHistory]);

  // Handle command input change
  const handleCommandChange = useCallback((value: string) => {
    setCommandInput(value);
  }, []);

  // Handle mode toggle between AI and Terminal
  const handleModeToggle = useCallback((mode: InputMode) => {
    if (!activeSessionId) return;

    // Provide haptic feedback
    triggerHaptic(HAPTIC_PATTERNS.tap);

    // Send mode switch command via WebSocket
    send({
      type: 'switch_mode',
      sessionId: activeSessionId,
      mode,
    });

    // Optimistically update local session state
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, inputMode: mode }
        : s
    ));

    console.log('[Mobile] Mode switched to:', mode, 'for session:', activeSessionId);
  }, [activeSessionId, send]);

  // Handle interrupt request
  const handleInterrupt = useCallback(async () => {
    if (!activeSessionId) return;

    // Provide haptic feedback
    triggerHaptic(HAPTIC_PATTERNS.tap);

    try {
      // Get the base URL for API requests
      const baseUrl = `${window.location.protocol}//${window.location.host}`;
      const response = await fetch(`${baseUrl}/api/session/${activeSessionId}/interrupt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('[Mobile] Session interrupted:', activeSessionId);
        triggerHaptic(HAPTIC_PATTERNS.success);
      } else {
        console.error('[Mobile] Failed to interrupt session:', result.error);
      }
    } catch (error) {
      console.error('[Mobile] Error interrupting session:', error);
    }
  }, [activeSessionId]);

  // Handle opening history drawer
  const handleOpenHistory = useCallback(() => {
    setShowHistoryDrawer(true);
    triggerHaptic(HAPTIC_PATTERNS.tap);
  }, []);

  // Handle closing history drawer
  const handleCloseHistory = useCallback(() => {
    setShowHistoryDrawer(false);
  }, []);

  // Handle selecting a command from history
  const handleSelectHistoryCommand = useCallback((command: string) => {
    setCommandInput(command);
    // Haptic feedback is provided by the drawer
  }, []);

  // Get active session for input mode
  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Determine content based on connection state
  const renderContent = () => {
    // Show offline state when device has no network connectivity
    if (isOffline) {
      return (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            borderRadius: '12px',
            backgroundColor: colors.bgSidebar,
            border: `1px solid ${colors.border}`,
            maxWidth: '300px',
          }}
        >
          <h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
            You're Offline
          </h2>
          <p style={{ fontSize: '14px', color: colors.textDim, marginBottom: '12px' }}>
            No internet connection. Maestro requires a network connection to communicate with your desktop app.
          </p>
          <p style={{ fontSize: '12px', color: colors.textDim }}>
            The app will automatically reconnect when you're back online.
          </p>
        </div>
      );
    }

    if (connectionState === 'disconnected') {
      return (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            borderRadius: '12px',
            backgroundColor: colors.bgSidebar,
            border: `1px solid ${colors.border}`,
            maxWidth: '300px',
          }}
        >
          <h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
            Connection Lost
          </h2>
          <p style={{ fontSize: '14px', color: colors.textDim, marginBottom: '12px' }}>
            {error || 'Unable to connect to Maestro desktop app.'}
          </p>
          {reconnectAttempts > 0 && (
            <p style={{ fontSize: '12px', color: colors.textDim, marginBottom: '12px' }}>
              Reconnection attempts: {reconnectAttempts}
            </p>
          )}
          <button
            onClick={handleRetry}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              backgroundColor: colors.accent,
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Retry Connection
          </button>
        </div>
      );
    }

    if (connectionState === 'connecting' || connectionState === 'authenticating') {
      return (
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            borderRadius: '12px',
            backgroundColor: colors.bgSidebar,
            border: `1px solid ${colors.border}`,
            maxWidth: '300px',
          }}
        >
          <h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
            Connecting to Maestro...
          </h2>
          <p style={{ fontSize: '14px', color: colors.textDim }}>
            Please wait while we establish a connection to your desktop app.
          </p>
        </div>
      );
    }

    // Connected or authenticated state
    return (
      <div
        style={{
          marginBottom: '24px',
          padding: '16px',
          borderRadius: '12px',
          backgroundColor: colors.bgSidebar,
          border: `1px solid ${colors.border}`,
          maxWidth: '300px',
        }}
      >
        <h2 style={{ fontSize: '16px', marginBottom: '8px', color: colors.textMain }}>
          Mobile Remote Control
        </h2>
        <p style={{ fontSize: '14px', color: colors.textDim }}>
          Send commands to your AI assistants from anywhere. Session selector
          and command input will be added next.
        </p>
      </div>
    );
  };

  // CSS variable for dynamic viewport height with fallback
  // The fixed CommandInputBar requires padding at the bottom of the container
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100dvh',
    backgroundColor: colors.bgMain,
    color: colors.textMain,
    // Add padding at bottom to account for fixed input bar (~70px + safe area)
    paddingBottom: 'calc(70px + max(12px, env(safe-area-inset-bottom)))',
  };

  // Determine if session pill bar should be shown
  const showSessionPillBar = !isOffline &&
    (connectionState === 'connected' || connectionState === 'authenticated') &&
    sessions.length > 0;

  return (
    <div style={containerStyle}>
      {/* Header with connection status */}
      <MobileHeader
        connectionState={connectionState}
        isOffline={isOffline}
        onRetry={handleRetry}
      />

      {/* Session pill bar - shown when connected and sessions available */}
      {showSessionPillBar && (
        <SessionPillBar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onOpenAllSessions={handleOpenAllSessions}
        />
      )}

      {/* Session status banner - shown when connected and a session is selected */}
      {showSessionPillBar && activeSession && (
        <SessionStatusBanner session={activeSession} />
      )}

      {/* All Sessions view - full-screen modal with larger session cards */}
      {showAllSessions && (
        <AllSessionsView
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onClose={handleCloseAllSessions}
        />
      )}

      {/* Main content area with pull-to-refresh */}
      <main
        {...containerProps}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          padding: '20px',
          paddingTop: `${20 + pullDistance}px`,
          textAlign: 'center',
          overflow: 'auto',
          overscrollBehavior: 'contain',
          position: 'relative',
          touchAction: pullDistance > 0 ? 'none' : 'pan-y',
          transition: isRefreshing ? 'padding-top 0.3s ease' : 'none',
        }}
      >
        {/* Pull-to-refresh indicator */}
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          progress={progress}
          isRefreshing={isRefreshing}
          isThresholdReached={isThresholdReached}
          style={{
            position: 'fixed',
            // Adjust top position based on what's shown above
            // Header: ~56px, Session pill bar: ~52px, Status banner: ~44px when active session
            top: showSessionPillBar
              ? activeSession
                ? 'max(152px, calc(152px + env(safe-area-inset-top)))' // Header + pill bar + status banner
                : 'max(108px, calc(108px + env(safe-area-inset-top)))' // Header + pill bar
              : 'max(56px, calc(56px + env(safe-area-inset-top)))', // Just header
            left: 0,
            right: 0,
            zIndex: 10,
          }}
        />

        {/* Content wrapper to center items when not scrolling */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          {renderContent()}
          <p style={{ fontSize: '12px', color: colors.textDim }}>
            Make sure Maestro desktop app is running
          </p>
          {lastRefreshTime && (connectionState === 'connected' || connectionState === 'authenticated') && (
            <p style={{ fontSize: '11px', color: colors.textDim, marginTop: '8px' }}>
              Last updated: {lastRefreshTime.toLocaleTimeString()}
            </p>
          )}
        </div>
      </main>

      {/* Sticky bottom command input bar with recent command chips */}
      <CommandInputBar
        isOffline={isOffline}
        isConnected={connectionState === 'connected' || connectionState === 'authenticated'}
        value={commandInput}
        onChange={handleCommandChange}
        onSubmit={handleCommandSubmit}
        placeholder={activeSessionId ? 'Enter command...' : 'Select a session first...'}
        disabled={!activeSessionId}
        inputMode={(activeSession?.inputMode as InputMode) || 'ai'}
        onModeToggle={handleModeToggle}
        isSessionBusy={activeSession?.state === 'busy'}
        onInterrupt={handleInterrupt}
        onHistoryOpen={handleOpenHistory}
        recentCommands={getUniqueCommands(5)}
        onSelectRecentCommand={handleSelectHistoryCommand}
      />

      {/* Command history drawer - swipe up from input area */}
      <CommandHistoryDrawer
        isOpen={showHistoryDrawer}
        onClose={handleCloseHistory}
        history={commandHistory}
        onSelectCommand={handleSelectHistoryCommand}
        onDeleteCommand={removeFromHistory}
        onClearHistory={clearHistory}
      />
    </div>
  );
}
