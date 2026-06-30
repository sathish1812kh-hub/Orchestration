import * as path from 'path';
import * as fs from 'fs';
import { GcacProfile } from './gcac';

export const CLAUDE_CODE_PROFILE: GcacProfile = {
  name: 'claude-code',
  executablePath: 'claude.cmd', // Default Windows launcher
  args: ['--non-interactive', '--no-color'],
  versionCommand: 'claude --version',
  promptRegex: 'claude\\s*>',
  completionStrategy: 'regex',
  thinkingMarker: '\\(thinking\\)',
  errorMarker: '(Error:|Fatal:|Exception:).*',
  capabilities: [
    { capabilityId: 'code.generate', version: '1.0.0' },
    { capabilityId: 'code.review', version: '1.0.0' },
    { capabilityId: 'shell.execute', version: '1.0.0' },
    { capabilityId: 'filesystem.read', version: '1.0.0' },
    { capabilityId: 'filesystem.write', version: '1.0.0' }
  ]
};

export function discoverClaudeCodePath(configuredPath?: string): string {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  // Windows PATH discovery check
  const pathDirectories = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirectories) {
    const full = path.join(dir, 'claude.cmd');
    if (fs.existsSync(full)) {
      return full;
    }
  }

  // Fallback to powershell/node execution target
  return 'claude.cmd';
}

export function negotiateCapabilities(versionString: string): Array<{ capabilityId: string; version: string }> {
  // Strip non-numeric descriptors
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return CLAUDE_CODE_PROFILE.capabilities; // Fallback to baseline
  }

  const major = parseInt(match[1], 10);
  
  if (major >= 2) {
    // Version 2+ adds reasoning and conversational resume capabilities
    return [
      ...CLAUDE_CODE_PROFILE.capabilities,
      { capabilityId: 'reasoning', version: '2.0.0' },
      { capabilityId: 'conversation.resume', version: '1.0.0' }
    ];
  }

  return CLAUDE_CODE_PROFILE.capabilities;
}

export function validateVersionCompatibility(versionString: string): {
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
