import * as fs from 'fs';
import * as path from 'path';
import { GcacProfile } from './gcac';

export interface PdkScaffoldOptions {
  name: string;
  executablePath: string;
  args: string[];
  versionCommand: string;
  promptRegex: string;
  completionStrategy: 'regex' | 'idle' | 'terminator';
}

export class ProfileDevelopmentKit {
  private compatibilityCatalog: Array<{
    connector: string;
    version: string;
    status: 'PASS' | 'FAIL' | 'PENDING';
    certified: boolean;
  }> = [
    { connector: 'claude-code', version: '1.2.0', status: 'PASS', certified: true },
    { connector: 'codex-cli', version: 'pending', status: 'PENDING', certified: false },
    { connector: 'gemini-cli', version: 'pending', status: 'PENDING', certified: false }
  ];

  public generateScaffold(opts: PdkScaffoldOptions): {
    profile: GcacProfile;
    configTemplate: string;
    documentationTemplate: string;
  } {
    const profile: GcacProfile = {
      name: opts.name,
      executablePath: opts.executablePath,
      args: opts.args,
      versionCommand: opts.versionCommand,
      promptRegex: opts.promptRegex,
      completionStrategy: opts.completionStrategy,
      capabilities: [
        { capabilityId: 'code.generate', version: '1.0.0' },
        { capabilityId: 'shell.execute', version: '1.0.0' }
      ]
    };

    const configTemplate = JSON.stringify(profile, null, 2);
    const documentationTemplate = `# Profile documentation for ${opts.name}\n\nVendor profile configuration mappings.`;

    return { profile, configTemplate, documentationTemplate };
  }

  public validateProfileSchema(profile: GcacProfile): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    if (!profile.name) errors.push('Missing required name');
    if (!profile.executablePath) errors.push('Missing required executablePath');
    if (!profile.promptRegex) errors.push('Missing required promptRegex');
    if (!profile.completionStrategy) errors.push('Missing required completionStrategy');
    if (!profile.capabilities || profile.capabilities.length === 0) {
      errors.push('Profile must advertise at least one capability');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  public generateMockCliCode(opts: {
    banner: string;
    prompt: string;
    successOutput: string;
  }): string {
    return `
      // Auto-generated Mock CLI script
      console.log("${opts.banner}");
      process.stdout.write("${opts.prompt} ");
      process.stdin.on("data", (data) => {
        const cmd = data.toString().trim();
        if (cmd === "exit") {
          process.exit(0);
        }
        console.log("${opts.successOutput}");
        process.stdout.write("${opts.prompt} ");
      });
    `;
  }

  public testParser(
    profile: GcacProfile,
    text: string
  ): {
    promptMatched: boolean;
    containsErrors: boolean;
    cleanOutput: string;
  } {
    const promptRegex = new RegExp(profile.promptRegex);
    const promptMatched = promptRegex.test(text);

    let containsErrors = false;
    if (profile.errorMarker) {
      const errRegex = new RegExp(profile.errorMarker);
      containsErrors = errRegex.test(text);
    }

    let cleanOutput = text;
    if (profile.thinkingMarker) {
      cleanOutput = text.replace(new RegExp(profile.thinkingMarker, 'g'), '');
    }

    return {
      promptMatched,
      containsErrors,
      cleanOutput
    };
  }

  public getCompatibilityMatrix() {
    return this.compatibilityCatalog;
  }

  public certifyProfile(profile: GcacProfile): {
    overallVerdict: 'PASS' | 'FAIL';
    scores: {
      schema: number;
      capabilities: number;
      parsers: number;
    };
    report: string;
  } {
    const schemaCheck = this.validateProfileSchema(profile);
    const schemaScore = schemaCheck.valid ? 100 : 0;
    
    const capsScore = (profile.capabilities && profile.capabilities.length > 0) ? 100 : 0;
    const parsersScore = profile.promptRegex ? 100 : 0;

    const passed = schemaCheck.valid && capsScore === 100 && parsersScore === 100;

    return {
      overallVerdict: passed ? 'PASS' : 'FAIL',
      scores: {
        schema: schemaScore,
        capabilities: capsScore,
        parsers: parsersScore
      },
      report: `### Profile Certification Summary for ${profile.name}\n- Schema Validation: ${schemaScore === 100 ? 'PASS' : 'FAIL'}\n- Capabilities advertisement: ${capsScore === 100 ? 'PASS' : 'FAIL'}\n- Completion prompt parsers: ${parsersScore === 100 ? 'PASS' : 'FAIL'}`
    };
  }

  public packageRelease(
    profile: GcacProfile,
    workspaceRoot: string
  ): {
    packagePath: string;
    checksum: string;
  } {
    const p = path.join(workspaceRoot, `${profile.name}-package.json`);
    fs.writeFileSync(p, JSON.stringify(profile, null, 2));

    return {
      packagePath: p,
      checksum: 'sha256-mockchecksumhash123456789'
    };
  }
}
