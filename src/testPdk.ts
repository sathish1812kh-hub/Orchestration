import * as fs from 'fs';
import * as path from 'path';
import { ProfileDevelopmentKit } from './pdk';
import { loadConfiguration } from './config';
import { GcacProfile } from './gcac';

async function runPdkTests() {
  console.log('==================================================');
  console.log('       MCP PROFILE DEVELOPMENT KIT TESTS          ');
  console.log('==================================================\n');

  const config = loadConfiguration();
  const workspaceRoot = config.workspaceRoots[0];
  const pdk = new ProfileDevelopmentKit();

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
  // Test 1: Scaffold Generation
  // ----------------------------------------------------
  console.log('--- Testing Scaffold Generation ---');
  try {
    const res = pdk.generateScaffold({
      name: 'codex-cli',
      executablePath: 'codex.exe',
      args: ['--non-interactive'],
      versionCommand: 'codex --version',
      promptRegex: 'codex >>>',
      completionStrategy: 'regex'
    });

    assert('Generates GcacProfile object cleanly', res.profile.name === 'codex-cli');
    assert('Config template contains JSON representation', res.configTemplate.includes('"codex.exe"'));
    assert('Documentation template contains header titles', res.documentationTemplate.includes('codex-cli'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Scaffold test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Schema Validation
  // ----------------------------------------------------
  console.log('\n--- Testing Schema Validation ---');
  try {
    const validCheck = pdk.validateProfileSchema({
      name: 'gemini-cli',
      executablePath: 'gemini.exe',
      args: [],
      versionCommand: 'gemini --version',
      promptRegex: 'gemini >',
      completionStrategy: 'regex',
      capabilities: [{ capabilityId: 'code.generate', version: '1.0.0' }]
    });

    const malformedCheck = pdk.validateProfileSchema({
      name: '',
      executablePath: '',
      args: [],
      versionCommand: '',
      promptRegex: '',
      completionStrategy: 'regex',
      capabilities: []
    });

    assert('Validates compliant profile configurations', validCheck.valid === true);
    assert('Rejects malformed profile configurations', malformedCheck.valid === false);
    assert('Exposes detailed schema error listings', malformedCheck.errors.length > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Schema test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Mock CLI Compilation
  // ----------------------------------------------------
  console.log('\n--- Testing Mock CLI Compilation ---');
  try {
    const script = pdk.generateMockCliCode({
      banner: 'Codex Mock CLI v1.0',
      prompt: 'codex >>>',
      successOutput: 'Processed successfully'
    });

    assert('Compiles mock process code scripts', script.includes('Codex Mock CLI'));
    assert('Mock script attaches prompt listeners', script.includes('process.stdin.on'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Mock CLI test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Parser Harness Checks
  // ----------------------------------------------------
  console.log('\n--- Testing Parser Harness Checks ---');
  try {
    const mockProfile: GcacProfile = {
      name: 'test-profile',
      executablePath: 'node',
      args: [],
      versionCommand: '',
      promptRegex: 'Ready',
      completionStrategy: 'regex',
      capabilities: [],
      thinkingMarker: '<think>.*</think>',
      errorMarker: 'Error:.*'
    };

    const res = pdk.testParser(mockProfile, 'Started <think>Analyzing...</think> Ready');
    assert('Correctly identifies matching prompt markers', res.promptMatched === true);
    assert('Strips thinking markers output chunks', !res.cleanOutput.includes('Analyzing'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Parser test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Certifications, Catalogs, and Releases
  // ----------------------------------------------------
  console.log('\n--- Testing Certifications & Releases ---');
  try {
    const matrix = pdk.getCompatibilityMatrix();
    assert('Exposes validated compatibility catalog matrix', matrix.length > 0);

    const testProfile: GcacProfile = {
      name: 'release-profile',
      executablePath: 'bin.exe',
      args: [],
      versionCommand: '',
      promptRegex: 'Ready',
      completionStrategy: 'regex',
      capabilities: [{ capabilityId: 'reasoning', version: '1.0.0' }]
    };

    const cert = pdk.certifyProfile(testProfile);
    assert('Executes certifications sweeps returning verdicts PASS', cert.overallVerdict === 'PASS');

    const pkg = pdk.packageRelease(testProfile, workspaceRoot);
    assert('Creates release packages on filesystem', fs.existsSync(pkg.packagePath));
    assert('Generates sha256 packages checksum files', pkg.checksum.length > 0);

    // Clean up package
    if (fs.existsSync(pkg.packagePath)) {
      fs.unlinkSync(pkg.packagePath);
    }

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Releases test error:', err);
  }

  console.log('\n==================================================');
  console.log(`PDK TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPdkTests().catch(console.error);
