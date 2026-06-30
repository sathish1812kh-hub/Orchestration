import { EventBus } from './eventBus';
import { PlatformStateRegistry } from './stateRegistry';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { AutonomousOrchestrator } from './orchestrator';
import { PluginFramework } from './pluginFramework';

export interface ServiceDescriptor {
  serviceId: string;
  version: string;
  dependencies: string[];
  startup: () => Promise<void>;
  shutdown: () => Promise<void>;
  readinessProbe: () => Promise<boolean>;
  healthProbe: () => Promise<boolean>;
}

export class RuntimeLifecycleManager {
  private services = new Map<string, ServiceDescriptor>();
  private status: 'Offline' | 'Starting' | 'Ready' | 'Stopping' | 'Stopped' | 'Recovering' | 'Maintenance' = 'Offline';
  private eventBus?: EventBus;

  constructor() {}

  public registerService(service: ServiceDescriptor) {
    // Detect cyclic dependencies in registry
    this.services.set(service.serviceId, service);
    this.resolveDependencyOrder(); // Will throw if cyclic
  }

  public getStatus() {
    return {
      status: this.status,
      servicesCount: this.services.size,
      services: Array.from(this.services.values()).map(s => ({
        id: s.serviceId,
        version: s.version,
        dependencies: s.dependencies
      }))
    };
  }

  public setEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Performs topological sort dependency resolution.
   */
  public resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const order: string[] = [];

    const visit = (serviceId: string) => {
      stack.add(serviceId);
      const service = this.services.get(serviceId);
      if (service) {
        for (const dep of service.dependencies) {
          if (stack.has(dep)) {
            throw new Error(`CyclicDependency: Loop detected containing ${dep}`);
          }
          if (!visited.has(dep)) {
            visit(dep);
          }
        }
      }
      stack.delete(serviceId);
      if (!visited.has(serviceId)) {
        visited.add(serviceId);
        order.push(serviceId);
      }
    };

    for (const serviceId of this.services.keys()) {
      if (!visited.has(serviceId)) {
        visit(serviceId);
      }
    }

    return order;
  }

  public async startPlatform(): Promise<void> {
    if (this.status !== 'Offline' && this.status !== 'Stopped') {
      return;
    }

    this.status = 'Starting';
    await this.publishEvent('PlatformStarting', {});

    const order = this.resolveDependencyOrder();

    for (const sId of order) {
      const service = this.services.get(sId)!;
      try {
        await service.startup();
        const ready = await service.readinessProbe();
        if (!ready) {
          throw new Error(`Readiness probe failed for service: ${sId}`);
        }
        await this.publishEvent('ServiceStarted', { serviceId: sId });
      } catch (err: any) {
        this.status = 'Offline';
        await this.publishEvent('PlatformStopped', { error: `Startup failed on ${sId}: ${err.message}` });
        throw err;
      }
    }

    this.status = 'Ready';
    await this.publishEvent('PlatformReady', {});
  }

  public async stopPlatform(): Promise<void> {
    if (this.status === 'Stopping' || this.status === 'Stopped' || this.status === 'Offline') {
      return;
    }

    this.status = 'Stopping';
    await this.publishEvent('PlatformStopping', {});

    const order = this.resolveDependencyOrder().reverse(); // Reverse order for graceful teardown

    for (const sId of order) {
      const service = this.services.get(sId)!;
      try {
        await service.shutdown();
        await this.publishEvent('ServiceStopped', { serviceId: sId });
      } catch (_) {}
    }

    this.status = 'Stopped';
    await this.publishEvent('PlatformStopped', {});
  }

  public async restartPlatform(): Promise<void> {
    await this.stopPlatform();
    await this.startPlatform();
    await this.publishEvent('ServiceRestarted', { target: 'all' });
  }

  public async recoverPlatform(stateRegistry: PlatformStateRegistry): Promise<void> {
    this.status = 'Recovering';
    await this.publishEvent('PlatformRecovering', {});

    try {
      // Rebuild PlatformStateRegistry projections via EventBus history replays
      if (this.eventBus) {
        await stateRegistry.rebuild();
      }
      this.status = 'Ready';
      await this.publishEvent('PlatformRecovered', {});
    } catch (err: any) {
      this.status = 'Offline';
      await this.publishEvent('PlatformStopped', { error: `Recovery failed: ${err.message}` });
      throw err;
    }
  }

  public enterMaintenanceMode() {
    this.status = 'Maintenance';
  }

  public exitMaintenanceMode() {
    this.status = 'Ready';
  }

  public isMaintenanceMode(): boolean {
    return this.status === 'Maintenance';
  }

  private async publishEvent(type: string, payload: any = {}) {
    if (!this.eventBus) return;
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_lf_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'System',
        timestamp: Date.now(),
        severity: type.includes('Fail') ? 'Error' : 'Information',
        tags: ['lifecycle'],
        payload: {
          platformState: this.status,
          ...payload
        },
        metadata: { platformState: this.status },
        correlationId: 'corr_lf_platform',
        parentEventId: 'root'
      });
    } catch (_) {}
  }
}
