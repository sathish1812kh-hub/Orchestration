import * as fs from 'fs';
import * as path from 'path';
import { PolicyEngine } from './policyEngine';

export interface ProjectAnalysisResult {
  technologies: string[];
  dependencies: Record<string, string>;
  brokenImports: Array<{ file: string; importPath: string; line: number }>;
  unusedFiles: string[];
  circularDependencies: string[][];
}

export class ProjectAnalyzer {
  private policyEngine: PolicyEngine;

  constructor(policyEngine: PolicyEngine) {
    this.policyEngine = policyEngine;
  }

  public analyze(projectRoot: string): ProjectAnalysisResult {
    const resolvedRoot = path.resolve(projectRoot);
    const check = this.policyEngine.checkPath(resolvedRoot);
    if (!check.allowed) {
      throw new Error(`Policy violation: ${check.reason}`);
    }

    const technologies = this.detectTechnologies(resolvedRoot);
    const dependencies = this.analyzeDependencies(resolvedRoot);

    // Scan all files in project (excluding node_modules, .git, etc.)
    const files = this.getAllProjectFiles(resolvedRoot);

    // Build the dependency graph
    const { graph, brokenImports } = this.buildImportGraph(resolvedRoot, files);

    const unusedFiles = this.detectUnusedFiles(files, graph, resolvedRoot);
    const circularDependencies = this.detectCircularDependencies(graph);

    return {
      technologies,
      dependencies,
      brokenImports,
      unusedFiles,
      circularDependencies
    };
  }

  private detectTechnologies(root: string): string[] {
    const techs: string[] = [];

    if (fs.existsSync(path.join(root, 'package.json'))) techs.push('Node.js / JavaScript / TypeScript');
    if (fs.existsSync(path.join(root, 'tsconfig.json'))) techs.push('TypeScript Project');
    if (fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'))) techs.push('Python');
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) techs.push('Rust');
    if (fs.existsSync(path.join(root, 'go.mod'))) techs.push('Go');
    if (fs.existsSync(path.join(root, 'gemfile'))) techs.push('Ruby');
    if (fs.existsSync(path.join(root, 'pom.xml')) || fs.existsSync(path.join(root, 'build.gradle'))) techs.push('Java');
    if (fs.readdirSync(root).some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) techs.push('.NET / C#');

    return techs;
  }

