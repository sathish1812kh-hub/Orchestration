import { PolicyEngine } from './policyEngine';
import { SessionRegistry } from './sessionRegistry';
import { FileRouter } from './fileRouter';
import { ProcessRouter } from './processRouter';
import { GitRouter } from './gitRouter';
import { SecurityGates } from './securityGates';
import { ProjectAnalyzer } from './projectAnalyzer';
import { loadConfiguration } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function runTests() {
  console.log('==================================================');
  console.log('        MCP WINDOWS SHELL SERVER TEST SUITE       ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const policyEngine = new PolicyEngine(config);
  const sessionRegistry = new SessionRegistry(config.workspaceRoots[0]);
  const fileRouter = new FileRouter(policyEngine);
  const processRouter = new ProcessRouter();
  const gitRouter = new GitRouter(policyEngine);
  const securityGates = new SecurityGates();
  const projectAnalyzer = new ProjectAnalyzer(policyEngine);

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
  // Phase 1: Policy Engine and Safety Checks
  // ----------------------------------------------------
  console.log('--- Testing Policy Engine & Safety Gates ---');
  
  const blockCheck = policyEngine.checkCommand('format c:');
  assert('Blocked command is blocked', !blockCheck.allowed);

  const confirmCheck = policyEngine.checkCommand('git reset --hard HEAD');
  assert('Destructive command triggers confirmation', confirmCheck.allowed && confirmCheck.requiresConfirmation);

  const safeCheck = policyEngine.checkCommand('git status');
  assert('Safe command is fully allowed', safeCheck.allowed && !safeCheck.requiresConfirmation);

  const pathCheckBlocked = policyEngine.checkPath('C:\\Windows\\System32\\cmd.exe');
  assert('System folder path is blocked', !pathCheckBlocked.allowed);

  const pathCheckAllowed = policyEngine.checkPath(path.join(config.workspaceRoots[0], 'package.json'));
  assert('Workspace folder path is allowed', pathCheckAllowed.allowed);

  // ----------------------------------------------------
  // Phase 2: Persistent Session and Command Execution
  // ----------------------------------------------------
  console.log('\n--- Testing Persistent Sessions ---');
  try {
    const sessionInfo = sessionRegistry.createSession('powershell', 'Test Session');
    const session = sessionRegistry.getSession(sessionInfo.id)!;
    assert('Session created successfully', sessionInfo.status === 'active');

    // Test environment persistence by setting a variable
    const setRes = await session.execute('$test_var = "Hello Antigravity!"');
    assert('Variable set execution succeeds', setRes.exitCode === 0);

    // Test environment persistence by reading it in the next command
    const readRes = await session.execute('Write-Output $test_var');
    assert('Variable persisted across commands', readRes.stdout.trim() === 'Hello Antigravity!');
    assert('CWD is tracked correctly', readRes.cwd.toLowerCase() === config.workspaceRoots[0].toLowerCase());

    sessionRegistry.killSession(sessionInfo.id);
    assert('Session terminated successfully', sessionRegistry.listSessions().length === 0);
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Persistent sessions test encountered an error:', err);
  }

  // ----------------------------------------------------
  // Phase 3: File Router Operations
  // ----------------------------------------------------
  console.log('\n--- Testing File Operations ---');
  const testFile = path.join(config.workspaceRoots[0], 'test_dummy.txt');
  const renamedFile = path.join(config.workspaceRoots[0], 'test_dummy_renamed.txt');

  try {
    // Write
    fileRouter.writeFile(testFile, 'Hello line 1\nHello line 2');
    assert('File written successfully', fs.existsSync(testFile));

    // Read
    const readVal = fileRouter.readFile(testFile);
    assert('File read successfully', readVal.content.includes('Hello line 1'));

    // Append
    fileRouter.appendFile(testFile, '\nHello line 3');
    const readVal2 = fileRouter.readFile(testFile);
    assert('File appended successfully', readVal2.content.includes('Hello line 3'));

    // Replace
    fileRouter.replaceText(testFile, 'Hello', 'Hi');
    const readVal3 = fileRouter.readFile(testFile);
    assert('Replace text replaces occurrences', readVal3.content.includes('Hi line 1'));

    // Search
    const searchRes = fileRouter.searchFiles(config.workspaceRoots[0], 'Hi line 1', { searchContent: true });
    assert('Search content matches correctly', searchRes.length > 0);

    // Move / Rename
    fileRouter.moveFile(testFile, renamedFile);
    assert('File moved / renamed successfully', fs.existsSync(renamedFile) && !fs.existsSync(testFile));

    // Delete
    fileRouter.deleteFile(renamedFile);
    assert('File deleted successfully', !fs.existsSync(renamedFile));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] File operations test encountered an error:', err);
    // Cleanup
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    if (fs.existsSync(renamedFile)) fs.unlinkSync(renamedFile);
  }

  // ----------------------------------------------------
  // Phase 4: Processes & Git Operations
  // ----------------------------------------------------
  console.log('\n--- Testing Process and Git Operations ---');
  try {
    // Process list
    const procList = await processRouter.listProcesses();
    assert('Process listing returns active processes', procList.length > 0);
    assert('Process entries contain pid & name', procList[0].pid > 0 && procList[0].name.length > 0);

    // Git Init & Status
    await gitRouter.executeGit(config.workspaceRoots[0], ['init']);
    const gitRes = await gitRouter.executeGit(config.workspaceRoots[0], ['status']);
    assert('Git command executes successfully', gitRes.exitCode === 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Process/Git test encountered an error:', err);
  }

  // ----------------------------------------------------
  // Phase 5: Project Analysis
  // ----------------------------------------------------
  console.log('\n--- Testing Project Codebase Analysis ---');
  try {
    const analysis = projectAnalyzer.analyze(config.workspaceRoots[0]);
    assert('Technology detection found TS/Node.js', analysis.technologies.length > 0);
    assert('Dependency analysis parsed package.json', Object.keys(analysis.dependencies).length > 0);
    assert('Unused file analysis executed', Array.isArray(analysis.unusedFiles));
    assert('Circular dependency analysis executed', Array.isArray(analysis.circularDependencies));
  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Project analysis test encountered an error:', err);
  }

  console.log('\n==================================================');
  console.log(`TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
