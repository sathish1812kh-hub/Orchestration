import { ArchitectureGovernance, ADR } from './governance';

async function runGovernanceTests() {
  console.log('==================================================');
  console.log('      MCP ARCHITECTURE GOVERNANCE TESTS           ');
  console.log('==================================================\n');

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
  // Test 1: Architecture Decision Records (ADR)
  // ----------------------------------------------------
  console.log('--- Testing Architecture Decision Records (ADRs) ---');
  try {
    const testAdr: ADR = {
      number: 101,
      title: 'Decoupled CLI Profiles',
      author: 'Chief Software Architect',
      date: '2026-07-01',
      status: 'Proposed',
      context: 'Duplicate lifecycle process control was noticed across vendor connectors.',
      decision: 'Migrate vendor connectors to GcacProfiles running over unified IPCR hooks.',
      consequences: 'Improves maintainability. Vendor connectors act as configuration profiles.'
    };

    governance.registerAdr(testAdr);
    assert('Registers new ADR successfully', governance.getAdrs().length === 1);
    assert('Initializes status as Proposed', governance.getAdrs()[0].status === 'Proposed');

    governance.updateAdrStatus(101, 'Accepted');
    assert('Successfully updates ADR status to Accepted', governance.getAdrs()[0].status === 'Accepted');

    let duplicateRejected = false;
    try {
      governance.registerAdr(testAdr);
    } catch (_) {
      duplicateRejected = true;
    }
    assert('Rejects duplicate ADR registration number ID', duplicateRejected);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] ADR tests error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Platform Freeze Policy
  // ----------------------------------------------------
  console.log('\n--- Testing Platform Freeze Policy ---');
  try {
    assert('Platform kernel maps as Frozen component', governance.getComponentStatus('Kernel') === 'Frozen');
    assert('Platform profiles maps as Extensible component', governance.getComponentStatus('ConnectorProfiles') === 'Extensible');

    const frozenBlock = governance.validateExtensionChange('Kernel', 'breaking');
    const extensibleAllow = governance.validateExtensionChange('ConnectorProfiles', 'feature');

    assert('Frozen components block breaking changes proposals', frozenBlock.approved === false);
    assert('Extensible components allow new features proposals', extensibleAllow.approved === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Freeze policy tests error:', err);
  }

  // ----------------------------------------------------
  // Test 3: API Stability Catalog
  // ----------------------------------------------------
  console.log('\n--- Testing API Stability Catalog ---');
  try {
    governance.registerApi({
      apiName: 'PDK_Validator',
      stability: 'Beta',
      version: '1.1.0'
    });

    const catalog = governance.getApiCatalog();
    assert('Tracks dynamic stability tags catalogs', catalog.some(a => a.apiName === 'PDK_Validator' && a.stability === 'Beta'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] API stability tests error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Release Readiness Gates
  // ----------------------------------------------------
  console.log('\n--- Testing Release Readiness Gates ---');
  try {
    const ready = governance.checkReleaseReadiness(true, true, true);
    const notReady = governance.checkReleaseReadiness(false, true, false);

    assert('Approves release readiness when all quality checks pass', ready.ready === true);
    assert('Blocks release readiness when test gates fail', notReady.ready === false);
    assert('Lowers readiness score metrics accordingly', notReady.score === 25); // 100 - 50 (test fail) - 25 (doc missing) = 25

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Release readiness tests error:', err);
  }

  console.log('\n==================================================');
  console.log(`GOVERNANCE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runGovernanceTests().catch(console.error);