  private analyzeDependencies(root: string): Record<string, string> {
    const deps: Record<string, string> = {};
    const pkgPath = path.join(root, 'package.json');

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        Object.assign(deps, pkg.dependencies || {}, pkg.devDependencies || {});
      } catch (e) {
        // Ignore JSON parse error
      }
    }

    return deps;
  }

  private getAllProjectFiles(root: string): string[] {
    const files: string[] = [];
    const traverse = (dir: string) => {
      let items: string[] = [];
      try {
        items = fs.readdirSync(dir);
      } catch (e) {
        return;
      }

      for (const item of items) {
        const fullPath = path.join(dir, item);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          // Skip node_modules, git, dist, build directories
          if (['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj'].includes(item)) {
            continue;
          }
          traverse(fullPath);
        } else {
          // Filter to interesting source code file extensions
          const ext = path.extname(fullPath).toLowerCase();
          if (['.ts', '.js', '.tsx', '.jsx', '.py'].includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    };

    traverse(root);
    return files;
  }

  private buildImportGraph(
    root: string,
    files: string[]
  ): { graph: Record<string, string[]>; brokenImports: ProjectAnalysisResult['brokenImports'] } {
    const graph: Record<string, string[]> = {};
    const brokenImports: ProjectAnalysisResult['brokenImports'] = [];

    // Initialize graph
    for (const file of files) {
      graph[file] = [];
    }

    const jsTsRegex = /(?:import|export)\s+(?:[\w\s{},*]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;
    const pyRegex = /(?:from\s+([\w.]+)\s+import)|(?:import\s+([\w.,\s]+))/g;

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const ext = path.extname(file).toLowerCase();
        const dir = path.dirname(file);

        if (ext === '.ts' || ext === '.js' || ext === '.tsx' || ext === '.jsx') {
          let match;
          // Reset regex
          jsTsRegex.lastIndex = 0;
          
          // Get file lines to determine line number
          const lines = content.split(/\r?\n/);

          lines.forEach((lineText, lineIdx) => {
            let m;
            // Scan line by line for imports
            const localRegex = new RegExp(jsTsRegex);
            while ((m = localRegex.exec(lineText)) !== null) {
              const importPath = m[1] || m[2];
              if (!importPath) continue;

              // Only resolve local imports
              if (importPath.startsWith('.')) {
                const resolved = this.resolveLocalImport(dir, importPath);
                if (resolved && fs.existsSync(resolved)) {
                  graph[file].push(resolved);
                } else {
                  brokenImports.push({
                    file: path.relative(root, file),
                    importPath,
                    line: lineIdx + 1
                  });
                }
              }
            }
          });
        } else if (ext === '.py') {
          const lines = content.split(/\r?\n/);
          lines.forEach((lineText, lineIdx) => {
            let m;
            const localRegex = new RegExp(pyRegex);
            while ((m = localRegex.exec(lineText)) !== null) {
              const fromModule = m[1];
              const importModules = m[2];

              if (fromModule) {
                // e.g. from utils import helper
                if (fromModule.startsWith('.')) {
                  // Local python import
                  const resolved = this.resolvePythonImport(dir, fromModule);
                  if (resolved && fs.existsSync(resolved)) {
                    graph[file].push(resolved);
                  } else {
                    brokenImports.push({
                      file: path.relative(root, file),
                      importPath: fromModule,
                      line: lineIdx + 1
                    });
                  }
                }
              } else if (importModules) {
                // e.g. import os, sys, .local_module
                const modules = importModules.split(',').map(s => s.trim());
                for (const mod of modules) {
                  if (mod.startsWith('.')) {
                    const resolved = this.resolvePythonImport(dir, mod);
                    if (resolved && fs.existsSync(resolved)) {
                      graph[file].push(resolved);
                    } else {
                      brokenImports.push({
                        file: path.relative(root, file),
                        importPath: mod,
                        line: lineIdx + 1
                      });
                    }
                  }
                }
              }
            }
          });
        }
      } catch (e) {
        // Skip unreadable files
      }
    }

    return { graph, brokenImports };
  }

  private resolveLocalImport(dir: string, importPath: string): string | null {
    const fullPath = path.resolve(dir, importPath);
    
    // Extensions to check
    const exts = ['.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js', '/index.tsx', '/index.jsx'];
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }

    for (const ext of exts) {
      const pathWithExt = fullPath + ext;
      if (fs.existsSync(pathWithExt) && fs.statSync(pathWithExt).isFile()) {
        return pathWithExt;
      }
    }

    return null;
  }

  private resolvePythonImport(dir: string, importPath: string): string | null {
    // E.g. from .utils import some_func -> importPath is '.utils'
    // Resolve relative dots
    let dots = 0;
    while (importPath[dots] === '.') {
      dots++;
    }

    const rest = importPath.substring(dots).replace(/\./g, path.sep);
    let targetDir = dir;
    for (let i = 1; i < dots; i++) {
      targetDir = path.dirname(targetDir);
    }

    const fullPath = path.join(targetDir, rest);
    
    const possibleFiles = [
      fullPath + '.py',
      path.join(fullPath, '__init__.py')
    ];

    for (const file of possibleFiles) {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return file;
      }
    }

    return null;
  }

  private detectUnusedFiles(files: string[], graph: Record<string, string[]>, root: string): string[] {
    const importedSet = new Set<string>();

    for (const targets of Object.values(graph)) {
      for (const t of targets) {
        importedSet.add(t);
      }
    }

    const unused: string[] = [];
    for (const file of files) {
      // Ignore obvious main entry points
      const baseName = path.basename(file).toLowerCase();
      if (['index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js', 'server.ts', 'server.js', 'index.tsx', 'app.py', 'main.py'].includes(baseName)) {
        continue;
      }

      if (!importedSet.has(file)) {
        unused.push(path.relative(root, file));
      }
    }

    return unused;
  }

  private circularDependencies: string[][] = [];
  private visited: Record<string, number> = {}; // 0 = unvisited, 1 = visiting, 2 = visited
  private stack: string[] = [];

  private detectCircularDependencies(graph: Record<string, string[]>): string[][] {
    this.circularDependencies = [];
    this.visited = {};
    this.stack = [];

    const nodes = Object.keys(graph);
    for (const node of nodes) {
      this.visited[node] = 0;
    }

    for (const node of nodes) {
      if (this.visited[node] === 0) {
        this.dfsCycleSearch(node, graph);
      }
    }

    return this.circularDependencies;
  }

  private dfsCycleSearch(node: string, graph: Record<string, string[]>) {
    this.visited[node] = 1; // Visiting
    this.stack.push(node);

    const neighbors = graph[node] || [];
    for (const neighbor of neighbors) {
      if (this.visited[neighbor] === 1) {
        // Cycle detected
        const cycleStartIndex = this.stack.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          const cycle = this.stack.slice(cycleStartIndex).map(n => path.basename(n));
          cycle.push(path.basename(neighbor));
          this.circularDependencies.push(cycle);
        }
      } else if (this.visited[neighbor] === 0) {
        this.dfsCycleSearch(neighbor, graph);
      }
    }

    this.stack.pop();
    this.visited[node] = 2; // Visited
  }
}
