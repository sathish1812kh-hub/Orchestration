import * as path from 'path';
import * as fs from 'fs';
import { GcacProfile } from './gcac';

export const CODEX_CLI_PROFILE: GcacProfile = {
  name: 'codex-cli',
  executablePath: 'codex.exe',
  args: ['--interactive', '--no-banner'],
  versionCommand: 'codex --version',
  promptRegex: 'codex\\s*>>>',
  completionStrategy: 'regex',
  thinkingMarker: '\\(generating\\)',
  errorMarker: '(CodexError:|SyntaxError:).*',
  capabilities: [
    { capabilityId: 'code.generate', version: '1.0.0' },
    { capabilityId: 'code.review', version: '1.0.0' },
    { capabilityId: 'terminal.execute', version: '1.0.0' }
  ]
};

export function discoverCodexCliPath(configuredPath?: string): string {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, 'codex.exe');
    if (fs.existsSync(full)) {
      return full;
    }
  }

  return 'codex.exe';
}

export function negotiateCodexCapabilities(versionString: string): Array<{ capabilityId: string; version: string }> {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return CODEX_CLI_PROFILE.capabilities;
  }

  const major = parseInt(match[1], 10);
  if (major >= 2) {
    // Codex 2+ adds reasoning and model fine-tuning capability mappings
    return [
      ...CODEX_CLI_PROFILE.capabilities,
      { capabilityId: 'reasoning', version: '2.0.0' },
      { capabilityId: 'model.finetune', version: '1.0.0' }
    ];
  }

  return CODEX_CLI_PROFILE.capabilities;
}

export function validateCodexVersion(versionString: string): {
  compatible: boolean;
  message: string;
} {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { compatible: true, message: 'Dynamic check - parsing fallback' };
  }

  const major = parseInt(match[1], 10);
  if (major < 1) {
    return { compatible: false, message: `Version ${versionString} is below minimum supported version (1.0.0)` };
  }

  return { compatible: true, message: 'Version is compatible' };
}
