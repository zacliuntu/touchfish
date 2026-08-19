import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { clearTimeout, setTimeout } from 'node:timers'

const POLL_INTERVAL_MS = 100

export async function assertRunnableFile(path, fileSystem, platform) {
  const metadata = await fileSystem.stat(path)
  if (!metadata.isFile()) {
    throw new Error(
      `Packaged Electron executable must be a regular file: ${path}`,
    )
  }
  try {
    await fileSystem.access(
      path,
      platform === 'win32' ? constants.F_OK : constants.X_OK,
    )
  } catch {
    throw new Error(`Packaged Electron file is not executable: ${path}`)
  }
}

export function assertReadiness(value, platform) {
  if (value === null || typeof value !== 'object') {
    throw new Error('TouchFish readiness must be a JSON object')
  }
  const expectedAdapter = platform === 'linux' ? 'linux-x11' : 'windows'
  if (
    value.ready !== true ||
    value.platform !== platform ||
    value.adapter !== expectedAdapter ||
    !Number.isSafeInteger(value.displayCount) ||
    value.displayCount < 1 ||
    value.contextIsolation !== true ||
    value.nodeIntegration !== false
  ) {
    throw new Error(
      `Unexpected TouchFish readiness for platform=${platform}, adapter=${expectedAdapter}: ${JSON.stringify(value)}`,
    )
  }
}

export function remainingMilliseconds(deadline, now = Date.now()) {
  const remaining = deadline - now
  if (remaining <= 0) {
    throw new Error('Timed out at the shared 30s smoke deadline')
  }
  return remaining
}

export function waitForReadiness(path, child, deadline, dependencies) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (operation, value) => {
      if (settled) return
      settled = true
      child.off('error', onError)
      operation(value)
    }
    const onError = (error) => finish(reject, error)
    child.once('error', onError)

    void (async () => {
      while (!settled) {
        remainingMilliseconds(deadline, dependencies.now())
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `TouchFish exited before readiness (code=${String(child.exitCode)}, signal=${String(child.signalCode)})`,
          )
        }
        try {
          const readiness = JSON.parse(
            await dependencies.readFile(path, 'utf8'),
          )
          finish(resolve, readiness)
          return
        } catch (error) {
          if (!isMissing(error) && !(error instanceof SyntaxError)) throw error
        }
        const delay = Math.min(
          POLL_INTERVAL_MS,
          remainingMilliseconds(deadline, dependencies.now()),
        )
        await dependencies.sleep(delay)
      }
    })().catch((error) => finish(reject, error))
  })
}

export async function waitForChildExit(child, deadline) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  const remaining = remainingMilliseconds(deadline)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for TouchFish process exit'))
    }, remaining)
    const onExit = (code, signal) => {
      cleanup()
      resolve({ code, signal })
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
    }
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

export async function terminateChild(child, graceMilliseconds = 1_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if ('pid' in child && child.pid === undefined) return
  child.kill('SIGTERM')
  try {
    await waitForChildExit(child, Date.now() + graceMilliseconds)
    return
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return
  }

  child.kill('SIGKILL')
  await waitForChildExit(child, Date.now() + graceMilliseconds)
}

export async function writeQuitCommand(path, fileSystem) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fileSystem.writeFile(temporary, '{"command":"quit"}\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await fileSystem.rename(temporary, path)
  } catch (error) {
    await fileSystem.unlink(temporary).catch(() => undefined)
    throw error
  }
}

function isMissing(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
