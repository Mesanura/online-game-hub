import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".npm-cache",
  ".pnpm-store",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const EXTERNAL_SCHEMES = /^(?:https?:|mailto:|tel:|data:)/iu;

export interface MarkdownLinkViolation {
  file: string;
  line: number;
  target: string;
}

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function stripFencedCode(markdown: string): string {
  return markdown.replace(/^(```|~~~)[\s\S]*?^\1.*$/gmu, (block) =>
    block.replace(/[^\n]/gu, " "),
  );
}

function normalizeLinkTarget(rawTarget: string): string {
  const trimmedTarget = rawTarget.trim();
  if (trimmedTarget.startsWith("<")) {
    const closingBracket = trimmedTarget.indexOf(">");
    return closingBracket === -1
      ? trimmedTarget
      : trimmedTarget.slice(1, closingBracket);
  }

  return trimmedTarget.split(/\s+["']/u, 1)[0] ?? trimmedTarget;
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export async function checkMarkdownLinks(
  requestedRootDir: string = process.cwd(),
): Promise<MarkdownLinkViolation[]> {
  const rootDir = path.resolve(requestedRootDir);
  const markdownFiles = await listMarkdownFiles(rootDir);
  const violations: MarkdownLinkViolation[] = [];

  for (const markdownFile of markdownFiles) {
    const markdown = stripFencedCode(await readFile(markdownFile, "utf8"));
    const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;

    for (const match of markdown.matchAll(linkPattern)) {
      const target = normalizeLinkTarget(match[1] ?? "");
      if (
        target.length === 0 ||
        target.startsWith("#") ||
        target.startsWith("/") ||
        EXTERNAL_SCHEMES.test(target)
      ) {
        continue;
      }

      const [encodedPath] = target.split("#", 1);
      if (encodedPath === undefined || encodedPath.length === 0) {
        continue;
      }

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(encodedPath);
      } catch {
        decodedPath = encodedPath;
      }

      const resolvedTarget = path.resolve(
        path.dirname(markdownFile),
        decodedPath,
      );
      if (!existsSync(resolvedTarget)) {
        violations.push({
          file: path.relative(rootDir, markdownFile).split(path.sep).join("/"),
          line: lineNumberAt(markdown, match.index),
          target,
        });
      }
    }
  }

  return violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line,
  );
}

async function runCli(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();
  const violations = await checkMarkdownLinks(rootDir);
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.file}:${violation.line} points to missing local target ${JSON.stringify(violation.target)}.`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("Local Markdown links passed.");
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  await runCli();
}
