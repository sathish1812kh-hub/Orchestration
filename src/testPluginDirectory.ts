import * as fs from 'fs';
import * as path from 'path';
import { isProtectedPath, resolvePluginDirectory, PluginFramework } from './pluginFramework';
import { EventBus } from './eventBus';
import { TerminalManager } from './terminalManager';
import { WorkflowEngine } from './workflowEngine';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { AutonomousOrchestrator } from './orchestrator';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';

// Minimal Mock Event Bus
class MockEventBus extends EventBus {
  constructor() {
    super({
      append: async () => {},
      readAll: async () => []
    } as any);
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('        PLUGIN FRAMEWORK DIRECTORY TESTS          ');
  console.log('==================================================\n');

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, title: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passCount++;
    } else {
      console.error(`[FAIL] ${title}`);
      failCount++;
    }
  }

  // 1. Test isProtectedPath
  assert(isProtectedPath('C:\\Windows') === true, 'isProtectedPath identifies C:\\Windows');
  assert(isProtectedPath('C:\\Windows\\System32') === true, 'isProtectedPath identifies System32');
  assert(isProtectedPath('C:\\Program Files') === true, 'isProtectedPath identifies Program Files');
  assert(isProtectedPath('C:\\mcp-chatgptv2') === false, 'isProtectedPath allows project directory');

  // 2. Test resolvePluginDirectory (Default & env override)
  const originalEnv = { ...process.env };
  
  // Custom PLUGIN_DIRECTORY override
  process.env.PLUGIN_DIRECTORY = 'C:\\custom_plugins_test';
  assert(resolvePluginDirectory() === 'C:\\custom_plugins_test', 'resolvePluginDirectory respects PLUGIN_DIRECTORY env');

  // LOCALAPPDATA override
  delete process.env.PLUGIN_DIRECTORY;
  process.env.LOCALAPPDATA = 'C:\\Users\\MockUser\\AppData\\Local';
  assert(
    resolvePluginDirectory().toLowerCase() === 'c:\\users\\mockuser\\appdata\\local\\ngrok-mcp\\plugins',
    'resolvePluginDirectory falls back to LOCALAPPDATA'
  );

  // Restore env
  process.env = originalEnv;

  // 3. Test PluginFramework Initialization Safety
  const mockEventBus = new MockEventBus();
  const mockPolicyEngine = new PolicyEngine({
    blockedCommands: [],
    confirmationCommands: [],
    blockedPaths: [],
    workspaceRoots: [],
    ngrok: {
      port: 5000
    }
  });
  const mockAuditLogger = new AuditLogger(process.cwd());

  // Safe initialize under protected directory
  console.log('\nTesting safe initialization with protected directory (should fallback and NOT crash)...');
  const pfSystem = new PluginFramework(
    mockEventBus,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    mockPolicyEngine,
    mockAuditLogger,
    'C:\\Windows\\System32\\plugins'
  );
  assert(pfSystem !== undefined, 'PluginFramework constructor returns successfully for protected directories');

  // Safe initialize under invalid path
  console.log('\nTesting safe initialization with invalid directory path...');
  const pfInvalid = new PluginFramework(
    mockEventBus,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    mockPolicyEngine,
    mockAuditLogger,
    'Q:\\invalid_drive_path\\plugins'
  );
  assert(pfInvalid !== undefined, 'PluginFramework constructor returns successfully for invalid path');

  console.log('\n==================================================');
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
