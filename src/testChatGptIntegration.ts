import { EventBus, MemoryStorageProvider } from './eventBus';
import { ObservabilityPlatform } from './observability';
import { CloudExecutionGateway } from './cegrf';
import { PlatformBootstrap } from './bootstrap';
import * as http from 'http';

async function runChatGptIntegrationTests() {
  console.log('==================================================');
  console.log('      CHATGPT MCP LIVE INTEGRATION TESTS          ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const observability = new ObservabilityPlatform();
  const cegrf = new CloudExecutionGateway(eventBus, observability);
  const bootstrap = new PlatformBootstrap();

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
  // Test 1: MCP Handshake & Protocol Negotiation Simulation
  // ----------------------------------------------------
  console.log('--- Testing MCP Discovery Handshake ---');
  try {
    await bootstrap.start();
    
    // Validate HTTP POST for JSON-RPC
    await new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '1.0.0', capabilities: {} },
        id: 1
      });

      const req = http.request({
        host: '127.0.0.1',
        port: bootstrap.port,
        path: '/api/v1/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert('MCP Server-Sent RPC negotiates successfully', body.jsonrpc === '2.0' && body.result === 'OK');
          resolve();
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] MCP Handshake test failed:', err);
  }

  // ----------------------------------------------------
  // Test 2: SSE Stream Connection Verify
  // ----------------------------------------------------
  console.log('\n--- Testing SSE Stream Connection ---');
  try {
    await new Promise<void>((resolve, reject) => {
      http.get(`http://127.0.0.1:${bootstrap.port}/api/v1/stream`, (res) => {
        res.on('data', (chunk) => {
          const lines = chunk.toString().trim();
          assert('SSE stream connection established with ChatGPT active frame', lines.includes('connected'));
          res.destroy(); // Gracefully disconnect
          resolve();
        });
      }).on('error', reject);
    });

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] SSE Stream connection failed:', err);
  }

  // ----------------------------------------------------
  // Test 3: Local Connectors Discovery
  // ----------------------------------------------------
  console.log('\n--- Testing Connectors Status Check ---');
  try {
    cegrf.registerRemoteCluster({
      clusterId: 'claude-node',
      gatewayUrl: 'https://claude.gateway',
      state: 'Active',
      capabilities: ['code.generate'],
      latencyMs: 30
    });
    
    assert('Correctly registers and discovers local target capabilities', cegrf.getClustersList().length === 1);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Connectors status check failed:', err);
  }

  // ----------------------------------------------------
  // Shutdown
  // ----------------------------------------------------
  await bootstrap.stop();
  assert('Gracefully shuts down bootstrap server routes after validation', bootstrap.state === 'Stopped');

  console.log('\n==================================================');
  console.log(`CHATGPT MCP INTEGRATION TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runChatGptIntegrationTests().catch(console.error);
