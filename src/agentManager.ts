import { ChildProcess, spawn } from 'child_process';
import { EventBus } from './eventBus';

export interface AgentDescriptor {
  agentId: string;
  name: string;
  version: string;
  provider: 'local_process' | 'terminal_backed' | 'docker' | 'remote_mcp';
  platform: 'windows' | 'linux' | 'darwin';
  status: 'Starting' | 'Healthy' | 'Busy' | 'Degraded' | 'Recovering' | 'Draining' | 'Offline' | 'Failed' | 'Stopped';
  capabilities: Array<{ capabilityId: string; version: string }>;
  resourceLimits: {
    maxConcurrentTasks: number;
    maxMemoryMb: number;
  };
  currentWorkload: number;
  workspaceRoot: string;
  metadata: any;
  process?: ChildProcess; // Only for local processes
  lastHeartbeatTime?: number;
  restartCount: number;
}

export class AgentManager {
  private eventBus: EventBus;
  private agents = new Map<string, AgentDescriptor>();
  
  // Interval for missing heartbeat monitoring (Default: 5000ms check, 15000ms timeout)
  private heartbeatInterval!: NodeJS.Timeout;
  private autoRestartPolicy = {
    enabled: true,
    maxRetries: 3,
    backoffMs: 500
  };

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.startHeartbeatMonitor();
  }

  private startHeartbeatMonitor() {
    this.heartbeatInterval = setInterval(async () => {
      const now = Date.now();
      for (const agent of this.agents.values()) {
        if (agent.status === 'Offline' || agent.status === 'Stopped' || agent.status === 'Failed') continue;

        const lastHb = agent.lastHeartbeatTime || 0;
        if (now - lastHb > 15000) {
          // Transition to Offline
          await this.transitionHealth(agent.agentId, 'Offline');
          
          // Handle crash/process failure restart if it is a supervised local process
          if (agent.provider === 'local_process' && agent.process) {
            await this.handleAgentCrash(agent);
          }
        }
      }
    }, 2000);
  }

  public shutdown() {
    clearInterval(this.heartbeatInterval);
    for (const agent of this.agents.values()) {
      this.stopAgentProcess(agent);
    }
  }

  /**
   * Registers a new agent manually or dynamically discovered.
   */
  public async registerAgent(agent: Omit<AgentDescriptor, 'status' | 'currentWorkload' | 'restartCount'> & { status?: any }): Promise<AgentDescriptor> {
    const fullAgent: AgentDescriptor = {
      ...agent,
      status: agent.status || 'Starting',
      currentWorkload: 0,
      restartCount: 0,
      lastHeartbeatTime: Date.now()
    };

    this.agents.set(agent.agentId, fullAgent);

    await this.publishEvent('AgentRegistered', fullAgent);
    await this.transitionHealth(agent.agentId, 'Healthy');

    return fullAgent;
  }

  /**
   * Removes registration of an agent.
   */
  public async unregisterAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.stopAgentProcess(agent);
    this.agents.delete(agentId);

    await this.publishEvent('AgentStopped', agent);
    return true;
  }

  /**
   * Processes heartbeat logs and updates workloads.
   */
  public async processHeartbeat(agentId: string, metrics: { cpuUsagePct?: number; memoryUsedMb?: number; status?: any; currentWorkload?: number }): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.lastHeartbeatTime = Date.now();
    agent.currentWorkload = metrics.currentWorkload ?? agent.currentWorkload;

    const oldStatus = agent.status;
    if (metrics.status && metrics.status !== oldStatus) {
      await this.transitionHealth(agentId, metrics.status);
    } else if (agent.status === 'Offline') {
      await this.transitionHealth(agentId, 'Healthy');
    }

    await this.publishEvent('AgentHeartbeat', agent, { metrics });
    return true;
  }

  private async transitionHealth(agentId: string, newStatus: AgentDescriptor['status']) {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const oldStatus = agent.status;
    agent.status = newStatus;

    // Publish matching lifecycle category event
    let eventType = 'AgentStarted';
    if (newStatus === 'Stopped') eventType = 'AgentStopped';
    else if (newStatus === 'Offline') eventType = 'AgentOffline';
    else if (newStatus === 'Failed') eventType = 'AgentFailed';
    else if (newStatus === 'Draining') eventType = 'AgentDraining';
    else if (newStatus === 'Recovering') eventType = 'AgentRecovered';

    await this.publishEvent(eventType, agent, { oldStatus, newStatus });
  }

  /**
   * Spawns supervised local processes.
   */
  public async spawnSupervisedProcess(agentId: string, command: string, args: string[]): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.provider !== 'local_process') return false;

    try {
      this.stopAgentProcess(agent);

      const child = spawn(command, args, { shell: true });
      agent.process = child;
      agent.status = 'Healthy';
      agent.lastHeartbeatTime = Date.now();

      child.on('exit', async (code) => {
        if (agent.status !== 'Stopped' && agent.status !== 'Draining') {
          agent.status = 'Failed';
          await this.publishEvent('AgentFailed', agent, { reason: `Process exited with code ${code}` });
          await this.handleAgentCrash(agent, command, args);
        }
      });

      await this.publishEvent('AgentStarted', agent);
      return true;
    } catch (err: any) {
      agent.status = 'Failed';
      await this.publishEvent('AgentFailed', agent, { reason: `Spawn error: ${err.message}` });
      return false;
    }
  }

  private async handleAgentCrash(agent: AgentDescriptor, command?: string, args?: string[]) {
    if (!this.autoRestartPolicy.enabled) return;

    if (agent.restartCount < this.autoRestartPolicy.maxRetries) {
      agent.restartCount++;
      agent.status = 'Recovering';
      await this.publishEvent('AgentRestarted', agent, { attempt: agent.restartCount });

      setTimeout(async () => {
        if (command) {
          await this.spawnSupervisedProcess(agent.agentId, command, args || []);
        } else {
          // Manual heartbeat simulated process restart
          agent.status = 'Healthy';
          agent.lastHeartbeatTime = Date.now();
          await this.publishEvent('AgentStarted', agent);
        }
      }, this.autoRestartPolicy.backoffMs * agent.restartCount);
    } else {
      agent.status = 'Failed';
      await this.publishEvent('AgentFailed', agent, { reason: 'Max restart retries exceeded' });
    }
  }

  private stopAgentProcess(agent: AgentDescriptor) {
    if (agent.process) {
      try {
        agent.process.kill('SIGTERM');
      } catch (_) {
        try {
          agent.process.kill('SIGKILL');
        } catch (_) {}
      }
      agent.process = undefined;
    }
  }

  public async stopAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.stopAgentProcess(agent);
    await this.transitionHealth(agentId, 'Stopped');
    return true;
  }

  public async restartAgent(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.stopAgentProcess(agent);
    agent.restartCount = 0;
    await this.transitionHealth(agentId, 'Healthy');
    agent.lastHeartbeatTime = Date.now();
    return true;
  }

  public async enableDrainMode(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    await this.transitionHealth(agentId, 'Draining');
    
    // Auto-stop once task workload reaches 0
    const checkIdle = setInterval(async () => {
      if (agent.currentWorkload === 0) {
        clearInterval(checkIdle);
        if (agent.status === 'Draining') {
          await this.stopAgent(agentId);
        }
      }
    }, 100);

    return true;
  }

  public async disableDrainMode(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'Draining') return false;

    await this.transitionHealth(agentId, 'Healthy');
    return true;
  }

  private async publishEvent(type: string, agent: AgentDescriptor, payload: any = {}) {
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_ag_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'Agent',
        timestamp: Date.now(),
        severity: type.includes('Failed') ? 'Error' : 'Information',
        tags: ['agent', agent.agentId],
        payload: {
          agentId: agent.agentId,
          name: agent.name,
          status: agent.status,
          provider: agent.provider,
          capabilities: agent.capabilities,
          ...payload
        },
        metadata: { agentId: agent.agentId },
        correlationId: `corr_ag_${agent.agentId}`,
        parentEventId: 'root'
      });
    } catch (_) {}
  }

  public getAgent(agentId: string): AgentDescriptor | undefined {
    return this.agents.get(agentId);
  }

  public listAgents(): AgentDescriptor[] {
    return Array.from(this.agents.values());
  }
}
