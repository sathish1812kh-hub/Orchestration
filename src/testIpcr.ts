import * as path from 'path';
import * as fs from 'fs';
import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { InteractiveProcessConnector } from './ipcr';

class TestCliConnector extends InteractiveProcessConnector {
  protected parseBanner(banner: string): void {}
  protected filterOutput(chunk: string): string {
    return chunk;
  }
  protected detectError(chunk: string): string | null {
    if (chunk.toLowerCase().includes('error') || chunk.toLowerCase().includes('fail')) {
      return chunk;
    }
    return null;
  }
}

async function runIpcrTests() {
  console.log('==================================================');
  console.log('      MCP INTERACTIVE PROCESS CONNECTOR TESTS      ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const connector = new TestCliConnector(eventBus, observability);

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
  // Test 1: Process Lifecycle Initialization & Spawning
  // ----------------------------------------------------
  console.log('--- Testing Process Spawning ---');
  try {
    await connector.initialize({
      executablePath: 'powershell.exe',
      args: ['-NoLogo', '-NonInteractive', '-Command', '"Write-Output Ready; while($true) { Start-Sleep 1 }"'],
      cwd: process.cwd(),
      completionStrategy: 'regex',
      completionPattern: 'Ready',
      timeoutMs: 3000
    });

    const pid = await connector.start();
    assert('Successfully spawned interactive powershell process', pid !== undefined && pid > 0);
    assert('Records active PID on runtime reference', connector.getPid() === pid);
    assert('Records process session identification token', connector.getSessionId() !== undefined);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Spawning test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Pipeline Execution & Pluggable Completion
  // ----------------------------------------------------
  console.log('\n--- Testing Pipeline Execution & Completion Strategies ---');
  try {
    let streamCount = 0;
    const output = await connector.execute('Write-Output "PingTest"', (chunk) => {
      streamCount++;
    });

    assert('Completion detection matches regex prompt indicator', output.includes('Ready'));
    assert('Outputs stream callbacks correctly', streamCount > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Execution test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Process Attachment & Recovery
  // ----------------------------------------------------
  console.log('\n--- Testing Process Attachment & Recovery ---');
  try {
    const activePid = connector.getPid();
    if (activePid) {
      const attached = await connector.reconnect(activePid);
      assert('Reattaches cleanly to active surviving process PID', attached);
      assert('Audit metrics log connection recovery attempts', connector.getMetrics().recoveryCount === 1);
    } else {
      failCount++;
      console.error('[FAIL] Missing active PID for recovery test');
    }

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Attachment test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Cancellation SIGINT Signals
  // ----------------------------------------------------
  console.log('\n--- Testing Cancellation SIGINT Signals ---');
  try {
    await connector.cancel();
    assert('Sends SIGINT process signals and updates metrics logs', connector.getMetrics().cancellationCount === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Cancellation test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Observability Telemetry
  // ----------------------------------------------------
  console.log('\n--- Testing Observability Telemetry ---');
  try {
    const metrics = connector.getMetrics();
    assert('Tracks stdout processing volumes in bytes', metrics.stdoutVolumeBytes > 0);
    assert('Tracks execution latency indicators', metrics.executionLatencyMs > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Observability test error:', err);
  }

  // Cleanup
  await connector.shutdown();

  console.log('\n==================================================');
  console.log(`IPCR TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runIpcrTests().catch(console.error);
