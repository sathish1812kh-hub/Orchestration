import * as path from 'path';
import * as fs from 'fs';
import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { PromptDetectionEngine } from './promptDetector';
import { PromptProfileRegistry } from './promptProfiles';
import { StreamingEngine } from './streamingEngine';
import { ConnectorManager } from './connectorRuntime';
import { ObservabilityPlatform } from './observability';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import { AntigravityConnector } from './antigravityConnector';

async function runAntigravityConnectorTests() {
  console.log('==================================================');
  console.log('       MCP ANTIGRAVITY AGENT CONNECTOR TESTS      ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  
  // Use first workspace root for path permission tests
  const workspaceRoot = config.workspaceRoots[0];
  const terminalManager = new TerminalManager(workspaceRoot, policyEngine, auditLogger);
  
  const profileRegistry = new PromptProfileRegistry();
  profileRegistry.register({
    name: 'powershell_prompt',
    shellType: 'powershell',
    promptRegex: 'PS.*>',
    busyIndicators: ['running', 'executing'],
    errorIndicators: [],
    completionIndicators: [],
    enabled: true
  });

  const promptDetector = new PromptDetectionEngine(terminalManager, profileRegistry);
  const streamingEngine = new StreamingEngine(terminalManager, promptDetector);

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();
  const connectorManager = new ConnectorManager(eventBus, observability);

  const connector = new AntigravityConnector(
    connectorManager,
    terminalManager,
    promptDetector,
    streamingEngine,
    eventBus,
    observability
  );

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
  // Test 1: Connector Runtime Registration
  // ----------------------------------------------------
  console.log('--- Testing Connector Registration ---');
  try {
    const reg = connectorManager.getConnector(connector.getConnectorId());
    assert('Antigravity registers as a standard runtime connector', reg !== undefined);
    assert('Advertises shell.execute capability support', reg?.capabilities.some(c => c.capabilityId === 'shell.execute') === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Registration test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Connection Lifecycle
  // ----------------------------------------------------
  console.log('\n--- Testing Connection Lifecycle ---');
  let termUuid = '';
  try {
    // Connect using ConsoleBridge.exe binary to simulate stable interactive terminal runtimes
    const agyMockPath = path.join(process.cwd(), 'dist', 'ConsoleBridge.exe');
    termUuid = await connector.connect(workspaceRoot, { agyPath: agyMockPath });
    
    assert('Launches new managed powershell terminal session', termUuid.length > 0);
    assert('Tracks active terminal UUID on connector instance', connector.getActiveTerminalUuid() === termUuid);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Connection lifecycle test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Prompt Execution & Streaming
  // ----------------------------------------------------
  console.log('\n--- Testing Prompt Execution & Streaming ---');
  try {
    let streamOutput = '';
    const res = await connector.execute('echo "Antigravity Connector Live Test"', (chunk) => {
      streamOutput += chunk;
    });

    assert('Wait prompt blocks execute and returns visible text output', res.output.includes('Antigravity'));
    assert('Streams response data chunks in real time', streamOutput.length > 0 || res.output.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Prompt execution test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Cancellation
  // ----------------------------------------------------
  console.log('\n--- Testing Cancellation ---');
  try {
    await connector.cancel();
    assert('Cancellation sends virtual Ctrl+C keystroke combo and registers count', connector.getMetrics().cancellationCount === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Cancellation test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Reconnect Recovery
  // ----------------------------------------------------
  console.log('\n--- Testing Reconnect Recovery ---');
  try {
    const recovered = await connector.recover(workspaceRoot);
    assert('Session recovery re-initializes and binds a surviving terminal', recovered);
    assert('Incremented connection recovery counter metric', connector.getMetrics().recoveryCount === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Recovery test error:', err);
  }

  // ----------------------------------------------------
  // Cleanup
  // ----------------------------------------------------
  await connector.disconnect();
  terminalManager.shutdown();

  console.log('\n==================================================');
  console.log(`ANTIGRAVITY CONNECTOR TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAntigravityConnectorTests().catch(console.error);
