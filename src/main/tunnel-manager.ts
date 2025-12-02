import { ChildProcess, spawn } from 'child_process';
import { logger } from './utils/logger';

export interface TunnelStatus {
  isRunning: boolean;
  url: string | null;
  error: string | null;
}

export interface TunnelResult {
  success: boolean;
  url?: string;
  error?: string;
}

class TunnelManager {
  private process: ChildProcess | null = null;
  private url: string | null = null;
  private error: string | null = null;

  async start(port: number): Promise<TunnelResult> {
    // Stop any existing tunnel first
    await this.stop();

    return new Promise((resolve) => {
      logger.info(`Starting cloudflared tunnel for port ${port}`, 'TunnelManager');

      this.process = spawn('cloudflared', [
        'tunnel', '--url', `http://localhost:${port}`
      ]);

      let resolved = false;

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.error('Tunnel startup timed out', 'TunnelManager');
          this.stop();
          resolve({ success: false, error: 'Tunnel startup timed out (30s)' });
        }
      }, 30000);

      // Cloudflare outputs the URL to stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        logger.info(`cloudflared output: ${output}`, 'TunnelManager');

        // Look for the trycloudflare.com URL
        const urlMatch = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (urlMatch && !resolved) {
          this.url = urlMatch[0];
          clearTimeout(timeout);
          resolved = true;
          logger.info(`Tunnel established: ${this.url}`, 'TunnelManager');
          resolve({ success: true, url: this.url });
        }
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          this.error = `Failed to start cloudflared: ${err.message}`;
          logger.error(this.error, 'TunnelManager');
          resolve({ success: false, error: this.error });
        }
      });

      this.process.on('exit', (code) => {
        logger.info(`cloudflared exited with code ${code}`, 'TunnelManager');
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          this.error = `cloudflared exited unexpectedly (code ${code})`;
          resolve({ success: false, error: this.error });
        }
        // Clean up state
        this.process = null;
        this.url = null;
      });
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      logger.info('Stopping tunnel', 'TunnelManager');
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.url = null;
    this.error = null;
  }

  getStatus(): TunnelStatus {
    return {
      isRunning: this.process !== null && this.url !== null,
      url: this.url,
      error: this.error,
    };
  }
}

export const tunnelManager = new TunnelManager();
