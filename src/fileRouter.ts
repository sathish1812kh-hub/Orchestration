import * as fs from 'fs';
import * as path from 'path';
import { PolicyEngine } from './policyEngine';

export class FileRouter {
  private policyEngine: PolicyEngine;

  constructor(policyEngine: PolicyEngine) {
    this.policyEngine = policyEngine;
  }

  private checkPath(filePath: string) {
    const check = this.policyEngine.checkPath(filePath);
    if (!check.allowed) {
      throw new Error(`Policy violation: ${check.reason}`);
    }
  }

  public isBinaryFile(filePath: string): boolean {
    const buffer = Buffer.alloc(8000);
    const fd = fs.openSync(filePath, 'r');
    try {
      const bytesRead = fs.readSync(fd, buffer, 0, 8000, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) {
          return true;
        }
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  }

  public readFile(filePath: string): { content: string; isBinary: boolean } {
    const resolved = path.resolve(filePath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }

    const isBinary = this.isBinaryFile(resolved);
    if (isBinary) {
      return { content: '[Binary File: Display Suppressed]', isBinary: true };
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    return { content, isBinary: false };
  }

  public writeFile(filePath: string, content: string): void {
    const resolved = path.resolve(filePath);
    this.checkPath(resolved);

    // Create directories if they don't exist
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, 'utf-8');
  }

  public appendFile(filePath: string, content: string): void {
    const resolved = path.resolve(filePath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }

    fs.appendFileSync(resolved, content, 'utf-8');
  }

  public replaceText(filePath: string, target: string, replacement: string, isRegex = false): { matchesCount: number } {
    const resolved = path.resolve(filePath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }

    if (this.isBinaryFile(resolved)) {
      throw new Error('Cannot replace text in a binary file.');
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    let newContent = '';
    let matchesCount = 0;

    if (isRegex) {
      const regex = new RegExp(target, 'g');
      matchesCount = (content.match(regex) || []).length;
      newContent = content.replace(regex, replacement);
    } else {
      // Literal match
      let index = content.indexOf(target);
      while (index !== -1) {
        matchesCount++;
        index = content.indexOf(target, index + target.length);
      }
      newContent = content.split(target).join(replacement);
    }

    fs.writeFileSync(resolved, newContent, 'utf-8');
    return { matchesCount };
  }

  public deleteFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`File does not exist: ${resolved}`);
    }

