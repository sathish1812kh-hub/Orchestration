import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface IpcrConfig {
  executablePath: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  timeoutMs?: number;
  completionStrategy: 'regex' | 'idle' | 'terminator';
  completionPattern?: string;
  idleTimeoutMs?: number;
}

export interface IpcrSession {
  sessionId: string;
  pid: number;
  status: 'Active' | 'Suspended' | 'Recovering' | 'Terminated';
  createdAt: number;
  lastActiveTime: number;
}

export abstract class InteractiveProcessConnector {
  protected proc?: ChildProcessWithoutNullStreams;
  protected stdoutBuffer = '';
  protected stderrBuffer = '';
  protected sessionId?: string;
  protected config?: IpcrConfig;

  // Observability metrics
  protected metrics = {
    startupTimeMs: 0,
    executionLatencyMs: 0,
    stdoutVolumeBytes: 0,
    stderrVolumeBytes: 0,
    restartCount: 0,
    recoveryCount: 0,
    cancellationCount: 0,
    failureCount: 0
  };

  constructor(
    protected eventBus: EventBus,
    protected observability: ObservabilityPlatform
  ) {}

  public getSessionId() {
    return this.sessionId;
  }

  public getMetrics() {
    return this.metrics;
  }

  public getPid(): number | undefined {
    return this.proc?.pid;
  }

  // Parser hooks (to be overridden by subclasses/vendors)
  protected abstract parseBanner(banner: string): void;
  protected abstract filterOutput(chunk: string): string;
  protected abstract detectError(chunk: string): string | null;

  public async initialize(config: IpcrConfig): Promise<void> {
    this.config = config;
    this.sessionId = `ipcr_${Math.random().toString(36).substr(2, 9)}`;
  }

  public async start(): Promise<number> {
    if (!this.config) throw new Error('IPCR not initialized');

    const startTime = Date.now();
    this.proc = spawn(this.config.executablePath, this.config.args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      shell: true
    });

    this.metrics.startupTimeMs = Date.now() - startTime;

    this.proc.stdout.on('data', (data) => {
      const txt = data.toString();
      this.stdoutBuffer += txt;
      this.metrics.stdoutVolumeBytes += Buffer.byteLength(txt);
      
      const filtered = this.filterOutput(txt);
      this.publishStreamChunk('stdout', filtered);
    });

    this.proc.stderr.on('data', (data) => {
      const txt = data.toString();
      this.stderrBuffer += txt;
      this.metrics.stderrVolumeBytes += Buffer.byteLength(txt);
      
      const err = this.detectError(txt);
      if (err) {
        this.publishStreamChunk('stderr', err);
      }
    });

    this.proc.on('close', () => {
      this.publishEvent('ProcessTerminated', { pid: this.proc?.pid });
    });

    const pid = this.proc.pid;
    if (pid === undefined) {
      throw new Error('Failed to capture process ID');
    }

    this.publishEvent('ProcessStarted', { pid, sessionId: this.sessionId });
    return pid;
  }

  public async execute(input: string, onStream: (chunk: string) => void): Promise<string> {
    if (!this.proc || !this.proc.stdin) {
      throw new Error('Process is not running');
    }

    const start = Date.now();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    const subId = `ipcr-sub-${Date.now()}`;
    const streamListener = (event: any) => {
      if (event.correlationId === this.sessionId && event.payload.streamType === 'stdout') {
        onStream(event.payload.text);
      }
    };
    
    // Subscribe to raw standard streams events
    this.eventBus.subscribe(subId, { eventType: 'ProcessStreamChunk' }, streamListener);

    // Write input prompt
    this.proc.stdin.write(input + '\n');

    // Pluggable Completion Strategy
    await this.waitForCompletion();

    this.eventBus.unsubscribe(subId);
    this.metrics.executionLatencyMs = Date.now() - start;

    return this.stdoutBuffer;
  }

  public async cancel(): Promise<void> {
    if (this.proc) {
      this.metrics.cancellationCount++;
      // Send SIGINT signal
      this.proc.kill('SIGINT');
      this.publishEvent('ProcessCancelled', { pid: this.proc.pid });
    }
  }

  public async reconnect(pid: number): Promise<boolean> {
    this.metrics.recoveryCount++;
    // In node.js, attaching to an existing process stdin/stdout requires raw OS handles/bridge.
    // For standard IPCR, we verify the process handle by sending a 0 signal.
    try {
      process.kill(pid, 0); // Check if process is alive
      this.publishEvent('ProcessReconnected', { pid, sessionId: this.sessionId });
      return true;
    } catch (_) {
      // Process is dead, trigger restart
      this.metrics.restartCount++;
      await this.start();
      return false;
    }
  }

  public async shutdown(): Promise<void> {
    if (this.proc) {
      this.proc.kill('SIGKILL');
      this.proc = undefined;
      this.publishEvent('ProcessStopped', { sessionId: this.sessionId });
    }
  }

  protected async waitForCompletion(): Promise<void> {
    if (!this.config) return;

    const timeout = this.config.timeoutMs || 5000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (this.config.completionStrategy === 'regex' && this.config.completionPattern) {
        const regex = new RegExp(this.config.completionPattern);
        if (regex.test(this.stdoutBuffer)) {
          break;
        }
      } else if (this.config.completionStrategy === 'idle') {
        const idle = this.config.idleTimeoutMs || 200;
        await new Promise(resolve => setTimeout(resolve, idle));
        break;
      } else {
        // Terminator pattern match fallback
        if (this.stdoutBuffer.includes('Completed') || this.stdoutBuffer.includes('Ready')) {
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  private publishStreamChunk(streamType: 'stdout' | 'stderr', text: string) {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_ipcr_chunk_${Date.now()}`,
      eventType: 'ProcessStreamChunk',
      eventCategory: 'Telemetry',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['ipcr', this.sessionId || ''],
      payload: { streamType, text },
      metadata: {},
      correlationId: this.sessionId || '',
      parentEventId: 'root'
    }).catch(() => {});
  }

  private publishEvent(eventType: string, payload: any) {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_ipcr_evt_${Date.now()}`,
      eventType,
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['ipcr_runtime'],
      payload,
      metadata: {},
      correlationId: this.sessionId || '',
      parentEventId: 'root'
    }).catch(() => {});
  }
}
