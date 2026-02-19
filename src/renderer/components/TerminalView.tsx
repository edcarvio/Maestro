/**
 * TerminalView - Container for xterm.js terminal within a Maestro session.
 *
 * Manages the lifecycle of a terminal PTY:
 * - Spawns PTY when tab becomes active and visible
 * - Kills PTY when tab is closed
 * - Passes theme/font settings to XTerminal
 * - Reports PTY exit back to session state
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { XTerminal, XTerminalHandle } from './XTerminal';
import { getTerminalSessionId } from '../utils/terminalTabHelpers';
import type { Session, Theme, TerminalTab } from '../types';

interface TerminalViewProps {
	session: Session;
	terminalTab: TerminalTab;
	theme: Theme;
	fontFamily: string;
	fontSize?: number;
	isVisible: boolean;
	defaultShell: string;
	shellArgs?: string;
	shellEnvVars?: Record<string, string>;
	onTerminalTabUpdate: (sessionId: string, tabId: string, updates: Partial<TerminalTab>) => void;
}

export function TerminalView({
	session,
	terminalTab,
	theme,
	fontFamily,
	fontSize = 14,
	isVisible,
	defaultShell,
	shellArgs,
	shellEnvVars,
	onTerminalTabUpdate,
}: TerminalViewProps) {
	const xtermRef = useRef<XTerminalHandle>(null);
	const spawnedRef = useRef(false);
	const [isSpawning, setIsSpawning] = useState(false);

	const ptySessionId = getTerminalSessionId(session.id, terminalTab.id);

	// Spawn PTY when terminal tab becomes visible and hasn't been spawned yet
	useEffect(() => {
		if (!isVisible || spawnedRef.current || terminalTab.state === 'exited') return;

		const spawnPty = async () => {
			if (spawnedRef.current) return;
			setIsSpawning(true);
			try {
				const result = await window.maestro.process.spawnTerminalTab({
					sessionId: ptySessionId,
					cwd: terminalTab.cwd || session.cwd,
					shell: defaultShell || undefined,
					shellArgs: shellArgs || undefined,
					shellEnvVars: shellEnvVars || undefined,
				});

				if (result.success) {
					spawnedRef.current = true;
					onTerminalTabUpdate(session.id, terminalTab.id, {
						pid: result.pid,
						state: 'idle',
					});
				} else {
					onTerminalTabUpdate(session.id, terminalTab.id, {
						state: 'exited',
						exitCode: -1,
					});
				}
			} catch (err) {
				console.error('[TerminalView] Failed to spawn PTY:', err);
				onTerminalTabUpdate(session.id, terminalTab.id, {
					state: 'exited',
					exitCode: -1,
				});
			} finally {
				setIsSpawning(false);
			}
		};

		spawnPty();
	}, [isVisible, ptySessionId, terminalTab.cwd, terminalTab.id, terminalTab.state, session.id, session.cwd, defaultShell, shellArgs, shellEnvVars, onTerminalTabUpdate]);

	// Handle PTY exit events
	useEffect(() => {
		const unsubscribe = window.maestro.process.onExit((sid: string, code: number) => {
			if (sid === ptySessionId) {
				spawnedRef.current = false;
				onTerminalTabUpdate(session.id, terminalTab.id, {
					state: 'exited',
					exitCode: code,
					pid: 0,
				});
			}
		});
		return unsubscribe;
	}, [ptySessionId, session.id, terminalTab.id, onTerminalTabUpdate]);

	// Focus terminal when it becomes visible
	useEffect(() => {
		if (isVisible && xtermRef.current) {
			// Small delay to ensure DOM is ready
			const timer = setTimeout(() => xtermRef.current?.focus(), 50);
			return () => clearTimeout(timer);
		}
	}, [isVisible]);

	// Kill PTY on unmount (component destroyed = tab closed)
	useEffect(() => {
		return () => {
			if (spawnedRef.current) {
				window.maestro.process.kill(ptySessionId);
				spawnedRef.current = false;
			}
		};
	}, [ptySessionId]);

	const handleResize = useCallback((cols: number, rows: number) => {
		// Could update session state if needed
	}, []);

	if (terminalTab.state === 'exited' && !spawnedRef.current) {
		return (
			<div
				className="flex items-center justify-center h-full"
				style={{ color: theme.colors.textDim, backgroundColor: theme.colors.bgMain }}
			>
				<div className="text-center">
					<p>Terminal process exited{terminalTab.exitCode != null ? ` with code ${terminalTab.exitCode}` : ''}</p>
					<p className="text-sm mt-1" style={{ color: theme.colors.textDim }}>
						Close this tab or press Enter to restart
					</p>
				</div>
			</div>
		);
	}

	if (isSpawning) {
		return (
			<div
				className="flex items-center justify-center h-full"
				style={{ color: theme.colors.textDim, backgroundColor: theme.colors.bgMain }}
			>
				Starting terminal...
			</div>
		);
	}

	return (
		<div className="w-full h-full" style={{ display: isVisible ? 'block' : 'none' }}>
			<XTerminal
				ref={xtermRef}
				sessionId={ptySessionId}
				theme={theme}
				fontFamily={fontFamily}
				fontSize={fontSize}
				onResize={handleResize}
			/>
		</div>
	);
}
