import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { ConnectorManager } from './connectorRuntime';
import { ConnectorValidator } from './connectorValidator';

async function runConnectorValidatorTests() {
  console.log('==================================================');
  console.log('      MCP CONNECTOR VALIDATION RUNNER TESTS       ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();
  const connectorManager = new ConnectorManager(eventBus, observability);

  const validator = new ConnectorValidator(connectorManager);

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
  // Test 1: Certification Run against Registered Connector
  // ----------------------------------------------------
  console.log('--- Testing Successful Certification Run ---');
  try {
    // Register mock connector
    connectorManager.register({
      connectorId: 'gemini-connector',
      name: 'Gemini Agent Connector',
      version: '1.0.0',
      vendor: 'Google',
      capabilities: [{ capabilityId: 'code.generate', version: '1.0.0' }],
      transports: ['stdio', 'http']
    });

    const report = await validator.certify('gemini-connector', async () => {
      return {
        connectionLatency: 120,
        executionLatency: 350,
        streamCount: 15
      };
    });

    assert('Verification result returns passing verdict PASS', report.verdict === 'PASS');
    assert('Computes compliance score correctly (100%)', report.scores.compliance === 100);
    assert('Computes performance score correctly (100%)', report.scores.performance === 100);
    assert('Records performance latency metrics', report.metrics.connectionLatencyMs === 120);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Certification test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Failure Verdict on Latency Violations
  // ----------------------------------------------------
  console.log('\n--- Testing Fault / Latency Violations ---');
  try {
    const report = await validator.certify('gemini-connector', async () => {
      return {
        connectionLatency: 3000, // Violates <2000ms threshold
        executionLatency: 150,
        streamCount: 2
      };
    });

    assert('Validation flags latency threshold breaches as FAIL', report.verdict === 'FAIL');
    assert('Lowers performance score indicator accordingly (50%)', report.scores.performance === 50);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Fault check test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: History & Compliance Logs
  // ----------------------------------------------------
  console.log('\n--- Testing Validation Logs & History ---');
  try {
    const history = validator.getHistory();
    assert('Stores completed runs in certification history list', history.length === 2);
    assert('Historian contains valid compliance details', history[0].checks.some(c => c.name.includes('Capability')));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] History test error:', err);
  }

  console.log('\n==================================================');
  console.log(`VALIDATOR TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runConnectorValidatorTests().catch(console.error);
