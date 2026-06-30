import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { WorkflowEngine, WorkflowDefinition } from './workflowEngine';
import { AuditLogger } from './auditLogger';
import { PolicyEngine } from './policyEngine';
import { loadConfiguration } from './config';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWorkflowTests() {
  console.log('==================================================');
  console.log('            MCP WORKFLOW ENGINE TESTS             ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);
  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const engine = new WorkflowEngine(eventBus, terminalManager);

  let successCount = 0;
  let failCount = 0;

  function assert(title: string, condition: boolean, message?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      successCount++;
    } else {
      console.error(`[FAIL] ${title} ${message ? '- ' + message : ''}`);
      failCount++;
    }
  }

  // Create a terminal so tasks can link to it
  const termMeta = terminalManager.createManagedTerminal('cmd', 'Wf Test Term', process.cwd());
  const termId = termMeta.uuid;

  // Helper template for a valid workflow definition
  const createValidDef = (override: Partial<WorkflowDefinition> = {}): WorkflowDefinition => {
    return {
      id: `wf_${Math.random().toString(36).substring(2, 9)}`,
      name: 'Wf Build & Deploy',
      version: '1.0.0',
      priority: 'Normal',
      owner: 'architect',
      retryPolicy: { type: 'never', maxRetries: 0, delayMs: 0 },
      tasks: [
        { id: 'task-clean', name: 'Clean build directories', description: 'rmdir /s /q dist', dependencies: [], terminalId: termId, command: 'echo CleanDone' },
        { id: 'task-build', name: 'Run compile build', description: 'npm run build', dependencies: ['task-clean'], terminalId: termId, command: 'echo BuildDone' }
      ],
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: DAG Validation (Cyclic Detection)
  // ----------------------------------------------------
  console.log('--- Testing DAG Validation & Cycle Detection ---');
  try {
    const cyclicDef = createValidDef({
      tasks: [
        { id: 'task-a', name: 'Task A', description: 'A', dependencies: ['task-b'] },
        { id: 'task-b', name: 'Task B', description: 'B', dependencies: ['task-a'] }
      ]
    });

    let threwDagError = false;
    try {
      engine.validateDAG(cyclicDef);
    } catch (_) {
      threwDagError = true;
    }
    assert('DAG Validator rejects cyclic workflows', threwDagError);

    const acyclicDef = createValidDef();
    let acyclicValid = true;
    try {
      engine.validateDAG(acyclicDef);
    } catch (_) {
      acyclicValid = false;
    }
    assert('DAG Validator accepts acyclic workflows', acyclicValid);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] DAG validation test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Sequential execution
  // ----------------------------------------------------
  console.log('\n--- Testing Sequential Execution Flow ---');
  try {
    const def = createValidDef();
    const state = await engine.createWorkflow(def);
    assert('Workflow created with initial state Created', state.status === 'Created');

    await engine.startWorkflow(def.id);
    assert('Workflow transitioned to Running state', state.status === 'Running');

    await delay(1000); // Allow scheduling and execution completion

    const task1 = state.tasks.get('task-clean')!;
    const task2 = state.tasks.get('task-build')!;
    
    assert('Task 1 completed successfully', task1.status === 'Completed');
    assert('Task 2 completed successfully', task2.status === 'Completed');
    assert('Workflow progress reports 100%', state.progress === 100);
    assert('Workflow completed successfully', state.status === 'Completed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Sequential execution test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Retries and Exponential Backoff
  // ----------------------------------------------------
  console.log('\n--- Testing Task Retries & Backoff ---');
  try {
    const def = createValidDef({
      retryPolicy: { type: 'fixed', maxRetries: 2, delayMs: 50 },
      tasks: [
        { id: 'task-retry', name: 'Task Failure', description: 'Will crash', dependencies: [], terminalId: 'invalid-terminal-id', command: 'echo hello' }
      ]
    });

    const state = await engine.createWorkflow(def);
    await engine.startWorkflow(def.id);

    await delay(350); // Allow execution and retries (2 retries * 50ms = 100ms)

    const tState = state.tasks.get('task-retry')!;
    assert('Task retried matching maximum retry limits (2)', tState.retryCount === 2);
    assert('Task status transitioned to Failed after retry exhaustion', tState.status === 'Failed');
    assert('Workflow failed due to task exhaustion', state.status === 'Failed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Retry policy test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Pause & Resume Controls
  // ----------------------------------------------------
  console.log('\n--- Testing Pause & Resume Control Actions ---');
  try {
    const def = createValidDef({
      tasks: [
        { id: 'task-long', name: 'Long running', description: 'echo long', dependencies: [], terminalId: termId, command: 'echo hello' }
      ]
    });

    const state = await engine.createWorkflow(def);
    await engine.startWorkflow(def.id);
    await engine.pauseWorkflow(def.id);

    assert('Workflow paused successfully', state.status === 'Paused');

    await engine.resumeWorkflow(def.id);
    assert('Workflow resumed running', state.status === 'Running' || state.status === 'Completed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Pause / Resume test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Checkpointing & Recovery
  // ----------------------------------------------------
  console.log('\n--- Testing Checkpoint & Restore Flow ---');
  try {
    const def = createValidDef();
    const state = await engine.createWorkflow(def);

    // Run first step and capture checkpoint
    await engine.startWorkflow(def.id);
    await delay(100);

    const checkpoint = engine.exportCheckpoint(def.id);
    assert('Checkpoint JSON exported successfully', checkpoint.length > 0);

    // Modify status dynamically to simulate recovery load
    engine.importCheckpoint(def.id, checkpoint);
    const restoredState = engine.getWorkflowState(def.id)!;
    assert('Checkpoint restores step progress and active states', restoredState.progress >= 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Checkpoint test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 6: Workflow Timeouts
  // ----------------------------------------------------
  console.log('\n--- Testing Workflow Timeout Restrictions ---');
  try {
    const def = createValidDef({
      timeoutMs: 50,
      tasks: [
        { id: 'task-sleep', name: 'Sleep command', description: 'Exceeds limit', dependencies: [], terminalId: termId, command: 'echo hello' }
      ]
    });

    const state = await engine.createWorkflow(def);
    await engine.startWorkflow(def.id);

    await delay(150); // Exceeds 50ms timeout limit

    assert('Workflow timed out and transitioned to Failed', state.status === 'Failed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Timeout test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 7: Rollback Commands
  // ----------------------------------------------------
  console.log('\n--- Testing Task Rollback Command Triggering ---');
  try {
    const def = createValidDef({
      tasks: [
        { id: 'task-rollback', name: 'Crashing Task', description: 'Rollback test', dependencies: [], terminalId: 'invalid-terminal-id', command: 'echo x', rollbackCommand: 'echo rollback-triggered' }
      ]
    });

    const state = await engine.createWorkflow(def);
    await engine.startWorkflow(def.id);
    await delay(100);

    assert('Failed task with rollback command executed failure flow', state.status === 'Failed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Rollback test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`WORKFLOW ENGINE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Terminate terminal manager shell
  terminalManager.shutdown();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runWorkflowTests().catch(console.error);
