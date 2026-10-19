import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { $ } from "bun";
import packageJson from "../package.json";

/**
 * Build release archives for every supported platform.
 *
 * Cross-compiles from whatever machine runs this — Bun downloads the target
 * runtime, and OpenTUI's per-platform native library is pulled in via
 * `bun install --os/--cpu` (its optionalDependencies only install for the host
 * platform otherwise, and without them the bundler fails to resolve the
 * dynamic `import("@opentui/core-<platform>")`).
 *
 * Produces, in dist/:
 *   kev-v<version>-<os>-<arch>.tar.gz  (kev[.exe] inside)
 *   kev-v<version>-windows-x64.zip
 *   install.sh                          (shipped as a release asset too, so the
 *                                        curl|bash URL tracks the latest release)
 *   SHA256SUMS                          (covers the archives and install.sh)
 */

type Target = { os: "linux" | "darwin" | "windows"; arch: "x64" | "arm64" };

const TARGETS: Target[] = [
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "arm64" },
  { os: "windows", arch: "x64" },
];

const version = packageJson.version;
const tag = `v${version}`;
const distDir = "dist";
const stagingDir = `${distDir}/.staging`;

const isWindows = (t: Target) => t.os === "windows";
// The bundled binary's name inside the archive.
const binaryName = (t: Target) => (isWindows(t) ? "kev.exe" : "kev");
const archiveName = (t: Target) =>
  `kev-${tag}-${t.os}-${t.arch}.${isWindows(t) ? "zip" : "tar.gz"}`;
// bun's --os flag uses the JS platform name for Windows; target triples don't.
const bunInstallOs = (t: Target) => (isWindows(t) ? "win32" : t.os);

await rm(distDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });

// Make OpenTUI's native library for each target platform installable.
for (const t of TARGETS) {
  await $`bun install --frozen-lockfile --os=${bunInstallOs(t)} --cpu=${t.arch}`.quiet();
}

const checksums: string[] = [];
for (const t of TARGETS) {
  const target = `bun-${t.os}-${t.arch}`;
  const outfile = `${distDir}/kev-${t.os}-${t.arch}`;
  await $`bun build --compile --target=${target} src/index.tsx --outfile=${outfile}`;
  // The bundler appends .exe itself when targeting Windows.
  const built = isWindows(t) ? `${outfile}.exe` : outfile;

  const stagedDir = `${stagingDir}/${t.os}-${t.arch}`;
  const stagedBinary = `${stagedDir}/${binaryName(t)}`;
  await mkdir(stagedDir, { recursive: true });
  await copyFile(built, stagedBinary);
  await chmod(stagedBinary, 0o755);

  const archive = `${distDir}/${archiveName(t)}`;
  if (isWindows(t)) {
    await $`zip -jq ${archive} ${stagedBinary}`;
  } else {
    await $`tar -czf ${archive} -C ${stagedDir} ${binaryName(t)}`;
  }

  const bytes = await readFile(archive);
  const digest = createHash("sha256").update(bytes).digest("hex");
  checksums.push(`${digest}  ${archiveName(t)}`);
  console.log(`  ${archiveName(t)}  ${bytes.byteLength} bytes`);
}

// The installer ships with every release; its checksum belongs in SHA256SUMS.
const installer = `${distDir}/install.sh`;
await copyFile("scripts/install.sh", installer);
await chmod(installer, 0o755);
const installerBytes = await readFile(installer);
checksums.push(`${createHash("sha256").update(installerBytes).digest("hex")}  install.sh`);

await writeFile(`${distDir}/SHA256SUMS`, `${checksums.join("\n")}\n`);
await rm(stagingDir, { recursive: true, force: true });

console.log(`\nBuilt kev ${tag}: ${TARGETS.length} archives + install.sh + SHA256SUMS in ${distDir}/`);
