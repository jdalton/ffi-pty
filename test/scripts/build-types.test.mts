import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { buildTypes } from '../../scripts/build-types.mts'
import { repositoryRoot } from '../../paths/repository.mts'

const require = createRequire(import.meta.url)
test('declarations publish node-pty option and terminal types without source-file imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-types-'))
  try {
    cpSync(join(repositoryRoot, 'src'), join(root, 'src'), { recursive: true })
    buildTypes(root)
    cpSync(
      join(repositoryRoot, 'test/fixtures/node-pty.d.mts'),
      join(root, 'node-pty.d.mts'),
    )
    const directory = join(root, 'dist/types')
    assert.ok(readdirSync(directory).includes('index.d.mts'))
    for (const file of readdirSync(directory, { recursive: true }).filter(
      name => name.endsWith('.d.mts'),
    )) {
      assert.doesNotMatch(
        readFileSync(join(directory, file), 'utf8'),
        /from ['"].*\.mts['"];/,
      )
    }
    writeFileSync(
      join(root, 'consumer.mts'),
      `import {spawn as spawnSync,type IPty,type IBasePtyForkOptions,type IWindowsPtyForkOptions,type IPtyForkOptions,type IEvent,type IDisposable} from './dist/types/compat-index.mjs';
import {spawn,spawnSync as immediateSpawn} from './dist/types/index.mjs';
import type * as upstream from './node-pty.mjs';
import * as replacement from './dist/types/compat-index.mjs';
const dropIn: typeof upstream = replacement;
const base: IBasePtyForkOptions={encoding:'utf8',env:{EMPTY:undefined}};
const windows:IWindowsPtyForkOptions={...base,useConptyDll:true};
const unix:IPtyForkOptions={...base,uid:0};
const terminal:IPty=spawnSync('cmd.exe','/c echo hello',windows);
const synchronous:void=terminal.write('hello');
terminal.resize(80,24,{width:800,height:600});
terminal.setParentWindow?.(Buffer.alloc(8));
const event:IEvent<string>=terminal.onData;
const subscription:IDisposable=event(data=>data.length);
subscription.dispose();spawnSync('sh',[],unix);
const ready=await spawn('sh',[],{signal:new AbortController().signal});
await ready.write('hello');await ready.close();
const legacy=immediateSpawn('sh',[]);await legacy.ready;await legacy.close();`,
    )
    execFileSync(
      process.execPath,
      [
        join(dirname(require.resolve('typescript/package.json')), 'bin/tsc'),
        '--noEmit',
        '--module',
        'nodenext',
        '--target',
        'esnext',
        '--types',
        'node',
        '--typeRoots',
        dirname(dirname(require.resolve('@types/node/package.json'))),
        join(root, 'consumer.mts'),
      ],
      { stdio: 'pipe' },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('declaration compiler failures propagate instead of publishing partial types', () => {
  const root = mkdtempSync(join(tmpdir(), 'ffi-types-fail-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(
      join(root, 'src/index.mts'),
      'export const invalid: number = "bad"',
    )
    assert.throws(() => buildTypes(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
