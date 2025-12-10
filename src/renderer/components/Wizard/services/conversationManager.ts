/**
 * conversationManager.ts
 *
 * Manages the back-and-forth conversation flow between the wizard and the
 * AI agent during project discovery. Handles message sending, response parsing,
 * and conversation state management.
 */

import type { ToolType } from '../../../types';
import type { WizardMessage } from '../WizardContext';
import {
  generateSystemPrompt,
  parseStructuredOutput,
  formatUserMessage,
  isReadyToProceed,
  type StructuredAgentResponse,
  type ParsedResponse,
  READY_CONFIDENCE_THRESHOLD,
} from './wizardPrompts';

/**
 * Configuration for starting a conversation
 */
export interface ConversationConfig {
  /** The agent type to use for the conversation */
  agentType: ToolType;
  /** The working directory for the agent */
  directoryPath: string;
  /** Project name (used in system prompt) */
  projectName: string;
}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  /** Whether the message was sent and response received successfully */
  success: boolean;
  /** The parsed agent response */
  response?: ParsedResponse;
  /** Error message if unsuccessful */
  error?: string;
  /** The raw output data (for debugging) */
  rawOutput?: string;
}

/**
 * Callback type for receiving agent output chunks
 */
export type OutputChunkCallback = (chunk: string) => void;

/**
 * Callback type for conversation state changes
 */
export interface ConversationCallbacks {
  /** Called when a message is being sent */
  onSending?: () => void;
  /** Called when agent starts responding */
  onReceiving?: () => void;
  /** Called with partial output chunks (for streaming display) */
  onChunk?: OutputChunkCallback;
  /** Called when response is complete */
  onComplete?: (result: SendMessageResult) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
}

/**
 * State of an active conversation session
 */
interface ConversationSession {
  /** Unique session ID for this wizard conversation */
  sessionId: string;
  /** The agent type */
  agentType: ToolType;
  /** Working directory */
  directoryPath: string;
  /** Project name */
  projectName: string;
  /** Whether the agent process is active */
  isActive: boolean;
  /** System prompt used for this session */
  systemPrompt: string;
  /** Accumulated output buffer for parsing */
  outputBuffer: string;
  /** Resolve function for pending message */
  pendingResolve?: (result: SendMessageResult) => void;
  /** Callbacks for the conversation */
  callbacks?: ConversationCallbacks;
  /** Cleanup function for data listener */
  dataListenerCleanup?: () => void;
  /** Cleanup function for exit listener */
  exitListenerCleanup?: () => void;
}

/**
 * Generate a unique session ID for wizard conversations
 */
