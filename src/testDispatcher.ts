import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher, TerminalAdapter, DispatchRequest } from './dispatcher';
import { AuditLogger } from './auditLogger';
import { PolicyEngine } from './policyEngine';
import { loadConfiguration } from './config';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDispatcherTests() {
  console.log('==================================================');
  console.log('         MCP EXECUTION DISPATCHER TESTS           ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);
  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const dispatcher = new ExecutionDispatcher(eventBus);

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

  // Spawns a terminal to support Local Terminal Adapter
  const termMeta = terminalManager.createManagedTerminal('cmd', 'Disp Test Term', process.cwd());
  const termId = termMeta.uuid;

  // 1. Instantiate and Register Local Terminal Adapter
  const adapter = new TerminalAdapter('local-term-001', 'Test Terminal Adapter', terminalManager);
  dispatcher.registerProvider(adapter);

  // Helper template for dispatch request
  const createRequest = (override: Partial<DispatchRequest> = {}): Omit<DispatchRequest, 'dispatchId'> => {
    return {
      workflowId: 'wf-disp-123',
      taskId: 'task-clean',
      requiredCapabilities: ['local_terminal'],
      priority: 'Normal',
      timeoutMs: 5000,
      command: 'echo CleanDone',
      terminalId: termId,
      metadata: {},
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: Capability Matching & Provider Selection
  // ----------------------------------------------------
  console.log('--- Testing Capability Matching & Provider Selection ---');
  try {
    // A. Match succeeds
    const req1 = createRequest({ requiredCapabilities: ['local_terminal'] });
    const state1 = await dispatcher.submit(req1);
    assert('Queued state initialized successfully', state1.status === 'Queued');
    
    await delay(150); // Allow async queue processing
    assert('Assigned task to matching capability provider', state1.status === 'Completed' || state1.status === 'Running');

    // B. Match fails
    const reqFail = createRequest({ requiredCapabilities: ['remote_docker_container'] });
    const stateFail = await dispatcher.submit(reqFail);
    await delay(100);
    assert('Task with unmatched capabilities fails with descriptive error', 
      stateFail.status === 'Failed' && 
      stateFail.error?.includes('No execution provider matched capabilities') === true
    );

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Capability matching test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Priority Queuing
  // ----------------------------------------------------
  console.log('\n--- Testing Queue Priority Sorting ---');
  try {
    // Unregister adapter temporarily to hold queue items
    dispatcher.unregisterProvider('local-term-001');

    const reqLow = createRequest({ priority: 'Low', taskId: 'low-task' });
    const reqCritical = createRequest({ priority: 'Critical', taskId: 'critical-task' });
    
    const stateLow = await dispatcher.submit(reqLow);
    const stateCritical = await dispatcher.submit(reqCritical);

    // Verify queue order
    const queue = (dispatcher as any).queue as DispatchRequest[];
    assert('Critical priority task sorted to front of dispatch queue', queue[0].taskId === 'critical-task');
    assert('Low priority task sorted to end of dispatch queue', queue[1].taskId === 'low-task');

    // Restore provider and cleanup queue
    dispatcher.registerProvider(adapter);
    await delay(300); // Allow processing

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Priority sorting test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Cancellation and Retries
  // ----------------------------------------------------
  console.log('\n--- Testing Cancellation & Retries ---');
  try {
    // Queue task and cancel immediately
    dispatcher.unregisterProvider('local-term-001');
    const reqCancel = createRequest({ taskId: 'cancel-task' });
    const stateCancel = await dispatcher.submit(reqCancel);

    const cancelled = await dispatcher.cancel(stateCancel.dispatchId);
    assert('Cancellation tool returned success', cancelled);
    assert('Task status transitioned to Cancelled', stateCancel.status === 'Cancelled');

    // Retry failed/timed-out tasks
    dispatcher.registerProvider(adapter);
    const reqRetry = createRequest({ taskId: 'retry-task', requiredCapabilities: ['non-existent'] }); // Fails immediately
    const stateRetry = await dispatcher.submit(reqRetry);
    await delay(100);

    const retriedState = await dispatcher.retry(stateRetry.dispatchId);
    assert('Retry tool successfully re-submitted task', retriedState !== null && retriedState.status === 'Queued');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Cancellation and retry test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Timeouts
  // ----------------------------------------------------
  console.log('\n--- Testing Dispatcher Timeouts ---');
  try {
    const reqTimeout = createRequest({ timeoutMs: 50, command: 'pause', taskId: 'task-long' });
    const stateTimeout = await dispatcher.submit(reqTimeout);
    
    await delay(150); // Exceeds 50ms timeout limit
    assert('Task dispatch timed out inside dispatcher limits', stateTimeout.status === 'TimedOut' && stateTimeout.error?.includes('timed out') === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Timeout test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`DISPATCHER TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Terminate terminal manager shell
  terminalManager.shutdown();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDispatcherTests().catch(console.error);
