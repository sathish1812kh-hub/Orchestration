import { EventBus } from './eventBus';
import { ExecutionDispatcher, DispatchState } from './dispatcher';

export interface DecisionProvider {
  id: string;
  name: string;
  decide(context: OrchestrationContext): Promise<OrchestrationDecision>;
}

export interface OrchestrationDecision {
  action: 'dispatch_task' | 'wait' | 'request_approval' | 'complete' | 'fail';
  reasoning: string;
  taskRequest?: {
    taskId: string;
    requiredCapabilities: string[];
    priority: 'Critical' | 'High' | 'Normal' | 'Low' | 'Background';
    timeoutMs: number;
    command?: string;
    terminalId?: string;
  };
  approvalReason?: string;
}

export interface OrchestrationContext {
  orchestrationId: string;
  objective: string;
  activeWorkflowId?: string;
  completedActions: Array<{ taskId: string; action: string; result: string }>;
  pendingActions: string[];
  observations: string[];
  reasoningMetadata: any;
  iteration: number;
  maxIterations: number;
  startTime: number;
  elapsedTime: number;
  status: 'Starting' | 'Running' | 'Paused' | 'WaitingForApproval' | 'Completed' | 'Stopped' | 'Failed';
}

export interface OrchestratorGoal {
  goalId: string;
  definition: string;
  status: 'Pending' | 'Completed' | 'Failed';
  retryBudget: number;
  retryCount: number;
}

/**
 * Replaceable Mock Decision Provider for autonomous verification.
 */
export class MockDecisionProvider implements DecisionProvider {
  public id = 'mock-provider-001';
  public name = 'Mock Decision Engine';
  
  private stepCount = 0;
  
  public decide(context: OrchestrationContext): Promise<OrchestrationDecision> {
    this.stepCount++;
    
    // Simulate iterative decisions to align with test runs
    if (context.objective.includes('Approval')) {
      if (this.stepCount === 1) {
        return Promise.resolve({
          action: 'request_approval',
          reasoning: 'Destructive action requested; human validation is needed',
          approvalReason: 'Confirm permission to delete workspace temporary files'
        });
      }
    }

    if (context.objective.includes('Infinite')) {
      // Loop decision simulation to trigger loop limits
      return Promise.resolve({
        action: 'dispatch_task',
        reasoning: 'Re-evaluating dynamic variable offsets',
        taskRequest: {
          taskId: `task-loop-${this.stepCount}`,
          requiredCapabilities: ['mock_capability'],
          priority: 'Normal',
          timeoutMs: 1000,
          command: 'echo Loop'
        }
      });
    }

    if (this.stepCount === 1) {
      return Promise.resolve({
        action: 'dispatch_task',
        reasoning: 'Analyzing environment configurations',
        taskRequest: {
          taskId: 'task-clean',
          requiredCapabilities: ['local_terminal'],
          priority: 'Normal',
          timeoutMs: 3000,
          command: 'echo CleanDone'
        }
      });
    }

    return Promise.resolve({
      action: 'complete',
      reasoning: 'Goal is achieved and verified successfully'
    });
  }
}

export class AutonomousOrchestrator {
  private eventBus: EventBus;
  private dispatcher: ExecutionDispatcher;
  private decisionProvider: DecisionProvider;

  private activeContexts = new Map<string, OrchestrationContext>();
  private activeGoals = new Map<string, OrchestratorGoal>();
  private activeDispatches = new Map<string, string>(); // orchestrationId -> dispatchId
  
  constructor(eventBus: EventBus, dispatcher: ExecutionDispatcher, provider: DecisionProvider) {
    this.eventBus = eventBus;
    this.dispatcher = dispatcher;
    this.decisionProvider = provider;
  }

  public async start(objective: string, maxIterations = 5): Promise<OrchestrationContext> {
    const orchestrationId = `orch_${Math.random().toString(36).substring(2, 9)}`;
    const context: OrchestrationContext = {
      orchestrationId,
      objective,
      completedActions: [],
      pendingActions: [],
      observations: [],
      reasoningMetadata: {},
      iteration: 0,
      maxIterations,
      startTime: Date.now(),
      elapsedTime: 0,
      status: 'Starting'
    };

    this.activeContexts.set(orchestrationId, context);

    // Register initial Goal
    const goalId = `goal_${orchestrationId}`;
    this.activeGoals.set(goalId, {
      goalId,
      definition: objective,
      status: 'Pending',
      retryBudget: 3,
      retryCount: 0
    });

    await this.transitionState(orchestrationId, 'Running');
    await this.publishEvent('LoopStarted', context);

    // Trigger run loop asynchronously
    setImmediate(() => this.runLoopStep(orchestrationId));

    return context;
  }

