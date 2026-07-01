import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { GenericCliAiConnector } from './gcac';
import { ConnectorCompatibilityLab } from './ccl';
import { RealConnectorAcceptanceTest } from './rcat';
import { ArchitectureGovernance } from './governance';
import {
  QWEN_CLI_PROFILE,
  negotiateQwenCapabilities,
  validateQwenVersion,
  discoverQwenCliPath
} from './qwenProfile';
import { CODEX_CLI_PROFILE } from './codexProfile';
import { GEMINI_CLI_PROFILE } from './geminiProfile';
import { OPENAI_CLI_PROFILE } from './openaiProfile';

async function runQwenProfileTests() {
  console.log('==================================================');
  console.log('      MCP QWEN PROFILE & ZERO-KERNEL TESTS        ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const connector = new GenericCliAiConnector(eventBus, observability);
  const lab = new ConnectorCompatibilityLab();
  const rcat = new RealConnectorAcceptanceTest();
  const governance = new ArchitectureGovernance();

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
    const discovered = discoverQwenCliPath();
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
    const lowVer = validateQwenVersion('0.9.1');
    const midVer = validateQwenVersion('1.4.0');

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
    const capsV1 = negotiateQwenCapabilities('1.5.0');
    const capsV2 = negotiateQwenCapabilities('2.0.0');

    assert('Baseline version includes core filesystem & reasoning caps', capsV1.some(c => c.capabilityId === 'reasoning'));
    assert('Version 2.0+ dynamically negotiates multimodal capabilities', capsV2.some(c => c.capabilityId === 'multimodal'));
    assert('Version 2.0+ dynamically negotiates agent functioncall capabilities', capsV2.some(c => c.capabilityId === 'agent.functioncall'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Negotiation test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Profile Driven Connector Spawn
  // ----------------------------------------------------
  console.log('\n--- Testing Profile Driven Connector Spawn ---');
  try {
    // Override executable with interactive node mock for stable tests execution
    const profileOverride = {
      ...QWEN_CLI_PROFILE,
      executablePath: 'node.exe',
      args: ['-e', '"process.stdout.write(\'qwen >>> \'); process.stdin.on(\'data\', d => { process.stdout.write(d.toString() + \'\\nqwen >>> \') })"'],
      promptRegex: 'qwen\\s*>>>'
    };

    await connector.initializeGcac(profileOverride, process.cwd());
    const pid = await connector.start();
    assert('Connector spawns cleanly using Qwen GcacProfile parameters', pid > 0);

    const output = await connector.execute('Write-Output "LiveTest"', () => {});
    assert('Pipeline captures output prompt matching regex boundary', output.includes('qwen >>>'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Spawning simulation error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Cross-Profile Equivalence Checks
  // ----------------------------------------------------
  console.log('\n--- Testing Cross-Profile Equivalence ---');
  try {
    // Assert structural equivalence of profiles schemas
    assert('Codex profile name is correct', CODEX_CLI_PROFILE.name === 'codex-cli');
    assert('Gemini profile name is correct', GEMINI_CLI_PROFILE.name === 'gemini-cli');
    assert('OpenAI profile name is correct', OPENAI_CLI_PROFILE.name === 'openai-cli');
    assert('Qwen profile name is correct', QWEN_CLI_PROFILE.name === 'qwen-cli');
    assert('All use the standardized regex completion strategy',
      CODEX_CLI_PROFILE.completionStrategy === GEMINI_CLI_PROFILE.completionStrategy &&
      GEMINI_CLI_PROFILE.completionStrategy === OPENAI_CLI_PROFILE.completionStrategy &&
      OPENAI_CLI_PROFILE.completionStrategy === QWEN_CLI_PROFILE.completionStrategy
    );

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Equivalence check error:', err);
  }

  // ----------------------------------------------------
  // Test 6: CCL / RCAT / Governance Gates
  // ----------------------------------------------------
  console.log('\n--- Testing Certification Compliance Gates ---');
  try {
    const trace = await lab.runTest(QWEN_CLI_PROFILE, '1.4.0', 'Normal');
    const reportCcl = lab.certify(QWEN_CLI_PROFILE, [trace]);
    const reportRcat = await rcat.runAcceptance(QWEN_CLI_PROFILE, 'qwen.exe', async () => {
      return { startupLatency: 60, executionLatency: 90, success: true };
    });
    const gov = governance.validateExtensionChange('ConnectorProfiles', 'feature');

    assert('CCL certifies Qwen Profile with PASS', reportCcl.verdict === 'PASS');
    assert('RCAT certifies Qwen Profile with Certified status', reportRcat.verdict === 'Certified');
    assert('AGF approves configuration profile extension', gov.approved === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Compliance gates error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`QWEN PROFILE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runQwenProfileTests().catch(console.error);
