import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import express, { Express } from 'express';
import cors from 'cors';
import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { PlatformStateRegistry } from './stateRegistry';
import { WorkflowEngine } from './workflowEngine';
import { AgentManager } from './agentManager';
import { ConnectorManager } from './connectorRuntime';
import { MaceCollaborationEngine } from './mace';
import { DmaeClusterManager } from './dmae';
import { DcmsContextCoordinator } from './dcms';
import { CloudExecutionGateway } from './cegrf';
import { loadConfiguration } from './config';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { TerminalManager } from './terminalManager';
import { startNgrokTunnel } from './ngrokTunnel';

export type LifecycleState =
  | 'RuntimeStarting'
  | 'LoadingConfiguration'
  | 'InitializingSubsystems'
  | 'BindingTransports'
  | 'OpeningConnectors'
  | 'StartingHTTP'
  | 'OpeningTunnel'
  | 'Ready'
  | 'Stopping'
  | 'Stopped';

export class PlatformBootstrap {
  public state: LifecycleState = 'Stopped';
  public port: number = 5001;
  public host: string = '127.0.0.1';

  // Config parameters
  private ngrokEnabled = false;
  private ngrokDomain?: string;
  private ngrokAuthtoken?: string;

  // Subsystems
  public eventBus!: EventBus;
  public observability!: ObservabilityPlatform;
  public stateRegistry!: PlatformStateRegistry;
  public workflowEngine!: WorkflowEngine;
  public agentManager!: AgentManager;
  public connectorManager!: ConnectorManager;
  public mace!: MaceCollaborationEngine;
  public dmae!: DmaeClusterManager;
  public dcms!: DcmsContextCoordinator;
  public cegrf!: CloudExecutionGateway;

  // Servers & Tunnels
  private app!: Express;
  private server?: http.Server;
  private tunnelStop?: () => Promise<void>;
  private startTime = Date.now();

  constructor() {}

  private loadEnv(): void {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const val = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = val;
      }
    }
  }

  private publishLifecycle(state: LifecycleState): void {
    this.state = state;
    if (this.eventBus) {
      this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: Math.random().toString(36).substring(7),
        eventType: state,
        eventCategory: 'Lifecycle',
        timestamp: Date.now(),
        correlationId: 'bootstrap',
        parentEventId: 'none',
        severity: 'Information',
        tags: ['lifecycle', state],
        payload: { state },
        metadata: {},
        priority: 'Normal'
      });
    }
  }

  public async start(): Promise<void> {
    this.publishLifecycle('RuntimeStarting');

    // 1. Loading Configuration
    this.publishLifecycle('LoadingConfiguration');
    this.loadEnv();

    this.port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;
    this.host = process.env.HOST || '127.0.0.1';
    this.ngrokEnabled = process.env.NGROK_ENABLED === 'true';
    this.ngrokDomain = process.env.NGROK_DOMAIN;
    this.ngrokAuthtoken = process.env.NGROK_AUTHTOKEN;

    const configuration = loadConfiguration();
    const policyEngine = new PolicyEngine(configuration);
    const auditLogger = new AuditLogger(process.cwd());
    const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);

    // 2. Initializing Subsystems
    this.publishLifecycle('InitializingSubsystems');

    const storage = new MemoryStorageProvider();
    this.eventBus = new EventBus(storage);
    this.observability = new ObservabilityPlatform();
    this.stateRegistry = new PlatformStateRegistry(this.eventBus);
    this.workflowEngine = new WorkflowEngine(this.eventBus, terminalManager);
    this.agentManager = new AgentManager(this.eventBus);
    this.connectorManager = new ConnectorManager(this.eventBus, this.observability);
    this.mace = new MaceCollaborationEngine(this.eventBus, this.observability);
    this.dmae = new DmaeClusterManager(this.eventBus, this.observability);
    this.dcms = new DcmsContextCoordinator(this.eventBus, this.observability);
    this.cegrf = new CloudExecutionGateway(this.eventBus, this.observability);

    // 3. Binding Transports
    this.publishLifecycle('BindingTransports');

    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    // GET /
    this.app.get('/', (req, res) => {
      res.json({
        status: 'running',
        platform: 'Platform v2.0',
        version: '2.0',
        port: this.port
      });
    });

    // GET /ready
    this.app.get('/ready', (req, res) => {
      if (this.state === 'Ready') {
        res.status(200).send('READY');
      } else {
        res.status(503).send('SERVICE UNAVAILABLE');
      }
    });

    // GET /health
    this.app.get('/health', (req, res) => {
      const stats = {
        status: 'healthy',
        uptime: `${Math.floor((Date.now() - this.startTime) / 1000)}s`,
        connectors: this.connectorManager.listConnectors().length,
        sessions: this.mace.getSessionsList().length,
        memory: `${Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        version: '2.0'
      };
      res.json(stats);
    });

    // GET /api/v1/stream
    this.app.get('/api/v1/stream', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write('data: {"status":"connected"}\n\n');
    });

    // POST /api/v1/rpc
    this.app.post('/api/v1/rpc', (req, res) => {
      res.json({ jsonrpc: '2.0', result: 'OK', id: req.body.id });
    });

    // 4. Opening Connectors
    this.publishLifecycle('OpeningConnectors');

    // 5. Starting HTTP
    this.publishLifecycle('StartingHTTP');
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(this.port, this.host, () => {
        resolve();
      });
    });

    // 6. Opening Tunnel
    this.publishLifecycle('OpeningTunnel');
    if (this.ngrokEnabled && this.ngrokAuthtoken) {
      try {
        const tunnel = await startNgrokTunnel(this.port, this.ngrokAuthtoken, this.ngrokDomain);
        this.tunnelStop = tunnel.stop;
        console.log(`[ngrok] Exposing local gateway at: ${tunnel.url}`);
      } catch (err: any) {
        console.warn(`[WARNING] Failed to establish ngrok tunnel: ${err.message || err}. Continuing local execution.`);
      }
    }

    // 7. Ready State
    this.publishLifecycle('Ready');
    this.printBanner();
  }

  public async stop(): Promise<void> {
    this.publishLifecycle('Stopping');

    if (this.tunnelStop) {
      await this.tunnelStop();
      this.tunnelStop = undefined;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }

    this.agentManager.shutdown();

    this.publishLifecycle('Stopped');
  }

  private printBanner(): void {
    console.log(`
=====================================

Platform v2.0 Started

Host:
${this.host}

Port:
${this.port}

REST:
http://localhost:${this.port}

RPC:
http://localhost:${this.port}/api/v1/rpc

SSE:
http://localhost:${this.port}/api/v1/stream

Health:
http://localhost:${this.port}/health

Ready:
http://localhost:${this.port}/ready

MCP:
READY

Connector Runtime:
READY

MACE:
READY

DMAE:
READY

DCMS:
READY

CEGRF:
READY

=====================================`);
  }
}
