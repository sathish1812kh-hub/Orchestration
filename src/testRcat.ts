import { RealConnectorAcceptanceTest } from './rcat';
import { GcacProfile } from './gcac';

async function runRcatTests() {
  console.log('==================================================');
  console.log('       MCP REAL CONNECTOR ACCEPTANCE TESTS        ');
  console.log('==================================================\n');

  const rcat = new RealConnectorAcceptanceTest();

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

  const testProfile: GcacProfile = {
    name: 'claude-code',
    executablePath: 'claude.cmd',
    args: [],
    versionCommand: '',
    promptRegex: 'Ready',
    completionStrategy: 'regex',
    capabilities: []
  };

  // ----------------------------------------------------
  // Test 1: Binary Discovery Scanner
  // ----------------------------------------------------
  console.log('--- Testing Executable Discovery ---');
  try {
    const discovered = rcat.discoverExecutable('claude-code');
    assert('Scans paths directories returning valid file name', discovered.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Scan test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Launch Traits Validations
  // ----------------------------------------------------
  console.log('\n--- Testing Launch Validation ---');
  try {
    const info = rcat.validateBinaryProperties('claude.cmd');
    assert('Asserts launcher validity successfully', info.valid === true);
    assert('Reads default output version tag', info.version === '1.2.0');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Validation test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Acceptance Run & Certify
  // ----------------------------------------------------
  console.log('\n--- Testing Acceptance Run & Certify ---');
  try {
    const report = await rcat.runAcceptance(testProfile, 'claude.cmd', async () => {
      return { startupLatency: 90, executionLatency: 150, success: true };
    });

    assert('Issues Certified status verdict report for passing runs', report.verdict === 'Certified');
    assert('Benchmarks process startup latency correctly', report.benchmarks.startupLatencyMs === 90);
    assert('Records host environment descriptors', report.environment.os === process.platform);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Acceptance test error:', err);
  }

  console.log('\n==================================================');
  console.log(`RCAT TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRcatTests().catch(console.error);
