import { TerminalManager } from './terminalManager';
import { PromptProfileRegistry } from './promptProfiles';
import { PromptDetectionEngine } from './promptDetector';
import { StreamingEngine, TerminalEvent } from './streamingEngine';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStreamingTests() {
  console.log('==================================================');
  console.log('       MCP TERMINAL STREAMING ENGINE TESTS        ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(config.workspaceRoots[0]);
  
  const terminalManager = new TerminalManager(config.workspaceRoots[0], policyEngine, auditLogger);
  const registry = new PromptProfileRegistry();
  const promptDetector = new PromptDetectionEngine(terminalManager, registry);
  const streamingEngine = new StreamingEngine(terminalManager, promptDetector);

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

  // Create terminal
  const meta = terminalManager.createManagedTerminal('cmd', 'Streaming Test CMD', config.workspaceRoots[0]);
  const uuid = meta.uuid;
  await delay(1000); // Allow startup

  // ----------------------------------------------------
  // Test 1: Subscribe & Capture Live Events
  // ----------------------------------------------------
  console.log('--- Testing Live Subscription & Event Ordering ---');
  const eventsSub1: TerminalEvent[] = [];
  
  streamingEngine.subscribe(uuid, 'Sub-1', (ev) => {
    eventsSub1.push(ev);
  });
  await delay(500); // Allow baseline capture to establish

  const term = terminalManager.getTerminal(uuid)!;
  console.log('Sending command: echo HelloStream');
  await term.write('echo HelloStream');
  await term.sendKey(13, 0); // Enter
  await delay(1200); // Wait for output & polling

  assert('Events were received by Sub-1', eventsSub1.length > 0);
  
  // Verify strict ordering of sequence numbers
  let strictlyIncreasing = true;
  for (let i = 1; i < eventsSub1.length; i++) {
    if (eventsSub1[i].sequence <= eventsSub1[i - 1].sequence) {
      strictlyIncreasing = false;
    }
  }
  assert('Sequence numbers are strictly increasing', strictlyIncreasing);
  
  const hasHello = eventsSub1.some(e => e.eventType === 'OutputChunk' && e.payload.chunk?.includes('HelloStream'));
  assert('OutputChunk event matches command output content', hasHello);

  // ----------------------------------------------------
  // Test 2: Replay Buffer
  // ----------------------------------------------------
  console.log('\n--- Testing Replay Buffer ---');
  const replayed = streamingEngine.replay(uuid, 1);
  assert('Replay buffer contains historical events', replayed.length > 0);
  assert('Replayed first event matches sequence 1', replayed[0].sequence === 1);

  // ----------------------------------------------------
  // Test 3: Multiple Subscribers
  // ----------------------------------------------------
  console.log('\n--- Testing Multiple Subscribers ---');
  const eventsSub2: TerminalEvent[] = [];
  streamingEngine.subscribe(uuid, 'Sub-2', (ev) => {
    eventsSub2.push(ev);
  });

  console.log('Sending command: echo MultiSubActive');
  await term.write('echo MultiSubActive');
  await term.sendKey(13, 0); // Enter
  await delay(1200);

  const sub1HasMulti = eventsSub1.some(e => e.payload.chunk?.includes('MultiSubActive'));
  const sub2HasMulti = eventsSub2.some(e => e.payload.chunk?.includes('MultiSubActive'));
  
  assert('Sub-1 received MultiSubActive event', sub1HasMulti);
  assert('Sub-2 received MultiSubActive event independently', sub2HasMulti);

  // ----------------------------------------------------
  // Test 4: Pause / Resume Subscriptions
  // ----------------------------------------------------
  console.log('\n--- Testing Pause and Resume ---');
  const paused = streamingEngine.pauseSubscriber(uuid, 'Sub-1');
  assert('Subscription paused successfully', paused);

  const sub1PreLength = eventsSub1.length;
  console.log('Sending command: echo PausedOutput');
  await term.write('echo PausedOutput');
  await term.sendKey(13, 0); // Enter
  await delay(1000);

  assert('Paused Sub-1 did not receive new events during pause', eventsSub1.length === sub1PreLength);
  
  const sub2HasPaused = eventsSub2.some(e => e.payload.chunk?.includes('PausedOutput'));
  assert('Unpaused Sub-2 received event during Sub-1 pause', sub2HasPaused);

  console.log('Resuming Sub-1...');
  const resumed = streamingEngine.resumeSubscriber(uuid, 'Sub-1');
  assert('Subscription resumed successfully', resumed);
  
  // Wait a small delay for queue flush
  await delay(200);
  const sub1HasPausedAfterResume = eventsSub1.some(e => e.payload.chunk?.includes('PausedOutput'));
  assert('Resumed Sub-1 received buffered events after resume', sub1HasPausedAfterResume);

  // ----------------------------------------------------
  // Test 5: Backpressure & Bounded Queue Overflow
  // ----------------------------------------------------
  console.log('\n--- Testing Backpressure & Overflow Policy ---');
  // Create dummy subscriber with small queue and drop_oldest policy
  const dummyEvents: TerminalEvent[] = [];
  const dummySubId = 'Dummy-Backpressure';
  
  streamingEngine.subscribe(uuid, dummySubId, (ev) => {
    dummyEvents.push(ev);
  }, {
    maxQueueSize: 3,
    overflowPolicy: 'drop_oldest'
  });

  // Emitting manual test events using emitEvent to trigger overflow
  const metaDummy = { cursorX: 0, cursorY: 0, promptState: 'none', busyState: 'Idle' };
  
  // Pause it so events build up in its queue
  streamingEngine.pauseSubscriber(uuid, dummySubId);

  // Emit 5 events
  streamingEngine.emitEvent(uuid, 'OutputChunk', 'stdout', { chunk: 'Ev1' }, metaDummy);
  streamingEngine.emitEvent(uuid, 'OutputChunk', 'stdout', { chunk: 'Ev2' }, metaDummy);
  streamingEngine.emitEvent(uuid, 'OutputChunk', 'stdout', { chunk: 'Ev3' }, metaDummy);
  streamingEngine.emitEvent(uuid, 'OutputChunk', 'stdout', { chunk: 'Ev4' }, metaDummy);
  streamingEngine.emitEvent(uuid, 'OutputChunk', 'stdout', { chunk: 'Ev5' }, metaDummy);

  // Resume to flush
  streamingEngine.resumeSubscriber(uuid, dummySubId);

  // Since maxQueueSize is 3, the first 2 events ('Ev1', 'Ev2') should be dropped
  assert('Bounded queue dropped older events under drop_oldest policy', dummyEvents.length === 3);
  assert('Queue contains latest event Ev5', dummyEvents.some(e => e.payload.chunk === 'Ev5'));
  assert('Queue does not contain oldest event Ev1', !dummyEvents.some(e => e.payload.chunk === 'Ev1'));

  // ----------------------------------------------------
  // Test 6: Unsubscribe / Cleanup
  // ----------------------------------------------------
  console.log('\n--- Testing Subscription Cleanup ---');
  const removed = streamingEngine.unsubscribe(uuid, 'Sub-1');
  assert('Unsubscribed Sub-1 successfully', removed);
  
  const status = streamingEngine.getStatus(uuid);
  assert('Active subscriber count is updated in status', status.subscriberCount === 2); // Sub-2, Dummy-Backpressure

  // Cleanup
  terminalManager.closeTerminal(uuid);
  streamingEngine.stopStream(uuid);

  console.log('\n==================================================');
  console.log(`STREAMING ENGINE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStreamingTests().catch(console.error);
