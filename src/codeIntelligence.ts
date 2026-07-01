import * as fs from 'fs';
import * as path from 'path';
import { AuditLogger } from './auditLogger';

export const codeToolSchemas = [
  // Source Code Intelligence
  { name: 'code_index', description: 'Scan and index symbols inside a directory path', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_symbols', description: 'Get all declared classes and functions in a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_dependencies', description: 'List package imports and file dependencies', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_references', description: 'Locate text references of a symbol across files', inputSchema: { type: 'object', properties: { path: { type: 'string' }, symbol: { type: 'string' } }, required: ['path', 'symbol'] } },
  { name: 'code_outline', description: 'Get structural outline of class and method structures in a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_metrics', description: 'Retrieve lines counts and size metrics of a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_complexity', description: 'Compute estimated cyclomatic complexity of functions in a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_todo', description: 'Find all TODO annotations inside code files', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_fixme', description: 'Find all FIXME annotations inside code files', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'code_documentation', description: 'Analyze docstrings and JSDoc comment blocks in a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },

  // Workspace Intelligence
  { name: 'workspace_detect', description: 'Automatically identify project types (Node, Python, Git, Rust, Docker, etc.)', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'workspace_summary', description: 'Generate automatic summaries of project dependencies, size, and layout', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
];

export async function handleCodeTool(name: string, args: any, auditLogger: AuditLogger): Promise<any> {
  auditLogger.log({
    timestamp: new Date().toISOString(),
    toolName: name,
    command: JSON.stringify(args)
  } as any);

  switch (name) {
    case 'code_index':
    case 'code_outline':
    case 'code_symbols': {
      const content = fs.readFileSync(args.path, 'utf-8');
      const symbols: string[] = [];
      const classMatches = content.matchAll(/(?:class|interface|struct)\s+([a-zA-Z0-9_]+)/g);
      const funcMatches = content.matchAll(/(?:function|def|const)\s+([a-zA-Z0-9_]+)\s*(?:=|\()/g);
      
      for (const match of classMatches) {
        symbols.push(`Type: ${match[1]}`);
      }
      for (const match of funcMatches) {
        symbols.push(`Function/Const: ${match[1]}`);
      }
      return { path: args.path, symbols };
    }

    case 'code_dependencies': {
      const content = fs.readFileSync(args.path, 'utf-8');
      const imports: string[] = [];
      const jsImports = content.matchAll(/(?:import|require)\s+.*from\s+['"]([^'"]+)['"]/g);
      const pythonImports = content.matchAll(/(?:import|from)\s+([a-zA-Z0-9_.]+)/g);

      for (const match of jsImports) {
        imports.push(match[1]);
      }
      for (const match of pythonImports) {
        imports.push(match[1]);
      }
      return { path: args.path, dependencies: Array.from(new Set(imports)) };
    }

    case 'code_references': {
      const sym = args.symbol.toLowerCase();
      const traverseRefs = (dir: string): string[] => {
        let items: string[] = [];
        try { items = fs.readdirSync(dir); } catch (_) { return []; }
        const refs: string[] = [];
        for (const item of items) {
          const full = path.join(dir, item);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            if (item !== 'node_modules' && item !== '.git') {
              refs.push(...traverseRefs(full));
            }
          } else {
            if (item.endsWith('.ts') || item.endsWith('.js') || item.endsWith('.py') || item.endsWith('.cs')) {
              try {
                const text = fs.readFileSync(full, 'utf-8');
                if (text.toLowerCase().includes(sym)) {
                  refs.push(full);
                }
              } catch (_) {}
            }
          }
        }
        return refs;
      };
      return { symbol: args.symbol, references: traverseRefs(args.path).slice(0, 50) };
    }

    case 'code_metrics': {
      const content = fs.readFileSync(args.path, 'utf-8');
      const lines = content.split(/\r?\n/);
      const blankLines = lines.filter(l => l.trim().length === 0).length;
      const commentLines = lines.filter(l => l.trim().startsWith('//') || l.trim().startsWith('#') || l.trim().startsWith('/*') || l.trim().startsWith('*')).length;
      return {
        path: args.path,
        totalLines: lines.length,
        blankLines,
        commentLines,
        codeLines: lines.length - blankLines - commentLines,
        sizeBytes: fs.statSync(args.path).size
      };
    }

    case 'code_complexity': {
      const content = fs.readFileSync(args.path, 'utf-8');
      const decisionPoints = (content.match(/\b(if|else\s+if|for|while|catch|&&|\|\|)\b/g) || []).length;
      return {
        path: args.path,
        estimatedCyclomaticComplexity: decisionPoints + 1,
        verdict: decisionPoints < 10 ? 'Low Complexity' : decisionPoints < 25 ? 'Moderate' : 'High'
      };
    }

    case 'code_todo':
    case 'code_fixme': {
      const trigger = name === 'code_todo' ? 'TODO' : 'FIXME';
      const content = fs.readFileSync(args.path, 'utf-8');
      const lines = content.split(/\r?\n/);
      const annotations: any[] = [];
      lines.forEach((lineText, idx) => {
        if (lineText.includes(trigger)) {
          annotations.push({ line: idx + 1, text: lineText.trim() });
        }
      });
      return { path: args.path, annotations };
    }

    case 'code_documentation': {
      const content = fs.readFileSync(args.path, 'utf-8');
      const docblocks: string[] = [];
      const jsDocMatches = content.matchAll(/\/\*\*([\s\S]*?)\*\//g);
      const pythonDocMatches = content.matchAll(/"""([\s\S]*?)"""/g);

      for (const match of jsDocMatches) {
        docblocks.push(match[1].trim());
      }
      for (const match of pythonDocMatches) {
        docblocks.push(match[1].trim());
      }
      return { path: args.path, documentationBlocks: docblocks };
    }

    case 'workspace_detect': {
      const items = fs.readdirSync(args.path);
      const detections: string[] = [];
      if (items.includes('.git')) detections.push('Git Repository');
      if (items.includes('package.json')) detections.push('Node.js / npm Project');
      if (items.includes('requirements.txt') || items.includes('pyproject.toml') || items.includes('Pipfile')) detections.push('Python Project');
      if (items.includes('Cargo.toml')) detections.push('Rust Cargo Project');
      if (items.includes('go.mod')) detections.push('Go Module');
      if (items.some(f => f.endsWith('.sln') || f.endsWith('.csproj'))) detections.push('.NET Project');
      if (items.includes('Dockerfile')) detections.push('Docker Project');
      if (items.includes('docker-compose.yml')) detections.push('Docker Compose Project');
      if (items.includes('tsconfig.json')) detections.push('TypeScript Project');
      
      return { path: args.path, detectedProjectTypes: detections };
    }

    case 'workspace_summary': {
      const items = fs.readdirSync(args.path);
      const hasNode = items.includes('package.json');
      let nodeDependencies: string[] = [];
      if (hasNode) {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(args.path, 'package.json'), 'utf-8'));
          nodeDependencies = Object.keys(pkg.dependencies || {});
        } catch (_) {}
      }

      return {
        path: args.path,
        filesCount: items.length,
        hasGit: items.includes('.git'),
        hasNode,
        nodeDependencies,
        hasDocker: items.includes('Dockerfile')
      };
    }

    default:
      throw new Error(`UnsupportedCodeTool: ${name}`);
  }
}
