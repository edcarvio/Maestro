import type { Session, ToolType } from '../types';

export interface SessionValidationResult {
  valid: boolean;
  error?: string;
  errorField?: 'name' | 'directory';
}

/**
 * Validates that a new session can be created with the given parameters.
 *
 * Rules:
 * 1. Session names must be unique across all sessions
 * 2. Home directories (projectRoot) must be unique per provider (toolType)
 *    - Different providers (e.g., claude-code vs codex) CAN share the same directory
 *    - Same provider cannot have multiple sessions in the same directory
 */
export function validateNewSession(
  name: string,
  directory: string,
  toolType: ToolType,
  existingSessions: Session[]
): SessionValidationResult {
  const trimmedName = name.trim();
  const normalizedDir = normalizeDirectory(directory);

  // Check for duplicate name
  const duplicateName = existingSessions.find(
    session => session.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicateName) {
    return {
      valid: false,
      error: `An agent named "${duplicateName.name}" already exists`,
      errorField: 'name'
    };
  }

  // Check for duplicate directory within the same provider
  const duplicateDirectory = existingSessions.find(session => {
    const sessionDir = normalizeDirectory(session.projectRoot || session.cwd);
    return sessionDir === normalizedDir && session.toolType === toolType;
  });
  if (duplicateDirectory) {
    return {
      valid: false,
      error: `A ${getProviderDisplayName(toolType)} agent already exists for this directory: "${duplicateDirectory.name}"`,
      errorField: 'directory'
    };
  }

  return { valid: true };
}

/**
 * Validates that a session can be edited with the given name.
 *
 * Rules:
 * 1. Session names must be unique across all sessions (excluding the current session)
 */
export function validateEditSession(
  name: string,
  sessionId: string,
  existingSessions: Session[]
): SessionValidationResult {
  const trimmedName = name.trim();

  // Check for duplicate name (excluding the current session)
  const duplicateName = existingSessions.find(
    session => session.id !== sessionId && session.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicateName) {
    return {
      valid: false,
      error: `An agent named "${duplicateName.name}" already exists`,
      errorField: 'name'
    };
  }

  return { valid: true };
}

/**
 * Normalize directory path for comparison.
 * Removes trailing slashes and resolves common variations.
 */
function normalizeDirectory(dir: string): string {
  // Remove trailing slashes
  let normalized = dir.replace(/\/+$/, '');
  // Ensure consistent case on case-insensitive file systems (macOS/Windows)
  // For now, we'll do case-insensitive comparison by lowercasing
  normalized = normalized.toLowerCase();
  return normalized;
}

/**
 * Get a human-readable display name for a provider/tool type.
 */
export function getProviderDisplayName(toolType: ToolType): string {
  const displayNames: Record<ToolType, string> = {
    'claude-code': 'Claude Code',
    'claude': 'Claude',
    'aider': 'Aider',
    'opencode': 'OpenCode',
    'codex': 'Codex',
    'terminal': 'Terminal'
  };
  return displayNames[toolType] || toolType;
}
