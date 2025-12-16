import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Folder, RefreshCw } from 'lucide-react';
import type { AgentConfig, Session, ToolType } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { validateNewSession } from '../utils/sessionValidation';
import { FormInput } from './ui/FormInput';
import { Modal, ModalFooter } from './ui/Modal';

interface AgentDebugInfo {
  agentId: string;
  available: boolean;
  path: string | null;
  binaryName: string;
  envPath: string;
  homeDir: string;
  platform: string;
  whichCommand: string;
  error: string | null;
}

interface NewInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (agentId: string, workingDir: string, name: string) => void;
  theme: any;
  defaultAgent: string;
  existingSessions: Session[];
}

export function NewInstanceModal({ isOpen, onClose, onCreate, theme, defaultAgent, existingSessions }: NewInstanceModalProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [selectedAgent, setSelectedAgent] = useState(defaultAgent);
  const [workingDir, setWorkingDir] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshingAgent, setRefreshingAgent] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<AgentDebugInfo | null>(null);
  const [homeDir, setHomeDir] = useState<string>('');
  const [customAgentPaths, setCustomAgentPaths] = useState<Record<string, string>>({});

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Fetch home directory on mount for tilde expansion
  useEffect(() => {
    window.maestro.fs.homeDir().then(setHomeDir);
  }, []);

  // Expand tilde in path
  const expandTilde = (path: string): string => {
    if (!homeDir) return path;
    if (path === '~') return homeDir;
    if (path.startsWith('~/')) return homeDir + path.slice(1);
    return path;
  };

  // Validate session uniqueness
  const validation = useMemo(() => {
    const name = instanceName.trim();
    const expandedDir = expandTilde(workingDir.trim());
    if (!name || !expandedDir || !selectedAgent) {
      return { valid: true }; // Don't show errors until fields are filled
    }
    return validateNewSession(name, expandedDir, selectedAgent as ToolType, existingSessions);
  }, [instanceName, workingDir, selectedAgent, existingSessions, homeDir]);

  // Define handlers first before they're used in effects
  const loadAgents = async () => {
    setLoading(true);
    try {
      const detectedAgents = await window.maestro.agents.detect();
      setAgents(detectedAgents);

      // Load custom paths for agents
      const paths = await window.maestro.agents.getAllCustomPaths();
      setCustomAgentPaths(paths);

      // Set default or first available
      const defaultAvailable = detectedAgents.find((a: AgentConfig) => a.id === defaultAgent && a.available);
      const firstAvailable = detectedAgents.find((a: AgentConfig) => a.available);

      if (defaultAvailable) {
        setSelectedAgent(defaultAgent);
      } else if (firstAvailable) {
        setSelectedAgent(firstAvailable.id);
      }
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = React.useCallback(async () => {
    const folder = await window.maestro.dialog.selectFolder();
    if (folder) {
      setWorkingDir(folder);
    }
  }, []);

  const handleRefreshAgent = React.useCallback(async (agentId: string) => {
    setRefreshingAgent(agentId);
    setDebugInfo(null);
    try {
      const result = await window.maestro.agents.refresh(agentId);
      setAgents(result.agents);
      if (result.debugInfo && !result.debugInfo.available) {
        setDebugInfo(result.debugInfo);
      }
    } catch (error) {
      console.error('Failed to refresh agent:', error);
    } finally {
      setRefreshingAgent(null);
    }
  }, []);

  const handleCreate = React.useCallback(() => {
    const name = instanceName.trim();
    if (!name) return; // Name is required
    // Expand tilde before passing to callback
    const expandedWorkingDir = expandTilde(workingDir.trim());

    // Validate before creating
    const result = validateNewSession(name, expandedWorkingDir, selectedAgent as ToolType, existingSessions);
    if (!result.valid) return;

    onCreate(selectedAgent, expandedWorkingDir, name);
    onClose();

    // Reset
    setInstanceName('');
    setWorkingDir('');
  }, [instanceName, selectedAgent, workingDir, onCreate, onClose, expandTilde, existingSessions]);

  // Check if form is valid for submission
  const isFormValid = useMemo(() => {
    return selectedAgent &&
           agents.find(a => a.id === selectedAgent)?.available &&
           workingDir.trim() &&
           instanceName.trim() &&
           validation.valid;
  }, [selectedAgent, agents, workingDir, instanceName, validation.valid]);

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Handle Cmd+O for folder picker before stopping propagation
    if ((e.key === 'o' || e.key === 'O') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleSelectFolder();
      return;
    }
    // Handle Cmd+Enter for creating agent
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      if (isFormValid) {
        handleCreate();
      }
      return;
    }
  }, [handleSelectFolder, handleCreate, isFormValid]);

  // Effects
  useEffect(() => {
    if (isOpen) {
      loadAgents();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div onKeyDown={handleKeyDown}>
      <Modal
        theme={theme}
        title="Create New Agent"
        priority={MODAL_PRIORITIES.NEW_INSTANCE}
        onClose={onClose}
        width={500}
        initialFocusRef={nameInputRef}
        footer={
          <ModalFooter
            theme={theme}
            onCancel={onClose}
            onConfirm={handleCreate}
            confirmLabel="Create Agent"
            confirmDisabled={!isFormValid}
          />
        }
      >
        <div className="space-y-5">
          {/* Agent Name */}
          <FormInput
            ref={nameInputRef}
            id="agent-name-input"
            theme={theme}
            label="Agent Name"
            value={instanceName}
            onChange={setInstanceName}
            placeholder=""
            error={validation.errorField === 'name' ? validation.error : undefined}
            heightClass="p-2"
          />

          {/* Agent Selection */}
          <div>
            <label className="block text-xs font-bold opacity-70 uppercase mb-2" style={{ color: theme.colors.textMain }}>
              Agent Provider
            </label>
            {loading ? (
              <div className="text-sm opacity-50">Loading agents...</div>
            ) : (
              <div className="space-y-2">
                {agents.filter(a => !a.hidden).map((agent) => (
                  <div
                    key={agent.id}
                    className={`rounded border transition-all ${
                      selectedAgent === agent.id ? 'ring-2' : ''
                    }`}
                    style={{
                      borderColor: theme.colors.border,
                      backgroundColor: selectedAgent === agent.id ? theme.colors.accentDim : 'transparent',
                      ringColor: theme.colors.accent,
                    }}
                  >
                    <div
                      onClick={() => {
                        if (agent.id === 'claude-code' && agent.available) {
                          setSelectedAgent(agent.id);
                        }
                      }}
                      className={`w-full text-left p-3 ${(agent.id !== 'claude-code' || !agent.available) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-opacity-10 cursor-pointer'}`}
                      style={{ color: theme.colors.textMain }}
                      role="option"
                      aria-selected={selectedAgent === agent.id}
                      tabIndex={agent.id === 'claude-code' && agent.available ? 0 : -1}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{agent.name}</div>
                          {agent.path && (
                            <div className="text-xs opacity-50 font-mono mt-1">{agent.path}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {agent.id === 'claude-code' ? (
                            <>
                              {agent.available ? (
                                <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.success + '20', color: theme.colors.success }}>
                                  Available
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.error + '20', color: theme.colors.error }}>
                                  Not Found
                                </span>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRefreshAgent(agent.id);
                                }}
                                className="p-1 rounded hover:bg-white/10 transition-colors"
                                title="Refresh detection (shows debug info if not found)"
                                style={{ color: theme.colors.textDim }}
                              >
                                <RefreshCw className={`w-4 h-4 ${refreshingAgent === agent.id ? 'animate-spin' : ''}`} />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.warning + '20', color: theme.colors.warning }}>
                              Coming Soon
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Custom path input for Claude Code */}
                    {agent.id === 'claude-code' && (
                      <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: theme.colors.border }}>
                        <label className="block text-xs opacity-60 mb-1">Custom Path (optional)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customAgentPaths[agent.id] || ''}
                            onChange={(e) => {
                              const newPaths = { ...customAgentPaths, [agent.id]: e.target.value };
                              setCustomAgentPaths(newPaths);
                            }}
                            onBlur={async () => {
                              const path = customAgentPaths[agent.id]?.trim() || null;
                              await window.maestro.agents.setCustomPath(agent.id, path);
                              // Refresh agents to pick up the new path
                              loadAgents();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="/path/to/claude"
                            className="flex-1 p-1.5 rounded border bg-transparent outline-none text-xs font-mono"
                            style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                          />
                          {customAgentPaths[agent.id] && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newPaths = { ...customAgentPaths };
                                delete newPaths[agent.id];
                                setCustomAgentPaths(newPaths);
                                await window.maestro.agents.setCustomPath(agent.id, null);
                                loadAgents();
                              }}
                              className="px-2 py-1 rounded text-xs"
                              style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <p className="text-xs opacity-40 mt-1">
                          Specify a custom path if the agent is not in your PATH
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Debug Info Display */}
            {debugInfo && (
              <div
                className="mt-3 p-3 rounded border text-xs font-mono overflow-auto max-h-40"
                style={{
                  backgroundColor: theme.colors.error + '10',
                  borderColor: theme.colors.error + '40',
                  color: theme.colors.textMain,
                }}
              >
                <div className="font-bold mb-2" style={{ color: theme.colors.error }}>
                  Debug Info: {debugInfo.binaryName} not found
                </div>
                {debugInfo.error && (
                  <div className="mb-2 text-red-400">{debugInfo.error}</div>
                )}
                <div className="space-y-1 opacity-70">
                  <div><span className="opacity-50">Platform:</span> {debugInfo.platform}</div>
                  <div><span className="opacity-50">Home:</span> {debugInfo.homeDir}</div>
                  <div><span className="opacity-50">PATH:</span></div>
                  <div className="pl-2 break-all text-[10px]">
                    {debugInfo.envPath.split(':').map((p, i) => (
                      <div key={i}>{p}</div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setDebugInfo(null)}
                  className="mt-2 text-xs underline"
                  style={{ color: theme.colors.textDim }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Working Directory */}
          <FormInput
            theme={theme}
            label="Working Directory"
            value={workingDir}
            onChange={setWorkingDir}
            placeholder="Select directory..."
            error={validation.errorField === 'directory' ? validation.error : undefined}
            monospace
            heightClass="p-2"
            addon={
              <button
                onClick={handleSelectFolder}
                className="p-2 rounded border hover:bg-opacity-10"
                style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                title="Browse folders (Cmd+O)"
              >
                <Folder className="w-5 h-5" />
              </button>
            }
          />
        </div>
      </Modal>
    </div>
  );
}