  private async runLoopStep(orchestrationId: string) {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || context.status !== 'Running') return;

    context.iteration++;
    context.elapsedTime = Date.now() - context.startTime;

    // Safety checks
    if (context.iteration > context.maxIterations) {
      await this.failLoop(orchestrationId, 'Maximum loop iterations limit exceeded (Infinite Loop prevention)');
      return;
    }

    // Safety loops repeated failures
    const goal = this.activeGoals.get(`goal_${orchestrationId}`);
    if (goal && goal.retryCount >= goal.retryBudget) {
      await this.failLoop(orchestrationId, 'Exceeded retry budget on target goal executions');
      return;
    }

    try {
      // Observe and Evaluate via Provider
      const decision = await this.decisionProvider.decide(context);
      context.reasoningMetadata = { reasoning: decision.reasoning };

      await this.publishEvent('DecisionMade', context, { decision });

      switch (decision.action) {
        case 'dispatch_task': {
          if (!decision.taskRequest) {
            throw new Error('Decision requested dispatch but no taskRequest metadata was populated');
          }
          await this.dispatchOrchestratedTask(orchestrationId, decision.taskRequest);
          break;
        }
        case 'request_approval': {
          await this.transitionState(orchestrationId, 'WaitingForApproval');
          await this.publishEvent('WaitingForApproval', context, { reason: decision.approvalReason });
          break;
        }
        case 'complete': {
          if (goal) goal.status = 'Completed';
          await this.transitionState(orchestrationId, 'Completed');
          await this.publishEvent('LoopCompleted', context);
          break;
        }
        case 'fail': {
          if (goal) {
            goal.retryCount++;
            if (goal.retryCount < goal.retryBudget) {
              // Retry step loop
              context.observations.push(`Task attempt failed. Retrying goal: ${goal.retryCount}/${goal.retryBudget}`);
              setImmediate(() => this.runLoopStep(orchestrationId));
              return;
            }
          }
          await this.failLoop(orchestrationId, decision.reasoning || 'Goal failure evaluation reached');
          break;
        }
        case 'wait':
        default: {
          // Wait and continue
          setTimeout(() => this.runLoopStep(orchestrationId), 200);
          break;
        }
      }
    } catch (err: any) {
      await this.failLoop(orchestrationId, `Orchestration loop encountered error: ${err.message}`);
    }
  }

  private async dispatchOrchestratedTask(orchestrationId: string, taskReq: any) {
    const context = this.activeContexts.get(orchestrationId)!;
    
    try {
      const dispatchState = await this.dispatcher.submit({
        workflowId: `wf_${orchestrationId}`,
        taskId: taskReq.taskId,
        requiredCapabilities: taskReq.requiredCapabilities,
        priority: taskReq.priority || 'Normal',
        timeoutMs: taskReq.timeoutMs || 5000,
        command: taskReq.command,
        terminalId: taskReq.terminalId
      });

      this.activeDispatches.set(orchestrationId, dispatchState.dispatchId);
      context.observations.push(`Dispatched task ${taskReq.taskId} as ${dispatchState.dispatchId}`);

      // Async verification loop
      const verifyPoll = setInterval(() => {
        const current = this.dispatcher.getDispatchState(dispatchState.dispatchId);
        if (!current) {
          clearInterval(verifyPoll);
          return;
        }

        if (current.status === 'Completed') {
          clearInterval(verifyPoll);
          this.activeDispatches.delete(orchestrationId);
          context.completedActions.push({
            taskId: taskReq.taskId,
            action: taskReq.command || 'empty',
            result: 'Success'
          });
          context.observations.push(`Task completed successfully: ${taskReq.taskId}`);
          setImmediate(() => this.runLoopStep(orchestrationId));
        } else if (current.status === 'Failed' || current.status === 'TimedOut' || current.status === 'Cancelled') {
          clearInterval(verifyPoll);
          this.activeDispatches.delete(orchestrationId);
          context.observations.push(`Task dispatch failed: ${taskReq.taskId} status: ${current.status}`);
          
          const goal = this.activeGoals.get(`goal_${orchestrationId}`);
          if (goal) {
            goal.retryCount++;
          }
          setImmediate(() => this.runLoopStep(orchestrationId));
        }
      }, 50);

    } catch (err: any) {
      context.observations.push(`Dispatcher submission failed: ${err.message}`);
      setImmediate(() => this.runLoopStep(orchestrationId));
    }
  }

  public async approve(orchestrationId: string): Promise<boolean> {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || context.status !== 'WaitingForApproval') return false;

    await this.transitionState(orchestrationId, 'Running');
    await this.publishEvent('LoopResumed', context);
    setImmediate(() => this.runLoopStep(orchestrationId));
    return true;
  }

  public async reject(orchestrationId: string, reason: string): Promise<boolean> {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || context.status !== 'WaitingForApproval') return false;

    context.observations.push(`Human rejected action: ${reason}`);
    await this.failLoop(orchestrationId, `Human approval rejected: ${reason}`);
    return true;
  }

  public async pause(orchestrationId: string): Promise<boolean> {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || context.status !== 'Running') return false;

    await this.transitionState(orchestrationId, 'Paused');
    await this.publishEvent('LoopPaused', context);
    return true;
  }

  public async resume(orchestrationId: string): Promise<boolean> {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || context.status !== 'Paused') return false;

    await this.transitionState(orchestrationId, 'Running');
    await this.publishEvent('LoopResumed', context);
    setImmediate(() => this.runLoopStep(orchestrationId));
    return true;
  }

  public async stop(orchestrationId: string): Promise<boolean> {
    const context = this.activeContexts.get(orchestrationId);
    if (!context || (context.status === 'Completed' || context.status === 'Failed' || context.status === 'Stopped')) return false;

    // Cancel active dispatcher jobs
    const activeDispId = this.activeDispatches.get(orchestrationId);
    if (activeDispId) {
      this.dispatcher.cancel(activeDispId).catch(() => {});
      this.activeDispatches.delete(orchestrationId);
    }

    await this.transitionState(orchestrationId, 'Stopped');
    await this.publishEvent('LoopStopped', context);
    return true;
  }

  private async failLoop(orchestrationId: string, reason: string) {
    const context = this.activeContexts.get(orchestrationId)!;
    context.observations.push(`Loop failure: ${reason}`);
    
    const goal = this.activeGoals.get(`goal_${orchestrationId}`);
    if (goal) goal.status = 'Failed';

    await this.transitionState(orchestrationId, 'Failed');
    await this.publishEvent('LoopStopped', context, { reason });
  }

  private async transitionState(orchestrationId: string, status: OrchestrationContext['status']) {
    const context = this.activeContexts.get(orchestrationId);
    if (!context) return;
    context.status = status;
  }

  private async publishEvent(type: string, context: OrchestrationContext, payload: any = {}) {
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_orch_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'Workflow',
        timestamp: Date.now(),
        severity: status === 'Failed' ? 'Error' : 'Information',
        tags: ['orchestrator', context.orchestrationId],
        payload: {
          orchestrationId: context.orchestrationId,
          objective: context.objective,
          status: context.status,
          iteration: context.iteration,
          ...payload
        },
        metadata: { orchestrationId: context.orchestrationId },
        correlationId: `corr_orch_${context.orchestrationId}`,
        parentEventId: 'root'
      });
    } catch (_) {}
  }

  public getContext(orchestrationId: string): OrchestrationContext | undefined {
    return this.activeContexts.get(orchestrationId);
  }

  public getGoal(orchestrationId: string): OrchestratorGoal | undefined {
    return this.activeGoals.get(`goal_${orchestrationId}`);
  }

  public listOrchestrations(): OrchestrationContext[] {
    return Array.from(this.activeContexts.values());
  }

  public exportCheckpoint(orchestrationId: string): string {
    const ctx = this.getContext(orchestrationId);
    if (!ctx) throw new Error(`Orchestration ${orchestrationId} not found`);
    const goal = this.getGoal(orchestrationId);
    return JSON.stringify({ context: ctx, goal });
  }

  public importCheckpoint(checkpointJson: string): OrchestrationContext {
    const data = JSON.parse(checkpointJson);
    const ctx = data.context as OrchestrationContext;
    const goal = data.goal as OrchestratorGoal;

    this.activeContexts.set(ctx.orchestrationId, ctx);
    this.activeGoals.set(goal.goalId, goal);

    return ctx;
  }
}
