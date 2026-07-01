import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { DcmsContextCoordinator } from './dcms';

async function runDcmsTests() {
  console.log('==================================================');
  console.log('      MCP DISTRIBUTED STATE TESTS                 ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const dcms = new DcmsContextCoordinator(eventBus, observability);

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
  eventBus.subscribe('sub-created', { eventType: 'ContextCreated' }, () => eventLogs.push('Created'));
  eventBus.subscribe('sub-replicated', { eventType: 'ContextReplicated' }, () => eventLogs.push('Replicated'));
  eventBus.subscribe('sub-conflict', { eventType: 'ContextConflict' }, () => eventLogs.push('Conflict'));

  // ----------------------------------------------------
  // Test 1: Snapshot Creation & Versioning
  // ----------------------------------------------------
  console.log('--- Testing Snapshot Creation ---');
  try {
    const snap1 = dcms.createSnapshot('ctx-1', 'session-abc', 'workflow-xyz', 'node-A', { key: 'val1' });
    const snap2 = dcms.createSnapshot('ctx-1', 'session-abc', 'workflow-xyz', 'node-A', { key: 'val2' });

    assert('First snapshot starts at version 1', snap1.version === 1);
    assert('Second snapshot increments version to 2', snap2.version === 2);

    await new Promise(r => setTimeout(r, 100));
    assert('Publishes ContextCreated events on creation', eventLogs.includes('Created'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Snapshot creation test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Snapshot Replication
  // ----------------------------------------------------
  console.log('\n--- Testing Snapshot Replication ---');
  try {
    dcms.replicateSnapshot('ctx-1', 'node-B');
    await new Promise(r => setTimeout(r, 100));
    assert('Publishes ContextReplicated events on replication', eventLogs.includes('Replicated'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Replication test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Conflict Resolution & LWW
  // ----------------------------------------------------
  console.log('\n--- Testing Conflict Resolution ---');
  try {
    const current = dcms.getLatestSnapshot('ctx-1')!;

    // Case A: Higher version overrides current
    const incomingHighVer = {
      ...current,
      version: 3,
      data: { key: 'val3' }
    };
    const resA = dcms.resolveConflict(incomingHighVer);
    assert('Incoming higher version snapshot overrides current state', resA.version === 3);

    // Case B: Same version with newer timestamp (Last-Writer-Wins)
    const resB = dcms.resolveConflict({
      ...resA,
      timestamp: Date.now() + 1000,
      data: { key: 'val4' }
    });
    assert('Last-Writer-Wins resolves conflicts with identical versions', resB.data.key === 'val4');

    // Case C: Lower version triggers conflict event
    dcms.resolveConflict({
      ...resB,
      version: 1
    });
    await new Promise(r => setTimeout(r, 100));
    assert('Publishes ContextConflict event on obsolete snapshots', eventLogs.includes('Conflict'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Conflict test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Checkpoint Restore
  // ----------------------------------------------------
  console.log('\n--- Testing Checkpoint Restore ---');
  try {
    const restored = dcms.restoreSnapshot('ctx-1', 1);
    assert('Restores historical snapshot checkpoints successfully', restored.version === 1 && restored.data.key === 'val1');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Restore test error:', err);
  }

  console.log('\n==================================================');
  console.log(`DCMS RUNTIME TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runDcmsTests().catch(console.error);
