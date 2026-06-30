import { PlatformEvent, EventBus } from './eventBus';

export interface TerminalProjection {
  terminalId: string;
  shellType: string;
  pid: number;
  status: string;
  currentDirectory: string;
  workspace: string;
  activeSubscribers: string[];
  attachedWorkflow?: string;
  lastActivity: number;
  health: 'healthy' | 'degraded';
}

export interface WorkflowProjection {
  workflowId: string;
  status: string;
  currentTask: string;
  progress: number;
  associatedTerminals: string[];
  associatedAgents: string[];
  retryCount: number;
}

export interface AgentProjection {
  agentId: string;
  status: string;
  capabilities: string[];
  assignedWorkflows: string[];
  assignedTerminals: string[];
  health: string;
  lastHeartbeat: number;
}

export interface SessionProjection {
  sessionId: string;
  owner: string;
  terminals: string[];
  workflows: string[];
  agents: string[];
  creationTime: number;
  lastActivity: number;
}

export interface PluginProjection {
  pluginId: string;
  version: string;
  status: string;
  capabilities: string[];
  loadedTimestamp: number;
}

export interface SubscriberProjection {
  subscriberId: string;
  subscribedTopics: string[];
  queueDepth: number;
  deliveryLatency: number;
  health: string;
}

export interface RegistrySnapshot {
  lastSequenceNumber: number;
  timestamp: number;
  terminals: TerminalProjection[];
  workflows: WorkflowProjection[];
  agents: AgentProjection[];
  sessions: SessionProjection[];
  plugins: PluginProjection[];
  subscribers: SubscriberProjection[];
}

export class PlatformStateRegistry {
  private eventBus: EventBus;
  private lastProcessedSequence = 0;
  private lastProcessedTimestamp = 0;

  // Projections Store
  private terminals = new Map<string, TerminalProjection>();
  private workflows = new Map<string, WorkflowProjection>();
  private agents = new Map<string, AgentProjection>();
  private sessions = new Map<string, SessionProjection>();
  private plugins = new Map<string, PluginProjection>();
  private subscribers = new Map<string, SubscriberProjection>();

