import * as http from 'http';
import * as url from 'url';
import { RuntimeLifecycleManager } from './lifecycle';
import { ConfigurationSecretsManager } from './configManager';
import { ObservabilityPlatform } from './observability';
import { PluginFramework } from './pluginFramework';
import { EventBus } from './eventBus';

// ----------------------------------------------------
// Canonical API Error Model
// ----------------------------------------------------
export type ApiErrorCode = 
  | 'InvalidRequest'
  | 'Unauthorized'
  | 'Forbidden'
  | 'Timeout'
  | 'Conflict'
  | 'NotFound'
  | 'InternalError';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ----------------------------------------------------
// DTO Specifications
// ----------------------------------------------------
export interface RequestContext {
  role: 'Local Administrator' | 'Read Only' | 'Operator' | 'Plugin';
}

export interface ConfigSetRequest {
  layer: 'platform' | 'environment' | 'workspace' | 'plugin' | 'overrides';
  key: string;
  value: any;
}

export interface ConfigSetResponse {
  updated: boolean;
  key: string;
  layer: string;
}

// ----------------------------------------------------
// Core Transport-Independent Control Plane
// ----------------------------------------------------
export class ControlPlane {
  constructor(
    private lifecycleManager: RuntimeLifecycleManager,
    private configManager: ConfigurationSecretsManager,
    private observability: ObservabilityPlatform,
    private pluginFramework: PluginFramework
  ) {}

  public async getStatus(ctx: RequestContext) {
    this.enforceRole(ctx, ['Local Administrator', 'Operator', 'Read Only']);
    return this.lifecycleManager.getStatus();
  }

  public async setConfig(ctx: RequestContext, req: ConfigSetRequest): Promise<ConfigSetResponse> {
    this.enforceRole(ctx, ['Local Administrator', 'Operator']);
    try {
      const updated = await this.configManager.updateConfig(req.layer, req.key, req.value);
      return { updated, key: req.key, layer: req.layer };
    } catch (err: any) {
      throw new ApiError('InvalidRequest', err.message);
    }
  }

  public async listPlugins(ctx: RequestContext) {
    this.enforceRole(ctx, ['Local Administrator', 'Operator', 'Read Only', 'Plugin']);
    return this.pluginFramework.listPlugins().map(p => ({
      pluginId: p.pluginId,
      name: p.manifest.name,
      version: p.manifest.version,
      status: p.status
    }));
  }

  private enforceRole(ctx: RequestContext, allowed: string[]) {
    if (!allowed.includes(ctx.role)) {
      throw new ApiError('Forbidden', `Role ${ctx.role} is not authorized for this operation`);
    }
  }
}

// ----------------------------------------------------
// Transport Adapter Layer
// ----------------------------------------------------
export class ControlPlaneServer {
  private server?: http.Server;
  private port: number = 8000;
  private activeConnections: number = 0;
  private controlPlane: ControlPlane;

  // Hardening Limits
  public hardeningLimits = {
    maxTerminalSessions: 10,
    maxPluginCount: 15,
    maxMemoryLimitMb: 1024
  };

  // Rate Limiting sliding window map
  public rateLimits = new Map<string, { count: number; windowStart: number }>();

  // Track active SSE client response streams
  private sseClients = new Set<http.ServerResponse>();

  constructor(
    private lifecycleManager: RuntimeLifecycleManager,
    private configManager: ConfigurationSecretsManager,
    private observability: ObservabilityPlatform,
    private pluginFramework: PluginFramework,
    private eventBus: EventBus
  ) {
    this.controlPlane = new ControlPlane(lifecycleManager, configManager, observability, pluginFramework);

    // Subscribe to EventBus and broadcast to active SSE client streams
    this.eventBus.subscribe('control-plane-sse', {}, (event) => {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      for (const client of this.sseClients) {
        try {
          client.write(data);
        } catch (_) {}
      }
    });
  }

