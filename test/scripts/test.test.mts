import { isLocalIpc } from '../setup/no-network.mts'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { testFiles, unitTestArguments, runTests } from '../../scripts/test.mts'

test('unit discovery excludes integration tests and keeps tooling separate', () => {
  const root = resolve('.')
  assert.ok(
    testFiles(root).every(file => !file.endsWith('.integration.test.mts')),
  )
  assert.ok(
    testFiles(root, 'integration').every(file =>
      file.endsWith('.integration.test.mts'),
    ),
  )
  assert.ok(testFiles(root, 'tooling').includes('test/scripts/test.test.mts'))
  assert.throws(() => testFiles(root, 'unknown'), /Unknown/)
  assert.ok(unitTestArguments(root, []).includes('--permission'))
  assert.equal(
    unitTestArguments(root, []).includes('--allow-net'),
    process.platform === 'win32',
  )
})

test('network guard rejects unmocked HTTP and allows explicit Nock fixtures', () => {
  const code = `
    const {default:nock}=require('nock');
    const http=require('node:http');
    nock('http://fixture.invalid').get('/mock').reply(200,'MOCK_OK');
    http.get('http://fixture.invalid/mock', response=>response.pipe(process.stdout));
    http.get('http://unmocked.invalid/unmocked').on('error', error=>console.log(error.code));
  `
  const output = execFileSync(
    process.execPath,
    ['--import=./test/setup/no-network.mts', '-e', code],
    { encoding: 'utf8', timeout: 5000 },
  )
  assert.match(output, /MOCK_OK/)
  assert.match(output, /ERR_NOCK_NO_MATCH|ENETUNREACH/)
})

test('unit preload blocks raw TCP, UDP and DNS without contacting the network', () => {
  const code = `
    const assert = require('node:assert/strict');
    assert.throws(()=>require('node:net').connect(80,'fixture.invalid'), /disabled/);
    assert.throws(()=>require('node:dns').resolve('fixture.invalid',()=>{}), /disabled/);
    const udp=require('node:dgram').createSocket('udp4');
    try { assert.throws(()=>udp.send('x',80,'fixture.invalid'), /disabled/); } finally { udp.close(); }
    console.log('BLOCKED');
  `
  assert.match(
    execFileSync(
      process.execPath,
      ['--import=./test/setup/no-network.mts', '-e', code],
      { encoding: 'utf8', timeout: 5000 },
    ),
    /BLOCKED/,
  )
})

