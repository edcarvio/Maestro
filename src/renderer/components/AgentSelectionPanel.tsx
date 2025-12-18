import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AgentConfig, Theme } from '../types';

export interface AgentSelectionPanelProps {
  /** List of available agents */
  agents: AgentConfig[];
  /** Whether agents are still loading */
  loading: boolean;
  /** Currently selected default agent ID */
  defaultAgent: string;
  /** Callback to set the default agent */
  setDefaultAgent: (agentId: string) => void;
  /** Agent configurations keyed by agent ID */
  agentConfigs: Record<string, Record<string, any>>;
  /** Callback to update agent configurations */
  setAgentConfigs: React.Dispatch<React.SetStateAction<Record<string, Record<string, any>>>>;
  /** Custom agent paths keyed by agent ID */
  customAgentPaths: Record<string, string>;
  /** Callback to update custom agent paths */
  setCustomAgentPaths: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Callback to reload agents after path changes */
  loadAgents: () => Promise<void>;
  /** The current theme */
  theme: Theme;
}

/**
 * A panel for selecting and configuring AI agents in settings.
 * Displays:
 * - List of available agents with availability badges
 * - Custom path input for Claude Code
 * - Agent-specific configuration options (checkboxes)
 */
export function AgentSelectionPanel({
  agents,
  loading,
  defaultAgent,
  setDefaultAgent,
  agentConfigs,
  setAgentConfigs,
  customAgentPaths,
  setCustomAgentPaths,
  loadAgents,
  theme,
}: AgentSelectionPanelProps): React.ReactElement {
  // Track available models for agents that support model selection
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  // Fetch models for an agent
  const fetchModels = useCallback(async (agentId: string, forceRefresh = false) => {
    setLoadingModels(prev => ({ ...prev, [agentId]: true }));
    try {
      const models = await window.maestro.agents.getModels(agentId, forceRefresh);
      setAvailableModels(prev => ({ ...prev, [agentId]: models }));
    } catch (error) {
      console.error(`Failed to fetch models for ${agentId}:`, error);
      setAvailableModels(prev => ({ ...prev, [agentId]: [] }));
    } finally {
      setLoadingModels(prev => ({ ...prev, [agentId]: false }));
    }
  }, []);

  // Fetch models when an agent with model selection is selected
  useEffect(() => {
    const selectedAgent = agents.find(a => a.id === defaultAgent);
    // Check if the agent's configOptions include a 'model' option
    // This indicates the agent supports model selection
    const hasModelOption = selectedAgent?.configOptions?.some((opt) => opt.key === 'model');

    if (selectedAgent && selectedAgent.available && hasModelOption && !availableModels[defaultAgent]) {
      fetchModels(defaultAgent);
    }
  }, [defaultAgent, agents, fetchModels, availableModels]);

  return (
    <>
      {/* Default AI Agent Selection */}
      <div>
        <label className="block text-xs font-bold opacity-70 uppercase mb-2">Default AI Agent</label>
        {loading ? (
          <div className="text-sm opacity-50">Loading agents...</div>
        ) : (
          <div className="space-y-2">
            {agents.filter((agent) => !agent.hidden).map((agent) => (
              <div
                key={agent.id}
                className={`rounded border transition-all ${
                  defaultAgent === agent.id ? 'ring-2' : ''
                }`}
                style={{
                  borderColor: theme.colors.border,
                  backgroundColor: defaultAgent === agent.id ? theme.colors.accentDim : theme.colors.bgMain,
                  ringColor: theme.colors.accent,
                }}
              >
                <button
                  disabled={!(agent.id === 'claude-code' || agent.id === 'opencode' || agent.id === 'codex') || !agent.available}
                  onClick={() => setDefaultAgent(agent.id)}
                  className={`w-full text-left p-3 ${(!(agent.id === 'claude-code' || agent.id === 'opencode' || agent.id === 'codex') || !agent.available) ? 'opacity-40 cursor-not-allowed' : 'hover:bg-opacity-10'}`}
                  style={{ color: theme.colors.textMain }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{agent.name}</div>
                      {agent.path && (
                        <div className="text-xs opacity-50 font-mono mt-1">{agent.path}</div>
                      )}
                    </div>
                    {agent.id === 'claude-code' || agent.id === 'opencode' || agent.id === 'codex' ? (
                      agent.available ? (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.success + '20', color: theme.colors.success }}>
                          Available
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.error + '20', color: theme.colors.error }}>
                          Not Found
                        </span>
                      )
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: theme.colors.warning + '20', color: theme.colors.warning }}>
                        Coming Soon
                      </span>
                    )}
                  </div>
                </button>
                {/* Custom path input for supported agents */}
                {(agent.id === 'claude-code' || agent.id === 'opencode' || agent.id === 'codex') && (
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
                        placeholder="/path/to/claude"
                        className="flex-1 p-1.5 rounded border bg-transparent outline-none text-xs font-mono"
                        style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                      />
                      {customAgentPaths[agent.id] && (
                        <button
                          onClick={async () => {
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
      </div>

      {/* Agent-Specific Configuration */}
      {!loading && agents.length > 0 && (() => {
        const selectedAgent = agents.find(a => a.id === defaultAgent);
        if (!selectedAgent || !selectedAgent.configOptions || selectedAgent.configOptions.length === 0) {
          return null;
        }

        return (
          <div>
            <label className="block text-xs font-bold opacity-70 uppercase mb-2">
              {selectedAgent.name} Configuration
            </label>
            <div className="space-y-3">
              {selectedAgent.configOptions.map((option: any) => (
                <div key={option.key}>
                  {option.type === 'checkbox' && (
                    <label className="flex items-center gap-3 p-3 rounded border cursor-pointer hover:bg-opacity-10"
                           style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}>
                      <input
                        type="checkbox"
                        checked={agentConfigs[selectedAgent.id]?.[option.key] ?? option.default}
                        onChange={(e) => {
                          const newConfig = {
                            ...agentConfigs[selectedAgent.id],
                            [option.key]: e.target.checked
                          };
                          setAgentConfigs(prev => ({
                            ...prev,
                            [selectedAgent.id]: newConfig
                          }));
                          window.maestro.agents.setConfig(selectedAgent.id, newConfig);
                        }}
                        className="w-4 h-4"
                        style={{ accentColor: theme.colors.accent }}
                      />
                      <div className="flex-1">
                        <div className="font-medium" style={{ color: theme.colors.textMain }}>
                          {option.label}
                        </div>
                        <div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
                          {option.description}
                        </div>
                      </div>
                    </label>
                  )}
                  {option.type === 'text' && (
                    <div className="p-3 rounded border" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}>
                      <div className="mb-2">
                        <div className="font-medium" style={{ color: theme.colors.textMain }}>
                          {option.label}
                        </div>
                        <div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
                          {option.description}
                        </div>
                      </div>
                      {/* Model selection with dropdown for discovered models */}
                      {option.key === 'model' && (availableModels[selectedAgent.id]?.length > 0 || loadingModels[selectedAgent.id]) ? (
                        <div className="flex gap-2">
                          <select
                            value={agentConfigs[selectedAgent.id]?.[option.key] ?? option.default}
                            onChange={(e) => {
                              const newConfig = {
                                ...agentConfigs[selectedAgent.id],
                                [option.key]: e.target.value
                              };
                              setAgentConfigs(prev => ({
                                ...prev,
                                [selectedAgent.id]: newConfig
                              }));
                              // Persist immediately on select
                              window.maestro.agents.setConfig(selectedAgent.id, newConfig);
                            }}
                            className="flex-1 p-2 rounded border bg-transparent outline-none text-sm font-mono cursor-pointer"
                            style={{ borderColor: theme.colors.border, color: theme.colors.textMain, backgroundColor: theme.colors.bgMain }}
                            disabled={loadingModels[selectedAgent.id]}
                          >
                            <option value="">Default model</option>
                            {availableModels[selectedAgent.id]?.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => fetchModels(selectedAgent.id, true)}
                            className="p-2 rounded border hover:bg-opacity-10 transition-colors"
                            style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
                            title="Refresh model list"
                            disabled={loadingModels[selectedAgent.id]}
                          >
                            <RefreshCw className={`w-4 h-4 ${loadingModels[selectedAgent.id] ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={agentConfigs[selectedAgent.id]?.[option.key] ?? option.default}
                          onChange={(e) => {
                            const newConfig = {
                              ...agentConfigs[selectedAgent.id],
                              [option.key]: e.target.value
                            };
                            setAgentConfigs(prev => ({
                              ...prev,
                              [selectedAgent.id]: newConfig
                            }));
                          }}
                          onBlur={() => {
                            // Only persist on blur to avoid excessive writes
                            const currentConfig = agentConfigs[selectedAgent.id] || {};
                            window.maestro.agents.setConfig(selectedAgent.id, currentConfig);
                          }}
                          placeholder={option.default || ''}
                          className="w-full p-2 rounded border bg-transparent outline-none text-sm font-mono"
                          style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                        />
                      )}
                      {/* Show hint if model discovery is available but not yet loaded */}
                      {option.key === 'model' && !loadingModels[selectedAgent.id] && !availableModels[selectedAgent.id] && (
                        <button
                          onClick={() => fetchModels(selectedAgent.id)}
                          className="mt-2 text-xs underline opacity-60 hover:opacity-100"
                          style={{ color: theme.colors.accent }}
                        >
                          Load available models
                        </button>
                      )}
                    </div>
                  )}
                  {option.type === 'number' && (
                    <div className="p-3 rounded border" style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}>
                      <div className="mb-2">
                        <div className="font-medium" style={{ color: theme.colors.textMain }}>
                          {option.label}
                        </div>
                        <div className="text-xs opacity-50 mt-0.5" style={{ color: theme.colors.textDim }}>
                          {option.description}
                        </div>
                      </div>
                      <input
                        type="number"
                        value={agentConfigs[selectedAgent.id]?.[option.key] ?? option.default}
                        onChange={(e) => {
                          const value = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
                          const newConfig = {
                            ...agentConfigs[selectedAgent.id],
                            [option.key]: isNaN(value) ? 0 : value
                          };
                          setAgentConfigs(prev => ({
                            ...prev,
                            [selectedAgent.id]: newConfig
                          }));
                        }}
                        onBlur={() => {
                          // Only persist on blur to avoid excessive writes
                          const currentConfig = agentConfigs[selectedAgent.id] || {};
                          window.maestro.agents.setConfig(selectedAgent.id, currentConfig);
                        }}
                        placeholder={option.default?.toString() || '0'}
                        min={0}
                        className="w-full p-2 rounded border bg-transparent outline-none text-sm font-mono"
                        style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}