  // Telemetry metrics
  private metrics = {
    processedEventsCount: 0,
    lastEventProcessTimeMs: 0,
    rebuildsCount: 0,
    snapshotsExportedCount: 0,
    snapshotsImportedCount: 0
  };

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.subscribeToEventBus();
  }

  private subscribeToEventBus() {
    this.eventBus.subscribe('State-Registry-Projection-Engine', { eventType: '*' }, (event) => {
      this.processEvent(event);
    });
  }

  /**
   * Deterministically applies state modifications based on canonical events.
   */
  public processEvent(event: PlatformEvent): void {
    if (event.sequenceNumber <= this.lastProcessedSequence) {
      // Ignore duplicate/older events (Idempotency)
      return;
    }

    const startTime = Date.now();
    this.lastProcessedSequence = event.sequenceNumber;
    this.lastProcessedTimestamp = event.timestamp;
    this.metrics.processedEventsCount++;

    const payload = event.payload || {};

    switch (event.eventType) {
      // --- Terminal Projections ---
      case 'TerminalCreated':
        this.terminals.set(event.terminalId || payload.terminalId, {
          terminalId: event.terminalId || payload.terminalId,
          shellType: payload.shellType || 'powershell',
          pid: payload.pid || 0,
          status: 'Idle',
          currentDirectory: payload.workspaceRoot || '',
          workspace: payload.workspaceRoot || '',
          activeSubscribers: [],
          lastActivity: event.timestamp,
          health: 'healthy'
        });
        break;

      case 'TerminalAttached':
        const termAtt = this.terminals.get(event.terminalId || payload.terminalId);
        if (termAtt) {
          termAtt.pid = payload.targetPid || termAtt.pid;
          termAtt.shellType = payload.shellType || termAtt.shellType;
          termAtt.lastActivity = event.timestamp;
        }
        break;

      case 'TerminalDetached':
        const termDet = this.terminals.get(event.terminalId || payload.terminalId);
        if (termDet) {
          termDet.pid = 0;
          termDet.lastActivity = event.timestamp;
        }
        break;

      case 'TerminalClosed':
        this.terminals.delete(event.terminalId || payload.terminalId);
        break;

      case 'TerminalResized':
        const termRes = this.terminals.get(event.terminalId || payload.terminalId);
        if (termRes) {
          termRes.lastActivity = event.timestamp;
        }
        break;

      case 'TerminalBusy':
      case 'PromptLost':
        const termBusy = this.terminals.get(event.terminalId || payload.terminalId);
        if (termBusy) {
          termBusy.status = 'Running';
          termBusy.lastActivity = event.timestamp;
        }
        break;

      case 'TerminalIdle':
      case 'PromptDetected':
        const termIdle = this.terminals.get(event.terminalId || payload.terminalId);
        if (termIdle) {
          termIdle.status = 'Idle';
          termIdle.lastActivity = event.timestamp;
        }
        break;

      case 'CommandStarted':
        const termCmd = this.terminals.get(event.terminalId || payload.terminalId);
        if (termCmd) {
          termCmd.status = 'Running';
          termCmd.lastActivity = event.timestamp;
        }
        break;

      case 'CommandCompleted':
        const termComp = this.terminals.get(event.terminalId || payload.terminalId);
        if (termComp) {
          termComp.status = 'Idle';
          termComp.lastActivity = event.timestamp;
        }
        break;

      // --- Streaming Projections ---
      case 'SubscriberJoined':
        const subId = payload.subscriberId;
        if (subId) {
          this.subscribers.set(subId, {
            subscriberId: subId,
            subscribedTopics: payload.filterRules ? Object.keys(payload.filterRules) : [],
            queueDepth: 0,
            deliveryLatency: 0,
            health: 'healthy'
          });

          // Add to terminal subscriber list
          const termSub = this.terminals.get(event.terminalId || payload.terminalId);
          if (termSub && !termSub.activeSubscribers.includes(subId)) {
            termSub.activeSubscribers.push(subId);
          }
        }
        break;

      case 'SubscriberLeft':
        const leftSubId = payload.subscriberId;
        if (leftSubId) {
          this.subscribers.delete(leftSubId);
          const termSub = this.terminals.get(event.terminalId || payload.terminalId);
          if (termSub) {
            termSub.activeSubscribers = termSub.activeSubscribers.filter(id => id !== leftSubId);
          }
        }
        break;

      case 'BufferOverflow':
        const overflowSub = this.subscribers.get(payload.subscriberId);
        if (overflowSub) {
          overflowSub.health = 'degraded';
        }
        break;

      // --- Workflow Projections ---
      case 'WorkflowCreated':
        this.workflows.set(payload.workflowId, {
          workflowId: payload.workflowId,
          status: 'Created',
          currentTask: '',
          progress: 0,
          associatedTerminals: payload.terminalId ? [payload.terminalId] : [],
          associatedAgents: payload.agentId ? [payload.agentId] : [],
          retryCount: 0
        });
        break;

      case 'WorkflowStarted':
        const wfStart = this.workflows.get(payload.workflowId);
        if (wfStart) {
          wfStart.status = 'Running';
        }
        break;

      case 'WorkflowCompleted':
        const wfComp = this.workflows.get(payload.workflowId);
        if (wfComp) {
          wfComp.status = 'Completed';
          wfComp.progress = 100;
        }
        break;

      case 'WorkflowFailed':
        const wfFail = this.workflows.get(payload.workflowId);
        if (wfFail) {
          wfFail.status = 'Failed';
        }
        break;

      case 'TaskStarted':
        const wfTaskStart = this.workflows.get(payload.workflowId);
        if (wfTaskStart) {
          wfTaskStart.currentTask = payload.taskId;
        }
        break;

      // --- Agent Projections ---
      case 'AgentRegistered':
        this.agents.set(payload.agentId, {
          agentId: payload.agentId,
          status: 'Registered',
          capabilities: payload.capabilities || [],
          assignedWorkflows: [],
          assignedTerminals: [],
          health: 'healthy',
          lastHeartbeat: event.timestamp
        });
        break;

      case 'AgentStarted':
        const agStart = this.agents.get(payload.agentId);
        if (agStart) {
          agStart.status = 'Active';
          agStart.lastHeartbeat = event.timestamp;
        }
        break;

      case 'AgentStopped':
        const agStop = this.agents.get(payload.agentId);
        if (agStop) {
          agStop.status = 'Stopped';
          agStop.lastHeartbeat = event.timestamp;
        }
        break;

      // --- System & Session Projections ---
      case 'ServerStarted':
        // Clear session or set initialization timestamps
        break;

      case 'PluginLoaded':
        this.plugins.set(payload.pluginId, {
          pluginId: payload.pluginId,
          version: payload.version || '1.0.0',
          status: 'Loaded',
          capabilities: payload.capabilities || [],
          loadedTimestamp: event.timestamp
        });
        break;

      case 'PluginUnloaded':
        this.plugins.delete(payload.pluginId);
        break;
    }

    this.metrics.lastEventProcessTimeMs = Date.now() - startTime;
  }

  // --- Snapshot Manager ---
  
  public exportSnapshot(): RegistrySnapshot {
    this.metrics.snapshotsExportedCount++;
    return {
      lastSequenceNumber: this.lastProcessedSequence,
      timestamp: Date.now(),
      terminals: Array.from(this.terminals.values()),
      workflows: Array.from(this.workflows.values()),
      agents: Array.from(this.agents.values()),
      sessions: Array.from(this.sessions.values()),
      plugins: Array.from(this.plugins.values()),
      subscribers: Array.from(this.subscribers.values())
    };
  }

  public importSnapshot(snapshot: RegistrySnapshot): void {
    this.validateSnapshot(snapshot);
    
    this.lastProcessedSequence = snapshot.lastSequenceNumber;
    this.lastProcessedTimestamp = snapshot.timestamp;
    this.metrics.snapshotsImportedCount++;

    this.terminals.clear();
    this.workflows.clear();
    this.agents.clear();
    this.sessions.clear();
    this.plugins.clear();
    this.subscribers.clear();

    for (const t of snapshot.terminals) this.terminals.set(t.terminalId, t);
    for (const w of snapshot.workflows) this.workflows.set(w.workflowId, w);
    for (const a of snapshot.agents) this.agents.set(a.agentId, a);
    for (const s of snapshot.sessions) this.sessions.set(s.sessionId, s);
    for (const p of snapshot.plugins) this.plugins.set(p.pluginId, p);
    for (const sub of snapshot.subscribers) this.subscribers.set(sub.subscriberId, sub);
  }

  private validateSnapshot(snapshot: any): void {
    const required = ['lastSequenceNumber', 'timestamp', 'terminals', 'workflows', 'agents', 'sessions', 'plugins', 'subscribers'];
    for (const field of required) {
      if (snapshot[field] === undefined || snapshot[field] === null) {
        throw new Error(`Corrupted Snapshot: missing field: ${field}`);
      }
    }
  }

  // --- Replay Support ---

  public async rebuild(): Promise<void> {
    this.metrics.rebuildsCount++;
    
    // Wipe projections
    this.terminals.clear();
    this.workflows.clear();
    this.agents.clear();
    this.sessions.clear();
    this.plugins.clear();
    this.subscribers.clear();
    this.lastProcessedSequence = 0;

    // Query all events from store from sequence 1 onwards
    const history = await this.eventBus.replay(() => true);
    for (const event of history) {
      this.processEvent(event);
    }
  }

  // --- Query Engine ---

  public getTerminal(id: string) { return this.terminals.get(id); }
  public listTerminals() { return Array.from(this.terminals.values()); }

  public getWorkflow(id: string) { return this.workflows.get(id); }
  public listWorkflows() { return Array.from(this.workflows.values()); }

  public getAgent(id: string) { return this.agents.get(id); }
  public listAgents() { return Array.from(this.agents.values()); }

  public getSession(id: string) { return this.sessions.get(id); }
  public listSessions() { return Array.from(this.sessions.values()); }

  public getPlugin(id: string) { return this.plugins.get(id); }
  public listPlugins() { return Array.from(this.plugins.values()); }

  public getSubscriber(id: string) { return this.subscribers.get(id); }
  public listSubscribers() { return Array.from(this.subscribers.values()); }

  // --- Consistency Checker ---

  public checkConsistency(): {
    status: 'consistent' | 'inconsistent';
    orphans: {
      workflows: string[];
      terminals: string[];
      agents: string[];
    };
    staleProjections: string[];
    errors: string[];
  } {
    const orphansWorkflows: string[] = [];
    const orphansTerminals: string[] = [];
    const orphansAgents: string[] = [];
    const staleProjections: string[] = [];
    const errors: string[] = [];

    // Verify orphan terminals: active subscribers references exist
    for (const t of this.terminals.values()) {
      for (const subId of t.activeSubscribers) {
        if (!this.subscribers.has(subId)) {
          errors.push(`Terminal ${t.terminalId} references non-existent subscriber ID: ${subId}`);
        }
      }
    }

    // Verify orphan workflows: associated terminals exist
    for (const w of this.workflows.values()) {
      for (const termId of w.associatedTerminals) {
        if (!this.terminals.has(termId)) {
          errors.push(`Workflow ${w.workflowId} references non-existent terminal ID: ${termId}`);
        }
      }
      for (const agId of w.associatedAgents) {
        if (!this.agents.has(agId)) {
          errors.push(`Workflow ${w.workflowId} references non-existent agent ID: ${agId}`);
        }
      }
      if (w.status === 'Running' && w.associatedAgents.length === 0) {
        orphansWorkflows.push(w.workflowId);
      }
    }

    // Check last activity heartbeats (stale warning)
    const now = Date.now();
    for (const a of this.agents.values()) {
      if (a.status === 'Active' && now - a.lastHeartbeat > 60000) {
        staleProjections.push(`Agent ${a.agentId} heartbeat has not updated for >60s`);
      }
    }

    const isConsistent = errors.length === 0;

    return {
      status: isConsistent ? 'consistent' : 'inconsistent',
      orphans: {
        workflows: orphansWorkflows,
        terminals: orphansTerminals,
        agents: orphansAgents
      },
      staleProjections,
      errors
    };
  }

  public getStatus() {
    return {
      lastSequence: this.lastProcessedSequence,
      lastTimestamp: this.lastProcessedTimestamp,
      terminalsCount: this.terminals.size,
      workflowsCount: this.workflows.size,
      agentsCount: this.agents.size,
      pluginsCount: this.plugins.size,
      subscribersCount: this.subscribers.size,
      metrics: this.metrics
    };
  }
}
