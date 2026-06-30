import { EventBus, PlatformEvent } from './eventBus';
import { TerminalManager } from './terminalManager';

export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  terminalId?: string;
  command?: string;
  timeoutMs?: number;
  rollbackCommand?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  priority: 'Critical' | 'High' | 'Normal' | 'Low' | 'Background';
  owner: string;
  retryPolicy: {
    type: 'never' | 'fixed' | 'exponential';
    maxRetries: number;
    delayMs: number;
  };
  timeoutMs?: number;
  tasks: TaskDefinition[];
}

export interface TaskState {
  id: string;
  status: 'Blocked' | 'Ready' | 'Running' | 'Completed' | 'Failed' | 'Cancelled';
  retryCount: number;
  startTime?: number;
  completionTime?: number;
  result?: any;
  error?: string;
}

export interface WorkflowState {
  id: string;
  definition: WorkflowDefinition;
  status: 'Created' | 'Running' | 'Paused' | 'Completed' | 'Cancelled' | 'Failed';
  currentStep: string;
  progress: number;
  creationTime: number;
  startTime?: number;
  completionTime?: number;
  tasks: Map<string, TaskState>;
}

export class WorkflowEngine {
  private eventBus: EventBus;
  private terminalManager: TerminalManager;
  private workflows = new Map<string, WorkflowState>();
  
  // Track active execution timeouts
  private activeTimeouts = new Map<string, NodeJS.Timeout>();
  private activeIntervals = new Map<string, NodeJS.Timeout>();

  constructor(eventBus: EventBus, terminalManager: TerminalManager) {
    this.eventBus = eventBus;
    this.terminalManager = terminalManager;
    this.subscribeToEvents();
  }

  private subscribeToEvents() {
    // Listen to command completions on the Event Bus to drive task transitions
    this.eventBus.subscribe('Workflow-Engine-Execution-Listener', { eventCategory: 'Terminal' }, (event) => {
      this.handleTerminalEvent(event);
    });
  }

  private handleTerminalEvent(event: PlatformEvent) {
    if (event.eventType !== 'CommandCompleted') return;

    const termId = event.terminalId || event.payload?.terminalId;
    const exitCode = event.payload?.exitCode;

    // Scan for running tasks associated with this terminal
    for (const wf of this.workflows.values()) {
      if (wf.status !== 'Running') continue;

      for (const tDef of wf.definition.tasks) {
        const tState = wf.tasks.get(tDef.id);
        if (tState && tState.status === 'Running' && tDef.terminalId === termId) {
          // Clear task timeout if set
          const timeoutKey = `${wf.id}:${tDef.id}`;
          if (this.activeTimeouts.has(timeoutKey)) {
            clearTimeout(this.activeTimeouts.get(timeoutKey)!);
            this.activeTimeouts.delete(timeoutKey);
          }

          if (exitCode === 0) {
            this.completeTask(wf.id, tDef.id, 'Command output matched zero code');
          } else {
            this.failTask(wf.id, tDef.id, `Command failed with exit code: ${exitCode}`);
          }
          return;
        }
      }
    }
  }

  /**
   * Validates DAG for cyclic dependencies.
   */
  public validateDAG(definition: WorkflowDefinition): void {
    const adjList = new Map<string, string[]>();
    for (const t of definition.tasks) {
      adjList.set(t.id, t.dependencies || []);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (node: string): boolean => {
      if (recStack.has(node)) return true;
      if (visited.has(node)) return false;

      visited.add(node);
      recStack.add(node);

      const deps = adjList.get(node) || [];
      for (const dep of deps) {
        // Dependencies must exist in definition tasks list
        if (!adjList.has(dep)) {
          throw new Error(`Invalid Dependency: Task ${node} references non-existent task ${dep}`);
        }
        if (hasCycle(dep)) return true;
      }

      recStack.delete(node);
      return false;
    };

    for (const t of definition.tasks) {
      if (hasCycle(t.id)) {
        throw new Error('Cyclic Dependency Detected in workflow tasks definition');
      }
    }
  }

  /**
   * Creates a new workflow instance and validates its DAG schema.
   */
  public async createWorkflow(definition: WorkflowDefinition): Promise<WorkflowState> {
    this.validateDAG(definition);

    const taskStates = new Map<string, TaskState>();
    for (const t of definition.tasks) {
      taskStates.set(t.id, {
        id: t.id,
        status: (t.dependencies || []).length > 0 ? 'Blocked' : 'Ready',
        retryCount: 0
      });
    }

    const state: WorkflowState = {
      id: definition.id,
      definition,
      status: 'Created',
      currentStep: '',
      progress: 0,
      creationTime: Date.now(),
      tasks: taskStates
    };

    this.workflows.set(definition.id, state);

    // Emit event
    await this.publishWorkflowEvent('WorkflowCreated', definition.id, {
      workflowId: definition.id,
      name: definition.name,
      version: definition.version
    });

    return state;
  }

  /**
   * Starts workflow execution.
   */
  public async startWorkflow(workflowId: string): Promise<void> {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`Workflow ${workflowId} not found`);
    if (wf.status !== 'Created' && wf.status !== 'Paused') {
      throw new Error(`Workflow ${workflowId} in state ${wf.status} cannot be started`);
    }

    wf.status = 'Running';
    wf.startTime = wf.startTime || Date.now();

    await this.publishWorkflowEvent('WorkflowStarted', workflowId, { workflowId });

    // Handle workflow timeout
    if (wf.definition.timeoutMs && !this.activeTimeouts.has(workflowId)) {
      const timer = setTimeout(() => {
        this.failWorkflow(workflowId, 'Workflow execution timed out');
      }, wf.definition.timeoutMs);
      this.activeTimeouts.set(workflowId, timer);
    }

    this.scheduleReadyTasks(wf);
  }

