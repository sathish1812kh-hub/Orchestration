import * as fs from 'fs';
import * as path from 'path';
import { ReleaseManager } from './release';

async function runReleaseTests() {
  console.log('==================================================');
  console.log('            MCP RELEASE ENGINEERING TESTS         ');
  console.log('==================================================\n');

  const workspaceRoot = process.cwd();
  const manager = new ReleaseManager(workspaceRoot);

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
  // Test 1: Semantic Versioning & Build Info
  // ----------------------------------------------------
  console.log('--- Testing Build Metadata & Versioning ---');
  try {
    const build = manager.getBuildInfo();
    assert('Version is semantic 1.0.0', build.version === '1.0.0');
    assert('Build number is populated', build.buildNumber !== undefined);
    assert('Commit hash is present', build.commitHash.length === 40);
    assert('Timestamp is valid', build.timestamp > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Versioning test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Package Generation
  // ----------------------------------------------------
  console.log('\n--- Testing Package Generation ---');
  try {
    const paths = await manager.packageArtifacts();
    assert('Generated portable ZIP target package', fs.existsSync(paths[0]));
    assert('Generated developer SDK package tgz file', fs.existsSync(paths[1]));
    assert('Generated examples library package', fs.existsSync(paths[2]));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Package generation test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Checksum correctness (SHA-256 / SHA-512)
  // ----------------------------------------------------
  console.log('\n--- Testing Checksum Hash Generators ---');
  try {
    const targetFile = path.join(workspaceRoot, 'releases', 'mcp-platform-v1.0.0-portable.zip');
    const hashes = manager.computeHashes(targetFile);

    assert('SHA-256 checksum has correct hexadecimal length (64 chars)', hashes.sha256.length === 64);
    assert('SHA-512 checksum has correct hexadecimal length (128 chars)', hashes.sha512.length === 128);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Checksums test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Release Manifest & Verify Release Integrity
  // ----------------------------------------------------
  console.log('\n--- Testing Release Verification ---');
  try {
    const manifest = await manager.generateReleaseManifest();
    assert('Generated release_manifest.json file', fs.existsSync(path.join(workspaceRoot, 'releases', 'release_manifest.json')));
    assert('Manifest lists correct count of artifacts', manifest.artifacts.length === 3);

    const verified = manager.verifyRelease(manifest);
    assert('Release manifest verification check returns valid', verified.isValid);

    // Tamper with file to verify validation catches checksum mismatches
    const zipPath = path.join(workspaceRoot, 'releases', 'mcp-platform-v1.0.0-portable.zip');
    fs.appendFileSync(zipPath, '\nTAMPERED');

    const tamperedCheck = manager.verifyRelease(manifest);
    assert('Verification flags checksum mismatches on modified packages', !tamperedCheck.isValid);
    assert('Tamper detection error logs lists the mismatch reason', tamperedCheck.errors.some(e => e.includes('ChecksumMismatch')));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Release verification test error:', err);
  }

  console.log('\n==================================================');
  console.log(`RELEASE TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runReleaseTests().catch(console.error);
