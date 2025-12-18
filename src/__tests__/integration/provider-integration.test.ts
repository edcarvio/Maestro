/**
 * Provider Integration Tests
 *
 * These tests verify that each supported AI provider (Claude Code, Codex, OpenCode)
 * works correctly end-to-end:
 * 1. Initial message → get response + session ID
 * 2. Follow-up message with session resume → get response
 *
 * REQUIREMENTS:
 * - These tests require the actual provider CLIs to be installed
 * - They make real API calls and may incur costs
 *
 * These tests are SKIPPED by default. To run them:
 *   RUN_INTEGRATION_TESTS=true npm test -- provider-integration --run
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Skip integration tests by default - they make real API calls and may incur costs.
// Set RUN_INTEGRATION_TESTS=true to enable them.
const SKIP_INTEGRATION = process.env.RUN_INTEGRATION_TESTS !== 'true';

// Timeout for provider responses (providers can be slow)
const PROVIDER_TIMEOUT = 120_000; // 2 minutes

// Test directory
const TEST_CWD = process.cwd();

interface ProviderConfig {
  name: string;
  command: string;
  /** Check if the provider CLI is available */
  checkCommand: string;
  /** Build args for initial message (no session) */
  buildInitialArgs: (prompt: string) => string[];
  /** Build args for follow-up message (with session) */
  buildResumeArgs: (sessionId: string, prompt: string) => string[];
  /** Parse session ID from output */
  parseSessionId: (output: string) => string | null;
  /** Parse response text from output */
  parseResponse: (output: string) => string | null;
  /** Check if output indicates success */
  isSuccessful: (output: string, exitCode: number) => boolean;
}

const PROVIDERS: ProviderConfig[] = [
  {
    name: 'Claude Code',
    command: 'claude',
    checkCommand: 'claude --version',
    buildInitialArgs: (prompt: string) => [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--',
      prompt,
    ],
    buildResumeArgs: (sessionId: string, prompt: string) => [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--dangerously-skip-permissions',
      '--resume', sessionId,
      '--',
      prompt,
    ],
    parseSessionId: (output: string) => {
      // Claude outputs session_id in JSON lines
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.session_id) return json.session_id;
        } catch { /* ignore non-JSON lines */ }
      }
      return null;
    },
    parseResponse: (output: string) => {
      // Claude outputs result in JSON lines
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'result' && json.result) return json.result;
        } catch { /* ignore non-JSON lines */ }
      }
      return null;
    },
    isSuccessful: (output: string, exitCode: number) => {
      return exitCode === 0;
    },
  },
  {
    name: 'Codex',
    command: 'codex',
    checkCommand: 'codex --version',
    buildInitialArgs: (prompt: string) => [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C', TEST_CWD,
      '--',
      prompt,
    ],
    buildResumeArgs: (sessionId: string, prompt: string) => [
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-C', TEST_CWD,
      'resume', sessionId,
      '--',
      prompt,
    ],
    parseSessionId: (output: string) => {
      // Codex outputs thread_id in thread.started events
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'thread.started' && json.thread_id) {
            return json.thread_id;
          }
        } catch { /* ignore non-JSON lines */ }
      }
      return null;
    },
    parseResponse: (output: string) => {
      // Codex outputs item.completed events with item.type === 'agent_message'
      const responses: string[] = [];
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
            // agent_message item has text field directly
            if (json.item.text) {
              responses.push(json.item.text);
            }
          }
        } catch { /* ignore non-JSON lines */ }
      }
      return responses.length > 0 ? responses.join('\n') : null;
    },
    isSuccessful: (output: string, exitCode: number) => {
      // Codex may exit with 0 even on success, check for turn.completed
      if (exitCode !== 0) return false;
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'turn.completed') return true;
        } catch { /* ignore */ }
      }
      return false;
    },
  },
  {
    name: 'OpenCode',
    command: 'opencode',
    checkCommand: 'opencode --version',
    buildInitialArgs: (prompt: string) => [
      'run',
      '--format', 'json',
      '--',
      prompt,
    ],
    buildResumeArgs: (sessionId: string, prompt: string) => [
      'run',
      '--format', 'json',
      '--session', sessionId,
      '--',
      prompt,
    ],
    parseSessionId: (output: string) => {
      // OpenCode outputs sessionID in events (step_start, text, step_finish)
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.sessionID) {
            return json.sessionID;
          }
        } catch { /* ignore non-JSON lines */ }
      }
      return null;
    },
    parseResponse: (output: string) => {
      // OpenCode outputs text events with part.text
      const responses: string[] = [];
      for (const line of output.split('\n')) {
        try {
          const json = JSON.parse(line);
          if (json.type === 'text' && json.part?.text) {
            responses.push(json.part.text);
          }
        } catch { /* ignore non-JSON lines */ }
      }
      return responses.length > 0 ? responses.join('') : null;
    },
    isSuccessful: (output: string, exitCode: number) => {
      return exitCode === 0;
    },
  },
];

