import * as fs from 'fs';
import * as path from 'path';
import { TrustedRootManager, FilesystemIndexer, handleFilesystemTool } from './trustedFilesystem';
import { handleGitTool } from './gitIntelligence';
import { handleCodeTool } from './codeIntelligence';
import { AuditLogger } from './auditLogger';

async function runTests() {
  console.log('==================================================');
  console.log('       TRUSTED FILESYSTEM INTEGRATION TESTS       ');
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

  const workspaceRoot = process.cwd();
  const auditLogger = new AuditLogger(workspaceRoot);
  
  // Set developer mode environment variables
  process.env.DEVELOPER_MODE = 'true';
  process.env.TRUSTED_ROOTS = JSON.stringify([workspaceRoot]);

  // 1. Instantiate Manager & Indexer
  const manager = new TrustedRootManager(auditLogger);
  const indexer = new FilesystemIndexer(workspaceRoot);
  indexer.startIndexingBackground();

  // Test 1: Trusted Path Validation
  assert(manager.isTrusted(workspaceRoot) === true, 'Workspace root is trusted');
  assert(manager.isTrusted('C:\\Windows') === false, 'C:\\Windows is not trusted by default');

  // Test 2: Workspace Roots Listing
  const rootsRes = await handleFilesystemTool(manager, indexer, 'filesystem_roots', {}, auditLogger);
  assert(rootsRes.roots.includes(workspaceRoot), 'filesystem_roots returns current workspace root');

  // Test 3: Create, Write, and Read
  const testDir = path.join(workspaceRoot, 'test_trusted_fs_run');
  const testFile = path.join(testDir, 'sandbox.txt');

  await handleFilesystemTool(manager, indexer, 'filesystem_create_directory', { path: testDir }, auditLogger);
  assert(fs.existsSync(testDir), 'filesystem_create_directory creates folder');

  await handleFilesystemTool(manager, indexer, 'filesystem_write', { path: testFile, content: 'Trusted Filesystem Run' }, auditLogger);
  assert(fs.existsSync(testFile), 'filesystem_write writes content to file');

  const readRes = await handleFilesystemTool(manager, indexer, 'filesystem_read', { path: testFile }, auditLogger);
  assert(readRes.content === 'Trusted Filesystem Run', 'filesystem_read reads content back');

  // Test 4: Checksum & Hash
  const hashRes = await handleFilesystemTool(manager, indexer, 'filesystem_hash', { path: testFile }, auditLogger);
  assert(hashRes.hash !== undefined, 'filesystem_hash returns sha256 hash');

  // Test 5: Search & Find
  const findRes = await handleFilesystemTool(manager, indexer, 'filesystem_find', { path: testDir, name: 'sandbox.txt' }, auditLogger);
  assert(findRes.matches.length > 0, 'filesystem_find locates created file');

  // Test 6: Git Operations simulation
  const gitStatusRes = await handleGitTool('git_status', { path: workspaceRoot }, auditLogger);
  assert(gitStatusRes.status !== undefined, 'git_status executes successfully');

  // Test 7: Workspace & Code Intelligence
  const detectRes = await handleCodeTool('workspace_detect', { path: workspaceRoot }, auditLogger);
  assert(detectRes.detectedProjectTypes.includes('Node.js / npm Project'), 'workspace_detect detects Node project');

  const metricsRes = await handleCodeTool('code_metrics', { path: testFile }, auditLogger);
  assert(metricsRes.totalLines === 1, 'code_metrics measures file lines correctly');

  // Cleanup
  await handleFilesystemTool(manager, indexer, 'filesystem_delete', { path: testFile }, auditLogger);
  await handleFilesystemTool(manager, indexer, 'filesystem_delete_directory', { path: testDir }, auditLogger);

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
