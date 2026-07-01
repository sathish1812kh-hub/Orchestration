import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { GenericCliAiConnector } from './gcac';
import { ConnectorCompatibilityLab } from './ccl';
import { RealConnectorAcceptanceTest } from './rcat';
import { ArchitectureGovernance } from './governance';
import {
  CODEX_CLI_PROFILE,
  negotiateCodexCapabilities,
  validateCodexVersion,
  discoverCodexCliPath
} from './codexProfile';

async function runCodexProfileTests() {
  console.log('==================================================');
  console.log('       MCP CODEX PROFILE & NEGOTIATION TESTS      ');
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
    const discovered = discoverCodexCliPath();
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
    const lowVer = validateCodexVersion('0.7.2');
    const midVer = validateCodexVersion('1.1.0');

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
    const capsV1 = negotiateCodexCapabilities('1.5.0');
    const capsV2 = negotiateCodexCapabilities('2.1.0');

    assert('Baseline version includes core filesystem & review caps', capsV1.some(c => c.capabilityId === 'code.review'));
    assert('Version 2.0+ dynamically negotiates reasoning capabilities', capsV2.some(c => c.capabilityId === 'reasoning'));
    assert('Version 2.0+ dynamically negotiates model finetune capabilities', capsV2.some(c => c.capabilityId === 'model.finetune'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Negotiation test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Profile Driven Connector Spawn & Streams
  // ----------------------------------------------------
  console.log('\n--- Testing Profile Driven Connector Spawn ---');
  try {
    // Override executable with interactive node mock for stable tests execution
    const profileOverride = {
      ...CODEX_CLI_PROFILE,
      executablePath: 'node.exe',
      args: ['-e', '"process.stdout.write(\'codex >>> \'); process.stdin.on(\'data\', d => { process.stdout.write(d.toString() + \'\\ncodex >>> \') })"'],
      promptRegex: 'codex\\s*>>>'
    };

    await connector.initializeGcac(profileOverride, process.cwd());
    const pid = await connector.start();
    assert('Connector spawns cleanly using Codex GcacProfile parameters', pid > 0);

    const output = await connector.execute('Write-Output "LiveTest"', () => {});
    assert('Pipeline captures output prompt matching regex boundary', output.includes('codex >>>'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Spawning simulation error:', err);
  }

  // ----------------------------------------------------
  // Test 5: CCL Integration validation
  // ----------------------------------------------------
  console.log('\n--- Testing Compatibility Lab Validation (CCL) ---');
  try {
    const trace = await lab.runTest(CODEX_CLI_PROFILE, '1.2.0', 'Normal');
    const report = lab.certify(CODEX_CLI_PROFILE, [trace]);
    assert('CCL issues certification verdict for Codex Profile', report.verdict === 'PASS');
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] CCL validation error:', err);
  }

  // ----------------------------------------------------
  // Test 6: RCAT Integration validation
  // ----------------------------------------------------
  console.log('\n--- Testing Real Connector Acceptance Test (RCAT) ---');
  try {
    const report = await rcat.runAcceptance(CODEX_CLI_PROFILE, 'codex.exe', async () => {
      return { startupLatency: 120, executionLatency: 250, success: true };
    });
    assert('RCAT issues Certified verdict for Codex Profile', report.verdict === 'Certified');
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] RCAT validation error:', err);
  }

  // ----------------------------------------------------
  // Test 7: Governance compliance validation
  // ----------------------------------------------------
  console.log('\n--- Testing Governance Validation ---');
  try {
    const res = governance.validateExtensionChange('ConnectorProfiles', 'feature');
    assert('Governance approves Codex configuration profile extension', res.approved === true);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Governance validation error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`CODEX PROFILE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCodexProfileTests().catch(console.error);
