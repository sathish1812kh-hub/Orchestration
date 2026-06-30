import { EventBus, MemoryStorageProvider } from './eventBus';
import { PlatformStateRegistry } from './stateRegistry';
import { RuntimeLifecycleManager, ServiceDescriptor } from './lifecycle';

async function runLifecycleTests() {
  console.log('==================================================');
  console.log('         MCP RUNTIME LIFECYCLE TESTS              ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const stateRegistry = new PlatformStateRegistry(eventBus);

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
  // Test 1: Dependency Ordering & Cycle Verification
  // ----------------------------------------------------
  console.log('--- Testing Dependency Ordering & Cycle Checks ---');
  try {
    const manager = new RuntimeLifecycleManager();

    // A. Cyclic loop (A -> B -> A)
    manager.registerService({
      serviceId: 'service-a',
      version: '1.0.0',
      dependencies: ['service-b'],
      startup: async () => {},
      shutdown: async () => {},
      readinessProbe: async () => true,
      healthProbe: async () => true
    });

    try {
      manager.registerService({
        serviceId: 'service-b',
        version: '1.0.0',
        dependencies: ['service-a'],
        startup: async () => {},
        shutdown: async () => {},
        readinessProbe: async () => true,
        healthProbe: async () => true
      });
      assert('Cyclic dependency should fail', false, 'Allowed cyclic loops');
    } catch (err: any) {
      assert('Lifecycle manager successfully detects and blocks dependency loops', err.message.includes('CyclicDependency') || err.message.includes('Loop detected'));
    }

    // B. Clean Acyclic startup order
    const acyclicManager = new RuntimeLifecycleManager();
    acyclicManager.registerService({
      serviceId: 'database',
      version: '1.0.0',
      dependencies: [],
      startup: async () => {},
      shutdown: async () => {},
      readinessProbe: async () => true,
      healthProbe: async () => true
    });
    acyclicManager.registerService({
      serviceId: 'server',
      version: '1.0.0',
      dependencies: ['database'],
      startup: async () => {},
      shutdown: async () => {},
      readinessProbe: async () => true,
      healthProbe: async () => true
    });

    const order = acyclicManager.resolveDependencyOrder();
    assert('Topological sorting resolves correct dependent boot sequence', order[0] === 'database' && order[1] === 'server');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Dependency sorting test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Startup & Shutdown Sequences
  // ----------------------------------------------------
  console.log('\n--- Testing Coordinated Startup & Graceful Shutdown ---');
  try {
    const manager = new RuntimeLifecycleManager();
    manager.setEventBus(eventBus);

    const execLog: string[] = [];

    const serviceA: ServiceDescriptor = {
      serviceId: 'service-a',
      version: '1.0.0',
      dependencies: [],
      startup: async () => { execLog.push('start-a'); },
      shutdown: async () => { execLog.push('stop-a'); },
      readinessProbe: async () => true,
      healthProbe: async () => true
    };

    const serviceB: ServiceDescriptor = {
      serviceId: 'service-b',
      version: '1.0.0',
      dependencies: ['service-a'],
      startup: async () => { execLog.push('start-b'); },
      shutdown: async () => { execLog.push('stop-b'); },
      readinessProbe: async () => true,
      healthProbe: async () => true
    };

    manager.registerService(serviceA);
    manager.registerService(serviceB);

    // Run startup
    await manager.startPlatform();
    assert('Platform transitioned to Ready status', manager.getStatus().status === 'Ready');
    assert('Startup execution order flows by dependencies', execLog[0] === 'start-a' && execLog[1] === 'start-b');

    // Run graceful shutdown
    await manager.stopPlatform();
    assert('Platform gracefully transitioned to Stopped status', manager.getStatus().status === 'Stopped');
    assert('Graceful shutdown reverse dependency order execution works', execLog[2] === 'stop-b' && execLog[3] === 'stop-a');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Startup/Shutdown sequences test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Recovery Projections
  // ----------------------------------------------------
  console.log('\n--- Testing Platform State Recovery ---');
  try {
    const manager = new RuntimeLifecycleManager();
    manager.setEventBus(eventBus);

    // Trigger state recovery sequence
    await manager.recoverPlatform(stateRegistry);
    assert('Platform recovery completes and transitions to Ready', manager.getStatus().status === 'Ready');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Platform recovery test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Maintenance Mode
  // ----------------------------------------------------
  console.log('\n--- Testing Administrative Maintenance Mode ---');
  try {
    const manager = new RuntimeLifecycleManager();
    assert('Default platform mode is not maintenance', !manager.isMaintenanceMode());

    manager.enterMaintenanceMode();
    assert('Entered maintenance mode successfully', manager.isMaintenanceMode() && manager.getStatus().status === 'Maintenance');

    manager.exitMaintenanceMode();
    assert('Exited maintenance mode successfully', !manager.isMaintenanceMode());

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Maintenance mode test error:', err);
  }

  console.log('\n==================================================');
  console.log(`LIFECYCLE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runLifecycleTests().catch(console.error);
