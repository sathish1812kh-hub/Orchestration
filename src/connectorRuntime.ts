import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface ConnectorDescriptor {
  connectorId: string;
  name: string;
  version: string;
  vendor: string;
  status: 'Registered' | 'Connecting' | 'Connected' | 'Ready' | 'Busy' | 'Waiting' | 'Streaming' | 'Cancelling' | 'Recovering' | 'Disconnected' | 'Failed';
  enabled: boolean;
  capabilities: Array<{ capabilityId: string; version: string }>;
  transports: string[];
}

export interface ConnectorSession {
  sessionId: string;
  connectorId: string;
  status: 'Active' | 'Suspended' | 'Recovering' | 'Terminated';
  createdAt: number;
  lastActiveTime: number;
}

export interface ExecutionContext {
  prompt: string;
  files: Array<{ path: string; content: string }>;
  workspaceRoot: string;
  metadata?: Record<string, any>;
}

export class ConnectorManager {
  private connectors = new Map<string, ConnectorDescriptor>();
  private sessions = new Map<string, ConnectorSession>();
  private metrics = {
    totalExecutions: 0,
    failedExecutions: 0,
    reconnects: 0,
    streamedMessagesCount: 0
  };

  constructor(
    private eventBus: EventBus,
    private observability: ObservabilityPlatform
  ) {}

  public register(desc: Omit<ConnectorDescriptor, 'status' | 'enabled'>): ConnectorDescriptor {
    const fullDesc: ConnectorDescriptor = {
      ...desc,
      status: 'Registered',
      enabled: true
    };
    this.connectors.set(desc.connectorId, fullDesc);
    this.publishEvent('ConnectorLoaded', { connectorId: desc.connectorId });
    return fullDesc;
  }

  public unregister(connectorId: string): boolean {
    const deleted = this.connectors.delete(connectorId);
    if (deleted) {
      this.publishEvent('ConnectorStopped', { connectorId });
    }
    return deleted;
  }

  public enable(connectorId: string): boolean {
    const conn = this.connectors.get(connectorId);
    if (conn) {
      conn.enabled = true;
      return true;
    }
    return false;
  }

  public disable(connectorId: string): boolean {
    const conn = this.connectors.get(connectorId);
    if (conn) {
      conn.enabled = false;
      conn.status = 'Disconnected';
      return true;
    }
    return false;
  }

  public getConnector(connectorId: string): ConnectorDescriptor | undefined {
    return this.connectors.get(connectorId);
  }

  public listConnectors(): ConnectorDescriptor[] {
    return Array.from(this.connectors.values());
  }

  public createSession(connectorId: string): ConnectorSession {
    const conn = this.connectors.get(connectorId);
    if (!conn || !conn.enabled) {
      throw new Error(`Connector ${connectorId} not found or disabled`);
    }

    const session: ConnectorSession = {
      sessionId: `sess_${Math.random().toString(36).substr(2, 9)}`,
      connectorId,
      status: 'Active',
      createdAt: Date.now(),
      lastActiveTime: Date.now()
    };
    this.sessions.set(session.sessionId, session);
    conn.status = 'Ready';
    this.publishEvent('ConnectorStarted', { connectorId, sessionId: session.sessionId });
    return session;
  }

  public getSession(sessionId: string): ConnectorSession | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(): ConnectorSession[] {
    return Array.from(this.sessions.values());
  }

  public async executePipeline(
    connectorId: string,
    sessionId: string,
    context: ExecutionContext,
    vendorExecuteFn: (ctx: ExecutionContext, onStream: (msg: string) => void) => Promise<any>
  ): Promise<any> {
    const conn = this.connectors.get(connectorId);
    const session = this.sessions.get(sessionId);

    if (!conn || !session) {
      throw new Error('Connector or Session is invalid');
    }

    conn.status = 'Busy';
    session.lastActiveTime = Date.now();
    this.metrics.totalExecutions++;
    this.publishEvent('ConnectorExecutionStarted', { connectorId, sessionId });

    const startTime = Date.now();
    try {
      // Shared streaming callback wrapping ordered buffer streams
      const onStream = (chunk: string) => {
        this.metrics.streamedMessagesCount++;
        conn.status = 'Streaming';
        this.eventBus.publish({
          schemaVersion: '1.0.0',
          eventId: `evt_stream_${Date.now()}`,
          eventType: 'ConnectorStreamChunk',
          eventCategory: 'Telemetry',
          timestamp: Date.now(),
          severity: 'Information',
          tags: ['connector', connectorId],
          payload: { connectorId, chunk },
          metadata: {},
          correlationId: sessionId,
          parentEventId: 'root'
        });
      };

      // Retry policy with backoff wrapper
      let result: any;
      let retries = 3;
      let delay = 100;
      while (retries > 0) {
        try {
          result = await vendorExecuteFn(context, onStream);
          break;
        } catch (err) {
          retries--;
          if (retries === 0) throw err;
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }

      conn.status = 'Ready';
      this.publishEvent('ConnectorExecutionCompleted', { connectorId, sessionId, durationMs: Date.now() - startTime });
      return result;

    } catch (err: any) {
      conn.status = 'Failed';
      this.metrics.failedExecutions++;
      this.publishEvent('ConnectorExecutionFailed', { connectorId, sessionId, error: err.message });
      throw err;
    }
  }

  public triggerRecovery(connectorId: string, sessionId: string): boolean {
    const conn = this.connectors.get(connectorId);
    const session = this.sessions.get(sessionId);

    if (!conn || !session) return false;

    conn.status = 'Recovering';
    session.status = 'Recovering';
    this.metrics.reconnects++;

    // Simulated reconnect timeout
    setTimeout(() => {
      conn.status = 'Ready';
      session.status = 'Active';
      this.publishEvent('ConnectorRecovered', { connectorId, sessionId });
    }, 100);

    return true;
  }

  public getRuntimeMetrics() {
    return {
      ...this.metrics,
      activeConnectorsCount: this.connectors.size,
      activeSessionsCount: this.sessions.size
    };
  }

  private publishEvent(eventType: string, payload: any) {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_${eventType.toLowerCase()}_${Date.now()}`,
      eventType,
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['connector_runtime'],
      payload,
      metadata: {},
      correlationId: 'corr_connector_runtime',
      parentEventId: 'root'
    }).catch(() => {});
  }
}
