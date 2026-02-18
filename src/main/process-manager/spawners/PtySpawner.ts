import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as pty from 'node-pty';
import { stripControlSequences } from '../../utils/terminalFilter';
import { logger } from '../../utils/logger';
import type { ProcessConfig, ManagedProcess, SpawnResult } from '../types';
import type { DataBufferManager } from '../handlers/DataBufferManager';
import { buildPtyTerminalEnv } from '../utils/envBuilder';

/**
 * Handles spawning of PTY (pseudo-terminal) processes.
 * Used for terminal mode and AI agents that require TTY support.
 */
export class PtySpawner {
	constructor(
		private processes: Map<string, ManagedProcess>,
		private emitter: EventEmitter,
		private bufferManager: DataBufferManager
	) {}

	/**
	 * Spawn a PTY process for a session
	 */
	spawn(config: ProcessConfig): SpawnResult {
		const { sessionId, toolType, cwd, command, args, shell, shellArgs, shellEnvVars, cols: configCols, rows: configRows } = config;

		const isTerminal = toolType === 'terminal' || toolType === 'embedded-terminal';
		const isEmbeddedTerminal = toolType === 'embedded-terminal';
		const isWindows = process.platform === 'win32';

		try {
			let ptyCommand: string;
			let ptyArgs: string[];

			if (isTerminal) {
				// Full shell emulation for terminal mode
				if (shell) {
					ptyCommand = shell;
				} else {
					ptyCommand = isWindows ? 'powershell.exe' : 'bash';
				}

				// Resolve shell name to absolute path (posix_spawnp may fail with bare names in Electron)
				if (!isWindows && ptyCommand && !ptyCommand.startsWith('/')) {

					const shellPaths = [
						`/bin/${ptyCommand}`,
						`/usr/bin/${ptyCommand}`,
						`/usr/local/bin/${ptyCommand}`,
						`/opt/homebrew/bin/${ptyCommand}`,
					];
					for (const p of shellPaths) {
						try {
							fs.accessSync(p, fs.constants.X_OK);
							ptyCommand = p;
							break;
						} catch {
							// Continue searching
						}
					}
				}

				// Use -l (login) AND -i (interactive) flags for fully configured shell
				ptyArgs = isWindows ? [] : ['-l', '-i'];

				// Append custom shell arguments from user configuration
				if (shellArgs && shellArgs.trim()) {
					const customShellArgsArray = shellArgs.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
					const cleanedArgs = customShellArgsArray.map((arg) => {
						if (
							(arg.startsWith('"') && arg.endsWith('"')) ||
							(arg.startsWith("'") && arg.endsWith("'"))
						) {
							return arg.slice(1, -1);
						}
						return arg;
					});
					if (cleanedArgs.length > 0) {
						logger.debug('Appending custom shell args', 'ProcessManager', {
							shellArgs: cleanedArgs,
						});
						ptyArgs = [...ptyArgs, ...cleanedArgs];
					}
				}
			} else {
				// Spawn the AI agent directly with PTY support
				ptyCommand = command;
				ptyArgs = args;
			}

			// Build environment for PTY process
			let ptyEnv: NodeJS.ProcessEnv;
			if (isEmbeddedTerminal) {
				// Embedded terminal uses full env — real shells need HOME, TERM, etc.
				// Login shell (-l) will source user's profile to set up PATH and other vars
				ptyEnv = { ...process.env, TERM: 'xterm-256color' };
			} else if (isTerminal) {
				ptyEnv = buildPtyTerminalEnv(shellEnvVars);
			} else {
				// For AI agents in PTY mode: pass full env (they need NODE_PATH, etc.)
				ptyEnv = process.env;
			}

			logger.debug('[ProcessManager] PTY spawn attempt', 'ProcessManager', {
				sessionId,
				toolType,
				ptyCommand,
				ptyArgs,
				cwd,
				shell: config.shell,
				pathEnv: (ptyEnv as Record<string, string>)?.PATH?.substring(0, 200),
			});

			const ptyProcess = pty.spawn(ptyCommand, ptyArgs, {
				name: 'xterm-256color',
				cols: configCols || 100,
				rows: configRows || 30,
				cwd: cwd,
				env: ptyEnv as Record<string, string>,
			});

			const managedProcess: ManagedProcess = {
				sessionId,
				toolType,
				ptyProcess,
				cwd,
				pid: ptyProcess.pid,
				isTerminal: true,
				startTime: Date.now(),
				command: ptyCommand,
				args: ptyArgs,
			};

			this.processes.set(sessionId, managedProcess);

			// Handle output
			ptyProcess.onData((data) => {
				if (isEmbeddedTerminal) {
					// Raw data for xterm.js — no filtering, no buffering
					this.emitter.emit('raw-pty-data', sessionId, data);
					return;
				}
				// AI agent output: strip control sequences for log-based display
				// (terminal mode uses embedded-terminal with raw passthrough above)
				const cleanedData = stripControlSequences(data);
				logger.debug('[ProcessManager] PTY onData', 'ProcessManager', {
					sessionId,
					pid: ptyProcess.pid,
					dataPreview: cleanedData.substring(0, 100),
				});
				// Only emit if there's actual content after filtering
				if (cleanedData.trim()) {
					this.bufferManager.emitDataBuffered(sessionId, cleanedData);
				}
			});

			ptyProcess.onExit(({ exitCode }) => {
				// Flush any remaining buffered data before exit
				this.bufferManager.flushDataBuffer(sessionId);

				logger.debug('[ProcessManager] PTY onExit', 'ProcessManager', {
					sessionId,
					exitCode,
				});
				this.emitter.emit('exit', sessionId, exitCode);
				this.processes.delete(sessionId);
			});

			logger.debug('[ProcessManager] PTY process created', 'ProcessManager', {
				sessionId,
				toolType,
				isTerminal,
				requiresPty: config.requiresPty || false,
				pid: ptyProcess.pid,
				command: ptyCommand,
				args: ptyArgs,
				cwd,
			});

			return { pid: ptyProcess.pid, success: true };
		} catch (error) {
			logger.error('[ProcessManager] Failed to spawn PTY process', 'ProcessManager', {
				error: String(error),
			});
			return { pid: -1, success: false, error: String(error) };
		}
	}
}
