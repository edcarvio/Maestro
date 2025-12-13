import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import type { Theme } from '../shared/theme-types';
import { getLocalIpAddressSync } from './utils/networkUtils';
import { logger } from './utils/logger';
import {
  WebSocketMessageHandler,
  WebClient,
  WebClientMessage,
} from './web-server/handlers';
import {
  BroadcastService,
  AITabData as BroadcastAITabData,
  CustomAICommand as BroadcastCustomAICommand,
  AutoRunState,
  CliActivity,
  SessionBroadcastData,
} from './web-server/services';

// Logger context for all web server logs
const LOG_CONTEXT = 'WebServer';

const GITHUB_REDIRECT_URL = 'https://github.com/pedramamini/Maestro';

// Live session info
interface LiveSessionInfo {
  sessionId: string;
  claudeSessionId?: string;
  enabledAt: number;
}

// Rate limiting configuration
export interface RateLimitConfig {
  // Maximum requests per time window
  max: number;
  // Time window in milliseconds
  timeWindow: number;
  // Maximum requests for POST endpoints (typically lower)
  maxPost: number;
  // Enable/disable rate limiting
  enabled: boolean;
}

/**
 * WebServer - HTTP and WebSocket server for remote access
 *
 * Architecture:
 * - Single server on random port
 * - Security token (UUID) generated at startup, required in all URLs
 * - Routes: /$TOKEN/ (dashboard), /$TOKEN/session/:id (session view)
 * - Live sessions: Only sessions marked as "live" appear in dashboard
 * - WebSocket: Real-time updates for session state, logs, theme
 *
 * URL Structure:
 *   http://localhost:PORT/$TOKEN/                  → Dashboard (all live sessions)
 *   http://localhost:PORT/$TOKEN/session/$UUID     → Single session view
 *   http://localhost:PORT/$TOKEN/api/*             → REST API
 *   http://localhost:PORT/$TOKEN/ws                → WebSocket
 *
 * Security:
 * - Token regenerated on each app restart
 * - Invalid/missing token redirects to GitHub
 * - No access without knowing the token
 */
// Usage stats type for session cost/token tracking
export interface SessionUsageStats {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
  contextWindow?: number;
}

// Last response type for mobile preview (truncated to save bandwidth)
export interface LastResponsePreview {
  text: string; // First 3 lines or ~500 chars of the last AI response
  timestamp: number;
  source: 'stdout' | 'stderr' | 'system';
  fullLength: number; // Total length of the original response
}

// AI Tab type for multi-tab support within a Maestro session
export interface AITabData {
  id: string;
  claudeSessionId: string | null;
  name: string | null;
  starred: boolean;
  inputValue: string;
  usageStats?: SessionUsageStats | null;
  createdAt: number;
  state: 'idle' | 'busy';
  thinkingStartTime?: number | null;
}

// Callback type for fetching sessions data
export type GetSessionsCallback = () => Array<{
  id: string;
  name: string;
  toolType: string;
  state: string;
  inputMode: string;
  cwd: string;
  groupId: string | null;
  groupName: string | null;
  groupEmoji: string | null;
  usageStats?: SessionUsageStats | null;
  lastResponse?: LastResponsePreview | null;
  claudeSessionId?: string | null;
  thinkingStartTime?: number | null; // Timestamp when AI started thinking (for elapsed time display)
  aiTabs?: AITabData[];
  activeTabId?: string;
  bookmarked?: boolean; // Whether session is bookmarked (shows in Bookmarks group)
}>;

// Session detail type for single session endpoint
export interface SessionDetail {
  id: string;
  name: string;
  toolType: string;
  state: string;
  inputMode: string;
  cwd: string;
  aiLogs?: Array<{ timestamp: number; content: string; type?: string }>;
  shellLogs?: Array<{ timestamp: number; content: string; type?: string }>;
  usageStats?: {
    inputTokens?: number;
    outputTokens?: number;
    totalCost?: number;
  };
  claudeSessionId?: string;
  isGitRepo?: boolean;
  activeTabId?: string;
}

// Callback type for fetching single session details
// Optional tabId allows fetching logs for a specific tab (avoids race conditions)
export type GetSessionDetailCallback = (sessionId: string, tabId?: string) => SessionDetail | null;

// Callback type for sending commands to a session
// Returns true if successful, false if session not found or write failed
export type WriteToSessionCallback = (sessionId: string, data: string) => boolean;

