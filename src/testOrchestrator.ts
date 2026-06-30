import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher, TerminalAdapter } from './dispatcher';
import { AuditLogger } from './auditLogger';
import { PolicyEngine } from './policyEngine';
import { loadConfiguration } from './config';
import { AutonomousOrchestrator, MockDecisionProvider } from './orchestrator';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOrchestratorTests() {
  console.log('==================================================');
  console.log('         MCP AUTONOMOUS ORCHESTRATOR TESTS        ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);
  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  
  const dispatcher = new ExecutionDispatcher(eventBus);
  const adapter = new TerminalAdapter('local-term-001', 'Test Terminal Adapter', terminalManager);
  dispatcher.registerProvider(adapter);

  // Register MockAdapter for infinite loop test stability
  const mockAdapter = {
    id: 'mock-adapter-002',
    name: 'Mock Adapter',
    capabilities: ['mock_capability'],
    health: 'healthy' as const,
    currentLoad: 0,
    maxLoad: 10,
    execute: async (req: any, cb: any) => {
      setImmediate(() => cb('Completed'));
    },
    cancel: async () => {}
  };
  dispatcher.registerProvider(mockAdapter);

  const provider = new MockDecisionProvider();
  const orchestrator = new AutonomousOrchestrator(eventBus, dispatcher, provider);

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

  // Create workspace terminal for provider execution
  const termMeta = terminalManager.createManagedTerminal('cmd', 'Orch Test Term', process.cwd());
  const termId = termMeta.uuid;
  await delay(1200); // Allow OS to spawn and initialize shell fully
  
  // Set terminal ID on local adapter template
  const writeOld = adapter.execute;
  adapter.execute = function(req, cb) {
    req.terminalId = termId;
    return writeOld.call(this, req, cb);
  };

  // ----------------------------------------------------
  // Test 1: Iterative Planning & Goal Completion
  // ----------------------------------------------------
  console.log('--- Testing Planning & Goal Completion ---');
  try {
    const context = await orchestrator.start('Deploy production environment files');
    assert('Orchestrator session initialized in Running state', context.status === 'Running');

    await delay(1500); // Allow dispatch and completion loop to proceed fully
    assert('Orchestration completed objective successfully', context.status === 'Completed');
    assert('Completed tasks list holds succeeded actions', context.completedActions.some(a => a.taskId === 'task-clean'));
    assert('Goal state updated to Completed status', orchestrator.getGoal(context.orchestrationId)?.status === 'Completed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Goal completion test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Approval Flow Controls
  // ----------------------------------------------------
  console.log('\n--- Testing Interactive Approval Pauses ---');
  try {
    const providerApp = new MockDecisionProvider();
    const orchestratorApp = new AutonomousOrchestrator(eventBus, dispatcher, providerApp);

    const context = await orchestratorApp.start('Approval Required: Delete temp folders');
    await delay(100);

    assert('Loop paused awaiting human approval confirmation', context.status === 'WaitingForApproval');

    // A. Test Approve Resume
    const approved = await orchestratorApp.approve(context.orchestrationId);
    assert('Approve action returned success', approved);
    assert('Orchestration resumed loop to Running state', context.status === 'Running' || context.status === 'Completed');

    // B. Test Reject Failure
    const providerRej = new MockDecisionProvider();
    const orchestratorRej = new AutonomousOrchestrator(eventBus, dispatcher, providerRej);
    const contextRej = await orchestratorRej.start('Approval Required: Delete critical database');
    await delay(100);

    const rejected = await orchestratorRej.reject(contextRej.orchestrationId, 'Safety violation detected by administrator');
    assert('Reject action returned success', rejected);
    assert('Orchestration terminated in Failed status after rejection', contextRej.status === 'Failed');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Approval flow test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Safety Limits & Infinite Loop Detection
  // ----------------------------------------------------
  console.log('\n--- Testing Infinite Loop Protection ---');
  try {
    const providerLoop = new MockDecisionProvider();
    const orchestratorLoop = new AutonomousOrchestrator(eventBus, dispatcher, providerLoop);

    // Limit iterations max to 2
    const context = await orchestratorLoop.start('Infinite Loop Simulation Task', 2);
    await delay(2000); // Allow sufficient loops execution time to fail

    console.log('DEBUG: context.status =', context.status);
    console.log('DEBUG: context.observations =', context.observations);

    assert('Safety loop controller terminated oscillating iterations', context.status === 'Failed');
    assert('Context logs capture limit failure messages', context.observations.some(obs => obs.includes('Limit exceeded') || obs.includes('iterations limit')));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Loop protection test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Context Checkpoint Serialization
  // ----------------------------------------------------
  console.log('\n--- Testing Checkpoint Import/Export ---');
  try {
    const context = await orchestrator.start('Checkpoint Export Task');
    await delay(100);

    const checkpoint = orchestrator.exportCheckpoint(context.orchestrationId);
    assert('Checkpoint JSON exported successfully', typeof checkpoint === 'string');

    // Terminate current
    await orchestrator.stop(context.orchestrationId);

    // Restore under new instance
    const orchestratorRestore = new AutonomousOrchestrator(eventBus, dispatcher, provider);
    const restoredContext = orchestratorRestore.importCheckpoint(checkpoint);

    assert('Import restored orchestration Id', restoredContext.orchestrationId === context.orchestrationId);
    assert('Import restored current goal state', orchestratorRestore.getGoal(restoredContext.orchestrationId)?.definition === 'Checkpoint Export Task');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Checkpoint test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`ORCHESTRATOR TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Terminate terminal manager shells
  terminalManager.shutdown();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runOrchestratorTests().catch(console.error);
