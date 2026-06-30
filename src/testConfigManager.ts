import { EventBus, MemoryStorageProvider } from './eventBus';
import { ConfigurationSecretsManager } from './configManager';

async function runConfigManagerTests() {
  console.log('==================================================');
  console.log('      MCP CONFIGURATION & SECRETS TESTS           ');
  console.log('==================================================\n');

  const storage = new MemoryStorageProvider();
  const eventBus = new EventBus(storage);
  const manager = new ConfigurationSecretsManager();
  manager.setEventBus(eventBus);

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
  // Test 1: Layered Configuration Precedence
  // ----------------------------------------------------
  console.log('--- Testing Layered Precedence ---');
  try {
    // Default platform.port is 3000
    assert('Default platform port is 3000', manager.get('platform.port') === 3000);

    // Override at environment level
    await manager.updateConfig('environment', 'platform.port', 4000);
    assert('Environment layer overrides default port value', manager.get('platform.port') === 4000);

    // Override at runtime override level
    await manager.updateConfig('overrides', 'platform.port', 5000);
    assert('Runtime overrides level overrides environment port value', manager.get('platform.port') === 5000);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Precedence test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Schema Validation & Reject bounds
  // ----------------------------------------------------
  console.log('\n--- Testing Schema Validation Rules ---');
  try {
    // Validate number ranges (min/max)
    try {
      await manager.updateConfig('overrides', 'platform.port', 99999); // Out of max range (65535)
      assert('Out-of-range port should fail validation', false, 'Allowed invalid port value');
    } catch (err: any) {
      assert('Schema validation blocks out-of-range value', err.message.includes('ValidationResultFailed') || err.message.includes('65535'));
    }

    // Validate enums
    try {
      await manager.updateConfig('overrides', 'platform.logLevel', 'invalid_level');
      assert('Invalid log level should fail validation', false, 'Allowed invalid log level value');
    } catch (err: any) {
      assert('Schema validation blocks invalid enum value', err.message.includes('ValidationResultFailed') || err.message.includes('logLevel'));
    }

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Validation rules test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Immutable Snapshots
  // ----------------------------------------------------
  console.log('\n--- Testing Immutable Snapshots ---');
  try {
    const snap = manager.getSnapshot();
    assert('Snapshot returned is frozen (read-only)', Object.isFrozen(snap));

    assert('Snapshot nested structures are frozen', Object.isFrozen(snap.platform));

    const oldPort = snap.platform.port;
    try {
      (snap as any).platform.port = 1234;
    } catch (_) {}
    
    assert('Snapshot is truly immutable and values cannot be overwritten', snap.platform.port === oldPort);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Snapshot test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Coordinated Transactions & Rollbacks
  // ----------------------------------------------------
  console.log('\n--- Testing Transaction Rollbacks ---');
  try {
    const oldPort = manager.get('platform.port');
    
    // Attempt invalid update transaction
    try {
      await manager.updateConfig('overrides', 'platform.port', -50); // Invalid negative port
    } catch (_) {}

    assert('Transaction rollbacks restore original snapshot state on validation failure', manager.get('platform.port') === oldPort);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Transaction rollback test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Watch Service Subscriptions
  // ----------------------------------------------------
  console.log('\n--- Testing Watch Service ---');
  try {
    let triggered = false;
    let observedVal = null;

    const sub = manager.watch('runtime.concurrencyLimit', (newVal) => {
      triggered = true;
      observedVal = newVal;
    });

    await manager.updateConfig('overrides', 'runtime.concurrencyLimit', 25);
    
    assert('Watch service triggers callback on value changes without polling', triggered);
    assert('Watch callback observes updated value', observedVal === 25);

    // Unsubscribe and test change is ignored
    sub.unsubscribe();
    triggered = false;
    await manager.updateConfig('overrides', 'runtime.concurrencyLimit', 30);
    assert('Unsubscribed watcher ignores subsequent value updates', !triggered);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Watch service test error:', err);
  }

  // ----------------------------------------------------
  // Test 6: DPAPI Protected Secrets
  // ----------------------------------------------------
  console.log('\n--- Testing Secure Secrets (Machine Encrypted) ---');
  try {
    const secretKey = 'azure.openai.apikey';
    const rawSecret = 'sk-12345abcdefg';

    await manager.storeSecret(secretKey, rawSecret);
    const retrieved = await manager.retrieveSecret(secretKey);

    assert('Secrets stored and decrypted successfully', retrieved === rawSecret);

    // Rotation transaction
    const newSecret = 'sk-98765rotated';
    await manager.rotateSecret(secretKey, newSecret);
    const rotated = await manager.retrieveSecret(secretKey);
    assert('Rotated secret values retrieve successfully', rotated === newSecret);

    // Deletion
    const deleted = await manager.deleteSecret(secretKey);
    assert('Secrets key deleted successfully', deleted);
    assert('Querying deleted secrets returns null', (await manager.retrieveSecret(secretKey)) === null);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Secrets manager test error:', err);
  }

  // ----------------------------------------------------
  // Test 7: Feature Flags
  // ----------------------------------------------------
  console.log('\n--- Testing Feature Flag Manager ---');
  try {
    const flag = manager.getFeatureFlag('experimentalWorkflowEngine');
    assert('Default feature flag state retrieved successfully', flag !== undefined);
    assert('Default flag is disabled', flag?.enabled === false);

    await manager.setFeatureFlag('experimentalWorkflowEngine', true);
    assert('Feature flag successfully updated at runtime', manager.getFeatureFlag('experimentalWorkflowEngine')?.enabled === true);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Feature flag test error:', err);
  }

  // ----------------------------------------------------
  // Test 8: Schema Migration Engine
  // ----------------------------------------------------
  console.log('\n--- Testing Schema Migration Engine ---');
  try {
    const legacyConfig = {
      version: '0.1.0',
      port: 8080
    };

    const migrated = await manager.migrateConfig(JSON.stringify(legacyConfig));
    assert('Migration engine identifies legacy keys and maps to version namespaces', migrated.platform?.port === 8080);
    assert('Migration engine removes deprecated legacy properties', migrated.port === undefined);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Migration engine test error:', err);
  }

  console.log('\n==================================================');
  console.log(`CONFIG MANAGER TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runConfigManagerTests().catch(console.error);
