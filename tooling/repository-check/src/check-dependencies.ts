import { builtinModules } from "node:module";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const WORKSPACE_PARENTS = [
  "apps",
  "packages",
  "games",
  "game-surfaces",
  "tooling",
  "tools",
];
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const IGNORED_DIRECTORIES = new Set([
  ".next",
  "playwright-report",
  "test-results",
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "fixtures",
  "node_modules",
]);
const PLATFORM_PACKAGES_WITHOUT_GAME_DEPENDENCIES = new Set([
  "packages/game-sdk",
  "packages/game-setup",
  "packages/game-server-runtime",
  "packages/game-surface-bridge",
  "packages/realtime-game-client-sdk",
  "packages/realtime-game-sdk",
  "packages/realtime-game-server-runtime",
  "packages/protocol",
]);
const UI_FORBIDDEN_PACKAGE_PATHS = new Set([
  "packages/database",
  "packages/game-client-sdk",
  "packages/game-registry",
  "packages/game-server-runtime",
  "packages/realtime-game-client-sdk",
  "packages/realtime-game-server-runtime",
  "packages/protocol",
]);
const CORE_ALLOWED_EXTERNAL_PACKAGES = new Set(["zod"]);
const NODE_BUILTINS = new Set(
  builtinModules.flatMap((moduleName) => [
    moduleName,
    moduleName.startsWith("node:") ? moduleName.slice(5) : `node:${moduleName}`,
  ]),
);

export type DependencyViolationCode =
  | "CORE_FORBIDDEN_API"
  | "CORE_FORBIDDEN_IMPORT"
  | "CROSS_GAME_DEPENDENCY"
  | "CROSS_PACKAGE_RELATIVE_IMPORT"
  | "CYCLIC_DEPENDENCY"
  | "GAME_IMPORT_OUTSIDE_REGISTRY"
  | "INVALID_PACKAGE_EXPORT"
  | "PLATFORM_TO_GAME_DEPENDENCY"
  | "SURFACE_FORBIDDEN_DEPENDENCY"
  | "SURFACE_SOURCE_IMPORT"
  | "UI_FORBIDDEN_DEPENDENCY"
  | "UNDECLARED_WORKSPACE_DEPENDENCY"
  | "UNEXPORTED_WORKSPACE_IMPORT";

export interface DependencyViolation {
  code: DependencyViolationCode;
  file: string;
  message: string;
}

export interface DependencyCheckResult {
  packageCount: number;
  sourceFileCount: number;
  violations: DependencyViolation[];
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: unknown;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  dependencies: Set<string>;
  exportKeys: Set<string>;
  exportTargets: string[];
  manifestPath: string;
  name: string;
  relativeDir: string;
  rootDir: string;
}