test('offline test workers retain V8 coverage while TCP remains blocked', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'ffi-coverage-worker-'))
  try {
    const fixture = resolve(directory, 'worker.test.mjs')
    const coverage = resolve(directory, 'raw')
    writeFileSync(
      fixture,
      "import { test } from 'node:test'; import assert from 'node:assert/strict'; import net from 'node:net'; test('offline', () => assert.throws(() => net.connect(80, 'fixture.invalid'))); ",
    )
    const runner = resolve('scripts/test.mts')
    execFileSync(
      process.execPath,
      [
        '--permission',
        '--allow-fs-read=*',
        '--allow-fs-write=*',
        '--allow-child-process',
        '--allow-inspector',
        '--input-type=module',
        '-e',
        'import { unitTestArguments } from ' +
          JSON.stringify(pathToFileURL(runner).href) +
          '; import { execFileSync } from "node:child_process"; execFileSync(process.execPath, unitTestArguments(process.cwd(), [' +
          JSON.stringify(fixture) +
          ']), {stdio:"pipe"});',
      ],
      {
        env: {
          ...process.env,
          NODE_V8_COVERAGE: coverage,
          NODE_TEST_CONTEXT: undefined,
        },
        timeout: 10_000,
      },
    )
    const scripts = readdirSync(coverage)
      .filter(name => name.endsWith('.json'))
      .flatMap(
        name =>
          JSON.parse(readFileSync(resolve(coverage, name), 'utf8')).result,
      )
    assert.ok(
      scripts.some(
        script =>
          script.url.endsWith('/worker.test.mjs') &&
          script.functions.some(fn => fn.ranges.some(range => range.count > 0)),
      ),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('runner propagates child failures and signal exits, forwards integration flags, and refuses empty suites', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ffi-runner-'))
  try {
    assert.throws(() => runTests([], root), /No tests/)
    mkdirSync(resolve(root, 'test/src'), { recursive: true })
    writeFileSync(resolve(root, 'test/src/example.test.mts'), '')
    writeFileSync(resolve(root, 'test/src/example.integration.test.mts'), '')
    const failure = new Error('cannot spawn')
    assert.throws(
      () => runTests([], root, (() => ({ error: failure })) as never),
      error => error === failure,
    )
    assert.equal(runTests([], root, (() => ({ status: null })) as never), 1)
    assert.equal(
      runTests(['integration', '--test-concurrency=1'], root, ((_exe, args) => {
        assert.ok(args.includes('--test-concurrency=1'))
        assert.ok(args.includes('test/src/example.integration.test.mts'))
        assert.ok(!args.includes('test/src/example.test.mts'))
        return { status: 2 }
      }) as never),
      2,
    )
    const windows = unitTestArguments(root, [], [], {
      platform: 'win32',
      coverage: false,
    })
    assert.ok(windows.includes('--allow-net'))
    assert.ok(!windows.includes('--allow-inspector'))
    const unix = unitTestArguments(root, [], [], {
      platform: 'linux',
      coverage: true,
    })
    assert.ok(!unix.includes('--allow-net'))
    assert.ok(unix.includes('--allow-inspector'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('test preload uses a file URL so Windows drive letters are not interpreted as URL schemes', () => {
  const root = resolve('folder with spaces')
  const preload = unitTestArguments(root, []).find(arg =>
    arg.startsWith('--import='),
  )!
  assert.equal(
    preload,
    '--import=' +
      pathToFileURL(resolve(root, 'test/setup/no-network.mts')).href,
  )
})

test('network guard accepts normalized local IPC arguments but rejects normalized TCP arguments', () => {
  assert.equal(isLocalIpc([[{ path: 'local-pipe' }, undefined]]), true)
  assert.equal(
    isLocalIpc([[{ host: 'example.invalid', port: 80 }, undefined]]),
    false,
  )
  assert.equal(isLocalIpc([80, 'example.invalid']), false)
})

test('offline preload opens real local IPC before either peer sends data', () => {
  const code = `
    const net = require('node:net');
    const {once} = require('node:events');
    const {mkdtempSync, rmSync} = require('node:fs');
    const {tmpdir} = require('node:os');
    const {join} = require('node:path');
    const root = mkdtempSync(join(tmpdir(), 'ffi-ipc-'));
    const path = process.platform === 'win32' ? String.fromCharCode(92,92,46,92) + 'pipe' + String.fromCharCode(92) + 'ffi-' + require('node:crypto').randomUUID() : join(root, 'socket');
    const server = net.createServer(socket => socket.end('IPC_OK'));
    (async () => {
      let client;
      try {
        server.listen(path);
        await once(server, 'listening');
        client = net.createConnection(path);
        const [data] = await once(client, 'data');
        require('node:assert/strict').equal(data.toString(), 'IPC_OK');
        console.log('IPC_OK');
      } finally {
        client?.destroy();
        await new Promise(resolve => server.close(resolve));
        rmSync(root, {recursive:true, force:true});
      }
    })().catch(error => { console.error(error); process.exitCode=1; });
  `
  assert.match(
    execFileSync(
      process.execPath,
      [
        '--permission',
        '--allow-fs-read=*',
        '--allow-fs-write=*',
        '--allow-child-process',
        '--allow-net',
        '--import=./test/setup/no-network.mts',
        '-e',
        code,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
    /IPC_OK/,
  )
})
