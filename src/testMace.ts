import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { MaceCollaborationEngine } from './mace';

async function runMaceTests() {
  console.log('==================================================');
  console.log('      MCP MULTI-AGENT COLLABORATION TESTS        ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const mace = new MaceCollaborationEngine(eventBus, observability);

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
  eventBus.subscribe('sub-started', { eventType: 'CollaborationStarted' }, () => eventLogs.push('Started'));
  eventBus.subscribe('sub-delegated', { eventType: 'TaskDelegated' }, () => eventLogs.push('Delegated'));
  eventBus.subscribe('sub-conflict', { eventType: 'ConflictDetected' }, () => eventLogs.push('Conflict'));
  eventBus.subscribe('sub-merged', { eventType: 'MergeCompleted' }, () => eventLogs.push('Merged'));

  // ----------------------------------------------------
  // Test 1: Sessions Lifecycle Transitions
  // ----------------------------------------------------
  console.log('--- Testing Sessions Lifecycle ---');
  try {
    const participants = ['claude-code', 'gemini-cli'];
    const roles = { 'claude-code': 'Planner', 'gemini-cli': 'Implementer' };

    const session = mace.createSession('session-101', participants, roles);
    assert('Creates session in Initializing state', session.state === 'Initializing');
    assert('Allocates participants and roles arrays correctly', session.participants.length === 2);

    mace.startSession('session-101');
    assert('Transitions session state to Executing', session.state === 'Executing');

    mace.pauseSession('session-101');
    assert('Transitions session state to Paused', session.state === 'Paused');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Session lifecycle test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Peer Review Coordination
  // ----------------------------------------------------
  console.log('\n--- Testing Peer Review Coordination ---');
  try {
    mace.resumeSession('session-101');
    mace.addArtifact('session-101', 'src/ipcr.ts');

    // Reviewer submits passed review
    mace.submitReview('session-101', 'claude-code', 'src/ipcr.ts', true);
    const session = mace.getSession('session-101')!;
    assert('Records passing peer review checklist verdicts', session.reviews.some(r => r.reviewer === 'claude-code' && r.passed === true));

    // Reviewer submits failed review triggering ConflictDetected event
    mace.submitReview('session-101', 'gemini-cli', 'src/ipcr.ts', false);
    await new Promise(r => setTimeout(r, 100));
    assert('Triggers ConflictDetected events on failed reviews', eventLogs.includes('Conflict'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Peer review test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Voting consensus & Merge
  // ----------------------------------------------------
  console.log('\n--- Testing Voting consensus & Merge ---');
  try {
    mace.submitVote('session-101', 'claude-code', 90);
    mace.submitVote('session-101', 'gemini-cli', 80);

    const checkPass = mace.evaluateMerge('session-101');
    assert('Approves merge when average score exceeds threshold', checkPass.merged === true && checkPass.verdict === 'Approved');

    // Negative case: low vote average
    mace.submitVote('session-101', 'claude-code', 40);
    mace.submitVote('session-101', 'gemini-cli', 30);
    const checkFail = mace.evaluateMerge('session-101');
    assert('Rejects merge when average score is low', checkFail.merged === false && checkFail.verdict === 'Rejected');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Voting test error:', err);
  }

  console.log('\n==================================================');
  console.log(`MACE RUNTIME TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runMaceTests().catch(console.error);
