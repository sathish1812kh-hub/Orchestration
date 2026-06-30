import * as fs from 'fs';
import * as path from 'path';
import { Configuration } from './types';

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG: Configuration = {
  workspaceRoots: [process.cwd()],
  blockedCommands: [
    'format',
    'shutdown',
    'init 0',
    'poweroff',
    'reboot',
    'reg add',
    'reg delete',
    'reg import',
    'del /s /q c:\\',
    'rm -rf /'
  ],
  confirmationCommands: [
    'git reset --hard',
    'git clean',
    'del /s',
    'rm -rf',
    'rmdir /s',
    'kill',
    'stop-process'
  ],
  blockedPaths: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\Users\\Default'
  ],
  ngrok: {
    authtoken: process.env.NGROK_AUTHTOKEN,
    domain: process.env.NGROK_DOMAIN,
    port: parseInt(process.env.PORT || '3000', 10)
  }
};

export function loadConfiguration(): Configuration {
  let fileConfig: Partial<Configuration> = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      fileConfig = JSON.parse(data);
    } catch (error) {
      console.error('Error reading config.json:', error);
    }
  }

  // Merge default, file, and env configurations
  const workspaceRoots = process.env.WORKSPACE_ROOTS
    ? process.env.WORKSPACE_ROOTS.split(';').map(p => path.resolve(p.trim()))
    : (fileConfig.workspaceRoots?.map(p => path.resolve(p)) || DEFAULT_CONFIG.workspaceRoots);

  const blockedPaths = (fileConfig.blockedPaths || DEFAULT_CONFIG.blockedPaths).map(p => path.resolve(p));

  return {
    workspaceRoots: workspaceRoots.length > 0 ? workspaceRoots : DEFAULT_CONFIG.workspaceRoots,
    blockedCommands: fileConfig.blockedCommands || DEFAULT_CONFIG.blockedCommands,
    confirmationCommands: fileConfig.confirmationCommands || DEFAULT_CONFIG.confirmationCommands,
    blockedPaths,
    ngrok: {
      authtoken: process.env.NGROK_AUTHTOKEN || fileConfig.ngrok?.authtoken || DEFAULT_CONFIG.ngrok.authtoken,
      domain: process.env.NGROK_DOMAIN || fileConfig.ngrok?.domain || DEFAULT_CONFIG.ngrok.domain,
      port: parseInt(process.env.PORT || '') || fileConfig.ngrok?.port || DEFAULT_CONFIG.ngrok.port
    }
  };
}

export function saveConfiguration(config: Configuration): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing config.json:', error);
  }
}
