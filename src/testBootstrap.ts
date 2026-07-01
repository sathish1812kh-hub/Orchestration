import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { PlatformBootstrap } from './bootstrap';

async function runBootstrapTests() {
  console.log('==================================================');
  console.log('      MCP RUNTIME BOOTSTRAP SUITE                 ');
  console.log('==================================================\n');

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

  // Write temporary test env file
  const testEnvPath = path.join(process.cwd(), '.env');
  const originalEnv = fs.existsSync(testEnvPath) ? fs.readFileSync(testEnvPath, 'utf-8') : null;

  fs.writeFileSync(testEnvPath, `
PORT=5099
HOST=127.0.0.1
NGROK_ENABLED=false
  `);

  const bootstrap = new PlatformBootstrap();

  // 1. Validate Env & Port Override
  console.log('--- Testing Environment Configuration ---');
  try {
    await bootstrap.start();
    assert('Correctly overrides default port 5001 to 5099 from env', bootstrap.port === 5099);
    assert('Correctly sets host to 127.0.0.1', bootstrap.host === '127.0.0.1');
    assert('Correctly transitions state to Ready', bootstrap.state === 'Ready');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Env test failed:', err);
  }

  // 2. Validate Endpoints
  console.log('\n--- Testing HTTP Endpoints ---');
  try {
    // Check root endpoint
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:5099/', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert('Root / endpoint returns platform version details', body.version === '2.0');
          resolve();
        });
      }).on('error', reject);
    });

    // Check ready endpoint
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:5099/ready', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          assert('Ready endpoint returns READY status string', data === 'READY');
          resolve();
        });
      }).on('error', reject);
    });

    // Check health endpoint
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:5099/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert('Health endpoint returns healthy status status', body.status === 'healthy');
          resolve();
        });
      }).on('error', reject);
    });

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Endpoints checks failed:', err);
  }

  // 3. Graceful Shutdown & State Transitions
  console.log('\n--- Testing Graceful Shutdown ---');
  try {
    await bootstrap.stop();
    assert('Gracefully updates state to Stopped after shutdown', bootstrap.state === 'Stopped');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Shutdown failed:', err);
  }

  // Restore original env
  if (originalEnv) {
    fs.writeFileSync(testEnvPath, originalEnv);
  } else {
    fs.unlinkSync(testEnvPath);
  }

  console.log('\n==================================================');
  console.log(`BOOTSTRAP TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runBootstrapTests().catch(console.error);
