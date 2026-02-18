/**
 * Utility functions for cleaning and filtering terminal output
 * Removes control sequences, escape codes, and other non-visible content
 *
 * NOTE: Terminal mode now uses xterm.js with raw PTY streaming (embedded-terminal).
 * stripControlSequences is only used for AI agent output (Claude Code, Codex, etc.)
 * where we need clean text for the log-based TerminalOutput renderer.
 */

/**
 * Strip terminal control sequences from raw PTY output for AI agent display.
 * This removes:
 * - OSC sequences (Operating System Commands) like title changes
 * - CSI sequences (Control Sequence Introducer) like cursor positioning
 * - Shell integration markers (VSCode, iTerm2, etc.)
 * - Control characters and invisible formatting
 *
 * Used only for AI agent output — terminal mode uses xterm.js which handles
 * control sequences natively via the embedded-terminal raw data path.
 *
 * @param text - Raw terminal output from AI agent PTY
 *
 * Note: This preserves ANSI color codes which are handled by ansi-to-html in the renderer
 */
export function stripControlSequences(text: string): string {
	let cleaned = text;

	// Remove OSC (Operating System Command) sequences
	// Format: ESC ] ... (BEL or ST)
	// Examples: window title changes, hyperlinks, custom sequences
	cleaned = cleaned.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove CSI (Control Sequence Introducer) sequences that aren't color codes
	// Format: ESC [ ... letter
	// Keep: SGR color codes (end with 'm')
	// Remove: cursor movement, scrolling, etc.
	cleaned = cleaned.replace(/\x1b\[[\d;]*[A-KSTfHJhlp]/gi, '');

	// Remove shell integration markers (VSCode, iTerm2, etc.)
	// Format: ESC ] 133 ; ... BEL/ST
	cleaned = cleaned.replace(/\x1b\]133;[^\x07\x1b]*(\x07|\x1b\\)/g, '');
	cleaned = cleaned.replace(/\x1b\]1337;[^\x07\x1b]*(\x07|\x1b\\)/g, '');
	cleaned = cleaned.replace(/\x1b\]7;[^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove BARE shell integration sequences (without ESC prefix)
	// SSH interactive shells emit these when .zshrc/.bashrc loads shell integration
	// Format: ]1337;Key=Value]1337;Key=Value...actual content (no ESC prefix)
	// Process BEL-terminated sequences first
	cleaned = cleaned.replace(/\]1337;[^\x07]*\x07/g, '');
	cleaned = cleaned.replace(/\]133;[^\x07]*\x07/g, '');
	cleaned = cleaned.replace(/\]7;[^\x07]*\x07/g, '');
	// Handle chained sequences (followed by another ])
	cleaned = cleaned.replace(/\]1337;[^\]\x07\x1b]*(?=\])/g, '');
	cleaned = cleaned.replace(/\]133;[^\]\x07\x1b]*(?=\])/g, '');
	cleaned = cleaned.replace(/\]7;[^\]\x07\x1b]*(?=\])/g, '');
	// Handle last sequence in chain (ShellIntegrationVersion followed by content)
	cleaned = cleaned.replace(/\]1337;ShellIntegrationVersion=[\d;a-zA-Z=]*/g, '');
	cleaned = cleaned.replace(/\]1337;(?:RemoteHost|CurrentDir|User|HostName)=[^\/\]\x07\{]*/g, '');
	// Handle sequences at end of string
	cleaned = cleaned.replace(/^\]1337;[^\]\x07]*$/g, '');
	cleaned = cleaned.replace(/^\]133;[^\]\x07]*$/g, '');
	cleaned = cleaned.replace(/^\]7;[^\]\x07]*$/g, '');

	// Remove other OSC sequences by number
	cleaned = cleaned.replace(/\x1b\][0-9];[^\x07\x1b]*(\x07|\x1b\\)/g, '');

	// Remove soft hyphen and other invisible formatting
	cleaned = cleaned.replace(/\u00AD/g, '');

	// Remove carriage returns that are followed by newlines (Windows-style)
	// But keep standalone \r for terminal overwrites
	cleaned = cleaned.replace(/\r\n/g, '\n');

	// Remove any remaining standalone escape sequences without parameters
	cleaned = cleaned.replace(/\x1b[()][AB012]/g, '');

	// Remove BEL (bell) character
	cleaned = cleaned.replace(/\x07/g, '');

	// Remove other control characters except newline, tab, and ANSI escape start
	cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1A\x1C-\x1F]/g, '');

	return cleaned;
}

/**
 * Strip ALL ANSI escape codes from text (including color codes).
 * This is more aggressive than stripControlSequences and removes everything.
 * Use this for stderr from AI agents where we don't want any formatting.
 *
 * NOTE: This is intentionally more comprehensive than shared/stringUtils.stripAnsiCodes().
 * The shared version handles basic SGR color/style codes (sufficient for UI display cleanup).
 * This version also handles: OSC sequences, character set selection, BEL, and control chars.
 * This comprehensive version is needed for raw terminal output from AI agents.
 *
 * @see src/shared/stringUtils.ts for the basic version
 */
export function stripAllAnsiCodes(text: string): string {
	// Remove all ANSI escape sequences including color codes
	// Format: ESC [ ... m (SGR sequences for colors/styles)
	// Format: ESC [ ... other letters (cursor, scrolling, etc.)
	// Format: ESC ] ... BEL/ST (OSC sequences)
	return text
		.replace(/\x1b\[[0-9;]*m/g, '') // SGR color/style codes
		.replace(/\x1b\[[\d;]*[A-Za-z]/g, '') // Other CSI sequences
		.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC sequences
		.replace(/\x1b[()][AB012]/g, '') // Character set selection
		.replace(/\x07/g, '') // BEL character
		.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1A\x1C-\x1F]/g, ''); // Other control chars
}

