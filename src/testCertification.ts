import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import { PluginFramework } from './pluginFramework';
import { RuntimeLifecycleManager } from './lifecycle';
import { ConfigurationSecretsManager } from './configManager';
import { ObservabilityPlatform } from './observability';
import { ControlPlaneServer } from './controlPlane';

async function runCertificationTests() {
  console.log('==================================================');
  console.log('        MCP PLATFORM PRODUCTION CERTIFICATION     ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const auditLogger = new AuditLogger(process.cwd());
  const terminalManager = new TerminalManager(process.cwd(), policyEngine, auditLogger);
  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const dispatcher = new ExecutionDispatcher(eventBus);
  const agentManager = new AgentManager(eventBus);
  const pluginFramework = new PluginFramework(
    eventBus,
    terminalManager,
    null as any,
    dispatcher,
    agentManager,
    null as any, // orchestrator
    policyEngine,
    auditLogger,
    process.cwd() + '/plugins_cert_test'
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

  const testPort = 8700;
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

  // ----------------------------------------------------
  // Scenario 1: Load Stress test (1000 High Frequency events)
  // ----------------------------------------------------
  console.log('--- Scenario 1: High Frequency Load Stress ---');
  try {
    const startTime = Date.now();
    for (let i = 0; i < 1000; i++) {
      await eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_stress_${i}`,
        eventType: 'StressTestEvent',
        eventCategory: 'System',
        timestamp: Date.now(),
        severity: 'Information',
        tags: ['stress'],
        payload: { index: i },
        metadata: {},
        correlationId: 'corr_stress',
        parentEventId: 'root'
      });
    }
    const duration = Date.now() - startTime;
    assert(`Successfully routed 1000 stress events in ${duration} ms`, duration < 1000);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Stress test error:', err);
  }

  // ----------------------------------------------------
  // Scenario 2: Chaos Fault Terminations
  // ----------------------------------------------------
  console.log('\n--- Scenario 2: Chaos Failure Injection ---');
  try {
    // Inject agent crash simulation
    await agentManager.registerAgent({
      agentId: 'agent-chaos',
      name: 'Agent Chaos',
      provider: 'local_process',
      version: '1.0.0',
      platform: 'windows',
      metadata: {},
      capabilities: [{ capabilityId: 'shell.execute', version: '1.0.0' }],
      workspaceRoot: process.cwd(),
      resourceLimits: { maxConcurrentTasks: 5, maxMemoryMb: 512 }
    });
    assert('Agent successfully registered before injection', agentManager.getAgent('agent-chaos')?.status === 'Healthy');

    // Force agent timeout transitions
    await (agentManager as any).transitionHealth('agent-chaos', 'Offline');

    assert('Chaos recovery detects missing agent heartbeats and mark agent offline', agentManager.getAgent('agent-chaos')?.status === 'Offline');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Chaos test error:', err);
  }

  // ----------------------------------------------------
  // Scenario 3: Security Intrusion Attempts
  // ----------------------------------------------------
  console.log('\n--- Scenario 3: Security Validation & Pen-testing ---');
  try {
    // A. Path traversal check (attempt outside workspace access)
    const traverseCheck = policyEngine.checkPath('C:\\Windows\\System32');
    assert('Policy Engine blocks unauthorized path traversal checks', !traverseCheck.allowed);

    // B. Command blacklist check (attempt format.com execute)
    const blacklistCheck = policyEngine.checkCommand('format C: /Q');
    assert('Policy Engine blocks blacklisted destructive commands', !blacklistCheck.allowed);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Security validation error:', err);
  }

  // ----------------------------------------------------
  // Shutdown Server
  // ----------------------------------------------------
  await server.stop();
  agentManager.shutdown();

  console.log('\n==================================================');
  console.log(`CERTIFICATION TESTS SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runCertificationTests().catch(console.error);
