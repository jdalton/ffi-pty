import { hash, makeReceipt } from '../../../.config/coverage/accumulate.mts'
export function fixture(run = 'first', hit = [1, 0], root = '/repo') {
  const loc = (line: number) => ({
    start: { line, column: 0 },
    end: { line, column: 10 },
  })
  return makeReceipt({
    run,
    suite: 'unit',
    shard: '1',
    platform: 'darwin',
    arch: 'arm64',
    node: 'v26.12.0',
    passed: true,
    root,
    sources: { 'a.mts': hash('same source') },
    report: {
      [`${root}/a.mts`]: {
        path: `${root}/a.mts`,
        statementMap: { 0: loc(1), 1: loc(2) },
        s: { 0: hit[0], 1: hit[1] },
        fnMap: {},
        f: {},
        branchMap: {
          0: { type: 'if', line: 1, loc: loc(1), locations: [loc(1), loc(2)] },
        },
        b: { 0: hit },
      },
    },
  })
}