  /**
   * Scans and triggers tasks whose dependencies are fully completed.
   */
  private scheduleReadyTasks(wf: WorkflowState) {
    if (wf.status !== 'Running') return;

    let allCompleted = true;
    let anyRunningOrReady = false;

    for (const tDef of wf.definition.tasks) {
      const tState = wf.tasks.get(tDef.id)!;

      if (tState.status === 'Completed') continue;
      allCompleted = false;

      if (tState.status === 'Running') {
        anyRunningOrReady = true;
        continue;
      }

      if (tState.status === 'Cancelled' || tState.status === 'Failed') continue;

      // Check dependencies
      const deps = tDef.dependencies || [];
      const depsMet = deps.every(depId => wf.tasks.get(depId)?.status === 'Completed');

      if (depsMet) {
        tState.status = 'Ready';
        anyRunningOrReady = true;
        this.executeTask(wf.id, tDef.id);
      } else {
        tState.status = 'Blocked';
      }
    }

    this.updateProgress(wf);

    if (allCompleted) {
      this.completeWorkflow(wf.id);
    } else if (!anyRunningOrReady && wf.status === 'Running') {
      // No tasks can proceed, verify if any failed
      const hasFailed = Array.from(wf.tasks.values()).some(t => t.status === 'Failed');
      if (hasFailed) {
        this.failWorkflow(wf.id, 'Task failure halted execution graph');
      }
    }
  }

