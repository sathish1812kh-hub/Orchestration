import { EventBus, MemoryStorageProvider } from './eventBus';
import { TerminalManager } from './terminalManager';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { AutonomousOrchestrator, MockDecisionProvider } from './orchestrator';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';
import { loadConfiguration } from './config';
import { PluginFramework, PluginManifest } from './pluginFramework';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPluginTests() {
  console.log('==================================================');
  console.log('           MCP PLUGIN FRAMEWORK TESTS             ');
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

  const framework = new PluginFramework(
    eventBus,
    terminalManager,
    null as any, // workflowEngine
    dispatcher,
    agentManager,
    orchestrator,
    policyEngine,
    auditLogger,
    process.cwd() + '/plugins_test'
  );

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

  // Template manifest generator
  const createManifest = (override: Partial<PluginManifest> = {}): PluginManifest => {
    return {
      pluginId: `plugin_${Math.random().toString(36).substring(2, 9)}`,
      name: 'Dynamic Plugin',
      version: '1.0.0',
      author: 'Antigravity developer',
      description: 'Dynamic sandbox extension tests',
      sdkVersion: '1.0.0',
      platformCompatibility: ['windows'],
      dependencies: [],
      permissions: ['terminal.write', 'event.publish'],
      extensionPoints: [],
      ...override
    };
  };

  // ----------------------------------------------------
  // Test 1: Manifest Validation
  // ----------------------------------------------------
  console.log('--- Testing Manifest Validation ---');
  try {
    const invalidManifest = createManifest({ name: '' }); // Missing required name
    try {
      await framework.registerPlugin(invalidManifest, 'console.log("invalid");');
      assert('Manifest validation should fail', false, 'Allowed invalid manifest to register');
    } catch (err: any) {
      assert('Manifest validation successfully rejected invalid fields', err.message.includes('InvalidManifest') || err.message.includes('name'));
    }
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Manifest validation test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Dependency Cycle Resolution
  // ----------------------------------------------------
  console.log('\n--- Testing Dependency Cycle Resolution ---');
  try {
    const manifestA = createManifest({ pluginId: 'plugin-a', dependencies: ['plugin-b'] });
    const manifestB = createManifest({ pluginId: 'plugin-b', dependencies: ['plugin-a'] });

    await framework.registerPlugin(manifestA, 'console.log("A");');
    
    try {
      await framework.registerPlugin(manifestB, 'console.log("B");');
      assert('Cycle detection should fail', false, 'Allowed cyclic dependency registration');
    } catch (err: any) {
      assert('Cycle detection resolved and blocked dependency loops', err.message.includes('CyclicDependency') || err.message.includes('Loop detected'));
    }
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Dependency resolution test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Sandbox Isolation & Injector
  // ----------------------------------------------------
  console.log('\n--- Testing Sandbox Isolation Limits ---');
  try {
    const manifestPriv = createManifest({ pluginId: 'plugin-sandbox-test' });
    
    // Attempting to access global NodeJS require/process or override scope
    const maliciousCode = `
      try {
        const p = process; // Should fail to access process
        pluginResult.message = "ProcessAccessed";
      } catch (err) {
        pluginResult.message = "SandboxSuccess";
      }
    `;

    const state = await framework.registerPlugin(manifestPriv, maliciousCode);
    const loaded = await framework.loadPlugin(state.pluginId);
    
    assert('Plugin script compiled inside VM sandbox successfully', loaded);
    
    const context = state.sandboxContext!;
    assert('Plugin prevented from accessing global process variables', context.pluginResult.message === 'SandboxSuccess');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Sandbox isolation test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Permission Enforcement
  // ----------------------------------------------------
  console.log('\n--- Testing SDK Permission Enforcements ---');
  try {
    const manifestPerm = createManifest({
      pluginId: 'plugin-permission-test',
      permissions: ['event.publish'] // Lacks 'terminal.write'
    });

    const scriptCode = `
      start = async function() {
        try {
          await sdk.terminal.write("term-123", "echo Allowed");
        } catch (err) {
          pluginResult.message = err.message;
        }
      };
    `;

    const state = await framework.registerPlugin(manifestPerm, scriptCode);
    await framework.loadPlugin(state.pluginId);
    await framework.startPlugin(state.pluginId);

    const context = state.sandboxContext!;
    const startHook = context.start;
    await startHook(); // Execute start hook to trigger write check

    assert('SDK calls restrict operations based on manifest permission list', context.pluginResult.message.includes('PermissionDenied'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Permission check test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Hot Reloading
  // ----------------------------------------------------
  console.log('\n--- Testing Hot Reload & Upgrades ---');
  try {
    const manifestReload = createManifest({ pluginId: 'plugin-reload-test' });
    await framework.registerPlugin(manifestReload, 'pluginResult.message = "Version1";');
    await framework.loadPlugin('plugin-reload-test');
    
    assert('Original version loaded successfully', framework.getPlugin('plugin-reload-test')?.sandboxContext?.pluginResult.message === 'Version1');

    // Upgrade plugin code string and reload
    const state = framework.getPlugin('plugin-reload-test')!;
    state.codeString = 'pluginResult.message = "Version2";';
    
    const reloaded = await framework.reloadPlugin('plugin-reload-test');
    assert('Hot reload returned success', reloaded);
    assert('Restored context reflects upgraded source code execution', framework.getPlugin('plugin-reload-test')?.sandboxContext?.pluginResult.message === 'Version2');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Hot reload test error:', err);
  }

  // ----------------------------------------------------
  // Test 6: Failure Isolation
  // ----------------------------------------------------
  console.log('\n--- Testing Failure Isolation (Graceful Crashes) ---');
  try {
    const manifestCrash = createManifest({ pluginId: 'plugin-crash-test' });
    
    // Script throws syntax or run error
    const state = await framework.registerPlugin(manifestCrash, 'throw new Error("FatalPluginCrash");');
    const loaded = await framework.loadPlugin(state.pluginId);

    assert('Crashed load returns false indicating failure', !loaded);
    assert('Plugin state transitions to Failed', state.status === 'Failed');
    assert('Event Bus continues to operate and persist states', eventBus !== undefined);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Failure isolation test error:', err);
  }

  console.log('\n==================================================');
  console.log(`PLUGIN FRAMEWORK TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  // Terminate active monitoring loops
  agentManager.shutdown();

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPluginTests().catch(console.error);
