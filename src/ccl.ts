import { GcacProfile } from './gcac';

export type CclBehavior = 'Normal' | 'Slow' | 'Crash' | 'Hang' | 'DelayedPrompt';

export interface CclExecutionTrace {
  version: string;
  behavior: CclBehavior;
  output: string;
  latencyMs: number;
  timestamp: number;
}

export interface CclReport {
  connectorId: string;
  verdict: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAILED' | 'UNSUPPORTED';
  regressionsDetected: boolean;
  benchmark: {
    startupMs: number;
    promptMs: number;
  };
  details: string[];
}

export class ConnectorCompatibilityLab {
  private tracesHistory: Record<string, CclExecutionTrace[]> = {};
  private matrixCatalog: Array<{
    connectorId: string;
    version: string;
    verdict: string;
    regressionStatus: string;
  }> = [];

  public async runTest(
    profile: GcacProfile,
    version: string,
    behavior: CclBehavior
  ): Promise<CclExecutionTrace> {
    const start = Date.now();
    let output = '';
    let latencyMs = 50;

    // Simulate behavior profiles
    switch (behavior) {
      case 'Normal':
        output = `claude-code v${version}\nProcessed successfully\nReady`;
        break;
      case 'Slow':
        output = `claude-code v${version}\nProcessed with delays\nReady`;
        latencyMs = 500;
        break;
      case 'Crash':
        output = `Error: Process terminated abruptly`;
        latencyMs = 10;
        break;
      case 'Hang':
        output = ``;
        latencyMs = 2000;
        break;
      case 'DelayedPrompt':
        output = `claude-code v${version}\nReady`;
        latencyMs = 800;
        break;
    }

    const trace: CclExecutionTrace = {
      version,
      behavior,
      output,
      latencyMs,
      timestamp: Date.now()
    };

    if (!this.tracesHistory[profile.name]) {
      this.tracesHistory[profile.name] = [];
    }
    this.tracesHistory[profile.name].push(trace);

    return trace;
  }

  public detectRegressions(
    profileName: string,
    current: CclExecutionTrace
  ): {
    regression: boolean;
    differences: string[];
  } {
    const history = this.tracesHistory[profileName] || [];
    const baseline = history.find(t => t.version === current.version && t.behavior === 'Normal' && t !== current);
    if (!baseline) {
      return { regression: false, differences: [] };
    }

    const differences: string[] = [];
    if (current.latencyMs > baseline.latencyMs * 1.5) {
      differences.push(`Latency regression: ${current.latencyMs}ms vs baseline ${baseline.latencyMs}ms`);
    }
    if (current.output.length < baseline.output.length * 0.8) {
      differences.push(`Output truncated: length ${current.output.length} vs baseline ${baseline.output.length}`);
    }

    return {
      regression: differences.length > 0,
      differences
    };
  }

  public certify(
    profile: GcacProfile,
    traces: CclExecutionTrace[]
  ): CclReport {
    const details: string[] = [];
    let hasFailure = false;
    let hasWarning = false;

    for (const t of traces) {
      if (t.behavior === 'Crash') {
        details.push(`Version ${t.version} crashed during execution`);
        hasFailure = true;
      }
      if (t.latencyMs > 300) {
        details.push(`Version ${t.version} exceeded latency limits (${t.latencyMs}ms)`);
        hasWarning = true;
      }
    }

    const verdict = hasFailure ? 'FAILED' : hasWarning ? 'PASS_WITH_WARNINGS' : 'PASS';

    const report: CclReport = {
      connectorId: profile.name,
      verdict,
      regressionsDetected: hasWarning,
      benchmark: {
        startupMs: traces[0]?.latencyMs || 50,
        promptMs: traces[1]?.latencyMs || 80
      },
      details
    };

    // Auto-update catalog matrix database
    this.matrixCatalog.push({
      connectorId: profile.name,
      version: traces[0]?.version || 'unknown',
      verdict,
      regressionStatus: hasWarning ? 'REGRESSION_WARNING' : 'STABLE'
    });

    return report;
  }

  public getMatrixCatalog() {
    return this.matrixCatalog;
  }

  public getHistory(profileName: string): CclExecutionTrace[] {
    return this.tracesHistory[profileName] || [];
  }
}
