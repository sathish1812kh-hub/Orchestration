import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { CloudExecutionGateway } from './cegrf';

async function runCegrfTests() {
  console.log('==================================================');
  console.log('      MCP CLOUD EXECUTION GATEWAY TESTS           ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const cegrf = new CloudExecutionGateway(eventBus, observability);

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
  eventBus.subscribe('sub-registered', { eventType: 'RemoteClusterRegistered' }, () => eventLogs.push('Registered'));
  eventBus.subscribe('sub-dispatched', { eventType: 'RemoteExecutionDispatched' }, () => eventLogs.push('Dispatched'));
  eventBus.subscribe('sub-synced', { eventType: 'ArtifactTransferred' }, () => eventLogs.push('Synced'));

  // ----------------------------------------------------
  // Test 1: Remote Cluster Registration
  // ----------------------------------------------------
  console.log('--- Testing Remote Cluster Registration ---');
  try {
    const cluster1 = {
      clusterId: 'eu-west-1',
      gatewayUrl: 'https://eu.gateway.local',
      state: 'Active' as const,
      capabilities: ['code.generate', 'reasoning'],
      latencyMs: 90
    };

    const cluster2 = {
      clusterId: 'us-east-1',
      gatewayUrl: 'https://us.gateway.local',
      state: 'Active' as const,
      capabilities: ['code.generate', 'reasoning'],
      latencyMs: 40
    };

    cegrf.registerRemoteCluster(cluster1);
    cegrf.registerRemoteCluster(cluster2);

    await new Promise(r => setTimeout(r, 100));

    assert('Registers remote federated clusters correctly', cegrf.getClustersList().length === 2);
    assert('Publishes RemoteClusterRegistered event on registration', eventLogs.includes('Registered'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Registration test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Federated Task Scheduling
  // ----------------------------------------------------
  console.log('\n--- Testing Federated Scheduling ---');
  try {
    // Should choose us-east-1 because it has lower latency (40ms vs 90ms)
    const selected = cegrf.federateTask('CodeOptimization', 'code.generate');
    assert('Federates task to optimal cluster based on latency routing checks', selected === 'us-east-1');

    await new Promise(r => setTimeout(r, 100));
    assert('Publishes RemoteExecutionDispatched event on task dispatch', eventLogs.includes('Dispatched'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Scheduling test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Remote Context Artifact Sync
  // ----------------------------------------------------
  console.log('\n--- Testing Artifact Synchronization ---');
  try {
    cegrf.syncArtifacts('eu-west-1', 'dist/build.zip');

    await new Promise(r => setTimeout(r, 100));
    assert('Publishes ArtifactTransferred event on synchronization', eventLogs.includes('Synced'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Artifact sync test error:', err);
  }

  console.log('\n==================================================');
  console.log(`CEGRF RUNTIME TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCegrfTests().catch(console.error);
