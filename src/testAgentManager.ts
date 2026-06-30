import { EventBus, MemoryStorageProvider } from './eventBus';
import { AgentManager, AgentDescriptor } from './agentManager';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAgentManagerTests() {
  console.log('==================================================');
  console.log('           MCP AGENT MANAGER TESTS                ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const manager = new AgentManager(eventBus);

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

  // Template descriptor
  const createAgentDesc = (override: Partial<AgentDescriptor> = {}): Omit<AgentDescriptor, 'status' | 'currentWorkload' | 'restartCount'> => {
    return {
      agentId: `ag_${Math.random().toString(36).substring(2, 9)}`,
      name: 'Claude Executor',
      version: '1.2.0',
      provider: 'remote_mcp',
      platform: 'windows',
      capabilities: [
        { capabilityId: 'code.generate', version: '1.0.0' },
        { capabilityId: 'filesystem.read', version: '1.0.0' }
      ],
      resourceLimits: { maxConcurrentTasks: 2, maxMemoryMb: 1024 },
      workspaceRoot: 'C:\\workspace',
      metadata: {},
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: Agent Registration & Discovery
  // ----------------------------------------------------
  console.log('--- Testing Agent Registration ---');
  try {
    const desc = createAgentDesc({ agentId: 'agent-life-001' });
    const registered = await manager.registerAgent(desc);

    assert('Agent successfully registered in manager store', registered.status === 'Healthy');
    assert('Agent capabilities mapped correctly', registered.capabilities.length === 2);

    const list = manager.listAgents();
    assert('Registration reflected in agent enumeration lists', list.length === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Registration test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Heartbeat Processing & Health Update
  // ----------------------------------------------------
  console.log('\n--- Testing Heartbeat Processing & Telemetry ---');
  try {
    // Process heartbeat
    const success = await manager.processHeartbeat('agent-life-001', {
      currentWorkload: 1,
      status: 'Busy'
    });

    assert('Heartbeat process return code reports success', success);
    
    const ag = manager.getAgent('agent-life-001')!;
    assert('Heartbeat updates current workload telemetry', ag.currentWorkload === 1);
    assert('Heartbeat updates state indicator to Busy', ag.status === 'Busy');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Heartbeat test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Offline Detection
  // ----------------------------------------------------
  console.log('\n--- Testing Heartbeat Timeout (Offline) ---');
  try {
    const ag = manager.getAgent('agent-life-001')!;
    // Simulate expired heartbeat timestamp
    ag.lastHeartbeatTime = Date.now() - 20000; // 20s ago (limit is 15s)

    await delay(2500); // Wait for heartbeat check interval

    assert('Missing heartbeats triggers transition to Offline status', ag.status === 'Offline');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Offline detection test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Supervised Process Restart Policy
  // ----------------------------------------------------
  console.log('\n--- Testing Process Supervision & Restarts ---');
  try {
    const supervisedDesc = createAgentDesc({
      agentId: 'agent-proc-002',
      provider: 'local_process'
    });
    await manager.registerAgent(supervisedDesc);

    // Spawn a dummy process that exits immediately (node -e "process.exit(1)")
    const spawned = await manager.spawnSupervisedProcess(
      'agent-proc-002',
      'node',
      ['-e', '"process.exit(1)"']
    );

    assert('Supervised process spawned successfully', spawned);

    await delay(1200); // Allow exit loop to execute and retry loops (backoff restarts)

    const ag = manager.getAgent('agent-proc-002')!;
    assert('Supervised process crash detected; auto-restart attempts triggered', ag.restartCount > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Process supervision test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Drain Mode
  // ----------------------------------------------------
  console.log('\n--- Testing Drain Mode Actions ---');
  try {
    const oldAg = manager.getAgent('agent-life-001')!;
    await manager.registerAgent(oldAg); // Reset state

    const freshAg = manager.getAgent('agent-life-001')!;
    // Set workload and enable drain
    freshAg.currentWorkload = 2;
    const drained = await manager.enableDrainMode('agent-life-001');

    assert('Drain mode enablement returns success', drained);
    assert('Agent status transitioned to Draining', freshAg.status === 'Draining');

    // Simulate task completions reducing workload to 0
    freshAg.currentWorkload = 0;
    await delay(150); // Allow interval check to trigger auto-stop

    assert('Draining agent auto-stopped once workload cleared to 0', freshAg.status === 'Stopped');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Drain mode test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`AGENT MANAGER TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Cleanup
  manager.shutdown();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAgentManagerTests().catch(console.error);
