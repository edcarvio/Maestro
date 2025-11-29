import { useState, useCallback, useRef, useEffect } from 'react';
import type { BatchRunState, Session, HistoryEntry } from '../types';

// Regex to count unchecked markdown checkboxes: - [ ] task
const UNCHECKED_TASK_REGEX = /^[\s]*-\s*\[\s*\]\s*.+$/gm;

// Default empty batch state
const DEFAULT_BATCH_STATE: BatchRunState = {
  isRunning: false,
  isStopping: false,
  totalTasks: 0,
  completedTasks: 0,
  currentTaskIndex: 0,
  originalContent: '',
  sessionIds: []
};

interface BatchCompleteInfo {
  sessionId: string;
  sessionName: string;
  completedTasks: number;
  totalTasks: number;
  wasStopped: boolean;
  elapsedTimeMs: number;
}

interface UseBatchProcessorProps {
  sessions: Session[];
  onUpdateSession: (sessionId: string, updates: Partial<Session>) => void;
  onSpawnAgent: (sessionId: string, prompt: string) => Promise<{ success: boolean; response?: string; claudeSessionId?: string }>;
  onAddHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void;
  onComplete?: (info: BatchCompleteInfo) => void;
}

interface UseBatchProcessorReturn {
  // Map of session ID to batch state
  batchRunStates: Record<string, BatchRunState>;
  // Get batch state for a specific session
  getBatchState: (sessionId: string) => BatchRunState;
  // Check if any session has an active batch
  hasAnyActiveBatch: boolean;
  // Get list of session IDs with active batches
  activeBatchSessionIds: string[];
  // Start batch run for a specific session
  startBatchRun: (sessionId: string, scratchpadContent: string, prompt: string) => Promise<void>;
  // Stop batch run for a specific session
  stopBatchRun: (sessionId: string) => void;
  // Custom prompts per session
  customPrompts: Record<string, string>;
  setCustomPrompt: (sessionId: string, prompt: string) => void;
}

/**
 * Count unchecked tasks in markdown content
 * Matches lines like: - [ ] task description
 */
export function countUnfinishedTasks(content: string): number {
  const matches = content.match(UNCHECKED_TASK_REGEX);
  return matches ? matches.length : 0;
}

/**
 * Hook for managing batch processing of scratchpad tasks across multiple sessions
 */