function generateWizardSessionId(): string {
  return `wizard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * ConversationManager class
 *
 * Manages a single conversation session between the wizard and an AI agent.
 * Handles:
 * - Spawning the agent process with the wizard system prompt
 * - Sending user messages with structured output reminders
 * - Parsing and validating agent responses
 * - Tracking conversation state and history
 */
class ConversationManager {
  /** Current active session (only one wizard conversation at a time) */
  private session: ConversationSession | null = null;

  /**
   * Start a new conversation session
   *
   * @param config Configuration for the conversation
   * @returns Session ID for the conversation
   */
  async startConversation(config: ConversationConfig): Promise<string> {
    // End any existing session first
    if (this.session) {
      await this.endConversation();
    }

    const sessionId = generateWizardSessionId();
    const systemPrompt = generateSystemPrompt({
      agentName: config.projectName,
      agentPath: config.directoryPath,
    });

    this.session = {
      sessionId,
      agentType: config.agentType,
      directoryPath: config.directoryPath,
      projectName: config.projectName,
      isActive: true,
      systemPrompt,
      outputBuffer: '',
    };

    return sessionId;
  }

  /**
   * Send a message to the agent and wait for a response
   *
   * This method:
   * 1. Spawns a new agent process with the full conversation context
   * 2. Waits for the agent to complete its response
   * 3. Parses the structured output
   * 4. Returns the result
   *
   * @param userMessage The user's message to send
   * @param conversationHistory Previous messages in the conversation
   * @param callbacks Optional callbacks for progress updates
   * @returns SendMessageResult with the parsed response
   */
  async sendMessage(
    userMessage: string,
    conversationHistory: WizardMessage[],
    callbacks?: ConversationCallbacks
  ): Promise<SendMessageResult> {
    if (!this.session) {
      return {
        success: false,
        error: 'No active conversation session. Call startConversation first.',
      };
    }

    // Update callbacks
    this.session.callbacks = callbacks;
    this.session.outputBuffer = '';

    // Notify sending
    callbacks?.onSending?.();

    try {
      // Get the agent configuration
      const agent = await window.maestro.agents.get(this.session.agentType);
      if (!agent || !agent.available) {
        return {
          success: false,
          error: `Agent ${this.session.agentType} is not available`,
        };
      }

      // Build the full prompt with conversation context
      const fullPrompt = this.buildPromptWithContext(
        userMessage,
        conversationHistory
      );

      // Spawn the agent process
      const spawnResult = await this.spawnAgentForMessage(agent, fullPrompt);

      if (!spawnResult.success) {
        callbacks?.onError?.(spawnResult.error || 'Failed to spawn agent');
        return spawnResult;
      }

      // Wait for the response
      const result = await this.waitForResponse();

      // Notify complete
      callbacks?.onComplete?.(result);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      callbacks?.onError?.(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Build the full prompt including conversation context
   */
  private buildPromptWithContext(
    userMessage: string,
    conversationHistory: WizardMessage[]
  ): string {
    if (!this.session) {
      return formatUserMessage(userMessage);
    }

    // Start with the system prompt
    let prompt = this.session.systemPrompt + '\n\n';

    // Add conversation history
    if (conversationHistory.length > 0) {
      prompt += '## Previous Conversation\n\n';
      for (const msg of conversationHistory) {
        if (msg.role === 'user') {
          prompt += `User: ${msg.content}\n\n`;
        } else if (msg.role === 'assistant') {
          prompt += `Assistant: ${msg.content}\n\n`;
        }
      }
    }

    // Add the current user message with the structured output suffix
    prompt += '## Current Message\n\n';
    prompt += formatUserMessage(userMessage);

    return prompt;
  }

  /**
   * Spawn the agent process for a single message exchange
   */
  private async spawnAgentForMessage(
    agent: any,
    prompt: string
  ): Promise<SendMessageResult> {
    if (!this.session) {
      return { success: false, error: 'No active session' };
    }

    return new Promise<SendMessageResult>((resolve) => {
      // Set up data listener
      this.session!.dataListenerCleanup = window.maestro.process.onData(
        (sessionId: string, data: string) => {
          if (sessionId === this.session?.sessionId) {
            this.session.outputBuffer += data;
            this.session.callbacks?.onChunk?.(data);
          }
        }
      );

      // Set up exit listener
      this.session!.exitListenerCleanup = window.maestro.process.onExit(
        (sessionId: string, code: number) => {
          if (sessionId === this.session?.sessionId) {
            // Agent finished - resolve with parsed output
            this.cleanupListeners();

            if (code === 0) {
              const parsedResponse = this.parseAgentOutput();
              resolve({
                success: true,
                response: parsedResponse,
                rawOutput: this.session?.outputBuffer,
              });
            } else {
              resolve({
                success: false,
                error: `Agent exited with code ${code}`,
                rawOutput: this.session?.outputBuffer,
              });
            }
          }
        }
      );

      // Store resolve for potential early termination
      this.session!.pendingResolve = resolve;

      // Spawn the agent with the prompt
      window.maestro.process
        .spawn({
          sessionId: this.session!.sessionId,
          toolType: this.session!.agentType,
          cwd: this.session!.directoryPath,
          command: agent.command,
          args: [...(agent.args || [])],
          prompt: prompt,
        })
        .then(() => {
          // Notify that we're receiving
          this.session?.callbacks?.onReceiving?.();
        })
        .catch((error: Error) => {
          this.cleanupListeners();
          resolve({
            success: false,
            error: `Failed to spawn agent: ${error.message}`,
          });
        });
    });
  }

  /**
   * Wait for the agent response to complete
   * (Used for additional waiting if needed)
   */
  private waitForResponse(): Promise<SendMessageResult> {
    if (!this.session?.pendingResolve) {
      return Promise.resolve({
        success: false,
        error: 'No pending response to wait for',
      });
    }

    // The response is handled by the exit listener set up in spawnAgentForMessage
    return new Promise((resolve) => {
      // This is a fallback - normally resolved by exit listener
      const timeout = setTimeout(() => {
        this.cleanupListeners();
        resolve({
          success: false,
          error: 'Response timeout - agent did not complete in time',
          rawOutput: this.session?.outputBuffer,
        });
      }, 120000); // 2 minute timeout

      // Store cleanup for timeout
      const originalResolve = this.session!.pendingResolve;
      this.session!.pendingResolve = (result) => {
        clearTimeout(timeout);
        originalResolve?.(result);
        resolve(result);
      };
    });
  }

  /**
   * Parse the accumulated agent output to extract the structured response
   */
  private parseAgentOutput(): ParsedResponse {
    if (!this.session) {
      return {
        structured: null,
        rawText: '',
        parseSuccess: false,
        parseError: 'No active session',
      };
    }

    const output = this.session.outputBuffer;

    // Try to extract the result from stream-json format
    const extractedResult = this.extractResultFromStreamJson(output);
    const textToParse = extractedResult || output;

    return parseStructuredOutput(textToParse);
  }

  /**
   * Extract the result field from Claude's stream-json output format
   */
  private extractResultFromStreamJson(output: string): string | null {
    try {
      // Look for the result message in stream-json format
      const lines = output.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'result' && msg.result) {
            return msg.result;
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    } catch {
      // Fallback to raw output
    }
    return null;
  }

  /**
   * Clean up event listeners
   */
  private cleanupListeners(): void {
    if (this.session?.dataListenerCleanup) {
      this.session.dataListenerCleanup();
      this.session.dataListenerCleanup = undefined;
    }
    if (this.session?.exitListenerCleanup) {
      this.session.exitListenerCleanup();
      this.session.exitListenerCleanup = undefined;
    }
  }

  /**
   * End the current conversation session
   */
  async endConversation(): Promise<void> {
    if (!this.session) return;

    this.cleanupListeners();

    // Kill any running process
    try {
      await window.maestro.process.kill(this.session.sessionId);
    } catch {
      // Process may already be dead
    }

    this.session = null;
  }

  /**
   * Check if there's an active conversation
   */
  isConversationActive(): boolean {
    return this.session !== null && this.session.isActive;
  }

  /**
   * Get the current session ID (if any)
   */
  getSessionId(): string | null {
    return this.session?.sessionId || null;
  }

  /**
   * Get the ready confidence threshold
   */
  getReadyThreshold(): number {
    return READY_CONFIDENCE_THRESHOLD;
  }

  /**
   * Check if a response indicates ready to proceed
   */
  checkIsReady(response: StructuredAgentResponse): boolean {
    return isReadyToProceed(response);
  }
}

// Export singleton instance
export const conversationManager = new ConversationManager();

/**
 * Helper function to create a user message for the conversation history
 */
export function createUserMessage(content: string): Omit<WizardMessage, 'id' | 'timestamp'> {
  return {
    role: 'user',
    content,
  };
}

/**
 * Helper function to create an assistant message for the conversation history
 */
export function createAssistantMessage(
  response: ParsedResponse
): Omit<WizardMessage, 'id' | 'timestamp'> {
  const structured = response.structured;
  return {
    role: 'assistant',
    content: structured?.message || response.rawText,
    confidence: structured?.confidence,
    ready: structured?.ready,
  };
}

/**
 * Helper function to determine if conversation should auto-proceed
 */
export function shouldAutoProceed(response: ParsedResponse): boolean {
  return (
    response.parseSuccess &&
    response.structured !== null &&
    isReadyToProceed(response.structured)
  );
}
