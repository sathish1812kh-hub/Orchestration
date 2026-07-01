import { UniversalConnectorCertification } from './uccf';

async function runUccfTests() {
  console.log('==================================================');
  console.log('      MCP UNIVERSAL CERTIFICATION TESTS           ');
  console.log('==================================================\n');

  const uccf = new UniversalConnectorCertification();

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
  // Test 1: Connector Discovery
  // ----------------------------------------------------
  console.log('--- Testing Connector Discovery ---');
  try {
    const list = uccf.listRegisteredProfiles();
    assert('Discovers all 5 production profiles', list.length === 5);
    assert('Includes Claude Code profile', list.includes('claude-code'));
    assert('Includes Codex CLI profile', list.includes('codex-cli'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Discovery test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Lifecycle & Scorecard Certification
  // ----------------------------------------------------
  console.log('\n--- Testing Certification & Scorecards ---');
  try {
    const mockProfile = { name: 'claude-code' } as any;
    const certPass = uccf.runCertification(mockProfile, 100, false);
    const certWarn = uccf.runCertification(mockProfile, 300, false);
    const certFail = uccf.runCertification(mockProfile, 100, true);

    assert('Issues CERTIFIED status verdict scorecard for standard compatible runs', certPass.verdict === 'CERTIFIED');
    assert('Issues CERTIFIED WITH WARNINGS status scorecard for high-latency runs', certWarn.verdict === 'CERTIFIED_WITH_WARNINGS');
    assert('Issues NOT CERTIFIED status scorecard for process crash events', certFail.verdict === 'NOT_CERTIFIED');

    assert('Documents passing checklist properties', certPass.checksPassed.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Certification test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Cross-Connector Equivalence Matrices
  // ----------------------------------------------------
  console.log('\n--- Testing Cross-Connector Equivalence Matrix ---');
  try {
    const matrix = uccf.generateEquivalenceMatrix();
    assert('Generates equivalence comparative data charts', matrix.length > 0);
    assert('Confirms lifecycle compliance properties match', matrix.some(m => m.feature === 'Lifecycle management' && m.claude && m.gemini));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Matrix check error:', err);
  }

  console.log('\n==================================================');
  console.log(`UCCF TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runUccfTests().catch(console.error);