    fs.unlinkSync(resolved);
  }

  public moveFile(srcPath: string, destPath: string): void {
    const resolvedSrc = path.resolve(srcPath);
    const resolvedDest = path.resolve(destPath);
    this.checkPath(resolvedSrc);
    this.checkPath(resolvedDest);

    if (!fs.existsSync(resolvedSrc)) {
      throw new Error(`Source file does not exist: ${resolvedSrc}`);
    }

    const destDir = path.dirname(resolvedDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(resolvedSrc, resolvedDest);
  }

  public copyFile(srcPath: string, destPath: string): void {
    const resolvedSrc = path.resolve(srcPath);
    const resolvedDest = path.resolve(destPath);
    this.checkPath(resolvedSrc);
    this.checkPath(resolvedDest);

    if (!fs.existsSync(resolvedSrc)) {
      throw new Error(`Source file does not exist: ${resolvedSrc}`);
    }

    const destDir = path.dirname(resolvedDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(resolvedSrc, resolvedDest);
  }

  public listDirectory(dirPath: string): Array<{ name: string; isDirectory: boolean; size: number; mtime: string }> {
    const resolved = path.resolve(dirPath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }

    const items = fs.readdirSync(resolved);
    return items.map(item => {
      const fullPath = path.join(resolved, item);
      try {
        const fileStats = fs.statSync(fullPath);
        return {
          name: item,
          isDirectory: fileStats.isDirectory(),
          size: fileStats.size,
          mtime: fileStats.mtime.toISOString()
        };
      } catch (e) {
        return {
          name: item,
          isDirectory: false,
          size: 0,
          mtime: new Date(0).toISOString()
        };
      }
    });
  }

  public createDirectory(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    this.checkPath(resolved);

    fs.mkdirSync(resolved, { recursive: true });
  }

  public deleteDirectory(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    this.checkPath(resolved);

    if (!fs.existsSync(resolved)) {
      throw new Error(`Directory does not exist: ${resolved}`);
    }

    fs.rmSync(resolved, { recursive: true, force: true });
  }

  public searchFiles(
    dirPath: string,
    query: string,
    options: { fileExtension?: string; searchContent?: boolean; isRegex?: boolean } = {}
  ): Array<{ path: string; line?: number; match?: string }> {
    const resolved = path.resolve(dirPath);
    this.checkPath(resolved);

    const results: Array<{ path: string; line?: number; match?: string }> = [];
    const maxResults = 100;

    const traverse = (currentDir: string) => {
      if (results.length >= maxResults) return;

      let items: string[] = [];
      try {
        items = fs.readdirSync(currentDir);
      } catch (e) {
        return; // Ignore inaccessible folders
      }

      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          // Verify directory before entering
          try {
            this.checkPath(fullPath);
            traverse(fullPath);
          } catch (e) {
            // Ignore policy disallowed subdirectories
          }
        } else {
          // File check
          try {
            this.checkPath(fullPath);
          } catch (e) {
            continue;
          }

          const ext = path.extname(fullPath).slice(1).toLowerCase();
          if (options.fileExtension && ext !== options.fileExtension.toLowerCase()) {
            continue;
          }

          if (options.searchContent) {
            if (this.isBinaryFile(fullPath)) continue;

            try {
              const fileContent = fs.readFileSync(fullPath, 'utf-8');
              const lines = fileContent.split(/\r?\n/);
              lines.forEach((lineText, lineIdx) => {
                if (results.length >= maxResults) return;

                let isMatch = false;
                if (options.isRegex) {
                  const regex = new RegExp(query, 'i');
                  isMatch = regex.test(lineText);
                } else {
                  isMatch = lineText.toLowerCase().includes(query.toLowerCase());
                }

                if (isMatch) {
                  results.push({
                    path: path.relative(resolved, fullPath),
                    line: lineIdx + 1,
                    match: lineText.trim()
                  });
                }
              });
            } catch (e) {
              // Ignore file read errors
            }
          } else {
            // Name search
            let isNameMatch = false;
            if (options.isRegex) {
              const regex = new RegExp(query, 'i');
              isNameMatch = regex.test(item);
            } else {
              isNameMatch = item.toLowerCase().includes(query.toLowerCase());
            }

            if (isNameMatch) {
              results.push({
                path: path.relative(resolved, fullPath)
              });
            }
          }
        }
      }
    };

    traverse(resolved);
    return results;
  }

  public getWorkspaceTree(dirPath: string, maxDepth = 3): any {
    const resolved = path.resolve(dirPath);
    this.checkPath(resolved);

    const buildTree = (currentDir: string, currentDepth: number): any => {
      if (currentDepth > maxDepth) return { name: path.basename(currentDir), truncated: true };

      const name = path.basename(currentDir) || currentDir;
      const result: any = { name, isDirectory: true, children: [] };

      let items: string[] = [];
      try {
        items = fs.readdirSync(currentDir);
      } catch (e) {
        return { name, error: 'Access Denied' };
      }

      for (const item of items) {
        const fullPath = path.join(currentDir, item);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          try {
            this.checkPath(fullPath);
            result.children.push(buildTree(fullPath, currentDepth + 1));
          } catch (e) {
            // Exclude
          }
        } else {
          try {
            this.checkPath(fullPath);
            result.children.push({
              name: item,
              isDirectory: false,
              size: stat.size
            });
          } catch (e) {
            // Exclude
          }
        }
      }

      return result;
    };

    return buildTree(resolved, 1);
  }
}
