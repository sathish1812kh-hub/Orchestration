import { execSync } from 'child_process';
import { AuditLogger } from './auditLogger';

export const gitToolSchemas = [
  { name: 'git_status', description: 'Get git status', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_diff', description: 'Get git diff', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_log', description: 'Get git log', inputSchema: { type: 'object', properties: { path: { type: 'string' }, count: { type: 'number' } }, required: ['path'] } },
  { name: 'git_branches', description: 'List git branches', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_tags', description: 'List git tags', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_blame', description: 'Get git blame for a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, file: { type: 'string' } }, required: ['path', 'file'] } },
  { name: 'git_stage', description: 'Stage files (git add)', inputSchema: { type: 'object', properties: { path: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['path', 'files'] } },
  { name: 'git_commit', description: 'Commit staged changes', inputSchema: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } }, required: ['path', 'message'] } },
  { name: 'git_push', description: 'Push commits to remote repository', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_pull', description: 'Pull commits from remote repository', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'git_checkout', description: 'Checkout a branch or file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, target: { type: 'string' } }, required: ['path', 'target'] } },
  { name: 'git_merge', description: 'Merge a branch', inputSchema: { type: 'object', properties: { path: { type: 'string' }, branch: { type: 'string' } }, required: ['path', 'branch'] } },
  { name: 'git_rebase', description: 'Rebase branch', inputSchema: { type: 'object', properties: { path: { type: 'string' }, base: { type: 'string' } }, required: ['path', 'base'] } },
  { name: 'git_stash', description: 'Stash changes', inputSchema: { type: 'object', properties: { path: { type: 'string' }, action: { type: 'string', enum: ['save', 'pop', 'list', 'clear'] } }, required: ['path', 'action'] } },
  { name: 'git_graph', description: 'Show commit history graph', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
];

export async function handleGitTool(name: string, args: any, auditLogger: AuditLogger): Promise<any> {
  auditLogger.log({
    timestamp: new Date().toISOString(),
    toolName: name,
    command: JSON.stringify(args)
  } as any);

  const execGit = (cmd: string): string => {
    try {
      return execSync(`git ${cmd}`, { cwd: args.path, encoding: 'utf-8' }).trim();
    } catch (err: any) {
      return `Git Error: ${err.stdout || err.message}`;
    }
  };

  switch (name) {
    case 'git_status':
      return { status: execGit('status --porcelain') || 'Clean working directory' };
    case 'git_diff':
      return { diff: execGit('diff') || 'No modifications' };
    case 'git_log': {
      const count = args.count || 10;
      return { log: execGit(`log -n ${count} --oneline`) };
    }
    case 'git_branches':
      return { branches: execGit('branch -a') };
    case 'git_tags':
      return { tags: execGit('tag') };
    case 'git_blame':
      return { blame: execGit(`blame ${args.file}`) };
    case 'git_stage': {
      const filesStr = args.files.join(' ');
      return { result: execGit(`add ${filesStr}`) };
    }
    case 'git_commit':
      return { result: execGit(`commit -m "${args.message}"`) };
    case 'git_push':
      return { result: execGit('push') };
    case 'git_pull':
      return { result: execGit('pull') };
    case 'git_checkout':
      return { result: execGit(`checkout ${args.target}`) };
    case 'git_merge':
      return { result: execGit(`merge ${args.branch}`) };
    case 'git_rebase':
      return { result: execGit(`rebase ${args.base}`) };
    case 'git_stash': {
      if (args.action === 'save') return { result: execGit('stash push') };
      if (args.action === 'pop') return { result: execGit('stash pop') };
      if (args.action === 'list') return { result: execGit('stash list') };
      if (args.action === 'clear') return { result: execGit('stash clear') };
      return { result: 'Invalid stash action' };
    }
    case 'git_graph':
      return { graph: execGit('log --graph --oneline --decorate -n 15') };
    default:
      throw new Error(`UnsupportedGitTool: ${name}`);
  }
}
