import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface DcmsContextSnapshot {
  contextId: string;
  sessionId: string;
  workflowId: string;
  version: number;
  checksum: string;
  timestamp: number;
  ownerNode: string;
  data: Record<string, any>;
}

export class DcmsContextCoordinator {
  private eventBus: EventBus;
  private obs: ObservabilityPlatform;
  private snapshots: Record<string, DcmsContextSnapshot[]> = {};

  constructor(eventBus: EventBus, obs: ObservabilityPlatform) {
    this.eventBus = eventBus;
    this.obs = obs;
  }

  private publishEvent(contextId: string, eventType: string, payload: any, severity: 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' = 'Information'): void {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: Math.random().toString(36).substring(7),
      eventType,
      eventCategory: 'dcms',
      timestamp: Date.now(),
      correlationId: contextId,
      parentEventId: 'none',
      sessionId: contextId,
      severity,
      tags: ['dcms', eventType],
      payload,
      metadata: { contextId },
      priority: severity === 'Error' ? 'High' : severity === 'Warning' ? 'Normal' : 'Low'
    });
  }

  public createSnapshot(
    contextId: string,
    sessionId: string,
    workflowId: string,
    ownerNode: string,
    data: Record<string, any>
  ): DcmsContextSnapshot {
    const list = this.snapshots[contextId] || [];
    const nextVer = list.length + 1;
    const checksum = Math.random().toString(36).substring(7); // Mock checksum computation

    const snap: DcmsContextSnapshot = {
      contextId,
      sessionId,
      workflowId,
      version: nextVer,
      checksum,
      timestamp: Date.now(),
      ownerNode,
      data
    };

    list.push(snap);
    this.snapshots[contextId] = list;

    this.publishEvent(contextId, 'ContextCreated', { contextId, version: nextVer });
    this.publishEvent(contextId, 'SnapshotCreated', { contextId, version: nextVer, checksum });

    return snap;
  }

  public replicateSnapshot(contextId: string, targetNode: string): void {
    const list = this.snapshots[contextId];
    if (!list || list.length === 0) throw new Error(`Context ${contextId} not found`);

    const latest = list[list.length - 1];
    this.publishEvent(contextId, 'ContextReplicated', { contextId, version: latest.version, targetNode });
    this.publishEvent(contextId, 'ReplicationCompleted', { contextId, version: latest.version, targetNode });
  }

  public resolveConflict(incoming: DcmsContextSnapshot): DcmsContextSnapshot {
    const list = this.snapshots[incoming.contextId];
    if (!list || list.length === 0) {
      this.snapshots[incoming.contextId] = [incoming];
      return incoming;
    }

    const current = list[list.length - 1];

    if (incoming.version > current.version) {
      list.push(incoming);
      this.publishEvent(incoming.contextId, 'ContextUpdated', { contextId: incoming.contextId, version: incoming.version });
      return incoming;
    }

    if (incoming.version === current.version && incoming.timestamp > current.timestamp) {
      // Last-Writer-Wins resolution
      list[list.length - 1] = incoming;
      this.publishEvent(incoming.contextId, 'ContextUpdated', { contextId: incoming.contextId, version: incoming.version, resolved: 'LastWriterWins' });
      return incoming;
    }

    this.publishEvent(incoming.contextId, 'ContextConflict', { contextId: incoming.contextId, currentVersion: current.version, incomingVersion: incoming.version }, 'Warning');
    return current;
  }

  public restoreSnapshot(contextId: string, version: number): DcmsContextSnapshot {
    const list = this.snapshots[contextId];
    if (!list) throw new Error(`Context ${contextId} not found`);

    const match = list.find(s => s.version === version);
    if (!match) throw new Error(`Version ${version} of context ${contextId} not found`);

    this.publishEvent(contextId, 'SnapshotRestored', { contextId, version });
    this.publishEvent(contextId, 'ContextRecovered', { contextId, version });
    return match;
  }

  public getLatestSnapshot(contextId: string): DcmsContextSnapshot | undefined {
    const list = this.snapshots[contextId];
    return list && list.length > 0 ? list[list.length - 1] : undefined;
  }

  public getHistory(contextId: string): DcmsContextSnapshot[] {
    return this.snapshots[contextId] || [];
  }
}
