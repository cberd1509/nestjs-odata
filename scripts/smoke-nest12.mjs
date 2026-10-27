#!/usr/bin/env node
// Consumer smoke test for NestJS 12 + TypeORM 1 in an ESM ("type": "module", NodeNext) app.
//
// 1. Packs the built @nestjs-odata/core and @nestjs-odata/typeorm (run `pnpm build` first).
// 2. Copies smoke/nest12-esm into a temporary directory outside the workspace, so the
//    packages resolve their peers (Nest 12, TypeORM 1) exactly like a real consumer.
// 3. Installs the tarballs with npm, type-checks the app with tsc (NodeNext, skipLibCheck off)
//    and runs its node:test suite against the compiled JavaScript.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(join(tmpdir(), 'nestjs-odata-smoke-'))
const keep = process.env.KEEP_SMOKE_DIR === '1'

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

try {
  const packs = join(work, 'packs')
  for (const pkg of ['core', 'typeorm']) {
    run('pnpm', ['pack', '--pack-destination', packs], join(root, 'packages', pkg))
  }
  const app = join(work, 'app')
  cpSync(join(root, 'smoke', 'nest12-esm'), app, {
    recursive: true,
    filter: (src) => !/node_modules|dist/.test(src.slice(root.length)),
  })
  const tarballs = readdirSync(packs).map((f) => join(packs, f))
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], app)
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', ...tarballs], app)
  run('npm', ['run', 'build'], app)
  run('npm', ['test'], app)
  console.log('Nest 12 ESM smoke test passed')
} finally {
  if (keep) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}