  public start(port: number = 8000): Promise<void> {
    this.port = port;
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        this.activeConnections++;
        res.on('finish', () => {
          this.activeConnections--;
        });

        // Enforce Security Headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

        // Input Size Limits: Reject content-lengths > 2MB
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > 2 * 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: 'PayloadTooLarge', message: 'Payload size limit exceeded' }));
          return;
        }

        // Rate Limiting (100 requests per minute limit)
        const clientIp = req.socket.remoteAddress || '127.0.0.1';
        const now = Date.now();
        const clientLimit = this.rateLimits.get(clientIp) || { count: 0, windowStart: now };
        if (now - clientLimit.windowStart > 60000) {
          clientLimit.count = 1;
          clientLimit.windowStart = now;
        } else {
          clientLimit.count++;
        }
        this.rateLimits.set(clientIp, clientLimit);

        if (clientLimit.count > 100) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', error: 'TooManyRequests', message: 'Rate limit exceeded' }));
          return;
        }

        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname || '';
        const method = req.method || 'GET';

        // Extract role from token / auth header mock
        const authHeader = req.headers.authorization || '';
        let role: any = 'Read Only';
        if (authHeader.includes('admin-token')) role = 'Local Administrator';
        else if (authHeader.includes('operator-token')) role = 'Operator';
        else if (authHeader.includes('plugin-token')) role = 'Plugin';

        const ctx: RequestContext = { role };

        try {
          // ----------------------------------------------------
          // Server-Sent Events (SSE) Streaming Route
          // ----------------------------------------------------
          if (pathname === '/api/v1/stream' && method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });
            res.write('\n'); // Keep-alive start character
            this.sseClients.add(res);
            req.on('close', () => {
              this.sseClients.delete(res);
            });
            return;
          }

          // ----------------------------------------------------
          // JSON-RPC Adapter Route (POST /api/v1/rpc)
          // ----------------------------------------------------
          if (pathname === '/api/v1/rpc' && method === 'POST') {
            this.readBody(req, async (body) => {
              const { jsonrpc, method: rpcMethod, params, id } = body;
              if (jsonrpc !== '2.0' || !rpcMethod) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'InvalidRequest' }, id }));
                return;
              }

              try {
                let result: any = null;
                if (rpcMethod === 'getStatus') {
                  result = await this.controlPlane.getStatus(ctx);
                } else if (rpcMethod === 'listPlugins') {
                  result = await this.controlPlane.listPlugins(ctx);
                } else {
                  throw new ApiError('NotFound', `RPC Method ${rpcMethod} not found`);
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
              } catch (err: any) {
                const code = err instanceof ApiError ? err.code : 'InternalError';
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: code, data: err.message }, id }));
              }
            });
            return;
          }

          // ----------------------------------------------------
          // REST Adapter Routes
          // ----------------------------------------------------
          res.setHeader('Content-Type', 'application/json');

          if (pathname === '/api/v1/admin/status' && method === 'GET') {
            const data = await this.controlPlane.getStatus(ctx);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'success', data }));
            return;
          }

          if (pathname === '/api/v1/config/set' && method === 'POST') {
            this.readBody(req, async (body) => {
              try {
                const data = await this.controlPlane.setConfig(ctx, body);
                res.writeHead(200);
                res.end(JSON.stringify({ status: 'success', data }));
              } catch (err: any) {
                this.handleRestError(res, err);
              }
            });
            return;
          }

          if (pathname === '/api/v1/plugins' && method === 'GET') {
            const data = await this.controlPlane.listPlugins(ctx);
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'success', data }));
            return;
          }

          // 404 RouteNotFound
          res.writeHead(404);
          res.end(JSON.stringify({ status: 'error', error: 'NotFound', message: 'RouteNotFound' }));

        } catch (err: any) {
          this.handleRestError(res, err);
        }
      });

      this.server.listen(port, () => {
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getStats() {
    return {
      port: this.port,
      activeConnections: this.activeConnections,
      serverActive: this.server !== undefined
    };
  }

  private handleRestError(res: http.ServerResponse, err: any) {
    const code = err instanceof ApiError ? err.code : 'InternalError';
    let statusCode = 500;
    if (code === 'Forbidden') statusCode = 403;
    else if (code === 'Unauthorized') statusCode = 401;
    else if (code === 'InvalidRequest') statusCode = 400;
    else if (code === 'NotFound') statusCode = 404;

    res.writeHead(statusCode);
    res.end(JSON.stringify({ status: 'error', error: code, message: err.message }));
  }

  private readBody(req: http.IncomingMessage, cb: (body: any) => void) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        cb(JSON.parse(body));
      } catch (_) {
        cb({});
      }
    });
  }
}
