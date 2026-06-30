import { EventBus, MemoryStorageProvider, JsonlStorageProvider, PlatformEvent } from './eventBus';
import * as fs from 'fs';
import * as path from 'path';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runEventBusTests() {
  console.log('==================================================');
  console.log('            MCP EVENT BUS RUNTIME TESTS           ');
  console.log('==================================================\n');

  const testDir = path.join(process.cwd(), 'scratch');
  const jsonlPath = path.join(testDir, 'test_event_store.jsonl');
  
  if (fs.existsSync(jsonlPath)) {
    fs.unlinkSync(jsonlPath);
  }

  const memoryStorage = new MemoryStorageProvider();
  const jsonlStorage = new JsonlStorageProvider(jsonlPath);

  const bus = new EventBus(memoryStorage);

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

  // Helper template for a valid v1.0.0 event
  const createValidEvent = (override: Partial<PlatformEvent> = {}): Omit<PlatformEvent, 'sequenceNumber'> => {
    return {
      schemaVersion: '1.0.0',
      eventId: `evt_${Math.random().toString(36).substring(2, 9)}`,
      eventType: 'TerminalCreated',
      eventCategory: 'Terminal',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['test', 'system'],
      payload: { shell: 'cmd' },
      metadata: { os: 'windows' },
      correlationId: 'corr_test_123',
      parentEventId: 'root',
      priority: 'Normal',
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: Event Publication & Schema Validation
  // ----------------------------------------------------
  console.log('--- Testing Publication & Schema Validation ---');
  try {
    const valid = createValidEvent();
    const published = await bus.publish(valid);
    assert('Valid event successfully published', published.sequenceNumber === 1);

    // Schema Validation: Invalid major version
    const invalidVer = createValidEvent({ schemaVersion: '2.0.0' });
    let threwVerError = false;
    try {
      await bus.publish(invalidVer);
    } catch (_) {
      threwVerError = true;
    }
    assert('Event with incompatible version rejected', threwVerError);

    // Schema Validation: Missing required field
    const invalidField = createValidEvent() as any;
    delete invalidField.severity;
    let threwFieldError = false;
    try {
      await bus.publish(invalidField);
    } catch (_) {
      threwFieldError = true;
    }
    assert('Event missing severity field rejected', threwFieldError);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Publication tests encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Subscriptions & Filtering
  // ----------------------------------------------------
  console.log('\n--- Testing Subscriptions & Filtering ---');
  try {
    const receivedEvents: PlatformEvent[] = [];
    
    // Subscribe to events with tag 'critical-tag'
    bus.subscribe('Sub-Filtered', { tags: ['critical-tag'] }, (ev) => {
      receivedEvents.push(ev);
    });

    const ev1 = createValidEvent({ tags: ['test'] });
    const ev2 = createValidEvent({ tags: ['critical-tag', 'test'] });

    await bus.publish(ev1);
    await bus.publish(ev2);

    await delay(100); // Allow async routing

    assert('Filtered subscriber received matched tag event', receivedEvents.length === 1);
    assert('Filtered subscriber did not receive unmatched event', receivedEvents[0].tags.includes('critical-tag'));

    // Cleanup subscriber
    const unsubbed = bus.unsubscribe('Sub-Filtered');
    assert('Clean unsubscribe returns success', unsubbed);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Subscription tests encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Subscriber Isolation & Slow Consumers
  // ----------------------------------------------------
  console.log('\n--- Testing Subscriber Isolation ---');
  try {
    const fastReceived: PlatformEvent[] = [];
    
    bus.subscribe('Fast-Subscriber', { eventType: '*' }, (ev) => {
      fastReceived.push(ev);
    });

    // Slow subscriber (we pause it so events build up in its queue)
    bus.subscribe('Slow-Subscriber', { eventType: '*' }, () => {}, { maxQueueSize: 3 });
    const slowSub = (bus as any).subscribers.find((s: any) => s.id === 'Slow-Subscriber')!;
    slowSub.paused = true;

    // Publish 5 events
    await bus.publish(createValidEvent({ eventType: 'Tick' }));
    await bus.publish(createValidEvent({ eventType: 'Tick' }));
    await bus.publish(createValidEvent({ eventType: 'Tick' }));
    await bus.publish(createValidEvent({ eventType: 'Tick' }));
    await bus.publish(createValidEvent({ eventType: 'Tick' }));

    await delay(100);

    assert('Fast subscriber received all events without blocking', fastReceived.length >= 5);
    assert('Slow subscriber queued events up to capacity limit (3)', slowSub.queue.length === 3);

    bus.unsubscribe('Fast-Subscriber');
    bus.unsubscribe('Slow-Subscriber');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Subscriber isolation test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Priority Queue Scheduling
  // ----------------------------------------------------
  console.log('\n--- Testing Priority Scheduling ---');
  try {
    const queueOrder: string[] = [];
    
    // Subscribe but pause immediately to queue and check sort order
    bus.subscribe('Priority-Sub', { eventType: '*' }, (ev) => {
      queueOrder.push(ev.priority || 'Normal');
    });

    const sub = (bus as any).subscribers.find((s: any) => s.id === 'Priority-Sub')!;
    sub.paused = true;

    await bus.publish(createValidEvent({ priority: 'Normal' }));
    await bus.publish(createValidEvent({ priority: 'Critical' }));
    await bus.publish(createValidEvent({ priority: 'Background' }));
    await bus.publish(createValidEvent({ priority: 'High' }));

    await delay(100);

    // Sort verification: Critical (5), High (4), Normal (3), Background (1)
    const sortedPriorities = sub.queue.map((e: any) => e.priority);
    assert('Subscriber queue sorted items by priority descending', 
      sortedPriorities[0] === 'Critical' &&
      sortedPriorities[1] === 'High' &&
      sortedPriorities[2] === 'Normal' &&
      sortedPriorities[3] === 'Background'
    );

    // Resume subscriber to verify processing
    bus.resumeSubscriber('Priority-Sub');
    assert('Callback invoked in priority order', 
      queueOrder[0] === 'Critical' &&
      queueOrder[1] === 'High' &&
      queueOrder[2] === 'Normal' &&
      queueOrder[3] === 'Background'
    );

    bus.unsubscribe('Priority-Sub');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Priority scheduling test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Dead Letter Queue (DLQ)
  // ----------------------------------------------------
  console.log('\n--- Testing Dead Letter Queue ---');
  try {
    const dlq = bus.getDeadLetterQueue();
    assert('Dead letter queue contains failed validation events', dlq.length >= 2);
    assert('DLQ stores failure reasons', dlq[0].failureReason.length > 0);

    // Dynamic repair/replay dead letters
    const repairResult = await bus.replayDeadLetters();
    assert('DLQ replay processed failed events', repairResult.failed === 2); // Still failed because schema is still invalid

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] DLQ test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 6: Persisted JSONL Storage
  // ----------------------------------------------------
  console.log('\n--- Testing JSONL Storage Provider ---');
  try {
    const jsonlBus = new EventBus(jsonlStorage);
    
    const ev = createValidEvent({ eventType: 'PersistedEvent' });
    await jsonlBus.publish(ev);

    assert('JSONL file created on disk', fs.existsSync(jsonlPath));

    const replayed = await jsonlBus.replay(e => e.eventType === 'PersistedEvent');
    assert('JSONL storage replayed persisted event from disk', replayed.length === 1 && replayed[0].eventType === 'PersistedEvent');

    // Clean up
    await jsonlStorage.clear();
    assert('JSONL storage cleared successfully', fs.readFileSync(jsonlPath, 'utf-8').trim() === '');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] JSONL storage test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 7: Metrics & Health
  // ----------------------------------------------------
  console.log('\n--- Testing Metrics & Health Monitor ---');
  try {
    const status = bus.getStatus();
    assert('Status reports health as running', status.health === 'running');
    assert('Status collects published event counts', status.publishedCount > 0);
    assert('Status collects dead letter count metrics', status.deadLetterCount > 0);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Metrics test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`EVENT BUS TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Clean up scratch file
  if (fs.existsSync(jsonlPath)) {
    fs.unlinkSync(jsonlPath);
  }

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runEventBusTests().catch(console.error);
