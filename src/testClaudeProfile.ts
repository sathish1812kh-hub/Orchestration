import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { GenericCliAiConnector } from './gcac';
import {
  CLAUDE_CODE_PROFILE,
  negotiateCapabilities,
  validateVersionCompatibility,
  discoverClaudeCodePath
} from './claudeProfile';

async function runClaudeProfileTests() {
  console.log('==================================================');
  console.log('      MCP CLAUDE PROFILE & NEGOTIATION TESTS      ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const connector = new GenericCliAiConnector(eventBus, observability);

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
  // Test 1: Executable Path Discovery
  // ----------------------------------------------------
  console.log('--- Testing Executable Discovery ---');
  try {
    const discovered = discoverClaudeCodePath();
    assert('Locates or falls back to standard launch name', discovered.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Discovery test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Version Validation
  // ----------------------------------------------------
  console.log('\n--- Testing Version Validation ---');
  try {
    const lowVer = validateVersionCompatibility('0.7.2');
    const midVer = validateVersionCompatibility('1.1.0');

    assert('Flags pre-release versions below 1.0.0 as incompatible', lowVer.compatible === false);
    assert('Approves release versions 1.x as compatible', midVer.compatible === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Version check test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Dynamic Capability Negotiation
  // ----------------------------------------------------
  console.log('\n--- Testing Capability Negotiation ---');
  try {
    const capsV1 = negotiateCapabilities('1.5.0');
    const capsV2 = negotiateCapabilities('2.1.0');

    assert('Baseline version includes core filesystem & review caps', capsV1.some(c => c.capabilityId === 'code.review'));
    assert('Version 2.0+ dynamically negotiates reasoning capabilities', capsV2.some(c => c.capabilityId === 'reasoning'));
    assert('Version 2.0+ dynamically negotiates conversation resume capabilities', capsV2.some(c => c.capabilityId === 'conversation.resume'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Negotiation test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Profile Driven Execution Simulation
  // ----------------------------------------------------
  console.log('\n--- Testing Profile Driven Connector Spawn ---');
  try {
    // Override executable with interactive node mock for stable tests execution
    const profileOverride = {
      ...CLAUDE_CODE_PROFILE,
      executablePath: 'node.exe',
      args: ['-e', '"process.stdout.write(\'claude > \'); process.stdin.on(\'data\', d => { process.stdout.write(d.toString() + \'\\nclaude > \') })"'],
      promptRegex: 'claude\\s*>'
    };

    await connector.initializeGcac(profileOverride, process.cwd());
    const pid = await connector.start();
    assert('Connector spawns cleanly using Claude GcacProfile parameters', pid > 0);

    const output = await connector.execute('Write-Output "LiveTest"', () => {});
    assert('Pipeline captures output prompt matching regex boundary', output.includes('claude >'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Spawning simulation error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`CLAUDE PROFILE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runClaudeProfileTests().catch(console.error);