export function useBatchProcessor({
  sessions,
  onUpdateSession,
  onSpawnAgent,
  onAddHistoryEntry,
  onComplete
}: UseBatchProcessorProps): UseBatchProcessorReturn {
  // Batch states per session
  const [batchRunStates, setBatchRunStates] = useState<Record<string, BatchRunState>>({});

  // Custom prompts per session
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});

  // Refs for tracking stop requests per session
  const stopRequestedRefs = useRef<Record<string, boolean>>({});
  const scratchpadPathRefs = useRef<Record<string, string | null>>({});

  // Helper to get batch state for a session
  const getBatchState = useCallback((sessionId: string): BatchRunState => {
    return batchRunStates[sessionId] || DEFAULT_BATCH_STATE;
  }, [batchRunStates]);

  // Check if any session has an active batch
  const hasAnyActiveBatch = Object.values(batchRunStates).some(state => state.isRunning);

  // Get list of session IDs with active batches
  const activeBatchSessionIds = Object.entries(batchRunStates)
    .filter(([_, state]) => state.isRunning)
    .map(([sessionId]) => sessionId);

  // Set custom prompt for a session
  const setCustomPrompt = useCallback((sessionId: string, prompt: string) => {
    setCustomPrompts(prev => ({ ...prev, [sessionId]: prompt }));
  }, []);

  // Broadcast batch run state changes to web interface
  useEffect(() => {
    // Broadcast state for each session that has batch state
    Object.entries(batchRunStates).forEach(([sessionId, state]) => {
      if (state.isRunning || state.completedTasks > 0) {
        window.maestro.web.broadcastAutoRunState(sessionId, {
          isRunning: state.isRunning,
          totalTasks: state.totalTasks,
          completedTasks: state.completedTasks,
          currentTaskIndex: state.currentTaskIndex,
          isStopping: state.isStopping,
        });
      } else {
        // When not running and no completed tasks, broadcast null to clear the state
        window.maestro.web.broadcastAutoRunState(sessionId, null);
      }
    });
  }, [batchRunStates]);

  /**
   * Start a batch processing run for a specific session
   */
  const startBatchRun = useCallback(async (sessionId: string, scratchpadContent: string, prompt: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      console.error('Session not found for batch processing:', sessionId);
      return;
    }

    // Track batch start time for completion notification
    const batchStartTime = Date.now();

    // Count tasks
    const totalTasks = countUnfinishedTasks(scratchpadContent);

    if (totalTasks === 0) {
      console.warn('No unchecked tasks found in scratchpad for session:', sessionId);
      return;
    }

    // Reset stop flag for this session
    stopRequestedRefs.current[sessionId] = false;

    // Write scratchpad content to temp file
    const writeResult = await window.maestro.tempfile.write(
      scratchpadContent,
      `maestro-scratchpad-${sessionId}-${Date.now()}.md`
    );

    if (!writeResult.success || !writeResult.path) {
      console.error('Failed to write temp file:', writeResult.error);
      return;
    }

    scratchpadPathRefs.current[sessionId] = writeResult.path;

    // Replace $$SCRATCHPAD$$ placeholder with actual path
    const finalPrompt = prompt.replace(/\$\$SCRATCHPAD\$\$/g, writeResult.path);

    // Initialize batch run state for this session
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        isRunning: true,
        isStopping: false,
        totalTasks,
        completedTasks: 0,
        currentTaskIndex: 0,
        scratchpadPath: writeResult.path,
        originalContent: scratchpadContent,
        customPrompt: prompt !== '' ? prompt : undefined,
        sessionIds: []
      }
    }));

    // Store custom prompt for persistence
    setCustomPrompts(prev => ({ ...prev, [sessionId]: prompt }));

    // Run agent iterations
    const claudeSessionIds: string[] = [];
    let completedCount = 0;

    // Helper to get current session state (for capturing updated usage stats)
    const getCurrentSession = () => sessions.find(s => s.id === sessionId);

    for (let i = 0; i < totalTasks; i++) {
      // Check if stop was requested for this session
      if (stopRequestedRefs.current[sessionId]) {
        console.log('Batch run stopped by user after task', i, 'for session:', sessionId);
        break;
      }

      // Update current task index
      setBatchRunStates(prev => ({
        ...prev,
        [sessionId]: {
          ...prev[sessionId],
          currentTaskIndex: i
        }
      }));

      try {
        // Capture start time for elapsed time tracking
        const taskStartTime = Date.now();

        // Spawn agent with the prompt for this specific session
        const result = await onSpawnAgent(sessionId, finalPrompt);

        // Capture elapsed time
        const elapsedTimeMs = Date.now() - taskStartTime;

        if (result.claudeSessionId) {
          claudeSessionIds.push(result.claudeSessionId);
          // Register as auto-initiated Maestro session
          window.maestro.claude.registerSessionOrigin(session.cwd, result.claudeSessionId, 'auto')
            .catch(err => console.error('[BatchProcessor] Failed to register session origin:', err));
        }

        completedCount++;

        // Update progress
        setBatchRunStates(prev => ({
          ...prev,
          [sessionId]: {
            ...prev[sessionId],
            completedTasks: completedCount,
            sessionIds: [...(prev[sessionId]?.sessionIds || []), result.claudeSessionId || '']
          }
        }));

        // Get current session state to capture usage stats
        const currentSession = getCurrentSession();

        // Add history entry for this task (both success and failure)
        const fullResponse = result.response || '';
        let summary = `Task ${i + 1} of ${totalTasks}`;

        if (fullResponse) {
          // Try to extract meaningful text - skip ANSI codes and find actual content
          const cleanResponse = fullResponse
            .replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI codes
            .replace(/─+/g, '') // Remove horizontal lines
            .replace(/[│┌┐└┘├┤┬┴┼]/g, '') // Remove box drawing chars
            .trim();

          // Find first meaningful sentence(s) - skip empty lines and very short lines
          const lines = cleanResponse.split('\n').filter(l => l.trim().length > 10);
          if (lines.length > 0) {
            // Take first line that looks like content, truncate to ~150 chars
            const firstContent = lines[0].trim();
            summary = firstContent.length > 150
              ? firstContent.substring(0, 147) + '...'
              : firstContent;
          }
        } else if (!result.success) {
          summary = `Task ${i + 1} of ${totalTasks} failed`;
        }

        onAddHistoryEntry({
          type: 'AUTO',
          timestamp: Date.now(),
          summary,
          fullResponse: fullResponse || undefined,
          claudeSessionId: result.claudeSessionId,
          projectPath: session.cwd,
          sessionId: sessionId, // Associate with this Maestro session for isolation
          success: result.success,
          // Capture usage stats and context at time of task completion
          contextUsage: currentSession?.contextUsage,
          usageStats: currentSession?.usageStats ? {
            inputTokens: currentSession.usageStats.inputTokens,
            outputTokens: currentSession.usageStats.outputTokens,
            cacheReadInputTokens: currentSession.usageStats.cacheReadInputTokens,
            cacheCreationInputTokens: currentSession.usageStats.cacheCreationInputTokens,
            totalCostUsd: currentSession.usageStats.totalCostUsd,
            contextWindow: currentSession.usageStats.contextWindow,
          } : undefined,
          elapsedTimeMs
        });

        // Re-read the scratchpad file to check remaining tasks and sync to UI
        const readResult = await window.maestro.tempfile.read(writeResult.path);
        if (readResult.success && readResult.content) {
          // Sync scratchpad changes to UI after each task
          console.log('[BatchProcessor] Syncing scratchpad after task', i + 1, 'for session:', sessionId);
          onUpdateSession(sessionId, { scratchPadContent: readResult.content });

          const remainingTasks = countUnfinishedTasks(readResult.content);
          console.log('[BatchProcessor] Remaining unchecked tasks:', remainingTasks);

          // If no more tasks, we're done
          if (remainingTasks === 0) {
            console.log('All tasks completed by agent for session:', sessionId);
            break;
          }
        }
      } catch (error) {
        console.error(`Error running task ${i + 1} for session ${sessionId}:`, error);
        // Continue to next task on error
      }
    }

    // Sync back changes from temp file
    try {
      const finalReadResult = await window.maestro.tempfile.read(writeResult.path);
      if (finalReadResult.success && finalReadResult.content) {
        // Update session's scratchpad content
        onUpdateSession(sessionId, { scratchPadContent: finalReadResult.content });
      }
    } catch (error) {
      console.error('Error reading final scratchpad state:', error);
    }

    // Clean up temp file
    try {
      await window.maestro.tempfile.delete(writeResult.path);
    } catch (error) {
      console.error('Error deleting temp file:', error);
    }

    // Reset state for this session
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        isRunning: false,
        isStopping: false,
        totalTasks: 0,
        completedTasks: 0,
        currentTaskIndex: 0,
        originalContent: '',
        sessionIds: claudeSessionIds
      }
    }));

    scratchpadPathRefs.current[sessionId] = null;

    // Call completion callback if provided
    if (onComplete) {
      const wasStopped = stopRequestedRefs.current[sessionId] || false;
      onComplete({
        sessionId,
        sessionName: session.name || session.cwd.split('/').pop() || 'Unknown',
        completedTasks: completedCount,
        totalTasks,
        wasStopped,
        elapsedTimeMs: Date.now() - batchStartTime
      });
    }
  }, [sessions, onUpdateSession, onSpawnAgent, onAddHistoryEntry, onComplete]);

  /**
   * Request to stop the batch run for a specific session after current task completes
   */
  const stopBatchRun = useCallback((sessionId: string) => {
    stopRequestedRefs.current[sessionId] = true;
    setBatchRunStates(prev => ({
      ...prev,
      [sessionId]: {
        ...prev[sessionId],
        isStopping: true
      }
    }));
  }, []);

  return {
    batchRunStates,
    getBatchState,
    hasAnyActiveBatch,
    activeBatchSessionIds,
    startBatchRun,
    stopBatchRun,
    customPrompts,
    setCustomPrompt
  };
}
