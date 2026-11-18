import { spawn } from '../../../src/compat.mts'
const custom = process.argv[2] === 'true'
const signal = (process.argv[3] || 'SIGINT') as NodeJS.Signals
process.on(signal, () => console.log(`${signal} in parent`))
const handler = custom
  ? `process.on(${JSON.stringify(signal)},()=>{console.log(${JSON.stringify(signal + ' in child')});process.exit()});`
  : ''
const term = spawn(process.execPath, [
  '-e',
  `${handler}console.log('ready');setTimeout(()=>console.log('should not be printed'),10000)`,
])
term.onData(data => {
  if (data.includes('ready')) {
    process.kill(term.pid, signal)
    process.kill(process.pid, signal)
  } else {
    process.stdout.write(data)
  }
})
await term.exited
await term.close()