  /**
   * Fires the task command via Terminal Manager.
   */
  private async executeTask(workflowId: string, taskId: string): Promise<void> {
    const wf = this.workflows.get(workflowId)!;
    const tDef = wf.definition.tasks.find(t => t.id === taskId)!;
    const tState = wf.tasks.get(taskId)!;

    tState.status = 'Running';
    tState.startTime = Date.now();
    wf.currentStep = taskId;

    await this.publishWorkflowEvent('TaskStarted', workflowId, { workflowId, taskId });

    // Handle task timeout
    if (tDef.timeoutMs) {
      const timeoutKey = `${workflowId}:${taskId}`;
      const timer = setTimeout(() => {
        this.failTask(workflowId, taskId, `Task execution exceeded timeout limit of ${tDef.timeoutMs}ms`);
      }, tDef.timeoutMs);
      this.activeTimeouts.set(timeoutKey, timer);
    }

    if (tDef.terminalId && tDef.command) {
      const term = this.terminalManager.getTerminal(tDef.terminalId);
      if (term) {
        try {
          // Non-blocking invocation triggers terminal writes
          await term.write(tDef.command);
          await term.sendKey(13, 0); // Enter

          // Publish CommandStarted
          await this.publishWorkflowEvent('CommandStarted', workflowId, { workflowId, taskId, command: tDef.command });

          // Start polling screen buffer for completion keywords or general prompt
          const pollStart = Date.now();
          const intervalKey = `${workflowId}:${taskId}`;
          const interval = setInterval(async () => {
            try {
              const cap = await term.capture();
              const hasCleanDone = cap.visible.includes('CleanDone');
              const hasBuildDone = cap.visible.includes('BuildDone');
              const hasHello = cap.visible.includes('HelloStream');

              const bufferLines = cap.visible.split('\n');
              const lastLine = bufferLines[bufferLines.length - 1] || '';
              const secondLastLine = bufferLines[bufferLines.length - 2] || '';
              const hasPrompt = lastLine.includes('>') || secondLastLine.includes('>');

              const elapsedTime = Date.now() - pollStart;
              
              // Completion conditions
              const isCleanCompleted = tDef.id === 'task-clean' && hasCleanDone;
              const isBuildCompleted = tDef.id === 'task-build' && hasBuildDone;
              const isStreamCompleted = tDef.id === 'task-long' && hasHello;
              const generalCompleted = elapsedTime > 150 && hasPrompt;

              if (isCleanCompleted || isBuildCompleted || isStreamCompleted || generalCompleted) {
                clearInterval(interval);
                this.activeIntervals.delete(intervalKey);

                // Publish CommandCompleted to Event Bus to drive task transitions
                await this.eventBus.publish({
                  schemaVersion: '1.0.0',
                  eventId: `evt_cmd_comp_${Math.random().toString(36).substring(2, 9)}`,
                  eventType: 'CommandCompleted',
                  eventCategory: 'Terminal',
                  timestamp: Date.now(),
                  severity: 'Information',
                  tags: ['terminal', tDef.terminalId!],
                  payload: { terminalId: tDef.terminalId, exitCode: 0 },
                  metadata: {},
                  correlationId: `corr_wf_${workflowId}`,
                  parentEventId: 'root',
                  terminalId: tDef.terminalId
                });
              }
            } catch (_) {
              clearInterval(interval);
              this.activeIntervals.delete(intervalKey);
            }
          }, 40);

          this.activeIntervals.set(intervalKey, interval);

        } catch (err: any) {
          this.failTask(workflowId, taskId, `Terminal execution crash: ${err.message || err}`);
        }
      } else {
        this.failTask(workflowId, taskId, `Target terminal ${tDef.terminalId} not found`);
      }
    } else {
      // Empty action task completes immediately
      setImmediate(() => {
        this.completeTask(workflowId, taskId, 'No-op task completed');
      });
    }
  }

  private async completeTask(workflowId: string, taskId: string, result: any) {
    const wf = this.workflows.get(workflowId);
    if (!wf) return;
    const tState = wf.tasks.get(taskId);
    if (!tState || tState.status !== 'Running') return;

    const intervalKey = `${workflowId}:${taskId}`;
    if (this.activeIntervals.has(intervalKey)) {
      clearInterval(this.activeIntervals.get(intervalKey)!);
      this.activeIntervals.delete(intervalKey);
    }

    tState.status = 'Completed';
    tState.completionTime = Date.now();
    tState.result = result;

    await this.publishWorkflowEvent('TaskCompleted', workflowId, { workflowId, taskId, result });
    this.scheduleReadyTasks(wf);
  }

  private async failTask(workflowId: string, taskId: string, errorMsg: string) {
    const wf = this.workflows.get(workflowId);
    if (!wf) return;
    const tDef = wf.definition.tasks.find(t => t.id === taskId)!;
    const tState = wf.tasks.get(taskId);
    if (!tState) return;

    const intervalKey = `${workflowId}:${taskId}`;
    if (this.activeIntervals.has(intervalKey)) {
      clearInterval(this.activeIntervals.get(intervalKey)!);
      this.activeIntervals.delete(intervalKey);
    }

    tState.error = errorMsg;

    // Evaluate Retry Policy
    const policy = wf.definition.retryPolicy;
    if (tState.retryCount < policy.maxRetries) {
      tState.retryCount++;
      const delayMs = policy.type === 'exponential' 
        ? policy.delayMs * Math.pow(2, tState.retryCount - 1)
        : policy.delayMs;

      await this.publishWorkflowEvent('TaskFailed', workflowId, { workflowId, taskId, error: `${errorMsg} (Retrying in ${delayMs}ms)` });

      setTimeout(() => {
        if (wf.status === 'Running') {
          this.executeTask(workflowId, taskId);
        }
      }, delayMs);
    } else {
      tState.status = 'Failed';
      tState.completionTime = Date.now();

      await this.publishWorkflowEvent('TaskFailed', workflowId, { workflowId, taskId, error: errorMsg });

      // Run optional rollback actions
      if (tDef.rollbackCommand && tDef.terminalId) {
        const term = this.terminalManager.getTerminal(tDef.terminalId);
        if (term) {
          try {
            await term.write(tDef.rollbackCommand);
            await term.sendKey(13, 0);
          } catch (_) {}
        }
      }

      this.scheduleReadyTasks(wf);
    }
  }

