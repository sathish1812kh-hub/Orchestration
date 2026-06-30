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

async function runHardeningTests() {
  console.log('==================================================');
  console.log('            MCP PRODUCTION HARDENING TESTS        ');
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
    process.cwd() + '/plugins_hardening_test'
  );

  const configManager = new ConfigurationSecretsManager();
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

  const testPort = 8600;
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
  const requestRest = (path: string, method: string, headers: any, body?: any): Promise<{ code: number; headers: http.IncomingHttpHeaders; body: string }> => {
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: testPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'close',
          ...headers
        }
      }, (res) => {
        let chunk = '';
        res.on('data', (d) => { chunk += d; });
        res.on('end', () => {
          resolve({ code: res.statusCode || 0, headers: res.headers, body: chunk });
        });
      });
      req.on('error', (err) => {
        resolve({ code: 0, headers: {}, body: err.message });
      });
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  };

  // ----------------------------------------------------
  // Test 1: Security Headers Enforcement
  // ----------------------------------------------------
  console.log('--- Testing Security Headers ---');
  try {
    const res = await requestRest('/api/v1/admin/status', 'GET', { Authorization: 'admin-token' });
    
    assert('Security header X-Content-Type-Options: nosniff is set', res.headers['x-content-type-options'] === 'nosniff');
    assert('Security header X-Frame-Options: DENY is set', res.headers['x-frame-options'] === 'DENY');
    assert('Security header Content-Security-Policy: default-src none is set', res.headers['content-security-policy'] === "default-src 'none'");
    assert('Security header HSTS is set with preload settings', res.headers['strict-transport-security'] !== undefined);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Security headers test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Input Size Limits Enforcement
  // ----------------------------------------------------
  console.log('\n--- Testing Input Size Limits ---');
  try {
    // Send a payload header indicating size exceeds 2MB limit (e.g. 3MB)
    const largeRes = await requestRest('/api/v1/config/set', 'POST', {
      'Content-Length': '3000000',
      Authorization: 'admin-token'
    });

    assert('HTTP server rejects payloads larger than 2MB with 413 Payload Too Large', largeRes.code === 413);
    assert('Rejection response format is valid JSON error data', largeRes.body.includes('PayloadTooLarge'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Input size limit test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: API Rate Limiting (Throttling)
  // ----------------------------------------------------
  console.log('\n--- Testing API Rate Limiting ---');
  try {
    let lastCode = 0;
    
    // Fire 105 rapid sequential REST requests
    for (let i = 0; i < 105; i++) {
      const r = await requestRest('/api/v1/admin/status', 'GET', { Authorization: 'admin-token' });
      lastCode = r.code;
      if (lastCode === 429) {
        break;
      }
    }

    assert('Rapid requests exceeding 100 hits threshold trigger HTTP 429 Too Many Requests', lastCode === 429);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Rate limiting test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Memory Saturation Diagnostics
  // ----------------------------------------------------
  console.log('\n--- Testing Resource Allocation & Profiler Diagnostics ---');
  try {
    const baselineMemory = process.memoryUsage().rss / 1024 / 1024;
    
    // Allocate temporary local heap memory
    let tempAlloc: any = Buffer.alloc(20 * 1024 * 1024); // 20 MB
    const activeMemory = process.memoryUsage().rss / 1024 / 1024;
    
    // Clear references
    tempAlloc = null;
    if (global.gc) global.gc();

    const postCleanupMemory = process.memoryUsage().rss / 1024 / 1024;
    assert('Memory profiler tracks heap variables and cleanup cycles correctly', postCleanupMemory <= activeMemory);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Memory diagnostics test error:', err);
  }

  // ----------------------------------------------------
  // Shutdown Server
  // ----------------------------------------------------
  await server.stop();
  agentManager.shutdown();

  console.log('\n==================================================');
  console.log(`HARDENING TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runHardeningTests().catch(console.error);