interface SourceInspection {
  imports: string[];
  violations: DependencyViolation[];
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relativeTo(rootDir: string, filePath: string): string {
  return toPosix(path.relative(rootDir, filePath));
}

function isInside(parentDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentDir, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function exportKeys(exportsField: unknown): Set<string> {
  if (typeof exportsField === "string") {
    return new Set(["."]);
  }

  if (
    exportsField === null ||
    typeof exportsField !== "object" ||
    Array.isArray(exportsField)
  ) {
    return new Set();
  }

  return new Set(
    Object.keys(exportsField).filter(
      (key) => key === "." || key.startsWith("./"),
    ),
  );
}

function exportTargets(exportsField: unknown): string[] {
  if (typeof exportsField === "string") {
    return [exportsField];
  }

  if (exportsField === null || typeof exportsField !== "object") {
    return [];
  }

  if (Array.isArray(exportsField)) {
    return exportsField.flatMap((entry) => exportTargets(entry));
  }

  return Object.values(exportsField).flatMap((entry) => exportTargets(entry));
}

function exportTargetHasSource(
  workspacePackage: WorkspacePackage,
  target: string,
): boolean {
  if (!target.startsWith("./")) {
    return false;
  }

  if (!target.startsWith("./dist/")) {
    return existsSync(path.resolve(workspacePackage.rootDir, target));
  }

  const emittedStem = target
    .replace(/^\.\/dist\//u, "")
    .replace(/\.d\.(?:c|m)?ts$/u, "")
    .replace(/\.(?:c|m)?js$/u, "");
  const sourceStems = new Set([path.join("src", emittedStem), emittedStem]);
  return [...sourceStems].some((sourceStem) =>
    [".ts", ".tsx", ".cts", ".mts"].some((extension) =>
      existsSync(
        path.resolve(workspacePackage.rootDir, `${sourceStem}${extension}`),
      ),
    ),
  );
}

async function discoverWorkspacePackages(
  rootDir: string,
): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = [];

  for (const parentName of WORKSPACE_PARENTS) {
    const parentDir = path.join(rootDir, parentName);
    if (!existsSync(parentDir)) {
      continue;
    }

    const entries = await readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageRoot = path.join(parentDir, entry.name);
      const manifestPath = path.join(packageRoot, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }

      const manifest = JSON.parse(
        await readFile(manifestPath, "utf8"),
      ) as PackageManifest;
      if (typeof manifest.name !== "string" || manifest.name.length === 0) {
        throw new Error(
          `${relativeTo(rootDir, manifestPath)} must declare a non-empty package name.`,
        );
      }

      const declaredDependencies = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);

      packages.push({
        dependencies: declaredDependencies,
        exportKeys: exportKeys(manifest.exports),
        exportTargets: exportTargets(manifest.exports),
        manifestPath,
        name: manifest.name,
        relativeDir: toPosix(path.join(parentName, entry.name)),
        rootDir: packageRoot,
      });
    }
  }

  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(entryPath)));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function isGamePackage(workspacePackage: WorkspacePackage): boolean {
  return workspacePackage.relativeDir.startsWith("games/");
}

function isGameSurfacePackage(workspacePackage: WorkspacePackage): boolean {
  return workspacePackage.relativeDir.startsWith("game-surfaces/");
}

function isGameCoreFile(
  workspacePackage: WorkspacePackage,
  filePath: string,
): boolean {
  if (!isGamePackage(workspacePackage)) {
    return false;
  }

  const relativePath = toPosix(
    path.relative(workspacePackage.rootDir, filePath),
  );
  return relativePath === "src/core.ts" || relativePath.startsWith("src/core/");
}

function packageNameFromSpecifier(specifier: string): string {
  if (!specifier.startsWith("@")) {
    return specifier.split("/")[0] ?? specifier;
  }

  return specifier.split("/").slice(0, 2).join("/");
}

function isForbiddenCoreImport(
  specifier: string,
  allowedCoreSdkPackages: ReadonlySet<string>,
): boolean {
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    return false;
  }

  if (NODE_BUILTINS.has(specifier)) {
    return true;
  }

  const importedPackageName = packageNameFromSpecifier(specifier);
  return (
    !allowedCoreSdkPackages.has(importedPackageName) &&
    !CORE_ALLOWED_EXTERNAL_PACKAGES.has(importedPackageName)
  );
}

function stringArgument(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteralLike(node)
    ? node.text
    : undefined;
}

