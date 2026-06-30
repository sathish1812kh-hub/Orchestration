import * as path from 'path';
import * as fs from 'fs';
import { TerminalManager, parseKeyCombination } from './terminalManager';
import { PromptDetectionEngine } from './promptDetector';
import { StreamingEngine } from './streamingEngine';
import { ConnectorManager } from './connectorRuntime';
import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export class AntigravityConnector {
  private activeTerminalUuid?: string;
  private connectorId = 'antigravity-connector';
  private agyPath = 'C:\\Users\\Sathish\\AppData\\Local\\agy\\bin\\agy.exe';

  // Observability telemetry
  private metrics = {
    connectionLatency: 0,
    executionLatency: 0,
    promptWaitTime: 0,
    streamedMessageCount: 0,
    recoveryCount: 0,
    cancellationCount: 0
  };

  constructor(
    private connectorManager: ConnectorManager,
    private terminalManager: TerminalManager,
    private promptDetector: PromptDetectionEngine,
    private streamingEngine: StreamingEngine,
    private eventBus: EventBus,
    private observability: ObservabilityPlatform
  ) {
    // Automatically register with ConnectorManager
    this.connectorManager.register({
      connectorId: this.connectorId,
      name: 'Antigravity Connector',
      version: '1.0.0',
      vendor: 'Google DeepMind',
      capabilities: [
        { capabilityId: 'shell.execute', version: '1.0.0' },
        { capabilityId: 'code.generate', version: '1.0.0' },
        { capabilityId: 'code.review', version: '1.0.0' }
      ],
      transports: ['stdio', 'http']
    });
  }

  public getConnectorId() {
    return this.connectorId;
  }

  public getMetrics() {
    return this.metrics;
  }

  public getActiveTerminalUuid() {
    return this.activeTerminalUuid;
  }

  public async connect(workspaceRoot: string, options?: { agyPath?: string }): Promise<string> {
    const startTime = Date.now();
    
    if (options?.agyPath) {
      this.agyPath = options.agyPath;
    }

    // Launch PowerShell terminal managed by platform
    const meta = this.terminalManager.createManagedTerminal('powershell', 'Antigravity Managed Session', workspaceRoot);
    this.activeTerminalUuid = meta.uuid;

    const term = this.terminalManager.getTerminal(meta.uuid);
    if (!term) {
      throw new Error(`Failed to initialize terminal ${meta.uuid}`);
    }

    // Wait for the shell prompt to be stable
    await this.promptDetector.waitPrompt(meta.uuid, 5000);

    // Write command launching agy CLI
    const runCmd = `& "${this.agyPath}" --version`;
    await term.write(runCmd);
    const { keyCode, controlState } = parseKeyCombination('Enter');
    await term.sendKey(keyCode, controlState);

    // Wait again for prompt stabilization
    await this.promptDetector.waitPrompt(meta.uuid, 5000);

    this.metrics.connectionLatency = Date.now() - startTime;
    
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_conn_started_${Date.now()}`,
      eventType: 'ConnectorConnected',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['connector', this.connectorId],
      payload: { connectorId: this.connectorId, terminalUuid: meta.uuid },
      metadata: {},
      correlationId: 'corr_antigravity_connect',
      parentEventId: 'root'
    }).catch(() => {});

    return meta.uuid;
  }

  public async disconnect(): Promise<void> {
    if (this.activeTerminalUuid) {
      this.terminalManager.closeTerminal(this.activeTerminalUuid);
      this.activeTerminalUuid = undefined;

      this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_conn_stopped_${Date.now()}`,
        eventType: 'ConnectorDisconnected',
        eventCategory: 'System',
        timestamp: Date.now(),
        severity: 'Information',
        tags: ['connector', this.connectorId],
        payload: { connectorId: this.connectorId },
        metadata: {},
        correlationId: 'corr_antigravity_disconnect',
        parentEventId: 'root'
      }).catch(() => {});
    }
  }

  public async execute(prompt: string, onStream: (chunk: string) => void): Promise<{ output: string }> {
    if (!this.activeTerminalUuid) {
      throw new Error('Connector is not connected. Call connect() first.');
    }

    const term = this.terminalManager.getTerminal(this.activeTerminalUuid);
    if (!term) throw new Error('Active terminal session went missing');

    const startTime = Date.now();
    this.metrics.streamedMessageCount = 0;

    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_exec_started_${Date.now()}`,
      eventType: 'ExecutionStarted',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['connector', this.connectorId],
      payload: { connectorId: this.connectorId, prompt },
      metadata: {},
      correlationId: this.activeTerminalUuid,
      parentEventId: 'root'
    }).catch(() => {});

    // 1. Wait prompt ready
    const waitStart = Date.now();
    await this.promptDetector.waitPrompt(this.activeTerminalUuid, 5000);
    this.metrics.promptWaitTime = Date.now() - waitStart;

    // 2. Subscribe output stream
    const subId = `antigravity-exec-${Date.now()}`;
    this.streamingEngine.subscribe(this.activeTerminalUuid, subId, (evt) => {
      if (evt.eventType === 'data' && evt.payload.text) {
        this.metrics.streamedMessageCount++;
        onStream(evt.payload.text);
        
        this.eventBus.publish({
          schemaVersion: '1.0.0',
          eventId: `evt_exec_stream_${Date.now()}`,
          eventType: 'ExecutionStreaming',
          eventCategory: 'Telemetry',
          timestamp: Date.now(),
          severity: 'Information',
          tags: ['connector', this.connectorId],
          payload: { connectorId: this.connectorId, chunk: evt.payload.text },
          metadata: {},
          correlationId: this.activeTerminalUuid!,
          parentEventId: 'root'
        }).catch(() => {});
      }
    });

    // 3. Write prompt
    await term.write(prompt);
    const { keyCode, controlState } = parseKeyCombination('Enter');
    await term.sendKey(keyCode, controlState);

    // 4. Block wait until prompt matches stabilization profile
    await this.promptDetector.waitPrompt(this.activeTerminalUuid, 5000);

    // 5. Unsubscribe streaming engine
    this.streamingEngine.unsubscribe(this.activeTerminalUuid, subId);

    // Capture execution outcome visible text
    const captureData = await term.capture(false);

    this.metrics.executionLatency = Date.now() - startTime;

    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_exec_comp_${Date.now()}`,
      eventType: 'ExecutionCompleted',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['connector', this.connectorId],
      payload: { connectorId: this.connectorId, success: true },
      metadata: {},
      correlationId: this.activeTerminalUuid,
      parentEventId: 'root'
    }).catch(() => {});

    return { output: captureData.visible };
  }

  public async cancel(): Promise<void> {
    if (this.activeTerminalUuid) {
      const term = this.terminalManager.getTerminal(this.activeTerminalUuid);
      if (term) {
        this.metrics.cancellationCount++;
        const { keyCode, controlState } = parseKeyCombination('Ctrl+C');
        await term.sendKey(keyCode, controlState);

        this.eventBus.publish({
          schemaVersion: '1.0.0',
          eventId: `evt_exec_cancel_${Date.now()}`,
          eventType: 'ExecutionCancelled',
          eventCategory: 'System',
          timestamp: Date.now(),
          severity: 'Information',
          tags: ['connector', this.connectorId],
          payload: { connectorId: this.connectorId },
          metadata: {},
          correlationId: this.activeTerminalUuid,
          parentEventId: 'root'
        }).catch(() => {});
      }
    }
  }

  public async recover(workspaceRoot: string): Promise<boolean> {
    this.metrics.recoveryCount++;
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_conn_rec_${Date.now()}`,
      eventType: 'ConnectorRecovered',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Warning',
      tags: ['connector', this.connectorId],
      payload: { connectorId: this.connectorId },
      metadata: {},
      correlationId: this.activeTerminalUuid || 'unknown',
      parentEventId: 'root'
    }).catch(() => {});

    // Fully re-initialize terminal context
    await this.connect(workspaceRoot);
    return true;
  }
}
