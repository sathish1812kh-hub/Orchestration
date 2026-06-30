import * as process from 'process';

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
  value: number;
  tags: string[];
  timestamp: number;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  component: string;
  operation: string;
  timestamp: number;
  durationMs: number;
  outcome: 'Success' | 'Failed';
}

export interface SystemHealth {
  status: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Offline' | 'Unknown';
  subsystems: { [key: string]: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Offline' };
}

export interface Alert {
  alertId: string;
  ruleName: string;
  severity: 'Warning' | 'Critical';
  message: string;
  timestamp: number;
}

export class ObservabilityPlatform {
  private metrics: Metric[] = [];
  private traces: TraceSpan[] = [];
  private alerts: Alert[] = [];
  private alertsPolicy = {
    highMemoryThresholdMb: 1024,
    highLatencyThresholdMs: 5000,
    queueOverflowSize: 100
  };

  constructor() {}

  // ----------------------------------------------------
  // Metrics Registry
  // ----------------------------------------------------
  public recordMetric(name: string, type: 'counter' | 'gauge' | 'histogram' | 'timer', value: number, tags: string[] = []) {
    this.metrics.push({
      name,
      type,
      value,
      tags,
      timestamp: Date.now()
    });
    this.evaluateAlertRules();
  }

  public getMetrics(): Metric[] {
    return this.metrics;
  }

  // ----------------------------------------------------
  // Distributed Tracing
  // ----------------------------------------------------
  public startTrace(traceId: string, spanId: string, parentSpanId: string | undefined, component: string, operation: string): { endSpan: (outcome: 'Success' | 'Failed') => void } {
    const startTime = Date.now();
    return {
      endSpan: (outcome: 'Success' | 'Failed') => {
        const durationMs = Date.now() - startTime;
        this.traces.push({
          traceId,
          spanId,
          parentSpanId,
          component,
          operation,
          timestamp: startTime,
          durationMs,
          outcome
        });
      }
    };
  }

  public getTraces(): TraceSpan[] {
    return this.traces;
  }

  // ----------------------------------------------------
  // Health Monitor
  // ----------------------------------------------------
  public aggregateHealth(servicesStatuses: { [key: string]: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Offline' }): SystemHealth {
    let status: 'Healthy' | 'Degraded' | 'Unhealthy' | 'Offline' = 'Healthy';

    const values = Object.values(servicesStatuses);
    if (values.includes('Unhealthy')) {
      status = 'Unhealthy';
    } else if (values.includes('Degraded')) {
      status = 'Degraded';
    } else if (values.includes('Offline')) {
      status = 'Degraded'; // Partially degraded
    }

    return {
      status,
      subsystems: servicesStatuses
    };
  }

  // ----------------------------------------------------
  // Lightweight Profiler
  // ----------------------------------------------------
  public sampleProfiler() {
    const memory = process.memoryUsage();
    return {
      cpuUsage: process.cpuUsage(),
      memoryUsageMb: {
        rss: Math.round(memory.rss / 1024 / 1024),
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024)
      },
      timestamp: Date.now()
    };
  }

  // ----------------------------------------------------
  // Rule-Based Alerting
  // ----------------------------------------------------
  private evaluateAlertRules() {
    const memory = process.memoryUsage().rss / 1024 / 1024;
    if (memory > this.alertsPolicy.highMemoryThresholdMb) {
      this.triggerAlert('HighMemoryUsage', 'Warning', `RSS memory usage is ${Math.round(memory)} MB, exceeding limit of ${this.alertsPolicy.highMemoryThresholdMb} MB`);
    }

    // Check last metrics for latency
    const recentLatency = this.metrics.filter(m => m.type === 'timer' && m.name === 'command_latency').slice(-5);
    for (const lat of recentLatency) {
      if (lat.value > this.alertsPolicy.highLatencyThresholdMs) {
        this.triggerAlert('HighCommandLatency', 'Critical', `Command latency observed at ${lat.value} ms, exceeding threshold of ${this.alertsPolicy.highLatencyThresholdMs} ms`);
      }
    }
  }

  public triggerAlert(ruleName: string, severity: 'Warning' | 'Critical', message: string) {
    // Avoid spamming duplicate alerts
    const dup = this.alerts.find(a => a.ruleName === ruleName && a.message === message && Date.now() - a.timestamp < 10000);
    if (dup) return;

    this.alerts.push({
      alertId: `alt_${Math.random().toString(36).substring(2, 9)}`,
      ruleName,
      severity,
      message,
      timestamp: Date.now()
    });
  }

  public getAlerts(): Alert[] {
    return this.alerts;
  }

  // ----------------------------------------------------
  // Export Manager
  // ----------------------------------------------------
  public exportMetrics(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.metrics, null, 2);
    }
    const csvRows = ['name,type,value,timestamp,tags'];
    for (const m of this.metrics) {
      csvRows.push(`${m.name},${m.type},${m.value},${m.timestamp},"${m.tags.join(';')}"`);
    }
    return csvRows.join('\n');
  }

  public exportTraces(format: 'json' | 'csv'): string {
    if (format === 'json') {
      return JSON.stringify(this.traces, null, 2);
    }
    const csvRows = ['traceId,spanId,parentSpanId,component,operation,durationMs,outcome'];
    for (const t of this.traces) {
      csvRows.push(`${t.traceId},${t.spanId},${t.parentSpanId || ''},${t.component},${t.operation},${t.durationMs},${t.outcome}`);
    }
    return csvRows.join('\n');
  }
}
