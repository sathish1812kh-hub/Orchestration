import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface RemoteCluster {
  clusterId: string;
  gatewayUrl: string;
  state: 'Active' | 'Inactive' | 'Unreachable';
  capabilities: string[];
  latencyMs: number;
}

export class CloudExecutionGateway {
  private eventBus: EventBus;
  private obs: ObservabilityPlatform;
  private clusters: Record<string, RemoteCluster> = {};

  constructor(eventBus: EventBus, obs: ObservabilityPlatform) {
    this.eventBus = eventBus;
    this.obs = obs;
  }

  private publishEvent(clusterId: string, eventType: string, payload: any, severity: 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' = 'Information'): void {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: Math.random().toString(36).substring(7),
      eventType,
      eventCategory: 'cegrf',
      timestamp: Date.now(),
      correlationId: clusterId,
      parentEventId: 'none',
      sessionId: clusterId,
      severity,
      tags: ['cegrf', eventType],
      payload,
      metadata: { clusterId },
      priority: severity === 'Error' ? 'High' : severity === 'Warning' ? 'Normal' : 'Low'
    });
  }

  public registerRemoteCluster(cluster: RemoteCluster): void {
    this.clusters[cluster.clusterId] = cluster;
    this.publishEvent(cluster.clusterId, 'FederationCreated', { clusterId: cluster.clusterId });
    this.publishEvent(cluster.clusterId, 'FederationJoined', { clusterId: cluster.clusterId });
    this.publishEvent(cluster.clusterId, 'RemoteClusterRegistered', { clusterId: cluster.clusterId, gatewayUrl: cluster.gatewayUrl });
  }

  public deregisterRemoteCluster(clusterId: string): void {
    if (this.clusters[clusterId]) {
      delete this.clusters[clusterId];
      this.publishEvent(clusterId, 'FederationLeft', { clusterId });
    }
  }

  public federateTask(taskName: string, capability: string): string {
    const candidates = Object.values(this.clusters).filter(
      c => c.state === 'Active' && c.capabilities.includes(capability)
    );

    if (candidates.length === 0) {
      throw new Error(`No active federated clusters matching capability: ${capability}`);
    }

    candidates.sort((a, b) => a.latencyMs - b.latencyMs);
    const selected = candidates[0];

    this.publishEvent(selected.clusterId, 'RemoteExecutionDispatched', { taskName, capability, selectedCluster: selected.clusterId });
    return selected.clusterId;
  }

  public syncArtifacts(clusterId: string, artifactPath: string): void {
    const cluster = this.clusters[clusterId];
    if (!cluster) throw new Error(`Remote cluster ${clusterId} not found`);

    this.publishEvent(clusterId, 'ArtifactTransferred', { clusterId, artifactPath });
  }

  public getCluster(clusterId: string): RemoteCluster | undefined {
    return this.clusters[clusterId];
  }

  public getClustersList(): RemoteCluster[] {
    return Object.values(this.clusters);
  }
}
