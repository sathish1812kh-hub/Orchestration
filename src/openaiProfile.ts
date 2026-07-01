import * as path from 'path';
import * as fs from 'fs';
import { GcacProfile } from './gcac';

export const OPENAI_CLI_PROFILE: GcacProfile = {
  name: 'openai-cli',
  executablePath: 'openai.exe',
  args: ['--interactive', '--no-banner'],
  versionCommand: 'openai --version',
  promptRegex: 'openai\\s*>>>',
  completionStrategy: 'regex',
  thinkingMarker: '\\(thinking\\)',
  errorMarker: '(OpenAIError:|SyntaxError:).*',
  capabilities: [
    { capabilityId: 'code.generate', version: '1.0.0' },
    { capabilityId: 'code.review', version: '1.0.0' },
    { capabilityId: 'reasoning', version: '1.0.0' },
    { capabilityId: 'multimodal', version: '1.0.0' }
  ]
};

export function discoverOpenaiCliPath(configuredPath?: string): string {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, 'openai.exe');
    if (fs.existsSync(full)) {
      return full;
    }
  }

  return 'openai.exe';
}

export function negotiateOpenaiCapabilities(versionString: string): Array<{ capabilityId: string; version: string }> {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return OPENAI_CLI_PROFILE.capabilities;
  }

  const major = parseInt(match[1], 10);
  if (major >= 2) {
    // OpenAI v2+ adds real-time reasoning and agentic function calls
    return [
      ...OPENAI_CLI_PROFILE.capabilities,
      { capabilityId: 'agent.functioncall', version: '2.0.0' },
      { capabilityId: 'reasoning.realtime', version: '2.0.0' }
    ];
  }

  return OPENAI_CLI_PROFILE.capabilities;
}

export function validateOpenaiVersion(versionString: string): {
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