function inspectSourceFile(
  rootDir: string,
  workspacePackage: WorkspacePackage,
  filePath: string,
  allowedCoreSdkPackages: ReadonlySet<string>,
): SourceInspection {
  const sourceText = ts.sys.readFile(filePath);
  if (sourceText === undefined) {
    throw new Error(`Unable to read ${filePath}.`);
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = new Set<string>();
  const violations: DependencyViolation[] = [];
  const coreFile = isGameCoreFile(workspacePackage, filePath);
  const displayPath = relativeTo(rootDir, filePath);

  const addCoreApiViolation = (api: string): void => {
    violations.push({
      code: "CORE_FORBIDDEN_API",
      file: displayPath,
      message: `Game Core must not use nondeterministic or environment API ${api}.`,
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = stringArgument(node.moduleSpecifier);
      if (specifier !== undefined) {
        imports.add(specifier);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const specifier = stringArgument(node.moduleReference.expression);
      if (specifier !== undefined) {
        imports.add(specifier);
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const specifier = stringArgument(node.arguments[0]);
        if (specifier !== undefined) {
          imports.add(specifier);
        }
      }

      if (coreFile && ts.isPropertyAccessExpression(node.expression)) {
        const owner = node.expression.expression;
        const member = node.expression.name.text;
        if (
          ts.isIdentifier(owner) &&
          owner.text === "Math" &&
          member === "random"
        ) {
          addCoreApiViolation("Math.random()");
        } else if (
          ts.isIdentifier(owner) &&
          owner.text === "Date" &&
          member === "now"
        ) {
          addCoreApiViolation("Date.now()");
        } else if (
          ts.isIdentifier(owner) &&
          owner.text === "performance" &&
          member === "now"
        ) {
          addCoreApiViolation("performance.now()");
        }
      }
    } else if (
      coreFile &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      addCoreApiViolation("new Date()");
    } else if (
      coreFile &&
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      node.name.text === "env"
    ) {
      addCoreApiViolation("process.env");
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (coreFile) {
    for (const specifier of imports) {
      if (isForbiddenCoreImport(specifier, allowedCoreSdkPackages)) {
        violations.push({
          code: "CORE_FORBIDDEN_IMPORT",
          file: displayPath,
          message: `Game Core import ${JSON.stringify(specifier)} is outside the allowed game-sdk + zod boundary.`,
        });
      }
    }
  }

  return { imports: [...imports].sort(), violations };
}

function findWorkspaceTarget(
  specifier: string,
  packagesByLongestName: readonly WorkspacePackage[],
): WorkspacePackage | undefined {
  return packagesByLongestName.find(
    (workspacePackage) =>
      specifier === workspacePackage.name ||
      specifier.startsWith(`${workspacePackage.name}/`),
  );
}

function exportKeyForImport(
  specifier: string,
  targetPackage: WorkspacePackage,
): string {
  if (specifier === targetPackage.name) {
    return ".";
  }

  return `.${specifier.slice(targetPackage.name.length)}`;
}

function relationViolations(
  rootDir: string,
  ownerPackage: WorkspacePackage,
  targetPackage: WorkspacePackage,
  filePath: string,
  relationship: string,
): DependencyViolation[] {
  const violations: DependencyViolation[] = [];
  const displayPath = relativeTo(rootDir, filePath);

  if (
    PLATFORM_PACKAGES_WITHOUT_GAME_DEPENDENCIES.has(ownerPackage.relativeDir) &&
    isGamePackage(targetPackage)
  ) {
    violations.push({
      code: "PLATFORM_TO_GAME_DEPENDENCY",
      file: displayPath,
      message: `${ownerPackage.name} must not ${relationship} concrete game ${targetPackage.name}.`,
    });
  }

  if (
    isGamePackage(ownerPackage) &&
    isGamePackage(targetPackage) &&
    ownerPackage.rootDir !== targetPackage.rootDir
  ) {
    violations.push({
      code: "CROSS_GAME_DEPENDENCY",
      file: displayPath,
      message: `${ownerPackage.name} must not ${relationship} another game ${targetPackage.name}.`,
    });
  }

  if (
    isGamePackage(targetPackage) &&
    ownerPackage.rootDir !== targetPackage.rootDir &&
    ownerPackage.relativeDir !== "packages/game-registry"
  ) {
    violations.push({
      code: "GAME_IMPORT_OUTSIDE_REGISTRY",
      file: displayPath,
      message: `${ownerPackage.name} must access concrete games only through game-registry composition.`,
    });
  }

  if (
    isGameSurfacePackage(ownerPackage) &&
    targetPackage.relativeDir !== "packages/game-surface-bridge"
  ) {
    violations.push({
      code: "SURFACE_FORBIDDEN_DEPENDENCY",
      file: displayPath,
      message: `${ownerPackage.name} must communicate through game-surface-bridge and must not ${relationship} workspace package ${targetPackage.name}.`,
    });
  }

  if (
    isGameSurfacePackage(targetPackage) &&
    ownerPackage.rootDir !== targetPackage.rootDir
  ) {
    violations.push({
      code: "SURFACE_SOURCE_IMPORT",
      file: displayPath,
      message: `${ownerPackage.name} must load ${targetPackage.name} as an immutable artifact instead of ${relationship} its source package.`,
    });
  }

  if (
    ownerPackage.relativeDir === "packages/ui" &&
    (isGamePackage(targetPackage) ||
      UI_FORBIDDEN_PACKAGE_PATHS.has(targetPackage.relativeDir))
  ) {
    violations.push({
      code: "UI_FORBIDDEN_DEPENDENCY",
      file: displayPath,
      message: `${ownerPackage.name} must not ${relationship} network, room, game, or database package ${targetPackage.name}.`,
    });
  }

  return violations;
}

function resolveRelativeModule(
  fromFile: string,
  specifier: string,
): string | undefined {
  const candidate = path.resolve(path.dirname(fromFile), specifier);
  const emittedExtension = path.extname(candidate);
  const sourceEquivalent =
    emittedExtension === ".js"
      ? `${candidate.slice(0, -3)}.ts`
      : emittedExtension === ".mjs"
        ? `${candidate.slice(0, -4)}.mts`
        : emittedExtension === ".cjs"
          ? `${candidate.slice(0, -4)}.cts`
          : undefined;
  const candidates = [
    candidate,
    ...(sourceEquivalent === undefined ? [] : [sourceEquivalent]),
    ...[...SOURCE_EXTENSIONS].map((extension) => `${candidate}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) =>
      path.join(candidate, `index${extension}`),
    ),
  ];
  return candidates.find((filePath) => existsSync(filePath));
}

function addGraphEdge(
  graph: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  const edges = graph.get(from) ?? new Set<string>();
  edges.add(to);
  graph.set(from, edges);
  if (!graph.has(to)) {
    graph.set(to, new Set());
  }
}

function findCycles(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  const state = new Map<string, "active" | "complete">();
  const stack: string[] = [];

  const visit = (node: string): void => {
    state.set(node, "active");
    stack.push(node);

    for (const target of graph.get(node) ?? []) {
      if (state.get(target) === "active") {
        const cycleStart = stack.lastIndexOf(target);
        const cycle = [...stack.slice(cycleStart), target];
        const key = [...new Set(cycle)].sort().join("|");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
      } else if (state.get(target) !== "complete") {
        visit(target);
      }
    }

    stack.pop();
    state.set(node, "complete");
  };

  for (const node of [...graph.keys()].sort()) {
    if (state.get(node) === undefined) {
      visit(node);
    }
  }

  return cycles;
}

export async function checkDependencies(
  requestedRootDir: string = process.cwd(),
): Promise<DependencyCheckResult> {
  const rootDir = path.resolve(requestedRootDir);
  const workspacePackages = await discoverWorkspacePackages(rootDir);
  const packagesByLongestName = [...workspacePackages].sort(
    (left, right) => right.name.length - left.name.length,
  );
  const allowedCoreSdkPackages = new Set(
    workspacePackages
      .filter((workspacePackage) =>
        ["packages/game-sdk", "packages/realtime-game-sdk"].includes(
          workspacePackage.relativeDir,
        ),
      )
      .map((workspacePackage) => workspacePackage.name),
  );
  const violations: DependencyViolation[] = [];
  const packageGraph = new Map<string, Set<string>>();
  const moduleGraph = new Map<string, Set<string>>();
  let sourceFileCount = 0;

  for (const workspacePackage of workspacePackages) {
    packageGraph.set(workspacePackage.name, new Set());

    if (
      workspacePackage.relativeDir.startsWith("packages/") &&
      workspacePackage.exportKeys.size === 0
    ) {
      violations.push({
        code: "INVALID_PACKAGE_EXPORT",
        file: relativeTo(rootDir, workspacePackage.manifestPath),
        message: `${workspacePackage.name} must declare an explicit public export map.`,
      });
    }

    for (const exportTarget of workspacePackage.exportTargets) {
      if (!exportTargetHasSource(workspacePackage, exportTarget)) {
        violations.push({
          code: "INVALID_PACKAGE_EXPORT",
          file: relativeTo(rootDir, workspacePackage.manifestPath),
          message: `Public export target ${JSON.stringify(exportTarget)} has no corresponding source file.`,
        });
      }
    }

    for (const dependencyName of workspacePackage.dependencies) {
      const targetPackage = workspacePackages.find(
        (candidatePackage) => candidatePackage.name === dependencyName,
      );
      if (targetPackage === undefined) {
        continue;
      }

      addGraphEdge(packageGraph, workspacePackage.name, targetPackage.name);
      violations.push(
        ...relationViolations(
          rootDir,
          workspacePackage,
          targetPackage,
          workspacePackage.manifestPath,
          "declare a dependency on",
        ),
      );
    }

    const sourceFiles = await listSourceFiles(workspacePackage.rootDir);
    sourceFileCount += sourceFiles.length;

    for (const sourceFile of sourceFiles) {
      moduleGraph.set(sourceFile, moduleGraph.get(sourceFile) ?? new Set());
      const inspection = inspectSourceFile(
        rootDir,
        workspacePackage,
        sourceFile,
        allowedCoreSdkPackages,
      );
      violations.push(...inspection.violations);

      for (const specifier of inspection.imports) {
        if (specifier.startsWith(".")) {
          const absoluteCandidate = path.resolve(
            path.dirname(sourceFile),
            specifier,
          );
          const targetPackage = workspacePackages.find((candidatePackage) =>
            isInside(candidatePackage.rootDir, absoluteCandidate),
          );
          if (
            targetPackage !== undefined &&
            targetPackage.rootDir !== workspacePackage.rootDir
          ) {
            violations.push({
              code: "CROSS_PACKAGE_RELATIVE_IMPORT",
              file: relativeTo(rootDir, sourceFile),
              message: `Cross-package relative import ${JSON.stringify(specifier)} bypasses public exports.`,
            });
            violations.push(
              ...relationViolations(
                rootDir,
                workspacePackage,
                targetPackage,
                sourceFile,
                "import",
              ),
            );
          }

          const resolvedModule = resolveRelativeModule(sourceFile, specifier);
          if (resolvedModule !== undefined) {
            addGraphEdge(moduleGraph, sourceFile, resolvedModule);
          }
          continue;
        }

        const targetPackage = findWorkspaceTarget(
          specifier,
          packagesByLongestName,
        );
        if (
          targetPackage === undefined ||
          targetPackage.rootDir === workspacePackage.rootDir
        ) {
          continue;
        }

        addGraphEdge(packageGraph, workspacePackage.name, targetPackage.name);
        violations.push(
          ...relationViolations(
            rootDir,
            workspacePackage,
            targetPackage,
            sourceFile,
            "import",
          ),
        );

        if (!workspacePackage.dependencies.has(targetPackage.name)) {
          violations.push({
            code: "UNDECLARED_WORKSPACE_DEPENDENCY",
            file: relativeTo(rootDir, sourceFile),
            message: `${workspacePackage.name} imports ${targetPackage.name} without declaring it in package.json.`,
          });
        }

        const requestedExport = exportKeyForImport(specifier, targetPackage);
        if (!targetPackage.exportKeys.has(requestedExport)) {
          violations.push({
            code: "UNEXPORTED_WORKSPACE_IMPORT",
            file: relativeTo(rootDir, sourceFile),
            message: `${JSON.stringify(specifier)} is not a declared public export of ${targetPackage.name}.`,
          });
        }
      }
    }
  }

  for (const cycle of findCycles(packageGraph)) {
    violations.push({
      code: "CYCLIC_DEPENDENCY",
      file: "package.json",
      message: `Workspace package cycle: ${cycle.join(" -> ")}.`,
    });
  }

  for (const cycle of findCycles(moduleGraph)) {
    violations.push({
      code: "CYCLIC_DEPENDENCY",
      file: relativeTo(rootDir, cycle[0] ?? rootDir),
      message: `Source module cycle: ${cycle.map((filePath) => relativeTo(rootDir, filePath)).join(" -> ")}.`,
    });
  }

  violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );

  return {
    packageCount: workspacePackages.length,
    sourceFileCount,
    violations,
  };
}

export function formatDependencyViolations(
  violations: readonly DependencyViolation[],
): string {
  return violations
    .map(
      (violation) =>
        `${violation.file} [${violation.code}] ${violation.message}`,
    )
    .join("\n");
}

async function runCli(): Promise<void> {
  const rootDir = process.argv[2] ?? process.cwd();
  const result = await checkDependencies(rootDir);
  if (result.violations.length > 0) {
    console.error(formatDependencyViolations(result.violations));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Dependency boundaries passed for ${result.packageCount} workspace packages and ${result.sourceFileCount} source files.`,
  );
}

const executedFile = process.argv[1];
if (
  executedFile !== undefined &&
  import.meta.url === pathToFileURL(executedFile).href
) {
  await runCli();
}