// Callback type for executing a command through the desktop's existing logic
// This forwards the command to the renderer which handles spawn, state, and broadcasts
// Returns true if command was accepted (session not busy)
// inputMode is optional - if provided, the renderer will use it instead of querying session state
export type ExecuteCommandCallback = (
  sessionId: string,
  command: string,
  inputMode?: 'ai' | 'terminal'
) => Promise<boolean>;

// Callback type for interrupting a session through the desktop's existing logic
// This forwards to the renderer which handles state updates and broadcasts
export type InterruptSessionCallback = (sessionId: string) => Promise<boolean>;

// Callback type for switching session input mode through the desktop's existing logic
// This forwards to the renderer which handles state updates and broadcasts
export type SwitchModeCallback = (
  sessionId: string,
  mode: 'ai' | 'terminal'
) => Promise<boolean>;

// Callback type for selecting/switching to a session in the desktop app
// This forwards to the renderer which handles state updates and broadcasts
// Optional tabId to also switch to a specific tab within the session
export type SelectSessionCallback = (sessionId: string, tabId?: string) => Promise<boolean>;

// Tab operation callbacks for multi-tab support
export type SelectTabCallback = (sessionId: string, tabId: string) => Promise<boolean>;
export type NewTabCallback = (sessionId: string) => Promise<{ tabId: string } | null>;
export type CloseTabCallback = (sessionId: string, tabId: string) => Promise<boolean>;

// Re-export Theme type from shared for backwards compatibility
export type { Theme } from '../shared/theme-types';

// Callback type for fetching current theme
export type GetThemeCallback = () => Theme | null;

// Custom AI command definition (matches renderer's CustomAICommand)
export interface CustomAICommand {
  id: string;
  command: string;
  description: string;
  prompt: string;
}

// Callback type for fetching custom AI commands
export type GetCustomCommandsCallback = () => CustomAICommand[];

// History entry type for the history API
export interface HistoryEntryData {
  id: string;
  type: 'AUTO' | 'USER';
  timestamp: number;
  summary: string;
  fullResponse?: string;
  claudeSessionId?: string;
  sessionName?: string;
  projectPath: string;
  sessionId?: string;
  contextUsage?: number;
  usageStats?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    totalCostUsd: number;
    contextWindow: number;
  };
  success?: boolean;
  elapsedTimeMs?: number;
  validated?: boolean;
}

// Callback type for fetching history entries
export type GetHistoryCallback = (projectPath?: string, sessionId?: string) => HistoryEntryData[];

// Default rate limit configuration
const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  max: 100,           // 100 requests per minute for GET endpoints
  timeWindow: 60000,  // 1 minute in milliseconds
  maxPost: 30,        // 30 requests per minute for POST endpoints (more restrictive)
  enabled: true,
};

