/**
 * @file group-chat-moderator.ts
 * @description Moderator management for Group Chat feature.
 *
 * The moderator is an AI agent that coordinates the group chat:
 * - Spawned in read-only mode to prevent unintended modifications
 * - Receives messages from users and dispatches to participants
 * - Aggregates responses and maintains conversation flow
 */

import { v4 as uuidv4 } from 'uuid';
import {
  GroupChat,
  loadGroupChat,
  updateGroupChat,
} from './group-chat-storage';
import { appendToLog, readLog } from './group-chat-log';

/**
 * Interface for the process manager dependency.
 * This allows for easy mocking in tests.
 */
export interface IProcessManager {
  spawn(config: {
    sessionId: string;
    toolType: string;
    cwd: string;
    command: string;
    args: string[];
    readOnlyMode?: boolean;
    prompt?: string;
  }): { pid: number; success: boolean };

  write(sessionId: string, data: string): boolean;

  kill(sessionId: string): boolean;
}

/**
 * In-memory store for active moderator sessions.
 * Maps groupChatId -> sessionId
 */
const activeModeratorSessions = new Map<string, string>();

/**
 * The system prompt sent to the moderator when it starts.
 */
export const MODERATOR_SYSTEM_PROMPT = `You are a Group Chat Moderator. Your role is to:

1. Coordinate conversations between multiple AI agents
2. Route messages to the appropriate participants using @mentions
3. Summarize and aggregate responses from agents
4. Ensure all participants have the context they need
5. Keep the conversation focused and productive

When addressing agents, use @AgentName format. Available commands:
- @AgentName: message - Send a message to a specific agent
- Review the chat log for conversation history

Be concise, professional, and ensure smooth collaboration between agents.`;

/**
 * Spawns a moderator agent for a group chat.
 *
 * @param chat - The group chat to spawn a moderator for
 * @param processManager - The process manager to use for spawning
 * @param cwd - Working directory for the moderator (defaults to home directory)
 * @returns The session ID of the spawned moderator
 */
export async function spawnModerator(
  chat: GroupChat,
  processManager: IProcessManager,
  cwd: string = process.env.HOME || '/tmp'
): Promise<string> {
  const sessionId = `group-chat-${chat.id}-moderator-${uuidv4()}`;

  // Spawn the moderator in read-only mode
  const result = processManager.spawn({
    sessionId,
    toolType: chat.moderatorAgentId,
    cwd,
    command: chat.moderatorAgentId,  // The agent command
    args: [],  // Args will be built by the process handler based on readOnlyMode
    readOnlyMode: true,
    prompt: MODERATOR_SYSTEM_PROMPT,
  });

  if (!result.success) {
    throw new Error(`Failed to spawn moderator for group chat ${chat.id}`);
  }

  // Store the session mapping
  activeModeratorSessions.set(chat.id, sessionId);

  // Update the group chat with the moderator session ID
  await updateGroupChat(chat.id, { moderatorSessionId: sessionId });

  return sessionId;
}

/**
 * Sends a message to the moderator and logs it.
 *
 * @param groupChatId - The ID of the group chat
 * @param message - The message to send
 * @param processManager - The process manager (optional, for sending to agent)
 */
export async function sendToModerator(
  groupChatId: string,
  message: string,
  processManager?: IProcessManager
): Promise<void> {
  const chat = await loadGroupChat(groupChatId);
  if (!chat) {
    throw new Error(`Group chat not found: ${groupChatId}`);
  }

  // Log the message
  await appendToLog(chat.logPath, 'user', message);

  // If process manager is provided, also send to the moderator session
  if (processManager) {
    const sessionId = activeModeratorSessions.get(groupChatId);
    if (sessionId) {
      processManager.write(sessionId, message + '\n');
    }
  }
}

/**
 * Kills the moderator session for a group chat.
 *
 * @param groupChatId - The ID of the group chat
 * @param processManager - The process manager (optional, for killing the process)
 */
export async function killModerator(
  groupChatId: string,
  processManager?: IProcessManager
): Promise<void> {
  const sessionId = activeModeratorSessions.get(groupChatId);

  if (sessionId && processManager) {
    processManager.kill(sessionId);
  }

  activeModeratorSessions.delete(groupChatId);

  // Clear the session ID in storage
  try {
    await updateGroupChat(groupChatId, { moderatorSessionId: '' });
  } catch {
    // Chat may already be deleted
  }
}

/**
 * Gets the moderator session ID for a group chat.
 *
 * @param groupChatId - The ID of the group chat
 * @returns The session ID, or undefined if no moderator is active
 */
export function getModeratorSessionId(groupChatId: string): string | undefined {
  return activeModeratorSessions.get(groupChatId);
}

/**
 * Checks if a moderator is currently active for a group chat.
 *
 * @param groupChatId - The ID of the group chat
 * @returns True if a moderator is active
 */
export function isModeratorActive(groupChatId: string): boolean {
  return activeModeratorSessions.has(groupChatId);
}

/**
 * Clears all active moderator sessions.
 * Useful for cleanup during shutdown or testing.
 */
export function clearAllModeratorSessions(): void {
  activeModeratorSessions.clear();
}

/**
 * Gets the chat log for the group chat.
 * This is useful for providing context to the moderator.
 *
 * @param groupChatId - The ID of the group chat
 * @returns Array of messages from the chat log
 */
export async function getModeratorChatLog(groupChatId: string) {
  const chat = await loadGroupChat(groupChatId);
  if (!chat) {
    throw new Error(`Group chat not found: ${groupChatId}`);
  }

  return readLog(chat.logPath);
}
