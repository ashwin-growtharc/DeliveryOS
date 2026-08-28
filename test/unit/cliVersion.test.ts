import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The CLI's `--version` string is a hardcoded literal in
// src/cli/program.ts, because tsconfig's `rootDir: src` makes importing
// package.json from there impossible without restructuring the build.
//
// A hardcoded version drifts, and this one did: package.json and
// tauri.conf.json moved to 0.1.2 while the literal stayed at 0.1.0, so the
// `deliveryos` CLI shipped *inside* the 0.1.2 installer would have reported
// itself as 0.1.0. Nothing caught it, because nothing was looking.
//
// This test is what makes that impossible. If you bump one, you bump all
// three, or the build fails here and tells you which is out of step.

const REPO_ROOT = path.join(__dirname, '..', '..');

function readJson(relativePath: string): { version: string } {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf-8'));
}

describe('version consistency', () => {
  const pkgVersion = readJson('package.json').version;

  it('the CLI reports the same version as package.json', () => {
    const programSource = fs.readFileSync(
      path.join(REPO_ROOT, 'src', 'cli', 'program.ts'),
      'utf-8',
    );
    const match = programSource.match(/\.version\('([^']+)'\)/);
    expect(match, 'could not find a .version(...) call in src/cli/program.ts').toBeTruthy();
    expect(
      match?.[1],
      `src/cli/program.ts declares ${match?.[1]} but package.json is ${pkgVersion}`,
    ).toBe(pkgVersion);
  });

  it('the installer reports the same version as package.json', () => {
    // tauri.conf.json's version is both the installer's version and the string
    // the auto-updater compares against, so a mismatch here means users are
    // told one version and running another.
    const tauriVersion = readJson(path.join('src-tauri', 'tauri.conf.json')).version;
    expect(
      tauriVersion,
      `src-tauri/tauri.conf.json declares ${tauriVersion} but package.json is ${pkgVersion}`,
    ).toBe(pkgVersion);
  });

  it('the Rust crate reports the same version as package.json', () => {
    const cargo = fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'Cargo.toml'), 'utf-8');
    const match = cargo.match(/^version = "([^"]+)"/m);
    expect(match, 'could not find a version in src-tauri/Cargo.toml').toBeTruthy();
    expect(
      match?.[1],
      `src-tauri/Cargo.toml declares ${match?.[1]} but package.json is ${pkgVersion}`,
    ).toBe(pkgVersion);
  });
});
