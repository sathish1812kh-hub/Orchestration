import * as path from 'path';
import * as fs from 'fs';
import { GcacProfile } from './gcac';

export const GEMINI_CLI_PROFILE: GcacProfile = {
  name: 'gemini-cli',
  executablePath: 'gemini.exe',
  args: ['--interactive', '--no-banner'],
  versionCommand: 'gemini --version',
  promptRegex: 'gemini\\s*>>>',
  completionStrategy: 'regex',
  thinkingMarker: '\\(thinking\\)',
  errorMarker: '(GeminiError:|SyntaxError:).*',
  capabilities: [
    { capabilityId: 'code.generate', version: '1.0.0' },
    { capabilityId: 'code.review', version: '1.0.0' },
    { capabilityId: 'browser.control', version: '1.0.0' },
    { capabilityId: 'reasoning', version: '1.0.0' }
  ]
};

export function discoverGeminiCliPath(configuredPath?: string): string {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const paths = (process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const full = path.join(dir, 'gemini.exe');
    if (fs.existsSync(full)) {
      return full;
    }
  }

  return 'gemini.exe';
}

export function negotiateGeminiCapabilities(versionString: string): Array<{ capabilityId: string; version: string }> {
  const match = versionString.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return GEMINI_CLI_PROFILE.capabilities;
  }

  const major = parseInt(match[1], 10);
  if (major >= 2) {
    // Gemini 2+ adds video.analysis and multimodal pipeline capabilities
    return [
      ...GEMINI_CLI_PROFILE.capabilities,
      { capabilityId: 'video.analysis', version: '2.0.0' },
      { capabilityId: 'multimodal', version: '2.0.0' }
    ];
  }

  return GEMINI_CLI_PROFILE.capabilities;
}

export function validateGeminiVersion(versionString: string): {
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
