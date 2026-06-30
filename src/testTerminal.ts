import { TerminalManager, parseKeyCombination } from './terminalManager';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTerminalTests() {
  console.log('==================================================');
  console.log('    MCP INTERACTIVE TERMINAL MANAGER V2 TESTS     ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(config.workspaceRoots[0]);
  const terminalManager = new TerminalManager(config.workspaceRoots[0], policyEngine, auditLogger);

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

  // ----------------------------------------------------
  // Test 1: Terminal Discovery
  // ----------------------------------------------------
  console.log('--- Testing Discovery ---');
  try {
    const list = await terminalManager.discoverTerminals();
    assert('Discovered terminal list successfully', Array.isArray(list));
    console.log(`Discovered ${list.length} running shells on Windows.`);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Discovery encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Create Managed Terminal & Focus
  // ----------------------------------------------------
  console.log('\n--- Testing Managed Terminal Creation ---');
  let termUuid = '';
  try {
    const meta = terminalManager.createManagedTerminal('cmd', 'CMD Test Terminal', config.workspaceRoots[0]);
    termUuid = meta.uuid;
    assert('Managed terminal created & registered', meta.uuid.length > 0);
    assert('Metadata indicates correct shell', meta.shellType === 'cmd');
    assert('Terminal initialized in Idle state', meta.busyState === 'Idle');

    const term = terminalManager.getTerminal(termUuid)!;
    
    // Focus test
    const focusRes = await term.focus();
    assert('Focus window action returned successfully', focusRes.status === 'success');
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Creation/Focus encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Screen Capture & Interactive Inputs
  // ----------------------------------------------------
  console.log('\n--- Testing Capture, Write, and Special Key Inputs ---');
  try {
    const term = terminalManager.getTerminal(termUuid)!;

    // Initial capture
    await delay(1000); // Wait for cmd shell window to load
    const cap1 = await term.capture();
    assert('Captured visible buffer successfully', cap1.visible.length > 0);
    assert('Capture returns correct dimensions', cap1.cols > 0 && cap1.rows > 0);

    // Write command characters
    console.log('Simulating typing "echo AntigravityTest"...');
    await term.write('echo AntigravityTest');
    
    const capAfterWrite = await term.capture();
    assert('Buffer captured characters after write', capAfterWrite.visible.includes('echo AntigravityTest'));
    assert('Busy state transitioned to Idle after action', term.busyState === 'Idle');

    // Send Enter key combination
    console.log('Sending key "Enter"...');
    const { keyCode, controlState } = parseKeyCombination('Enter');
    await term.sendKey(keyCode, controlState);
    
    // Allow process to run and output result
    await delay(1000);
    const capAfterEnter = await term.capture();
    assert('Output buffer contains command result', capAfterEnter.visible.includes('AntigravityTest'));
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Capture/keystrokes test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Registry Persistence
  // ----------------------------------------------------
  console.log('\n--- Testing Registry Persistence ---');
  try {
    const registryPath = path.join(config.workspaceRoots[0], 'terminal_registry.json');
    assert('Registry file exists on disk', fs.existsSync(registryPath));
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    assert('Registry JSON contains created terminal uuid', data.some((t: any) => t.uuid === termUuid));
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Persistence test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Keyboard Shortcuts & Parsing
  // ----------------------------------------------------
  console.log('\n--- Testing Key Shortcut Parsing ---');
  const key1 = parseKeyCombination('Ctrl+C');
  assert('Ctrl+C parsed correct virtual key code', key1.keyCode === 67);
  assert('Ctrl+C parsed correct control state', key1.controlState === 8);

  const key2 = parseKeyCombination('Shift+Tab');
  assert('Shift+Tab parsed correct virtual key code', key2.keyCode === 9);
  assert('Shift+Tab parsed correct control state', key2.controlState === 16);

  const key3 = parseKeyCombination('ArrowUp');
  assert('ArrowUp parsed correct virtual key code', key3.keyCode === 38);
  assert('ArrowUp parsed correct control state', key3.controlState === 0);

  // ----------------------------------------------------
  // Test 6: Stress Test & Concurrency
  // ----------------------------------------------------
  console.log('\n--- Testing Concurrent Multiple Sessions ---');
  try {
    const listBefore = terminalManager.listTerminals().length;
    console.log(`Spawning 3 concurrent shells...`);
    const t1 = terminalManager.createManagedTerminal('cmd', 'Stress 1', config.workspaceRoots[0]);
    const t2 = terminalManager.createManagedTerminal('cmd', 'Stress 2', config.workspaceRoots[0]);
    const t3 = terminalManager.createManagedTerminal('cmd', 'Stress 3', config.workspaceRoots[0]);
    
    await delay(1000);
    const listAfter = terminalManager.listTerminals().length;
    assert('Registry correctly holds concurrent sessions', listAfter === listBefore + 3);

    // Verify isolation - write to t1 and verify t2 buffer does not change
    const term1 = terminalManager.getTerminal(t1.uuid)!;
    const term2 = terminalManager.getTerminal(t2.uuid)!;

    await term1.write('echo StressSession1');
    await term2.write('echo StressSession2');

    const capTerm1 = await term1.capture();
    const capTerm2 = await term2.capture();

    assert('Session 1 buffer is isolated', capTerm1.visible.includes('echo StressSession1') && !capTerm1.visible.includes('echo StressSession2'));
    assert('Session 2 buffer is isolated', capTerm2.visible.includes('echo StressSession2') && !capTerm2.visible.includes('echo StressSession1'));

    // Clean up stress sessions
    terminalManager.closeTerminal(t1.uuid);
    terminalManager.closeTerminal(t2.uuid);
    terminalManager.closeTerminal(t3.uuid);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Concurrency stress test encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 7: Closure & Detach
  // ----------------------------------------------------
  console.log('\n--- Testing Terminal Session Closure ---');
  try {
    const closed = terminalManager.closeTerminal(termUuid);
    assert('Terminal session closed successfully', closed);
    assert('Terminal removed from active registry list', terminalManager.getTerminal(termUuid) === undefined);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Closure test encountered error:', err);
  }

  console.log('\n==================================================');
  console.log(`INTERACTIVE TERMINAL TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTerminalTests().catch(console.error);
