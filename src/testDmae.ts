import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { DmaeClusterManager } from './dmae';

async function runDmaeTests() {
  console.log('==================================================');
  console.log('      MCP DISTRIBUTED EXECUTION TESTS             ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const dmae = new DmaeClusterManager(eventBus, observability);

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

  // Record Event Bus publish triggers
  const eventLogs: string[] = [];
  eventBus.subscribe('sub-joined', { eventType: 'NodeJoined' }, () => eventLogs.push('Joined'));
  eventBus.subscribe('sub-left', { eventType: 'NodeLeft' }, () => eventLogs.push('Left'));
  eventBus.subscribe('sub-migrated', { eventType: 'TaskMigrated' }, () => eventLogs.push('Migrated'));

  // ----------------------------------------------------
  // Test 1: Node Registrations & Handshakes
  // ----------------------------------------------------
  console.log('--- Testing Node Registrations ---');
  try {
    const nodeA = {
      nodeId: 'node-A',
      clusterId: 'cluster-1',
      hostname: 'worker-A.local',
      state: 'Ready' as const,
      capabilities: ['code.generate', 'reasoning'],
      connectors: ['claude-code'],
      platformVersion: '1.0.0',
      load: 10,
      lastHeartbeat: Date.now()
    };

    const nodeB = {
      nodeId: 'node-B',
      clusterId: 'cluster-1',
      hostname: 'worker-B.local',
      state: 'Ready' as const,
      capabilities: ['code.generate', 'reasoning'],
      connectors: ['gemini-cli'],
      platformVersion: '1.0.0',
      load: 5,
      lastHeartbeat: Date.now()
    };

    dmae.registerNode(nodeA);
    dmae.registerNode(nodeB);

    await new Promise(r => setTimeout(r, 100));

    assert('Registers active nodes to cluster registry', dmae.getNodesList().length === 2);
    assert('Publishes NodeJoined events on registration', eventLogs.includes('Joined'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Registration test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Distributed Scheduling Policies
  // ----------------------------------------------------
  console.log('\n--- Testing Distributed Scheduling ---');
  try {
    // Should choose node-B because it has lower load (5 vs 10)
    const selected = dmae.scheduleTask('code.generate', 'LeastLoaded');
    assert('Scheduler selects the least loaded node matching capabilities', selected === 'node-B');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Scheduling test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Heartbeat Timeouts & Recovery
  // ----------------------------------------------------
  console.log('\n--- Testing Heartbeats & Recovery ---');
  try {
    const node = dmae.getNode('node-A')!;
    node.lastHeartbeat = Date.now() - 20000; // Simulating quiet interval of 20s

    dmae.checkHeartbeats(15000);
    assert('Transitions idle nodes to Offline state on heartbeat timeouts', node.state === 'Offline');

    dmae.triggerRecovery('node-B');
    const nodeB = dmae.getNode('node-B')!;
    assert('Transitions active node state to Recovering', nodeB.state === 'Recovering');

    await new Promise(r => setTimeout(r, 100));
    assert('Publishes TaskMigrated failover events', eventLogs.includes('Migrated'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Recovery test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Maintenance Mode
  // ----------------------------------------------------
  console.log('\n--- Testing Maintenance Mode ---');
  try {
    dmae.setMaintenanceMode('node-B', true);
    const nodeB = dmae.getNode('node-B')!;
    assert('Transitions nodes state to Draining in maintenance mode', nodeB.state === 'Draining');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Maintenance test error:', err);
  }

  console.log('\n==================================================');
  console.log(`DMAE RUNTIME TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDmaeTests().catch(console.error);
