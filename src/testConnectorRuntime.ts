import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { ConnectorManager, ConnectorDescriptor } from './connectorRuntime';

async function runConnectorRuntimeTests() {
  console.log('==================================================');
  console.log('        MCP UNIVERSAL CONNECTOR RUNTIME TESTS     ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();

  const manager = new ConnectorManager(eventBus, observability);

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
  // Test 1: Connector Registration & Discovery
  // ----------------------------------------------------
  console.log('--- Testing Registration & Statuses ---');
  let mockConn: ConnectorDescriptor;
  try {
    mockConn = manager.register({
      connectorId: 'claude-connector',
      name: 'Claude Code Connector',
      version: '1.0.0',
      vendor: 'Anthropic',
      capabilities: [{ capabilityId: 'shell.execute', version: '1.0.0' }],
      transports: ['stdio']
    });

    assert('Connector successfully registered with metadata', mockConn.connectorId === 'claude-connector');
    assert('Default lifecycle status is Registered', mockConn.status === 'Registered');
    assert('Connector list includes registered adapter', manager.listConnectors().length === 1);

    // Enable / disable
    manager.disable('claude-connector');
    assert('Connector disable status updates correctly', manager.getConnector('claude-connector')?.enabled === false);
    manager.enable('claude-connector');
    assert('Connector enable status updates correctly', manager.getConnector('claude-connector')?.enabled === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Registration test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Session Management
  // ----------------------------------------------------
  console.log('\n--- Testing Session Runtime ---');
  let session: any;
  try {
    session = manager.createSession('claude-connector');
    assert('Created unique session identifier', session.sessionId.startsWith('sess_'));
    assert('Session status defaults to Active', session.status === 'Active');
    assert('Session registry lists active channel', manager.listSessions().length === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Session test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Execution Pipeline & Retry Engine
  // ----------------------------------------------------
  console.log('\n--- Testing Execution Pipeline & Retry Engine ---');
  try {
    let callCounter = 0;
    const mockVendorExecute = async (ctx: any, onStream: (msg: string) => void) => {
      callCounter++;
      // Stream some progress chunks
      onStream(`Executing: chunk_${callCounter}_a`);
      onStream(`Executing: chunk_${callCounter}_b`);

      if (callCounter < 3) {
        throw new Error('Temporary Network Outage');
      }
      return { output: 'Success after retries!' };
    };

    // Trigger execution
    const result = await manager.executePipeline(
      'claude-connector',
      session.sessionId,
      {
        prompt: 'echo "hello"',
        files: [],
        workspaceRoot: process.cwd()
      },
      mockVendorExecute
    );

    assert('Pipeline execution wraps retries and returns successfully', result.output === 'Success after retries!');
    assert('Exponential backoff triggered retries successfully (called 3 times)', callCounter === 3);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Execution pipeline test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Heartbeats & Recovery
  // ----------------------------------------------------
  console.log('\n--- Testing Heartbeats & Recovery ---');
  try {
    const recoverResult = manager.triggerRecovery('claude-connector', session.sessionId);
    assert('Manual session recovery trigger initialized successfully', recoverResult === true);
    assert('Connector status transitions to Recovering', manager.getConnector('claude-connector')?.status === 'Recovering');

    // Wait for mock recovery timer
    await new Promise(resolve => setTimeout(resolve, 150));
    assert('Connector status recovers to Ready', manager.getConnector('claude-connector')?.status === 'Ready');
    assert('Session state restores to Active', manager.getSession(session.sessionId)?.status === 'Active');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Recovery test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Observability Telemetry
  // ----------------------------------------------------
  console.log('\n--- Testing Observability Telemetry ---');
  try {
    const metrics = manager.getRuntimeMetrics();
    assert('Metrics count tracking records total executions', metrics.totalExecutions === 1);
    assert('Metrics count tracking records streamed chunks', metrics.streamedMessagesCount === 6); // 2 streams * 3 execution attempts
    assert('Metrics count tracking records reconnect attempts', metrics.reconnects === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Observability test error:', err);
  }

  console.log('\n==================================================');
  console.log(`CONNECTOR RUNTIME TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runConnectorRuntimeTests().catch(console.error);
