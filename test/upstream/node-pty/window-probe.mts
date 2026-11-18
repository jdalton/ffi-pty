import { dlopen } from 'node:ffi'
import { setTimeout as delay } from 'node:timers/promises'

// Query the child console directly, without PowerShell's runtime C# compiler.
// Keep both libraries alive while their functions and console handles are used.
const kernel = dlopen('kernel32.dll', {
  GetConsoleWindow: { arguments: [], return: 'pointer' },
})
const user = dlopen('user32.dll', {
  GetAncestor: { arguments: ['pointer', 'uint32'], return: 'pointer' },
})
try {
  console.log('shell-running')
  await delay(Number(process.argv[2]))
  const consoleWindow = kernel.functions.GetConsoleWindow()
  const rootOwner = user.functions.GetAncestor(consoleWindow, 3)
  console.log(`console=${consoleWindow} rootOwner=${rootOwner} end`)
  await delay(Number(process.argv[3]) * 1000)
} finally {
  user.lib.close()
  kernel.lib.close()
}