/**
 * Check if a provider CLI is available
 */
async function isProviderAvailable(provider: ProviderConfig): Promise<boolean> {
  try {
    await execAsync(provider.checkCommand);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a provider command and capture output
 */
function runProvider(
  provider: ProviderConfig,
  args: string[],
  cwd: string = TEST_CWD
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(provider.command, args, {
      cwd,
      env: { ...process.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately to signal EOF (prevents processes waiting for input)
    proc.stdin?.end();

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({
        stdout,
        stderr,
        exitCode: 1,
      });
    });
  });
}

describe.skipIf(SKIP_INTEGRATION)('Provider Integration Tests', () => {
  // Run each provider's tests
  for (const provider of PROVIDERS) {
    describe(provider.name, () => {
      let providerAvailable = false;

      beforeAll(async () => {
        providerAvailable = await isProviderAvailable(provider);
        if (!providerAvailable) {
          console.log(`⚠️  ${provider.name} CLI not available, tests will be skipped`);
        }
      });

      it('should send initial message and receive session ID', async () => {
        if (!providerAvailable) {
          console.log(`Skipping: ${provider.name} not available`);
          return;
        }
        const prompt = 'Say "hello" and nothing else. Be extremely brief.';
        const args = provider.buildInitialArgs(prompt);

        console.log(`\n🚀 Running: ${provider.command} ${args.join(' ')}`);

        const result = await runProvider(provider, args);

        console.log(`📤 Exit code: ${result.exitCode}`);
        console.log(`📤 Stdout (first 500 chars): ${result.stdout.substring(0, 500)}`);
        if (result.stderr) {
          console.log(`📤 Stderr: ${result.stderr.substring(0, 300)}`);
        }

        // Check for success
        expect(
          provider.isSuccessful(result.stdout, result.exitCode),
          `${provider.name} should complete successfully`
        ).toBe(true);

        // Parse session ID
        const sessionId = provider.parseSessionId(result.stdout);
        console.log(`📋 Session ID: ${sessionId}`);
        expect(sessionId, `${provider.name} should return a session ID`).toBeTruthy();

        // Parse response
        const response = provider.parseResponse(result.stdout);
        console.log(`💬 Response: ${response?.substring(0, 200)}`);
        expect(response, `${provider.name} should return a response`).toBeTruthy();
      }, PROVIDER_TIMEOUT);

      it('should resume session with follow-up message', async () => {
        if (!providerAvailable) {
          console.log(`Skipping: ${provider.name} not available`);
          return;
        }
        // First, send initial message to get session ID
        const initialPrompt = 'Remember the number 42. Say only "Got it."';
        const initialArgs = provider.buildInitialArgs(initialPrompt);

        console.log(`\n🚀 Initial: ${provider.command} ${initialArgs.join(' ')}`);

        const initialResult = await runProvider(provider, initialArgs);

        expect(
          provider.isSuccessful(initialResult.stdout, initialResult.exitCode),
          `${provider.name} initial message should succeed`
        ).toBe(true);

        const sessionId = provider.parseSessionId(initialResult.stdout);
        console.log(`📋 Got session ID: ${sessionId}`);
        expect(sessionId, `${provider.name} should return session ID`).toBeTruthy();

        // Now send follow-up with session resume
        const followUpPrompt = 'What number did I ask you to remember? Reply with just the number.';
        const resumeArgs = provider.buildResumeArgs(sessionId!, followUpPrompt);

        console.log(`\n🔄 Resume: ${provider.command} ${resumeArgs.join(' ')}`);

        const resumeResult = await runProvider(provider, resumeArgs);

        console.log(`📤 Exit code: ${resumeResult.exitCode}`);
        console.log(`📤 Stdout (first 500 chars): ${resumeResult.stdout.substring(0, 500)}`);
        if (resumeResult.stderr) {
          console.log(`📤 Stderr: ${resumeResult.stderr.substring(0, 300)}`);
        }

        expect(
          provider.isSuccessful(resumeResult.stdout, resumeResult.exitCode),
          `${provider.name} resume should succeed`
        ).toBe(true);

        const response = provider.parseResponse(resumeResult.stdout);
        console.log(`💬 Response: ${response?.substring(0, 200)}`);
        expect(response, `${provider.name} should return a response`).toBeTruthy();

        // The response should contain "42" since we asked it to remember that
        expect(
          response?.includes('42'),
          `${provider.name} should remember the number 42 from session context`
        ).toBe(true);
      }, PROVIDER_TIMEOUT * 2); // Double timeout for two calls
    });
  }
});

/**
 * Standalone test runner for manual testing
 * Run with: npx tsx src/__tests__/integration/provider-integration.test.ts
 */
if (require.main === module) {
  (async () => {
    console.log('🧪 Running Provider Integration Tests (standalone)\n');

    for (const provider of PROVIDERS) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Testing: ${provider.name}`);
      console.log('='.repeat(60));

      const available = await isProviderAvailable(provider);
      if (!available) {
        console.log(`❌ ${provider.name} CLI not available, skipping`);
        continue;
      }

      console.log(`✅ ${provider.name} CLI available`);

      // Test 1: Initial message
      console.log('\n📝 Test 1: Initial message');
      const initialPrompt = 'Say "hello" briefly.';
      const initialArgs = provider.buildInitialArgs(initialPrompt);
      console.log(`Command: ${provider.command} ${initialArgs.join(' ')}`);

      const result1 = await runProvider(provider, initialArgs);
      console.log(`Exit code: ${result1.exitCode}`);

      const sessionId = provider.parseSessionId(result1.stdout);
      const response1 = provider.parseResponse(result1.stdout);
      console.log(`Session ID: ${sessionId}`);
      console.log(`Response: ${response1?.substring(0, 100)}`);

      if (!sessionId) {
        console.log('❌ No session ID returned, cannot test resume');
        continue;
      }

      // Test 2: Resume session
      console.log('\n📝 Test 2: Resume session');
      const resumePrompt = 'Say "goodbye" briefly.';
      const resumeArgs = provider.buildResumeArgs(sessionId, resumePrompt);
      console.log(`Command: ${provider.command} ${resumeArgs.join(' ')}`);

      const result2 = await runProvider(provider, resumeArgs);
      console.log(`Exit code: ${result2.exitCode}`);

      const response2 = provider.parseResponse(result2.stdout);
      console.log(`Response: ${response2?.substring(0, 100)}`);

      if (result2.exitCode === 0 && response2) {
        console.log(`✅ ${provider.name} integration test PASSED`);
      } else {
        console.log(`❌ ${provider.name} integration test FAILED`);
        if (result2.stderr) {
          console.log(`Stderr: ${result2.stderr}`);
        }
      }
    }
  })();
}