export class WebServer {
  private server: FastifyInstance;
  private port: number;
  private isRunning: boolean = false;
  private webClients: Map<string, WebClient> = new Map();
  private clientIdCounter: number = 0;
  private rateLimitConfig: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG };
  private getSessionsCallback: GetSessionsCallback | null = null;
  private getSessionDetailCallback: GetSessionDetailCallback | null = null;
  private getThemeCallback: GetThemeCallback | null = null;
  private getCustomCommandsCallback: GetCustomCommandsCallback | null = null;
  private writeToSessionCallback: WriteToSessionCallback | null = null;
  private executeCommandCallback: ExecuteCommandCallback | null = null;
  private interruptSessionCallback: InterruptSessionCallback | null = null;
  private switchModeCallback: SwitchModeCallback | null = null;
  private selectSessionCallback: SelectSessionCallback | null = null;
  private selectTabCallback: SelectTabCallback | null = null;
  private newTabCallback: NewTabCallback | null = null;
  private closeTabCallback: CloseTabCallback | null = null;
  private getHistoryCallback: GetHistoryCallback | null = null;
  private webAssetsPath: string | null = null;

  // Security token - regenerated on each app startup
  private securityToken: string;

  // Local IP address for generating URLs (detected at startup)
  private localIpAddress: string = 'localhost';

  // Live sessions - only these appear in the web interface
  private liveSessions: Map<string, LiveSessionInfo> = new Map();

  // WebSocket message handler instance
  private messageHandler: WebSocketMessageHandler;

  // Broadcast service instance
  private broadcastService: BroadcastService;

  constructor(port: number = 0) {
    // Use port 0 to let OS assign a random available port
    this.port = port;
    this.server = Fastify({
      logger: {
        level: 'info',
      },
    });

    // Generate a new security token (UUID v4)
    this.securityToken = randomUUID();
    logger.debug('Security token generated', LOG_CONTEXT);

    // Determine web assets path (production vs development)
    this.webAssetsPath = this.resolveWebAssetsPath();

    // Initialize the WebSocket message handler
    this.messageHandler = new WebSocketMessageHandler();

    // Initialize the broadcast service
    this.broadcastService = new BroadcastService();
    this.broadcastService.setGetWebClientsCallback(() => this.webClients);

    // Note: setupMiddleware and setupRoutes are called in start() to handle async properly
  }

  /**
   * Resolve the path to web assets
   * In production: dist/web relative to app root
   * In development: same location but might not exist until built
   */
  private resolveWebAssetsPath(): string | null {
    // Try multiple locations for the web assets
    const possiblePaths = [
      // Production: relative to the compiled main process
      path.join(__dirname, '..', 'web'),
      // Development: from project root
      path.join(process.cwd(), 'dist', 'web'),
      // Alternative: relative to __dirname going up to dist
      path.join(__dirname, 'web'),
    ];

    for (const p of possiblePaths) {
      if (existsSync(path.join(p, 'index.html'))) {
        logger.debug(`Web assets found at: ${p}`, LOG_CONTEXT);
        return p;
      }
    }

    logger.warn('Web assets not found. Web interface will not be served. Run "npm run build:web" to build web assets.', LOG_CONTEXT);
    return null;
  }

  /**
   * Serve the index.html file for SPA routes
   * Rewrites asset paths to include the security token
   */
  private serveIndexHtml(reply: FastifyReply, sessionId?: string): void {
    if (!this.webAssetsPath) {
      reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Web interface not built. Run "npm run build:web" to build web assets.',
      });
      return;
    }

    const indexPath = path.join(this.webAssetsPath, 'index.html');
    if (!existsSync(indexPath)) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Web interface index.html not found.',
      });
      return;
    }

    try {
      // Read and transform the HTML to fix asset paths
      let html = readFileSync(indexPath, 'utf-8');

      // Transform relative paths to use the token-prefixed absolute paths
      html = html.replace(/\.\/assets\//g, `/${this.securityToken}/assets/`);
      html = html.replace(/\.\/manifest\.json/g, `/${this.securityToken}/manifest.json`);
      html = html.replace(/\.\/icons\//g, `/${this.securityToken}/icons/`);
      html = html.replace(/\.\/sw\.js/g, `/${this.securityToken}/sw.js`);

      // Inject config for the React app to know the token and session context
      const configScript = `<script>
        window.__MAESTRO_CONFIG__ = {
          securityToken: "${this.securityToken}",
          sessionId: ${sessionId ? `"${sessionId}"` : 'null'},
          apiBase: "/${this.securityToken}/api",
          wsUrl: "/${this.securityToken}/ws"
        };
      </script>`;
      html = html.replace('</head>', `${configScript}</head>`);

      reply.type('text/html').send(html);
    } catch (err) {
      logger.error('Error serving index.html', LOG_CONTEXT, err);
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to serve web interface.',
      });
    }
  }

  // ============ Live Session Management ============

  /**
   * Mark a session as live (visible in web interface)
   */
  setSessionLive(sessionId: string, claudeSessionId?: string): void {
    this.liveSessions.set(sessionId, {
      sessionId,
      claudeSessionId,
      enabledAt: Date.now(),
    });
    logger.info(`Session ${sessionId} marked as live (total: ${this.liveSessions.size})`, LOG_CONTEXT);

    // Broadcast to all connected clients
    this.broadcastService.broadcastSessionLive(sessionId, claudeSessionId);
  }

  /**
   * Mark a session as offline (no longer visible in web interface)
   */
  setSessionOffline(sessionId: string): void {
    const wasLive = this.liveSessions.delete(sessionId);
    if (wasLive) {
      logger.info(`Session ${sessionId} marked as offline (remaining: ${this.liveSessions.size})`, LOG_CONTEXT);

      // Broadcast to all connected clients
      this.broadcastService.broadcastSessionOffline(sessionId);
    }
  }

  /**
   * Check if a session is currently live
   */
  isSessionLive(sessionId: string): boolean {
    return this.liveSessions.has(sessionId);
  }

  /**
   * Get all live session IDs
   */
  getLiveSessions(): LiveSessionInfo[] {
    return Array.from(this.liveSessions.values());
  }

  /**
   * Get the security token (for constructing URLs)
   */
  getSecurityToken(): string {
    return this.securityToken;
  }

  /**
   * Get the full secure URL (with token)
   * Uses the detected local IP address for LAN accessibility
   */
  getSecureUrl(): string {
    return `http://${this.localIpAddress}:${this.port}/${this.securityToken}`;
  }

  /**
   * Get URL for a specific session
   * Uses the detected local IP address for LAN accessibility
   */
  getSessionUrl(sessionId: string): string {
    return `http://${this.localIpAddress}:${this.port}/${this.securityToken}/session/${sessionId}`;
  }

  /**
   * Validate the security token from a request
   */
  private validateToken(token: string): boolean {
    return token === this.securityToken;
  }

  /**
   * Set the callback function for fetching current sessions list
   * This is called when a new client connects to send the initial state
   */
  setGetSessionsCallback(callback: GetSessionsCallback) {
    this.getSessionsCallback = callback;
  }

  /**
   * Set the callback function for fetching single session details
   * This is called by the /api/session/:id endpoint
   */
  setGetSessionDetailCallback(callback: GetSessionDetailCallback) {
    this.getSessionDetailCallback = callback;
  }

  /**
   * Set the callback function for fetching current theme
   * This is called when a new client connects to send the initial theme
   */
  setGetThemeCallback(callback: GetThemeCallback) {
    this.getThemeCallback = callback;
  }

  /**
   * Set the callback function for fetching custom AI commands
   * This is called when a new client connects to send the initial custom commands
   */
  setGetCustomCommandsCallback(callback: GetCustomCommandsCallback) {
    this.getCustomCommandsCallback = callback;
  }

  /**
   * Set the callback function for writing commands to a session
   * This is called by the /api/session/:id/send endpoint
   */
  setWriteToSessionCallback(callback: WriteToSessionCallback) {
    this.writeToSessionCallback = callback;
  }

  /**
   * Set the callback function for executing commands through the desktop
   * This forwards commands to the renderer which handles spawn, state management, and broadcasts
   */
  setExecuteCommandCallback(callback: ExecuteCommandCallback) {
    this.executeCommandCallback = callback;
  }

  /**
   * Set the callback function for interrupting a session through the desktop
   * This forwards to the renderer which handles state updates and broadcasts
   */
  setInterruptSessionCallback(callback: InterruptSessionCallback) {
    this.interruptSessionCallback = callback;
  }

  /**
   * Set the callback function for switching session mode through the desktop
   * This forwards to the renderer which handles state updates and broadcasts
   */
  setSwitchModeCallback(callback: SwitchModeCallback) {
    logger.info('[WebServer] setSwitchModeCallback called', LOG_CONTEXT);
    this.switchModeCallback = callback;
  }

  /**
   * Set the callback function for selecting/switching to a session in the desktop
   * This forwards to the renderer which handles state updates and broadcasts
   */
  setSelectSessionCallback(callback: SelectSessionCallback) {
    logger.info('[WebServer] setSelectSessionCallback called', LOG_CONTEXT);
    this.selectSessionCallback = callback;
  }

  /**
   * Set the callback function for selecting a tab within a session
   * This forwards to the renderer which handles tab state updates and broadcasts
   */
  setSelectTabCallback(callback: SelectTabCallback) {
    logger.info('[WebServer] setSelectTabCallback called', LOG_CONTEXT);
    this.selectTabCallback = callback;
  }

  /**
   * Set the callback function for creating a new tab within a session
   * This forwards to the renderer which handles tab creation and broadcasts
   */
  setNewTabCallback(callback: NewTabCallback) {
    logger.info('[WebServer] setNewTabCallback called', LOG_CONTEXT);
    this.newTabCallback = callback;
  }

  /**
   * Set the callback function for closing a tab within a session
   * This forwards to the renderer which handles tab removal and broadcasts
   */
  setCloseTabCallback(callback: CloseTabCallback) {
    logger.info('[WebServer] setCloseTabCallback called', LOG_CONTEXT);
    this.closeTabCallback = callback;
  }

  /**
   * Set the callback function for fetching history entries
   * This is called by the /api/history endpoint
   */
  setGetHistoryCallback(callback: GetHistoryCallback) {
    this.getHistoryCallback = callback;
  }

  /**
   * Set the rate limiting configuration
   */
  setRateLimitConfig(config: Partial<RateLimitConfig>) {
    this.rateLimitConfig = { ...this.rateLimitConfig, ...config };
    logger.info(`Rate limiting ${this.rateLimitConfig.enabled ? 'enabled' : 'disabled'} (max: ${this.rateLimitConfig.max}/min, maxPost: ${this.rateLimitConfig.maxPost}/min)`, LOG_CONTEXT);
  }

  /**
   * Get the current rate limiting configuration
   */
  getRateLimitConfig(): RateLimitConfig {
    return { ...this.rateLimitConfig };
  }

  private async setupMiddleware() {
    // Enable CORS for web access
    await this.server.register(cors, {
      origin: true,
    });

    // Enable WebSocket support
    await this.server.register(websocket);

    // Enable rate limiting for web interface endpoints to prevent abuse
    await this.server.register(rateLimit, {
      global: false,
      max: this.rateLimitConfig.max,
      timeWindow: this.rateLimitConfig.timeWindow,
      errorResponseBuilder: (_request: FastifyRequest, context) => {
        return {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again later.`,
          retryAfter: context.after,
        };
      },
      allowList: (request: FastifyRequest) => {
        if (!this.rateLimitConfig.enabled) return true;
        if (request.url === '/health') return true;
        return false;
      },
      keyGenerator: (request: FastifyRequest) => {
        return request.ip;
      },
    });

    // Register static file serving for web assets
    if (this.webAssetsPath) {
      const assetsPath = path.join(this.webAssetsPath, 'assets');
      if (existsSync(assetsPath)) {
        await this.server.register(fastifyStatic, {
          root: assetsPath,
          prefix: `/${this.securityToken}/assets/`,
          decorateReply: false,
        });
      }

      // Register icons directory
      const iconsPath = path.join(this.webAssetsPath, 'icons');
      if (existsSync(iconsPath)) {
        await this.server.register(fastifyStatic, {
          root: iconsPath,
          prefix: `/${this.securityToken}/icons/`,
          decorateReply: false,
        });
      }
    }
  }

  private setupRoutes() {
    const token = this.securityToken;

    // Root path - redirect to GitHub (no access without token)
    this.server.get('/', async (_request, reply) => {
      return reply.redirect(302, GITHUB_REDIRECT_URL);
    });

    // Health check (no auth required)
    this.server.get('/health', async () => {
      return { status: 'ok', timestamp: Date.now() };
    });

    // PWA manifest.json
    this.server.get(`/${token}/manifest.json`, async (_request, reply) => {
      if (!this.webAssetsPath) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      const manifestPath = path.join(this.webAssetsPath, 'manifest.json');
      if (!existsSync(manifestPath)) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.type('application/json').send(readFileSync(manifestPath, 'utf-8'));
    });

    // PWA service worker
    this.server.get(`/${token}/sw.js`, async (_request, reply) => {
      if (!this.webAssetsPath) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      const swPath = path.join(this.webAssetsPath, 'sw.js');
      if (!existsSync(swPath)) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.type('application/javascript').send(readFileSync(swPath, 'utf-8'));
    });

    // Dashboard - list all live sessions
    this.server.get(`/${token}`, async (_request, reply) => {
      this.serveIndexHtml(reply);
    });

    // Dashboard with trailing slash
    this.server.get(`/${token}/`, async (_request, reply) => {
      this.serveIndexHtml(reply);
    });

    // Single session view - works for any valid session (security token protects access)
    this.server.get(`/${token}/session/:sessionId`, async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      // Note: Session validation happens in the frontend via the sessions list
      this.serveIndexHtml(reply, sessionId);
    });

    // Catch-all for invalid tokens - redirect to GitHub
    this.server.get('/:token', async (request, reply) => {
      const { token: reqToken } = request.params as { token: string };
      if (!this.validateToken(reqToken)) {
        return reply.redirect(302, GITHUB_REDIRECT_URL);
      }
      // Valid token but no specific route - serve dashboard
      this.serveIndexHtml(reply);
    });

    // API Routes - all under /$TOKEN/api/*
    this.setupApiRoutes();

    // WebSocket route
    this.setupWebSocketRoute();
  }

  /**
   * Setup API routes under /$TOKEN/api/*
   */
  private setupApiRoutes() {
    const token = this.securityToken;

    // Get all sessions (not just "live" ones - security token protects access)
    this.server.get(`/${token}/api/sessions`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.max,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async () => {
      const sessions = this.getSessionsCallback ? this.getSessionsCallback() : [];

      // Enrich all sessions with live info if available
      const sessionData = sessions.map(s => {
        const liveInfo = this.liveSessions.get(s.id);
        return {
          ...s,
          claudeSessionId: liveInfo?.claudeSessionId || s.claudeSessionId,
          liveEnabledAt: liveInfo?.enabledAt,
          isLive: this.isSessionLive(s.id),
        };
      });

      return {
        sessions: sessionData,
        count: sessionData.length,
        timestamp: Date.now(),
      };
    });

    // Session detail endpoint - works for any valid session (security token protects access)
    // Optional ?tabId= query param to fetch logs for a specific tab (avoids race conditions)
    this.server.get(`/${token}/api/session/:id`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.max,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const { tabId } = request.query as { tabId?: string };

      if (!this.getSessionDetailCallback) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Session detail service not configured',
          timestamp: Date.now(),
        });
      }

      const session = this.getSessionDetailCallback(id, tabId);
      if (!session) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Session with id '${id}' not found`,
          timestamp: Date.now(),
        });
      }

      const liveInfo = this.liveSessions.get(id);
      return {
        session: {
          ...session,
          claudeSessionId: liveInfo?.claudeSessionId || session.claudeSessionId,
          liveEnabledAt: liveInfo?.enabledAt,
          isLive: this.isSessionLive(id),
        },
        timestamp: Date.now(),
      };
    });

    // Send command to session - works for any valid session (security token protects access)
    this.server.post(`/${token}/api/session/:id/send`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.maxPost,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { command?: string } | undefined;
      const command = body?.command;

      // Note: We don't check isSessionLive() here - the callback validates the session
      // exists and the security token already protects access.

      if (!command || typeof command !== 'string') {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Command is required and must be a string',
          timestamp: Date.now(),
        });
      }

      if (!this.writeToSessionCallback) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Session write service not configured',
          timestamp: Date.now(),
        });
      }

      const success = this.writeToSessionCallback(id, command + '\n');
      if (!success) {
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Failed to send command to session',
          timestamp: Date.now(),
        });
      }

      return {
        success: true,
        message: 'Command sent successfully',
        sessionId: id,
        timestamp: Date.now(),
      };
    });

    // Theme endpoint
    this.server.get(`/${token}/api/theme`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.max,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async (_request, reply) => {
      if (!this.getThemeCallback) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Theme service not configured',
          timestamp: Date.now(),
        });
      }

      const theme = this.getThemeCallback();
      if (!theme) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No theme currently configured',
          timestamp: Date.now(),
        });
      }

      return {
        theme,
        timestamp: Date.now(),
      };
    });

    // Interrupt session - works for any valid session (security token protects access)
    this.server.post(`/${token}/api/session/:id/interrupt`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.maxPost,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async (request, reply) => {
      const { id } = request.params as { id: string };

      // Note: We don't check isSessionLive() here - the callback validates the session
      // exists and the security token already protects access.

      if (!this.interruptSessionCallback) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Session interrupt service not configured',
          timestamp: Date.now(),
        });
      }

      try {
        // Forward to desktop's interrupt logic - handles state updates and broadcasts
        const success = await this.interruptSessionCallback(id);
        if (!success) {
          return reply.code(500).send({
            error: 'Internal Server Error',
            message: 'Failed to interrupt session',
            timestamp: Date.now(),
          });
        }

        return {
          success: true,
          message: 'Interrupt signal sent successfully',
          sessionId: id,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: `Failed to interrupt session: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    });

    // History endpoint - returns history entries filtered by project/session
    this.server.get(`/${token}/api/history`, {
      config: {
        rateLimit: {
          max: this.rateLimitConfig.max,
          timeWindow: this.rateLimitConfig.timeWindow,
        },
      },
    }, async (request, reply) => {
      if (!this.getHistoryCallback) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'History service not configured',
          timestamp: Date.now(),
        });
      }

      // Extract optional projectPath and sessionId from query params
      const { projectPath, sessionId } = request.query as {
        projectPath?: string;
        sessionId?: string;
      };

      try {
        const entries = this.getHistoryCallback(projectPath, sessionId);
        return {
          entries,
          count: entries.length,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: `Failed to fetch history: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    });
  }

  /**
   * Setup WebSocket route under /$TOKEN/ws
   */
  private setupWebSocketRoute() {
    const token = this.securityToken;

    this.server.get(`/${token}/ws`, { websocket: true }, (connection, request) => {
      const clientId = `web-client-${++this.clientIdCounter}`;

      // Extract sessionId from query string if provided (for session-specific subscriptions)
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      const sessionId = url.searchParams.get('sessionId') || undefined;

      const client: WebClient = {
        socket: connection.socket,
        id: clientId,
        connectedAt: Date.now(),
        subscribedSessionId: sessionId,
      };

      this.webClients.set(clientId, client);
      logger.info(`Client connected: ${clientId} (session: ${sessionId || 'dashboard'}, total: ${this.webClients.size})`, LOG_CONTEXT);

      // Send connection confirmation
      connection.socket.send(JSON.stringify({
        type: 'connected',
        clientId,
        message: 'Connected to Maestro Web Interface',
        subscribedSessionId: sessionId,
        timestamp: Date.now(),
      }));

      // Send initial sessions list (all sessions, not just "live" ones)
      if (this.getSessionsCallback) {
        const allSessions = this.getSessionsCallback();
        const sessionsWithLiveInfo = allSessions.map(s => {
          const liveInfo = this.liveSessions.get(s.id);
          return {
            ...s,
            claudeSessionId: liveInfo?.claudeSessionId || s.claudeSessionId,
            liveEnabledAt: liveInfo?.enabledAt,
            isLive: this.isSessionLive(s.id),
          };
        });
        connection.socket.send(JSON.stringify({
          type: 'sessions_list',
          sessions: sessionsWithLiveInfo,
          timestamp: Date.now(),
        }));
      }

      // Send current theme
      if (this.getThemeCallback) {
        const theme = this.getThemeCallback();
        if (theme) {
          connection.socket.send(JSON.stringify({
            type: 'theme',
            theme,
            timestamp: Date.now(),
          }));
        }
      }

      // Send custom AI commands
      if (this.getCustomCommandsCallback) {
        const customCommands = this.getCustomCommandsCallback();
        connection.socket.send(JSON.stringify({
          type: 'custom_commands',
          commands: customCommands,
          timestamp: Date.now(),
        }));
      }

      // Handle incoming messages
      connection.socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString()) as WebClientMessage;
          this.handleWebClientMessage(clientId, data);
        } catch {
          connection.socket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          }));
        }
      });

      // Handle disconnection
      connection.socket.on('close', () => {
        this.webClients.delete(clientId);
        logger.info(`Client disconnected: ${clientId} (total: ${this.webClients.size})`, LOG_CONTEXT);
      });

      // Handle errors
      connection.socket.on('error', (error) => {
        logger.error(`Client error (${clientId})`, LOG_CONTEXT, error);
        this.webClients.delete(clientId);
      });
    });
  }

  /**
   * Handle incoming messages from web clients
   * Delegates to the WebSocketMessageHandler for all message processing
   */
  private handleWebClientMessage(clientId: string, message: WebClientMessage) {
    const client = this.webClients.get(clientId);
    if (!client) return;

    // Delegate to the message handler
    this.messageHandler.handleMessage(client, message);
  }

  /**
   * Broadcast a message to all connected web clients
   */
  broadcastToWebClients(message: object): void {
    this.broadcastService.broadcastToAll(message);
  }

  /**
   * Broadcast a message to clients subscribed to a specific session
   */
  broadcastToSessionClients(sessionId: string, message: object): void {
    this.broadcastService.broadcastToSession(sessionId, message);
  }

  /**
   * Broadcast a session state change to all connected web clients
   * Called when any session's state changes (idle, busy, error, connecting)
   */
  broadcastSessionStateChange(sessionId: string, state: string, additionalData?: {
    name?: string;
    toolType?: string;
    inputMode?: string;
    cwd?: string;
    cliActivity?: CliActivity;
  }): void {
    this.broadcastService.broadcastSessionStateChange(sessionId, state, additionalData);
  }

  /**
   * Broadcast when a session is added
   */
  broadcastSessionAdded(session: SessionBroadcastData): void {
    this.broadcastService.broadcastSessionAdded(session);
  }

  /**
   * Broadcast when a session is removed
   */
  broadcastSessionRemoved(sessionId: string): void {
    this.broadcastService.broadcastSessionRemoved(sessionId);
  }

  /**
   * Broadcast the full sessions list to all connected web clients
   * Used for initial sync or bulk updates
   */
  broadcastSessionsList(sessions: SessionBroadcastData[]): void {
    this.broadcastService.broadcastSessionsList(sessions);
  }

  /**
   * Broadcast active session change to all connected web clients
   * Called when the user switches sessions in the desktop app
   */
  broadcastActiveSessionChange(sessionId: string): void {
    this.broadcastService.broadcastActiveSessionChange(sessionId);
  }

  /**
   * Broadcast tab change to all connected web clients
   * Called when the tabs array or active tab changes in a session
   */
  broadcastTabsChange(sessionId: string, aiTabs: BroadcastAITabData[], activeTabId: string): void {
    this.broadcastService.broadcastTabsChange(sessionId, aiTabs, activeTabId);
  }

  /**
   * Broadcast theme change to all connected web clients
   * Called when the user changes the theme in the desktop app
   */
  broadcastThemeChange(theme: Theme): void {
    this.broadcastService.broadcastThemeChange(theme);
  }

  /**
   * Broadcast custom commands update to all connected web clients
   * Called when the user modifies custom AI commands in the desktop app
   */
  broadcastCustomCommands(commands: BroadcastCustomAICommand[]): void {
    this.broadcastService.broadcastCustomCommands(commands);
  }

  /**
   * Broadcast AutoRun state to all connected web clients
   * Called when batch processing starts, progresses, or stops
   */
  broadcastAutoRunState(sessionId: string, state: AutoRunState | null): void {
    this.broadcastService.broadcastAutoRunState(sessionId, state);
  }

  /**
   * Broadcast user input to web clients subscribed to a session
   * Called when a command is sent from the desktop app so web clients stay in sync
   */
  broadcastUserInput(sessionId: string, command: string, inputMode: 'ai' | 'terminal'): void {
    this.broadcastService.broadcastUserInput(sessionId, command, inputMode);
  }

  /**
   * Get the number of connected web clients
   */
  getWebClientCount(): number {
    return this.webClients.size;
  }

  /**
   * Wire up the message handler callbacks
   * Called during start() to ensure all callbacks are set before accepting connections
   */
  private setupMessageHandlerCallbacks(): void {
    this.messageHandler.setCallbacks({
      getSessionDetail: (sessionId: string) => {
        return this.getSessionDetailCallback?.(sessionId) ?? null;
      },
      executeCommand: async (sessionId: string, command: string, inputMode?: 'ai' | 'terminal') => {
        if (!this.executeCommandCallback) return false;
        return this.executeCommandCallback(sessionId, command, inputMode);
      },
      switchMode: async (sessionId: string, mode: 'ai' | 'terminal') => {
        if (!this.switchModeCallback) return false;
        return this.switchModeCallback(sessionId, mode);
      },
      selectSession: async (sessionId: string, tabId?: string) => {
        if (!this.selectSessionCallback) return false;
        return this.selectSessionCallback(sessionId, tabId);
      },
      selectTab: async (sessionId: string, tabId: string) => {
        if (!this.selectTabCallback) return false;
        return this.selectTabCallback(sessionId, tabId);
      },
      newTab: async (sessionId: string) => {
        if (!this.newTabCallback) return null;
        return this.newTabCallback(sessionId);
      },
      closeTab: async (sessionId: string, tabId: string) => {
        if (!this.closeTabCallback) return false;
        return this.closeTabCallback(sessionId, tabId);
      },
      getSessions: () => {
        return this.getSessionsCallback?.() ?? [];
      },
      getLiveSessionInfo: (sessionId: string) => {
        return this.liveSessions.get(sessionId);
      },
      isSessionLive: (sessionId: string) => {
        return this.liveSessions.has(sessionId);
      },
    });
  }

  async start(): Promise<{ port: number; token: string; url: string }> {
    if (this.isRunning) {
      return {
        port: this.port,
        token: this.securityToken,
        url: this.getSecureUrl(),
      };
    }

    try {
      // Detect local IP address for LAN accessibility (sync - no network delay)
      this.localIpAddress = getLocalIpAddressSync();
      logger.info(`Using IP address: ${this.localIpAddress}`, LOG_CONTEXT);

      // Setup middleware and routes (must be done before listen)
      await this.setupMiddleware();
      this.setupRoutes();

      // Wire up message handler callbacks
      this.setupMessageHandlerCallbacks();

      await this.server.listen({ port: this.port, host: '0.0.0.0' });

      // Get the actual port (important when using port 0 for random assignment)
      const address = this.server.server.address();
      if (address && typeof address === 'object') {
        this.port = address.port;
      }

      this.isRunning = true;

      return {
        port: this.port,
        token: this.securityToken,
        url: this.getSecureUrl(),
      };
    } catch (error) {
      logger.error('Failed to start server', LOG_CONTEXT, error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    // Mark all live sessions as offline
    for (const sessionId of this.liveSessions.keys()) {
      this.setSessionOffline(sessionId);
    }

    try {
      await this.server.close();
      this.isRunning = false;
      logger.info('Server stopped', LOG_CONTEXT);
    } catch (error) {
      logger.error('Failed to stop server', LOG_CONTEXT, error);
    }
  }

  getUrl(): string {
    return `http://${this.localIpAddress}:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  isActive(): boolean {
    return this.isRunning;
  }

  getServer(): FastifyInstance {
    return this.server;
  }
}
