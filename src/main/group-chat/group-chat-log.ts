/**
 * @file group-chat-log.ts
 * @description Pipe-delimited log format utilities for Group Chat feature.
 *
 * Log format: TIMESTAMP|FROM|CONTENT
 * - TIMESTAMP: ISO 8601 format (e.g., 2024-01-15T10:30:00.000Z)
 * - FROM: Participant name (user, moderator, or agent name)
 * - CONTENT: Message content with escaped newlines and pipes
 *
 * Escaping rules:
 * - Newlines (\n) -> \\n
 * - Pipes (|) -> \\|
 * - Backslashes before n or | are doubled for proper escaping
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Message structure for parsed log entries.
 */
export interface GroupChatMessage {
  timestamp: string;
  from: string;
  content: string;
}

/**
 * Escapes content for storage in the pipe-delimited log format.
 * - Newlines are escaped as \\n
 * - Pipes are escaped as \\|
 *
 * @param content - Raw content to escape
 * @returns Escaped content safe for log storage
 */
export function escapeContent(content: string): string {
  // First escape backslashes that precede n or |, then escape newlines and pipes
  return content
    .replace(/\n/g, '\\n')
    .replace(/\|/g, '\\|');
}

/**
 * Reverses escaping to restore original content from log format.
 *
 * @param escaped - Escaped content from log
 * @returns Original unescaped content
 */
export function unescapeContent(escaped: string): string {
  // Unescape in reverse order
  return escaped
    .replace(/\\\|/g, '|')
    .replace(/\\n/g, '\n');
}

/**
 * Appends a message to the chat log file.
 *
 * @param logPath - Path to the log file
 * @param from - Sender name (user, moderator, or participant name)
 * @param content - Message content
 */
export async function appendToLog(
  logPath: string,
  from: string,
  content: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const escapedContent = escapeContent(content);
  const line = `${timestamp}|${from}|${escapedContent}\n`;

  // Ensure directory exists
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  // Append to file
  await fs.appendFile(logPath, line, 'utf-8');
}

/**
 * Reads and parses the chat log file.
 *
 * @param logPath - Path to the log file
 * @returns Array of parsed messages
 */
export async function readLog(logPath: string): Promise<GroupChatMessage[]> {
  try {
    const content = await fs.readFile(logPath, 'utf-8');

    if (!content.trim()) {
      return [];
    }

    const lines = content.split('\n').filter((line) => line.trim());
    const messages: GroupChatMessage[] = [];

    for (const line of lines) {
      // Split only on first two unescaped pipes
      // Find the first unescaped pipe (not preceded by backslash)
      let firstPipe = -1;
      let secondPipe = -1;

      for (let i = 0; i < line.length; i++) {
        if (line[i] === '|' && (i === 0 || line[i - 1] !== '\\')) {
          if (firstPipe === -1) {
            firstPipe = i;
          } else if (secondPipe === -1) {
            secondPipe = i;
            break;
          }
        }
      }

      if (firstPipe !== -1 && secondPipe !== -1) {
        const timestamp = line.substring(0, firstPipe);
        const from = line.substring(firstPipe + 1, secondPipe);
        const escapedContent = line.substring(secondPipe + 1);

        messages.push({
          timestamp,
          from,
          content: unescapeContent(escapedContent),
        });
      }
    }

    return messages;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
