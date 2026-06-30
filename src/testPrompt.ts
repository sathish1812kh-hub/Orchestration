import { TerminalManager } from './terminalManager';
import { PromptProfileRegistry } from './promptProfiles';
import { PromptDetectionEngine } from './promptDetector';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPromptTests() {
  console.log('==================================================');
  console.log('       MCP PROMPT DETECTION ENGINE TESTS          ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(config.workspaceRoots[0]);
  
  const terminalManager = new TerminalManager(config.workspaceRoots[0], policyEngine, auditLogger);
  const registry = new PromptProfileRegistry();
  const engine = new PromptDetectionEngine(terminalManager, registry);

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
  // Test 1: Default Profiles
  // ----------------------------------------------------
  console.log('--- Testing Default Profiles Registry ---');
  const profiles = registry.listProfiles();
  assert('Registry contains default profiles', profiles.length >= 8);
  assert('Powershell profile is registered', profiles.some(p => p.name === 'powershell'));
  assert('CMD profile is registered', profiles.some(p => p.name === 'cmd'));
  assert('WSL profile is registered', profiles.some(p => p.name === 'wsl'));
  assert('Python REPL is registered', profiles.some(p => p.name === 'python_repl'));
  assert('Node REPL is registered', profiles.some(p => p.name === 'node_repl'));
  assert('Password prompt is registered', profiles.some(p => p.name === 'password_prompt'));

  // ----------------------------------------------------
  // Test 2: Dynamic Profile Registration
  // ----------------------------------------------------
  console.log('\n--- Testing Dynamic Profile API ---');
  registry.register({
    name: 'custom_repl',
    shellType: 'any',
    promptRegex: '^MY_REPL>\\s*$',
    busyIndicators: ['waiting...'],
    errorIndicators: ['ERR'],
    completionIndicators: ['OK']
  });
  
  const custom = registry.getProfile('custom_repl');
  assert('Custom profile successfully registered', custom !== undefined && custom.promptRegex === '^MY_REPL>\\s*$');
  
  const disabled = registry.disableProfile('custom_repl');
  assert('Disable profile returns success', disabled);
  assert('Profile is disabled in registry', registry.getProfile('custom_repl')?.enabled === false);

  const enabled = registry.enableProfile('custom_repl');
  assert('Enable profile returns success', enabled);
  assert('Profile is enabled in registry', registry.getProfile('custom_repl')?.enabled === true);

  const unregistered = registry.unregister('custom_repl');
  assert('Unregister profile returns success', unregistered);
  assert('Profile removed from registry', registry.getProfile('custom_repl') === undefined);

  // ----------------------------------------------------
  // Test 3: Prompt Detection in Live CMD Shell
  // ----------------------------------------------------
  console.log('\n--- Testing Live Shell Prompt Detection ---');
  let termUuid = '';
  try {
    const meta = terminalManager.createManagedTerminal('cmd', 'CMD Prompt Test', config.workspaceRoots[0]);
    termUuid = meta.uuid;
    await delay(1000); // Wait for cmd shell window to spawn

    // Initial prompt check
    const detect1 = await engine.detectPrompt(termUuid);
    assert('Prompt output stabilized', detect1.stable);
    assert('Detected prompt matches CMD profile', detect1.matchedProfile === 'cmd');
    assert('Terminal state is Prompt Ready', detect1.state === 'Prompt Ready');
    console.log(`Matched Prompt: "${detect1.matchedPrompt}"`);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Live prompt detection encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 4: REPL Interactive Application Detection
  // ----------------------------------------------------
  console.log('\n--- Testing Interactive REPL App Detection ---');
  try {
    const term = terminalManager.getTerminal(termUuid)!;

    // Type "node" to start Node REPL inside the CMD shell
    console.log('Starting Node REPL inside terminal...');
    await term.write('node');
    await term.sendKey(13, 0); // Enter
    await delay(1500); // Wait for REPL to start

    const replDetect = await engine.detectPrompt(termUuid);
    console.log("REPL Buffer:\n" + JSON.stringify(replDetect.cleanBuffer));
    console.log("REPL Matched profile:", replDetect.matchedProfile, "state:", replDetect.state);
    assert('Detected Node REPL prompt profile', replDetect.matchedProfile === 'node_repl');
    assert('REPL state is Prompt Ready', replDetect.state === 'Prompt Ready');
    console.log(`REPL Prompt: "${replDetect.matchedPrompt}"`);

    // Run a command in Node REPL
    console.log('Sending console.log command in REPL...');
    await term.write('console.log("NodeREPLTest")');
    await term.sendKey(13, 0); // Enter
    await delay(800);

    const replOutput = await engine.detectPrompt(termUuid);
    console.log("REPL Output Buffer:\n" + JSON.stringify(replOutput.cleanBuffer));
    assert('Node REPL stdout printed output', replOutput.cleanBuffer.includes('NodeREPLTest'));

    // Send Ctrl+C twice to exit Node REPL back to CMD
    console.log('Sending Ctrl+C twice to exit REPL...');
    await term.sendKey(67, 8); // Ctrl+C (67 is C, 8 is LEFT_CTRL)
    await delay(200);
    await term.sendKey(67, 8); // Ctrl+C
    await delay(1000);

    const postReplDetect = await engine.detectPrompt(termUuid);
    assert('Returned to CMD prompt profile after exit', postReplDetect.matchedProfile === 'cmd');
    assert('State returned to Prompt Ready', postReplDetect.state === 'Prompt Ready');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Interactive REPL detection encountered error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Timeout and Blocking Commands
  // ----------------------------------------------------
  console.log('\n--- Testing Timeout / Blocked Commands ---');
  try {
    const term = terminalManager.getTerminal(termUuid)!;

    // Send a blocking command ("pause" in CMD)
    console.log('Sending blocking command "pause"...');
    await term.write('pause');
    await term.sendKey(13, 0); // Enter
    await delay(500);

    const pauseDetect = await engine.detectPrompt(termUuid);
    console.log("Pause Buffer:\n" + JSON.stringify(pauseDetect.cleanBuffer));
    console.log("Pause State:", pauseDetect.state);
    assert('Visible buffer contains pause text', pauseDetect.cleanBuffer.includes('Press any key to continue'));
    assert('No prompt matched (state is Waiting)', pauseDetect.state === 'Waiting');

    // Send a key to release the pause command
    console.log('Sending Enter key to release pause...');
    await term.sendKey(13, 0);
    await delay(500);
    
    // Wait for stabilization
    const waitRes = await engine.waitPrompt(termUuid, 5000);
    console.log("Post-pause Buffer:\n" + JSON.stringify(waitRes.cleanBuffer));
    console.log("Post-pause State:", waitRes.state, "matched:", waitRes.matchedProfile);
    assert('Wait prompt blocks until ready', waitRes.state === 'Prompt Ready');
    assert('Wait prompt successfully matched CMD profile', waitRes.matchedProfile === 'cmd');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Timeout/blocking test encountered error:', err);
  }

  // Cleanup
  if (termUuid) {
    terminalManager.closeTerminal(termUuid);
  }

  console.log('\n==================================================');
  console.log(`PROMPT DETECTION TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPromptTests().catch(console.error);
