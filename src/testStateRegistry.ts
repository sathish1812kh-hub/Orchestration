import { EventBus, MemoryStorageProvider, PlatformEvent } from './eventBus';
import { PlatformStateRegistry, RegistrySnapshot } from './stateRegistry';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStateRegistryTests() {
  console.log('==================================================');
  console.log('      MCP PLATFORM STATE REGISTRY TESTS          ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const registry = new PlatformStateRegistry(eventBus);

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

  const createEvent = (
    type: string,
    termId: string,
    payload: any = {},
    override: Partial<PlatformEvent> = {}
  ): Omit<PlatformEvent, 'sequenceNumber'> => {
    return {
      schemaVersion: '1.0.0',
      eventId: `evt_${Math.random().toString(36).substring(2, 9)}`,
      eventType: type,
      eventCategory: 'Terminal',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['test'],
      payload,
      metadata: {},
      correlationId: 'corr_state_999',
      parentEventId: 'root',
      terminalId: termId,
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: Projection Updates
  // ----------------------------------------------------
  console.log('--- Testing Projection State Updates ---');
  try {
    // 1. Publish TerminalCreated
    const ev1 = createEvent('TerminalCreated', 'term-state-001', { shellType: 'cmd', workspaceRoot: 'C:\\test' });
    await eventBus.publish(ev1);

    // 2. Publish SubscriberJoined
    const ev2 = createEvent('SubscriberJoined', 'term-state-001', { subscriberId: 'sub-state-001', filterRules: { stdout: true } });
    await eventBus.publish(ev2);

    // 3. Publish WorkflowCreated
    const ev3 = createEvent('WorkflowCreated', 'term-state-001', { workflowId: 'wf-state-001', agentId: 'agent-state-001', terminalId: 'term-state-001' });
    // Workflow category
    ev3.eventCategory = 'Workflow';
    await eventBus.publish(ev3);

    // 4. Publish AgentRegistered
    const ev4 = createEvent('AgentRegistered', 'term-state-001', { agentId: 'agent-state-001', capabilities: ['terminal'] });
    ev4.eventCategory = 'Agent';
    await eventBus.publish(ev4);

    // 5. Publish PluginLoaded
    const ev5 = createEvent('PluginLoaded', 'term-state-001', { pluginId: 'plugin-state-001', version: '2.1.0' });
    ev5.eventCategory = 'System';
    await eventBus.publish(ev5);

    await delay(150); // Allow async EventBus routing

    // Verify Terminal Projection
    const t = registry.getTerminal('term-state-001')!;
    assert('Terminal projection created successfully', t !== undefined);
    assert('Terminal contains correct workspace directory', t.currentDirectory === 'C:\\test');
    assert('Terminal tracks active subscriber ID', t.activeSubscribers.includes('sub-state-001'));

    // Verify Workflow Projection
    const w = registry.getWorkflow('wf-state-001')!;
    assert('Workflow projection created successfully', w !== undefined);
    assert('Workflow has status Created', w.status === 'Created');

    // Verify Agent Projection
    const a = registry.getAgent('agent-state-001')!;
    assert('Agent projection created successfully', a !== undefined);
    assert('Agent status is Registered', a.status === 'Registered');

    // Verify Plugin Projection
    const p = registry.getPlugin('plugin-state-001')!;
    assert('Plugin projection created successfully', p !== undefined);
    assert('Plugin reports correct version', p.version === '2.1.0');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Projection updates encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Idempotency & Duplicate Prevention
  // ----------------------------------------------------
  console.log('\n--- Testing Idempotency & Duplicate Prevention ---');
  try {
    const statusBefore = registry.getStatus().lastSequence;
    
    // Attempt duplicate processing of already processed sequence
    const duplicateEvent: PlatformEvent = {
      schemaVersion: '1.0.0',
      eventId: 'evt_dup_123',
      eventType: 'TerminalCreated',
      eventCategory: 'Terminal',
      timestamp: Date.now(),
      sequenceNumber: 1, // Already processed seq 1
      severity: 'Information',
      tags: [],
      payload: { terminalId: 'term-state-002' },
      metadata: {},
      correlationId: 'corr_dup',
      parentEventId: 'root'
    };

    registry.processEvent(duplicateEvent);
    assert('Projection engine ignores duplicate sequence numbers', registry.getTerminal('term-state-002') === undefined);
    assert('Sequence index remains unchanged', registry.getStatus().lastSequence === statusBefore);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Idempotency test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Snapshot Export & Import
  // ----------------------------------------------------
  console.log('\n--- Testing Snapshot Manager ---');
  try {
    const snapshot = registry.exportSnapshot();
    assert('Snapshot successfully exported', snapshot !== null && snapshot.lastSequenceNumber > 0);
    assert('Snapshot captures terminals states count', snapshot.terminals.length === 1);

    // Modify projections locally to simulate state changes
    const snapImport: RegistrySnapshot = {
      ...snapshot,
      terminals: [
        {
          terminalId: 'term-restored',
          shellType: 'pwsh',
          pid: 999,
          status: 'Idle',
          currentDirectory: 'C:\\restored',
          workspace: 'C:\\restored',
          activeSubscribers: [],
          lastActivity: Date.now(),
          health: 'healthy'
        }
      ]
    };

    registry.importSnapshot(snapImport);
    assert('Import snapshot restores terminals list successfully', registry.listTerminals().length === 1);
    assert('Restored terminal matches snapshot content', registry.getTerminal('term-restored')?.pid === 999);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Snapshot tests encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Replay & Rebuild
  // ----------------------------------------------------
  console.log('\n--- Testing Registry Rebuild ---');
  try {
    // Clear out and rebuild from event store
    await registry.rebuild();
    assert('Rebuild restores terminal list from event store', registry.getTerminal('term-state-001') !== undefined);
    assert('Rebuild restores subscribers lists', registry.getSubscriber('sub-state-001') !== undefined);
    assert('Rebuild restores plugins projections', registry.getPlugin('plugin-state-001') !== undefined);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Rebuild test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Consistency Checker
  // ----------------------------------------------------
  console.log('\n--- Testing Consistency Checker ---');
  try {
    const report1 = registry.checkConsistency();
    assert('Pristine state is consistent', report1.status === 'consistent');

    // Create inconsistent state: workflow referencing non-existent terminal
    const evInconsistent = createEvent('WorkflowCreated', 'term-missing', { workflowId: 'wf-broken', agentId: 'agent-state-001', terminalId: 'term-missing' });
    evInconsistent.eventCategory = 'Workflow';
    await eventBus.publish(evInconsistent);
    await delay(100);

    const report2 = registry.checkConsistency();
    assert('Inconsistent reference is detected by checker', report2.status === 'inconsistent');
    assert('Errors array contains reference mismatch detail', report2.errors.some(e => e.includes('wf-broken') && e.includes('term-missing')));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Consistency checks encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`STATE REGISTRY TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStateRegistryTests().catch(console.error);
