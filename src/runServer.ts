import { PlatformBootstrap } from './bootstrap';

async function run() {
  const bootstrap = new PlatformBootstrap();
  await bootstrap.start();
  
  console.log('Platform v2.0 Gateway is listening for incoming validations.');
}

run().catch(console.error);
