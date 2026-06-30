import { ConnectorCompatibilityLab } from './ccl';
import { GcacProfile } from './gcac';

async function runCclTests() {
  console.log('==================================================');
  console.log('       MCP CONNECTOR COMPATIBILITY LAB TESTS      ');
  console.log('==================================================\n');

  const lab = new ConnectorCompatibilityLab();

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
  // Test 1: Behavior Profiles Execution
  // ----------------------------------------------------
  console.log('--- Testing Behavior Profiles ---');
  try {
    const traceNormal = await lab.runTest(testProfile, '1.2.0', 'Normal');
    const traceSlow = await lab.runTest(testProfile, '1.2.0', 'Slow');
    const traceCrash = await lab.runTest(testProfile, '1.2.0', 'Crash');

    assert('Normal run executes and prints success buffers', traceNormal.output.includes('successfully'));
    assert('Slow run injects latency thresholds', traceSlow.latencyMs === 500);
    assert('Crash run captures stderr logs', traceCrash.output.includes('Error'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Behaviors test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Regression Detection Checks
  // ----------------------------------------------------
  console.log('\n--- Testing Regression Detection ---');
  try {
    // Current trace has 10x latency compared to normal baseline trace saved in test 1
    const currentTrace = await lab.runTest(testProfile, '1.2.0', 'Slow');
    const regCheck = lab.detectRegressions('claude-code', currentTrace);

    assert('Identifies latency regression deviations', regCheck.regression === true);
    assert('Logs descriptive warning reports list', regCheck.differences.some(d => d.includes('Latency')));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Regressions check test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Certification Matrix Reports
  // ----------------------------------------------------
  console.log('\n--- Testing Certification Matrix ---');
  try {
    const normalTrace = await lab.runTest(testProfile, '1.2.0', 'Normal');
    const slowTrace = await lab.runTest(testProfile, '1.2.0', 'Slow');
    const crashTrace = await lab.runTest(testProfile, '1.2.0', 'Crash');

    const certPass = lab.certify(testProfile, [normalTrace]);
    const certWarn = lab.certify(testProfile, [normalTrace, slowTrace]);
    const certFail = lab.certify(testProfile, [normalTrace, crashTrace]);

    assert('Issues PASS verdict for standard compatible runs', certPass.verdict === 'PASS');
    assert('Issues PASS WITH WARNINGS for high-latency runs', certWarn.verdict === 'PASS_WITH_WARNINGS');
    assert('Issues FAILED verdict for process crash occurrences', certFail.verdict === 'FAILED');

    // Verify matrix update
    const catalog = lab.getMatrixCatalog();
    assert('Auto-populates dynamic compatibility matrix catalog database', catalog.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Certification matrix test error:', err);
  }

  console.log('\n==================================================');
  console.log(`CCL TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCclTests().catch(console.error);
