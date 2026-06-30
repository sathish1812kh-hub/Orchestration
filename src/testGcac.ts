import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { GenericCliAiConnector, GcacProfile } from './gcac';

async function runGcacTests() {
  console.log('==================================================');
  console.log('      MCP GENERIC CLI AI CONNECTOR TESTS          ');
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
  // Test 1: Dynamic Profile Loading
  // ----------------------------------------------------
  console.log('--- Testing Profile Loading ---');
  const mockProfile: GcacProfile = {
    name: 'claude-code-mock',
    executablePath: 'powershell.exe',
    args: ['-NoLogo', '-NonInteractive', '-Command', '"Write-Output Ready; while($true) { Start-Sleep 1 }"'],
    versionCommand: 'powershell -Version',
    promptRegex: 'Ready',
    completionStrategy: 'regex',
    capabilities: [
      { capabilityId: 'code.generate', version: '1.2.0' },
      { capabilityId: 'reasoning', version: '2.0.0' }
    ],
    thinkingMarker: '<thinking>.*</thinking>',
    errorMarker: 'Error:.*'
  };

  try {
    connector.loadProfile(mockProfile);
    assert('Correctly loads custom profile definitions', connector.getProfile()?.name === 'claude-code-mock');
    assert('Exposes dynamic capability configurations', connector.capabilities().some(c => c.capabilityId === 'reasoning'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Profile load test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Subclass Pipeline Execution & Stream Parsers
  // ----------------------------------------------------
  console.log('\n--- Testing Pipeline Execution & Stream Parsers ---');
  try {
    await connector.initializeGcac(mockProfile, process.cwd());
    const pid = await connector.start();

    assert('Launches processes using profile parameters', pid !== undefined && pid > 0);

    let streamResult = '';
    const res = await connector.execute('Write-Output "Ping"', (chunk) => {
      streamResult += chunk;
    });

    assert('Completion strategy matches profile regex bounds', res.includes('Ready'));
    assert('Output filters work cleanly', streamResult.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Execution test error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`GCAC TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runGcacTests().catch(console.error);
