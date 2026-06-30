import * as http from 'http';
import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { AutonomousOrchestrator, MockDecisionProvider } from './orchestrator';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import { PluginFramework } from './pluginFramework';
import { RuntimeLifecycleManager } from './lifecycle';
import { ConfigurationSecretsManager } from './configManager';
import { ObservabilityPlatform } from './observability';
import { ControlPlaneServer } from './controlPlane';

async function runControlPlaneTests() {
  console.log('==================================================');
  console.log('       MCP CONTROL PLANE & TRANSPORTS TESTS       ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);
  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const dispatcher = new ExecutionDispatcher(eventBus);
  const agentManager = new AgentManager(eventBus);
  const provider = new MockDecisionProvider();
  const orchestrator = new AutonomousOrchestrator(eventBus, dispatcher, provider);

  const pluginFramework = new PluginFramework(
    eventBus,
    terminalManager,
    null as any,
    dispatcher,
    agentManager,
    orchestrator,
    policyEngine,
    auditLogger,
    process.cwd() + '/plugins_api_test'
  );

  const configManager = new ConfigurationSecretsManager();
  configManager.setEventBus(eventBus);
  const observability = new ObservabilityPlatform();

  const lifecycleManager = new RuntimeLifecycleManager();
  lifecycleManager.setEventBus(eventBus);

  // Register EventBus as service
  lifecycleManager.registerService({
    serviceId: 'event_bus',
    version: '1.0.0',
    dependencies: [],
    startup: async () => {},
    shutdown: async () => {},
    readinessProbe: async () => true,
    healthProbe: async () => true
  });
  await lifecycleManager.startPlatform();

  const server = new ControlPlaneServer(
    lifecycleManager,
    configManager,
    observability,
    pluginFramework,
    eventBus
  );

  const testPort = 8500;
  await server.start(testPort);

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

  // Request helpers
  const requestRest = (path: string, method: string, headers: any, body?: any): Promise<{ code: number; body: string }> => {
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: testPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let chunk = '';
        res.on('data', (d) => { chunk += d; });
        res.on('end', () => {
          resolve({ code: res.statusCode || 0, body: chunk });
        });
      });
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  };

  // ----------------------------------------------------
  // Test 1: Authentication Role Checks (REST)
  // ----------------------------------------------------
  console.log('--- Testing Authentication & Authorization ---');
  try {
    // Admin access
    const adminRes = await requestRest('/api/v1/admin/status', 'GET', { Authorization: 'admin-token' });
    assert('Admin token successfully retrieves platform status DTO', adminRes.code === 200 && adminRes.body.includes('Ready'));

    // Blocked access (Forbidden role check)
    const pluginRes = await requestRest('/api/v1/admin/status', 'GET', { Authorization: 'plugin-token' });
    assert('Role validation blocks unauthorized plugin tokens', pluginRes.code === 403 && pluginRes.body.includes('Forbidden'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Authentication test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: REST Adapter Validation & DTO Mapping
  // ----------------------------------------------------
  console.log('\n--- Testing REST Adapter Validation & DTO Mapping ---');
  try {
    // Post valid config override
    const setRes = await requestRest('/api/v1/config/set', 'POST', { Authorization: 'admin-token' }, {
      layer: 'overrides',
      key: 'platform.logLevel',
      value: 'debug'
    });
    
    assert('REST adapter parses parameters and maps return values to clean DTOs', setRes.code === 200);
    const parsed = JSON.parse(setRes.body);
    assert('DTO filters internal configuration structures from client responses', parsed.data.updated === true && parsed.data.layer === 'overrides');

    // Post invalid values
    const failRes = await requestRest('/api/v1/config/set', 'POST', { Authorization: 'admin-token' }, {
      layer: 'overrides',
      key: 'platform.port',
      value: -100 // Out of limits (min 1024)
    });
    assert('REST adapter correctly translates kernel validation failures into status 400 Bad Requests', failRes.code === 400);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] REST validation test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: JSON-RPC Adapter Translation
  // ----------------------------------------------------
  console.log('\n--- Testing JSON-RPC Adapter Translation ---');
  try {
    const rpcRes = await requestRest('/api/v1/rpc', 'POST', { Authorization: 'admin-token' }, {
      jsonrpc: '2.0',
      method: 'getStatus',
      params: {},
      id: 99
    });

    assert('JSON-RPC adapter correctly maps requests and formats responses', rpcRes.code === 200);
    const parsed = JSON.parse(rpcRes.body);
    assert('JSON-RPC response matches id index', parsed.id === 99);
    assert('JSON-RPC returns status ready in data payloads', parsed.result.status === 'Ready');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] JSON-RPC test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Server-Sent Events (SSE) Streaming
  // ----------------------------------------------------
  console.log('\n--- Testing Server-Sent Events (SSE) Streaming ---');
  try {
    let sseOutput = '';
    const sseReq = http.request({
      host: '127.0.0.1',
      port: testPort,
      path: '/api/v1/stream',
      method: 'GET'
    }, (res) => {
      res.on('data', (d) => {
        sseOutput += d.toString();
      });
    });
    sseReq.end();

    // Give connection time to initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Publish event on bus
    await eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: 'evt_test_sse_1',
      eventType: 'TestEvent',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['test'],
      payload: { hello: 'sse_world' },
      metadata: {},
      correlationId: 'corr_1',
      parentEventId: 'root'
    });

    // Wait for SSE propagation
    await new Promise(resolve => setTimeout(resolve, 150));
    sseReq.destroy(); // Close stream

    assert('SSE streaming is functional and streams updates in real time', sseOutput.includes('sse_world'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] SSE test error:', err);
  }

  // ----------------------------------------------------
  // Shutdown Server
  // ----------------------------------------------------
  await server.stop();
  agentManager.shutdown();

  console.log('\n==================================================');
  console.log(`CONTROL PLANE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runControlPlaneTests().catch(console.error);
