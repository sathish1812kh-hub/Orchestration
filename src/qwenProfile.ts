import * as path from 'path';
import * as fs from 'fs';
import { GcacProfile } from './gcac';

export const QWEN_CLI_PROFILE: GcacProfile = {
  name: 'qwen-cli',
  executablePath: 'qwen.exe',
  args: ['--interactive', '--no-banner'],
  versionCommand: 'qwen --version',
  promptRegex: 'qwen\\s*>>>',
  completionStrategy: 'regex',
  thinkingMarker: '\\(thinking\\)',
  errorMarker: '(QwenError:|SyntaxError:).*',
  capabilities: [
    { capabilityId: 'code.generate', version: '1.0.0' },
    { capabilityId: 'code.review', version: '1.0.0' },
    { capabilityId: 'reasoning', version: '1.0.0' }
  ]
};

export function discoverQwenCliPath(configuredPath?: string): string {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, 'qwen.exe');
    if (fs.existsSync(full)) {
      return full;
    }
  }

  return 'qwen.exe';
}

export function negotiateQwenCapabilities(versionString: string): Array<{ capabilityId: string; version: string }> {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return QWEN_CLI_PROFILE.capabilities;
  }

  const major = parseInt(match[1], 10);
  if (major >= 2) {
    // Qwen v2+ adds function calling and agentic capabilities
    return [
      ...QWEN_CLI_PROFILE.capabilities,
      { capabilityId: 'agent.functioncall', version: '2.0.0' },
      { capabilityId: 'multimodal', version: '2.0.0' }
    ];
  }

  return QWEN_CLI_PROFILE.capabilities;
}

export function validateQwenVersion(versionString: string): {
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
