/**
 * Maestro Desktop Web App
 *
 * Full-featured collaborative interface for hackathons and team coding.
 * Provides real-time collaboration, full visibility, and shared editing.
 *
 * Phase 2 implementation will expand this component.
 */

import React from 'react';
import { useThemeColors } from '../components/ThemeProvider';

export default function DesktopApp() {
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
          padding: '12px 24px',
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.surface,
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 600 }}>
          Maestro Web
        </h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              color: colors.textMuted,
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: colors.warning,
              }}
            />
            Connecting...
          </div>
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            maxWidth: '600px',
          }}
        >
          <div
            style={{
              marginBottom: '32px',
              padding: '32px',
              borderRadius: '16px',
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
            }}
          >
            <h2 style={{ fontSize: '24px', marginBottom: '16px' }}>
              Desktop Collaborative Interface
            </h2>
            <p
              style={{
                fontSize: '16px',
                color: colors.textMuted,
                lineHeight: 1.6,
              }}
            >
              Full-featured web interface for team collaboration during
              hackathons and pair programming sessions. Share your AI coding
              sessions with teammates in real-time.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
              marginBottom: '32px',
            }}
          >
            {[
              { title: 'Real-time Sync', desc: 'See changes instantly' },
              { title: 'Multi-user', desc: 'Collaborate together' },
              { title: 'Full History', desc: 'Complete session logs' },
            ].map(({ title, desc }) => (
              <div
                key={title}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <h3 style={{ fontSize: '14px', marginBottom: '4px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '12px', color: colors.textMuted }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>

          <p style={{ fontSize: '14px', color: colors.textMuted }}>
            This interface will be implemented in Phase 2.
            <br />
            Make sure Maestro desktop app is running to connect.
          </p>
        </div>
      </main>
    </div>
  );
}
