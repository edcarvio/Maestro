/**
 * Maestro Mobile Web App
 *
 * Lightweight remote control interface for mobile devices.
 * Focused on quick command input and session monitoring.
 *
 * Phase 1 implementation will expand this component.
 */

import React from 'react';
import { useThemeColors } from '../components/ThemeProvider';

export default function MobileApp() {
  const colors = useThemeColors();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: colors.background,
        color: colors.textMain,
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
        className="safe-area-top"
      >
        <h1 style={{ fontSize: '18px', fontWeight: 600 }}>Maestro</h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: colors.textMuted,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: colors.warning,
            }}
          />
          Connecting...
        </div>
      </header>

      {/* Main content area */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            marginBottom: '24px',
            padding: '16px',
            borderRadius: '12px',
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            maxWidth: '300px',
          }}
        >
          <h2 style={{ fontSize: '16px', marginBottom: '8px' }}>
            Mobile Remote Control
          </h2>
          <p style={{ fontSize: '14px', color: colors.textMuted }}>
            Send commands to your AI assistants from anywhere. This interface
            will be implemented in Phase 1.
          </p>
        </div>
        <p style={{ fontSize: '12px', color: colors.textMuted }}>
          Make sure Maestro desktop app is running
        </p>
      </main>

      {/* Bottom input bar placeholder */}
      <footer
        style={{
          padding: '12px 16px',
          borderTop: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
        className="safe-area-bottom"
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            placeholder="Enter command..."
            disabled
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: colors.background,
              border: `1px solid ${colors.border}`,
              color: colors.textMuted,
              fontSize: '14px',
            }}
          />
          <button
            disabled
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              backgroundColor: colors.accent,
              color: '#fff',
              opacity: 0.5,
              fontSize: '14px',
            }}
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
