import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface ClusterNode {
  nodeId: string;
  clusterId: string;
  hostname: string;
  state: 'Joining' | 'Ready' | 'Busy' | 'Draining' | 'Recovering' | 'Offline';
  capabilities: string[];
  connectors: string[];
  platformVersion: string;
  load: number;
  lastHeartbeat: number;
}

export class DmaeClusterManager {
  private eventBus: EventBus;
  private obs: ObservabilityPlatform;
  private nodes: Record<string, ClusterNode> = {};

  constructor(eventBus: EventBus, obs: ObservabilityPlatform) {
    this.eventBus = eventBus;
    this.obs = obs;
  }

  private publishEvent(nodeId: string, eventType: string, payload: any, severity: 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' = 'Information'): void {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: Math.random().toString(36).substring(7),
      eventType,
      eventCategory: 'dmae',
      timestamp: Date.now(),
      correlationId: nodeId,
      parentEventId: 'none',
      sessionId: nodeId,
      severity,
      tags: ['dmae', eventType],
      payload,
      metadata: { nodeId },
      priority: severity === 'Error' ? 'High' : severity === 'Warning' ? 'Normal' : 'Low'
    });
  }

  public registerNode(node: ClusterNode): void {
    this.nodes[node.nodeId] = {
      ...node,
      lastHeartbeat: Date.now()
    };
    this.publishEvent(node.nodeId, 'NodeJoined', { nodeId: node.nodeId, clusterId: node.clusterId });
    this.publishEvent(node.nodeId, 'WorkerRegistered', { nodeId: node.nodeId, connectors: node.connectors });
  }

  public unregisterNode(nodeId: string): void {
    const node = this.nodes[nodeId];
    if (node) {
      node.state = 'Offline';
      this.publishEvent(nodeId, 'NodeLeft', { nodeId });
      this.publishEvent(nodeId, 'WorkerDisconnected', { nodeId });
    }
  }

  public heartbeat(nodeId: string): void {
    const node = this.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.lastHeartbeat = Date.now();
    if (node.state === 'Offline') {
      node.state = 'Ready';
      this.publishEvent(nodeId, 'NodeRecovered', { nodeId });
    }
  }

  public checkHeartbeats(timeoutMs: number = 15000): void {
    const now = Date.now();
    for (const [id, node] of Object.entries(this.nodes)) {
      if (node.state !== 'Offline' && now - node.lastHeartbeat > timeoutMs) {
        node.state = 'Offline';
        this.publishEvent(id, 'NodeLeft', { nodeId: id, reason: 'HeartbeatTimeout' }, 'Warning');
      }
    }
  }

  public scheduleTask(capability: string, policy: 'RoundRobin' | 'LeastLoaded' = 'RoundRobin'): string {
    const candidates = Object.values(this.nodes).filter(
      n => n.state === 'Ready' && n.capabilities.includes(capability)
    );

    if (candidates.length === 0) {
      throw new Error(`No available nodes matching capability: ${capability}`);
    }

    if (policy === 'LeastLoaded') {
      candidates.sort((a, b) => a.load - b.load);
      return candidates[0].nodeId;
    }

    // Default RoundRobin / Arbitrary pick
    return candidates[0].nodeId;
  }

  public setMaintenanceMode(nodeId: string, enabled: boolean): void {
    const node = this.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.state = enabled ? 'Draining' : 'Ready';
    this.publishEvent(nodeId, 'WorkerRegistered', { nodeId, maintenance: enabled });
  }

  public triggerRecovery(nodeId: string): void {
    const node = this.nodes[nodeId];
    if (!node) throw new Error(`Node ${nodeId} not found`);
    node.state = 'Recovering';
    this.publishEvent(nodeId, 'TaskMigrated', { nodeId });
    this.publishEvent(nodeId, 'ClusterRecovered', { nodeId });
  }

  public getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes[nodeId];
  }

  public getNodesList(): ClusterNode[] {
    return Object.values(this.nodes);
  }
}
