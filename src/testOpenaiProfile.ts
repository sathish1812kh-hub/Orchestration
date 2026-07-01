import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { GenericCliAiConnector } from './gcac';
import { ConnectorCompatibilityLab } from './ccl';
import { RealConnectorAcceptanceTest } from './rcat';
import { ArchitectureGovernance } from './governance';
import {
  OPENAI_CLI_PROFILE,
  negotiateOpenaiCapabilities,
  validateOpenaiVersion,
  discoverOpenaiCliPath
} from './openaiProfile';
import { CODEX_CLI_PROFILE } from './codexProfile';
import { GEMINI_CLI_PROFILE } from './geminiProfile';

async function runOpenaiProfileTests() {
  console.log('==================================================');
  console.log('      MCP OPENAI-COMPATIBLE PROFILE TESTS         ');
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
    const discovered = discoverOpenaiCliPath();
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
    const lowVer = validateOpenaiVersion('0.9.1');
    const midVer = validateOpenaiVersion('1.4.0');

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
    const capsV1 = negotiateOpenaiCapabilities('1.5.0');
    const capsV2 = negotiateOpenaiCapabilities('2.0.0');

    assert('Baseline version includes core filesystem & reasoning caps', capsV1.some(c => c.capabilityId === 'reasoning'));
    assert('Version 2.0+ dynamically negotiates real-time reasoning capabilities', capsV2.some(c => c.capabilityId === 'reasoning.realtime'));
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
      ...OPENAI_CLI_PROFILE,
      executablePath: 'node.exe',
      args: ['-e', '"process.stdout.write(\'openai >>> \'); process.stdin.on(\'data\', d => { process.stdout.write(d.toString() + \'\\nopenai >>> \') })"'],
      promptRegex: 'openai\\s*>>>'
    };

    await connector.initializeGcac(profileOverride, process.cwd());
    const pid = await connector.start();
    assert('Connector spawns cleanly using OpenAI GcacProfile parameters', pid > 0);

    const output = await connector.execute('Write-Output "LiveTest"', () => {});
    assert('Pipeline captures output prompt matching regex boundary', output.includes('openai >>>'));

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
    assert('All use the standardized regex completion strategy',
      CODEX_CLI_PROFILE.completionStrategy === GEMINI_CLI_PROFILE.completionStrategy &&
      GEMINI_CLI_PROFILE.completionStrategy === OPENAI_CLI_PROFILE.completionStrategy
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
    const trace = await lab.runTest(OPENAI_CLI_PROFILE, '1.4.0', 'Normal');
    const reportCcl = lab.certify(OPENAI_CLI_PROFILE, [trace]);
    const reportRcat = await rcat.runAcceptance(OPENAI_CLI_PROFILE, 'openai.exe', async () => {
      return { startupLatency: 60, executionLatency: 90, success: true };
    });
    const gov = governance.validateExtensionChange('ConnectorProfiles', 'feature');

    assert('CCL certifies OpenAI Profile with PASS', reportCcl.verdict === 'PASS');
    assert('RCAT certifies OpenAI Profile with Certified status', reportRcat.verdict === 'Certified');
    assert('AGF approves configuration profile extension', gov.approved === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Compliance gates error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`OPENAI PROFILE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runOpenaiProfileTests().catch(console.error);
