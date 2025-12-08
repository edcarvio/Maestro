# Agent Support Architecture

This document describes the architecture for supporting multiple AI coding agents in Maestro, the refactoring needed to move from Claude-specific code to a generic agent abstraction, and how to add new agents.

## Table of Contents

- [Overview](#overview)
- [Agent Capability Model](#agent-capability-model)
- [Current State: Claude-Specific Code](#current-state-claude-specific-code)
- [Target State: Generic Agent Architecture](#target-state-generic-agent-architecture)
- [Refactoring Plan](#refactoring-plan)
- [Test Impact](#test-impact)
- [Adding a New Agent](#adding-a-new-agent)
- [Agent-Specific Implementations](#agent-specific-implementations)

---

## Overview

Maestro currently supports Claude Code as its primary AI agent. To support additional agents (OpenCode, Gemini CLI, Codex, Qwen3 Coder, etc.), we need to:

1. Abstract Claude-specific code into a generic agent interface
2. Define agent capabilities that control UI feature availability
3. Create agent-specific adapters for session storage, output parsing, and CLI arguments
4. Rename Claude-specific identifiers to generic "agent" terminology

---

## Agent Capability Model

Each agent declares its capabilities, which determine which UI features are available when that agent is active.

### Capability Interface

```typescript
// src/main/agent-capabilities.ts

interface AgentCapabilities {
  // Core features
  supportsResume: boolean;           // Can resume previous sessions (--resume, --session, etc.)
  supportsReadOnlyMode: boolean;     // Has a plan/read-only mode
  supportsJsonOutput: boolean;       // Emits structured JSON for parsing
  supportsSessionId: boolean;        // Emits session ID for tracking

  // Advanced features
  supportsImageInput: boolean;       // Can receive images in prompts
  supportsSlashCommands: boolean;    // Has discoverable slash commands
  supportsSessionStorage: boolean;   // Persists sessions we can browse
  supportsCostTracking: boolean;     // Reports token costs (API-based agents)
  supportsUsageStats: boolean;       // Reports token counts

  // Streaming behavior
  supportsBatchMode: boolean;        // Runs per-message (vs persistent process)
  supportsStreaming: boolean;        // Streams output incrementally
}
```

### Capability-to-UI Feature Mapping

| Capability | UI Feature | Component |
|------------|------------|-----------|
| `supportsReadOnlyMode` | Read-only toggle in input area | `InputArea.tsx` |
| `supportsSessionStorage` | Agent Sessions browser tab | `RightPanel.tsx`, `AgentSessionsBrowser.tsx` |
| `supportsResume` | Resume button in session browser | `AgentSessionsBrowser.tsx` |
| `supportsCostTracking` | Cost widget display | `MainPanel.tsx` |
| `supportsUsageStats` | Token usage display | `MainPanel.tsx`, `TabBar.tsx` |
| `supportsImageInput` | Image attachment button | `InputArea.tsx` |
| `supportsSlashCommands` | Slash command autocomplete | `InputArea.tsx`, autocomplete |
| `supportsSessionId` | Session ID pill in header | `MainPanel.tsx` |

### Per-Agent Capability Definitions

```typescript
// src/main/agent-capabilities.ts

const AGENT_CAPABILITIES: Record<string, AgentCapabilities> = {
  'claude-code': {
    supportsResume: true,
    supportsReadOnlyMode: true,        // --permission-mode plan
    supportsJsonOutput: true,          // --output-format stream-json
    supportsSessionId: true,
    supportsImageInput: true,          // --input-format stream-json
    supportsSlashCommands: true,       // Emits in init message
    supportsSessionStorage: true,      // ~/.claude/projects/
    supportsCostTracking: true,        // API-based
    supportsUsageStats: true,
    supportsBatchMode: true,
    supportsStreaming: true,
  },

  'opencode': {
    supportsResume: true,              // --session <id>
    supportsReadOnlyMode: true,        // --agent plan
    supportsJsonOutput: true,          // --format json
    supportsSessionId: true,           // sessionID in events
    supportsImageInput: true,          // -f flag
    supportsSlashCommands: false,      // TBD - needs investigation
    supportsSessionStorage: true,      // TBD - needs investigation
    supportsCostTracking: false,       // Local models = free
    supportsUsageStats: true,          // tokens in step_finish
    supportsBatchMode: true,
    supportsStreaming: true,
  },

  'gemini-cli': {
    supportsResume: false,             // TBD
    supportsReadOnlyMode: false,       // TBD
    supportsJsonOutput: false,         // TBD
    supportsSessionId: false,
    supportsImageInput: false,
    supportsSlashCommands: false,
    supportsSessionStorage: false,
    supportsCostTracking: true,        // API-based
    supportsUsageStats: false,
    supportsBatchMode: false,          // TBD
    supportsStreaming: true,
  },

  // Template for new agents - start with all false
  '_template': {
    supportsResume: false,
    supportsReadOnlyMode: false,
    supportsJsonOutput: false,
    supportsSessionId: false,
    supportsImageInput: false,
    supportsSlashCommands: false,
    supportsSessionStorage: false,
    supportsCostTracking: false,
    supportsUsageStats: false,
    supportsBatchMode: false,
    supportsStreaming: false,
  },
};
```

---

## Current State: Claude-Specific Code

The codebase has ~200+ references to "claude" that need refactoring. They fall into these categories:

### Category 1: Generic Session Identifiers (RENAME)

These represent "the agent's conversation session ID" - universal to all agents:

| Current Name | New Name | Files |
|--------------|----------|-------|
| `claudeSessionId` | `agentSessionId` | 20+ files |
| `activeClaudeSessionId` | `activeAgentSessionId` | App.tsx, MainPanel.tsx |
| `claudeCommands` | `agentCommands` | Session interface |
| `ClaudeSession` interface | `AgentSession` | AgentSessionsBrowser.tsx |
| `ClaudeSessionOrigin` | `AgentSessionOrigin` | index.ts |

**Key locations:**
- `src/renderer/types/index.ts:238,307,327` - AITab and Session interfaces
- `src/shared/types.ts:44` - HistoryEntry interface
- `src/renderer/App.tsx` - 60+ occurrences
- `src/main/index.ts` - 20+ occurrences

### Category 2: Generic Functions (RENAME)

| Current Name | New Name |
|--------------|----------|
| `startNewClaudeSession` | `startNewAgentSession` |
| `handleJumpToClaudeSession` | `handleJumpToAgentSession` |
| `onResumeClaudeSession` | `onResumeAgentSession` |
| `onNewClaudeSession` | `onNewAgentSession` |
| `spawnAgentForSession` | (already generic) |

### Category 3: IPC API (REDESIGN)

**Current:** `window.maestro.claude.*`

**New:** `window.maestro.agentSessions.*` with agent ID parameter

```typescript
// Before
window.maestro.claude.listSessions(projectPath)
window.maestro.claude.readSessionMessages(projectPath, sessionId)

// After
window.maestro.agentSessions.list(agentId, projectPath)
window.maestro.agentSessions.read(agentId, projectPath, sessionId)
```

### Category 4: Session Storage (ABSTRACT)

Each agent stores sessions differently:
- **Claude Code:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- **OpenCode:** TBD (server-managed sessions)

Create `AgentSessionStorage` interface with per-agent implementations.

### Category 5: Output Parsing (ABSTRACT)

Each agent has different JSON schemas:

| Agent | Session ID Field | Text Content | Token Stats |
|-------|------------------|--------------|-------------|
| Claude Code | `session_id` | `msg.result` | `msg.modelUsage` |
| OpenCode | `sessionID` | `msg.part.text` | `msg.part.tokens` |

Create `AgentOutputParser` interface with per-agent implementations.

### Category 6: CLI Arguments (CONFIGURE)

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| Resume | `--resume <id>` | `--session <id>` |
| Read-only | `--permission-mode plan` | `--agent plan` |
| JSON output | `--output-format stream-json` | `--format json` |
| Batch mode | `--print` | `run` subcommand |

Add to `AgentConfig`:

```typescript
interface AgentConfig {
  // ... existing fields
  resumeArgs?: (sessionId: string) => string[];
  readOnlyArgs?: string[];
  batchModeArgs?: string[];
  jsonOutputArgs?: string[];
}
```

### Category 7: KEEP AS AGENT-SPECIFIC

These should NOT be renamed - they are legitimately Claude-only:

- `id: 'claude-code'` in AGENT_DEFINITIONS
- `binaryName: 'claude'`
- `~/.claude/local` path detection
- Claude-specific CLI args in the agent definition
- Comments explaining Claude-specific behavior

---

## Target State: Generic Agent Architecture

### New Files to Create

```
src/main/
├── agent-capabilities.ts      # Capability definitions per agent
├── agent-session-storage.ts   # Abstract session storage interface
│   ├── ClaudeSessionStorage   # Claude implementation
│   └── OpenCodeSessionStorage # OpenCode implementation
├── agent-output-parser.ts     # Abstract output parser interface
│   ├── ClaudeOutputParser     # Claude implementation
│   └── OpenCodeOutputParser   # OpenCode implementation
└── agent-pricing.ts           # Cost calculation per agent
```

### Extended AgentConfig

```typescript
// src/main/agent-detector.ts

interface AgentConfig {
  // Identification
  id: string;
  name: string;
  binaryName: string;
  command: string;

  // Base arguments
  args: string[];

  // Capability-driven arguments
  resumeArgs?: (sessionId: string) => string[];   // e.g., ['--resume', id] or ['--session', id]
  readOnlyArgs?: string[];                         // e.g., ['--permission-mode', 'plan']
  jsonOutputArgs?: string[];                       // e.g., ['--format', 'json']
  batchModePrefix?: string[];                      // e.g., ['run'] for opencode

  // Runtime info
  available: boolean;
  path?: string;
  customPath?: string;
  requiresPty?: boolean;
  hidden?: boolean;

  // Capabilities (reference to AGENT_CAPABILITIES)
  capabilities: AgentCapabilities;

  // Pricing (for cost tracking)
  pricing?: {
    inputPerMillion: number;
    outputPerMillion: number;
    cacheReadPerMillion?: number;
    cacheCreationPerMillion?: number;
  };

  // Session storage configuration
  sessionStoragePath?: (projectPath: string) => string;  // e.g., ~/.claude/projects/...

  // Default context window size
  defaultContextWindow?: number;  // e.g., 200000 for Claude
}
```

### UI Capability Checks

```typescript
// src/renderer/hooks/useAgentCapabilities.ts

function useAgentCapabilities(agentId: string): AgentCapabilities {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);

  useEffect(() => {
    window.maestro.agents.getCapabilities(agentId).then(setCapabilities);
  }, [agentId]);

  return capabilities ?? DEFAULT_CAPABILITIES;
}

// Usage in components:
function InputArea({ session }) {
  const capabilities = useAgentCapabilities(session.toolType);

  return (
    <div>
      {/* Only show read-only toggle if agent supports it */}
      {capabilities.supportsReadOnlyMode && (
        <ReadOnlyToggle />
      )}

      {/* Only show image button if agent supports it */}
      {capabilities.supportsImageInput && (
        <ImageAttachButton />
      )}
    </div>
  );
}
```

---

## Refactoring Plan

### Phase 1: Foundation (Types & Capabilities)
**Effort: 2-3 hours**

1. Create `src/main/agent-capabilities.ts` with capability interface and definitions
2. Add `capabilities` field to `AgentConfig`
3. Expose capabilities via IPC: `window.maestro.agents.getCapabilities(agentId)`
4. Create `useAgentCapabilities` hook

### Phase 2: Identifier Renames
**Effort: 3-4 hours**

1. Rename in type definitions:
   - `claudeSessionId` → `agentSessionId`
   - `claudeCommands` → `agentCommands`
   - `ClaudeSession` → `AgentSession`

2. Rename in components and hooks (find-and-replace with review)

3. Rename state variables and functions in App.tsx

### Phase 3: Abstract Session Storage
**Effort: 4-5 hours**

1. Create `AgentSessionStorage` interface
2. Extract Claude session logic from `index.ts` into `ClaudeSessionStorage`
3. Create factory function `getSessionStorage(agentId)`
4. Update IPC handlers to use abstraction

### Phase 4: Abstract Output Parsing
**Effort: 3-4 hours**

1. Create `AgentOutputParser` interface
2. Extract Claude parsing from `process-manager.ts` into `ClaudeOutputParser`
3. Create `OpenCodeOutputParser`
4. Update `ProcessManager` to use factory

### Phase 5: IPC API Refactor
**Effort: 2-3 hours**

1. Add new generic API: `window.maestro.agentSessions.*`
2. Deprecate old API: `window.maestro.claude.*` (keep working, log warning)
3. Update all call sites

### Phase 6: UI Capability Gates
**Effort: 2-3 hours**

1. Add capability checks to `InputArea` (read-only toggle, image button)
2. Add capability checks to `RightPanel` (session browser availability)
3. Add capability checks to `MainPanel` (cost widget, session ID pill)
4. Add capability checks to `AgentSessionsBrowser`

### Phase 7: Add OpenCode Support
**Effort: 3-4 hours**

1. Add OpenCode to `AGENT_DEFINITIONS` with full config
2. Implement `OpenCodeOutputParser`
3. Implement `OpenCodeSessionStorage` (or mark as unsupported)
4. Test end-to-end: new session, resume, read-only mode

### Total Estimated Effort: 20-26 hours

---

## Test Impact

The test suite contains 147 test files, of which **55 files (37%)** contain Claude-specific references that will need updates during refactoring.

### Test Files Requiring Updates

| Category | Files | Changes Needed |
|----------|-------|----------------|
| Setup/Mocks | `setup.ts` | Rename `window.maestro.claude` mock to `agentSessions` |
| Type Tests | `templateVariables.test.ts` | Update `claudeSessionId` in test data |
| Hook Tests | `useSessionManager.test.ts`, `useBatchProcessor.test.ts` | Update session mock properties |
| Component Tests | `TabBar.test.tsx`, `SessionList.test.tsx`, `MainPanel.test.tsx`, `HistoryPanel.test.tsx`, `ProcessMonitor.test.tsx`, +8 more | Update `claudeSessionId` in mock data |
| CLI Tests | `batch-processor.test.ts`, `storage.test.ts` | Update mock session objects |
| Agent Tests | `agent-detector.test.ts` | **Keep as-is** (tests Claude-specific detection) |

### Tests That Should NOT Change

Some tests are legitimately Claude-specific and should remain unchanged:

- `agent-detector.test.ts` - Tests that `claude-code` agent is properly detected
- Storage tests with `claude-code` config paths - Tests Claude-specific settings
- Any test verifying Claude CLI argument construction

### Refactoring Strategy with Tests

**Recommended approach: Update tests incrementally alongside code changes.**

For each refactoring phase:

1. **Make the code change** (e.g., rename `claudeSessionId` → `agentSessionId`)
2. **Run tests** - They will fail due to type/name mismatches
3. **Update failing tests** with new names
4. **Run tests again** - They should pass
5. **Commit both code + test changes together**

This approach ensures:
- Tests catch any missed renames (TypeScript will also help)
- Each commit is self-contained and all tests pass
- The test suite remains a safety net throughout refactoring

### Test Mock Updates Per Phase

**Phase 2 (Identifier Renames):**
```typescript
// Before (in test files)
createTestSession({ claudeSessionId: 'test-123' })

// After
createTestSession({ agentSessionId: 'test-123' })
```

**Phase 5 (IPC API Refactor):**
```typescript
// Before (in setup.ts)
claude: {
  listSessions: vi.fn(),
  readSessionMessages: vi.fn(),
}

// After
agentSessions: {
  list: vi.fn(),      // Now takes agentId parameter
  read: vi.fn(),
}
```

### Estimated Test Update Effort

| Phase | Test Files Affected | Effort |
|-------|---------------------|--------|
| Phase 1: Foundation | 0 (new code) | 0 |
| Phase 2: Identifier Renames | ~45 files | 1-2 hours |
| Phase 3: Session Storage | ~5 files | 30 min |
| Phase 4: Output Parsing | ~3 files | 30 min |
| Phase 5: IPC API | ~10 files | 30 min |
| Phase 6: UI Capability Gates | ~10 files | 30 min |
| Phase 7: OpenCode Support | 0 (new tests) | Write new tests |
| **Total** | **55 files** | **~3-4 hours** |

### Creating Test Factories

To simplify future refactoring, consider creating test factories:

```typescript
// src/__tests__/factories/session.ts

export function createMockSession(overrides?: Partial<Session>): Session {
  return {
    id: 'test-session-1',
    name: 'Test Session',
    toolType: 'claude-code',
    agentSessionId: null,  // Generic name
    agentCommands: [],     // Generic name
    // ... other fields
    ...overrides,
  };
}

export function createMockAITab(overrides?: Partial<AITab>): AITab {
  return {
    id: 'tab-1',
    agentSessionId: null,  // Generic name
    // ... other fields
    ...overrides,
  };
}
```

Using factories means future renames only require updating the factory, not every test file.

---

## Adding a New Agent

See [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-new-ai-agent) for the step-by-step guide and capability checklist.

---

## Agent-Specific Implementations

### Claude Code

**CLI Reference:**
```bash
claude --print --verbose --output-format stream-json --dangerously-skip-permissions "prompt"
claude --print --resume <session-id> "prompt"
claude --print --permission-mode plan "prompt"  # Read-only
```

**Session Storage:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl`

**JSON Output Schema:**
```json
{"type": "system", "subtype": "init", "session_id": "...", "slash_commands": [...]}
{"type": "assistant", "message": {...}}
{"type": "result", "result": "response text", "session_id": "...", "modelUsage": {...}}
```

**Session ID Field:** `session_id` (snake_case)

---

### OpenCode

**CLI Reference:**
```bash
opencode run --format json "prompt"
opencode run --session <session-id> --format json "prompt"
opencode run --agent plan --format json "prompt"  # Read-only
opencode run --model ollama/qwen3:4b --format json "prompt"  # Custom model
```

**Session Storage:** Server-managed (TBD)

**JSON Output Schema:**
```json
{"type": "step_start", "sessionID": "...", "part": {...}}
{"type": "text", "sessionID": "...", "part": {"text": "response"}}
{"type": "tool_use", "sessionID": "...", "part": {"tool": "write", "state": {...}}}
{"type": "step_finish", "sessionID": "...", "part": {"tokens": {"input": N, "output": N}}}
```

**Session ID Field:** `sessionID` (camelCase)

---

### Gemini CLI (Placeholder)

**Status:** Not yet implemented

**CLI Reference:** TBD

**Known Info:**
- API-based (has cost tracking)
- May support streaming

---

### Codex (Placeholder)

**Status:** Not yet implemented

**CLI Reference:** TBD

---

### Qwen3 Coder (Placeholder)

**Status:** Not yet implemented

**CLI Reference:** TBD