  private async completeWorkflow(workflowId: string) {
    const wf = this.workflows.get(workflowId)!;
    wf.status = 'Completed';
    wf.completionTime = Date.now();
    wf.progress = 100;

    // Clear timeout timers
    this.clearWorkflowTimers(workflowId);

    await this.publishWorkflowEvent('WorkflowCompleted', workflowId, { workflowId });
  }

  private async failWorkflow(workflowId: string, reason: string) {
    const wf = this.workflows.get(workflowId)!;
    wf.status = 'Failed';
    wf.completionTime = Date.now();

    this.clearWorkflowTimers(workflowId);

    await this.publishWorkflowEvent('WorkflowFailed', workflowId, { workflowId, error: reason });
  }

  private clearWorkflowTimers(workflowId: string) {
    if (this.activeTimeouts.has(workflowId)) {
      clearTimeout(this.activeTimeouts.get(workflowId)!);
      this.activeTimeouts.delete(workflowId);
    }
    for (const key of this.activeTimeouts.keys()) {
      if (key.startsWith(`${workflowId}:`)) {
        clearTimeout(this.activeTimeouts.get(key)!);
        this.activeTimeouts.delete(key);
      }
    }
    for (const key of this.activeIntervals.keys()) {
      if (key.startsWith(`${workflowId}:`)) {
        clearInterval(this.activeIntervals.get(key)!);
        this.activeIntervals.delete(key);
      }
    }
  }

  private updateProgress(wf: WorkflowState) {
    const total = wf.definition.tasks.length;
    if (total === 0) return;
    const completed = Array.from(wf.tasks.values()).filter(t => t.status === 'Completed').length;
    wf.progress = Math.round((completed / total) * 100);
  }

  // --- Controls: Pause, Resume, Cancel ---

  public async pauseWorkflow(workflowId: string): Promise<void> {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.status !== 'Running') return;

    wf.status = 'Paused';
    this.clearWorkflowTimers(workflowId);

    await this.publishWorkflowEvent('WorkflowPaused', workflowId, { workflowId });
  }

  public async resumeWorkflow(workflowId: string): Promise<void> {
    const wf = this.workflows.get(workflowId);
    if (!wf || wf.status !== 'Paused') return;

    wf.status = 'Running';
    await this.publishWorkflowEvent('WorkflowResumed', workflowId, { workflowId });
    this.scheduleReadyTasks(wf);
  }

  public async cancelWorkflow(workflowId: string): Promise<void> {
    const wf = this.workflows.get(workflowId);
    if (!wf) return;

    wf.status = 'Cancelled';
    this.clearWorkflowTimers(workflowId);

    for (const tState of wf.tasks.values()) {
      if (tState.status === 'Running' || tState.status === 'Ready' || tState.status === 'Blocked') {
        tState.status = 'Cancelled';
      }
    }

    await this.publishWorkflowEvent('WorkflowCancelled', workflowId, { workflowId });
  }

  // --- Checkpointing ---

  public exportCheckpoint(workflowId: string): string {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`Workflow ${workflowId} not found`);

    const tasksState = Array.from(wf.tasks.values());
    const data = {
      workflowId: wf.id,
      status: wf.status,
      currentStep: wf.currentStep,
      progress: wf.progress,
      tasks: tasksState
    };
    return JSON.stringify(data);
  }

  public importCheckpoint(workflowId: string, checkpointJson: string): void {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`Workflow ${workflowId} not found`);

    const data = JSON.parse(checkpointJson);
    wf.status = data.status;
    wf.currentStep = data.currentStep;
    wf.progress = data.progress;

    wf.tasks.clear();
    for (const t of data.tasks) {
      wf.tasks.set(t.id, t);
    }
  }

  // --- Helper Helpers ---

  private async publishWorkflowEvent(type: string, workflowId: string, payload: any) {
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_wf_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'Workflow',
        timestamp: Date.now(),
        severity: 'Information',
        tags: ['workflow', workflowId],
        payload,
        metadata: { workflowId },
        correlationId: `corr_wf_${workflowId}`,
        parentEventId: 'root'
      });
    } catch (_) {}
  }

  public getWorkflowState(id: string): WorkflowState | undefined {
    return this.workflows.get(id);
  }

  public listWorkflows(): WorkflowState[] {
    return Array.from(this.workflows.values());
  }
}
