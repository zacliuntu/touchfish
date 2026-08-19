import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'

import {
  assertReadiness,
  assertRunnableFile,
  terminateChild,
  waitForChildExit,
  waitForReadiness,
  writeQuitCommand,
} from './smoke-electron-core.mjs'

const DEFAULT_TIMEOUT_MS = 30_000

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

async function main() {
  const executableArgument = process.argv[2]
  if (executableArgument === undefined || process.argv.length !== 3) {
    throw new Error(
      'Usage: node scripts/smoke-electron.mjs <packaged-electron-executable>',
    )
  }

  const executable = resolve(executableArgument)
  await assertRunnableFile(executable, fs, process.platform)
  const timeoutMs = parseTimeout(process.env.TOUCHFISH_SMOKE_TIMEOUT_MS)
  const smokeDirectory = await fs.mkdtemp(join(tmpdir(), 'touchfish-smoke-'))
  const readyFile = join(smokeDirectory, 'ready.json')
  const commandFile = join(smokeDirectory, 'command.json')
  const userDataDirectory = join(smokeDirectory, 'user-data')
  const xdgConfigDirectory = join(smokeDirectory, 'xdg-config')
  await Promise.all([
    fs.mkdir(userDataDirectory, { recursive: true, mode: 0o700 }),
    fs.mkdir(xdgConfigDirectory, { recursive: true, mode: 0o700 }),
  ])

  let child
  let stdout = ''
  let stderr = ''
  const deadline = Date.now() + timeoutMs
  try {
    child = spawn(
      executable,
      ['--hidden', `--user-data-dir=${userDataDirectory}`],
      {
        env: {
          ...process.env,
          TOUCHFISH_SMOKE_TEST: '1',
          TOUCHFISH_SMOKE_READY_FILE: readyFile,
          TOUCHFISH_SMOKE_COMMAND_FILE: commandFile,
          TOUCHFISH_SMOKE_USER_DATA_DIR: userDataDirectory,
          XDG_CONFIG_HOME: xdgConfigDirectory,
          ...(process.platform === 'linux' ? { XDG_SESSION_TYPE: 'x11' } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })

    const readiness = await waitForReadiness(readyFile, child, deadline, {
      readFile: fs.readFile,
      sleep: delay,
      now: Date.now,
    })
    assertReadiness(readiness, process.platform)
    await writeQuitCommand(commandFile, fs)
    const exit = await waitForChildExit(child, deadline)
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(
        `TouchFish did not exit cleanly (code=${String(exit.code)}, signal=${String(exit.signal)})`,
      )
    }
    process.stdout.write(
      `TouchFish packaged smoke passed: ${basename(executable)} (${readiness.platform}/${readiness.adapter})\n`,
    )
  } catch (error) {
    if (child !== undefined) {
      try {
        await terminateChild(child)
      } catch (cleanupError) {
        const detail =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        stderr += `${stderr === '' ? '' : '\n'}cleanup failed: ${detail}`
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    const logs = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
    throw new Error(logs === '' ? detail : `${detail}\n${logs}`, {
      cause: error,
    })
  } finally {
    await fs.rm(smokeDirectory, { recursive: true, force: true })
  }
}

function parseTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS
  const parsed = Number(value)
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 100 ||
    parsed > DEFAULT_TIMEOUT_MS
  ) {
    throw new Error(
      `TOUCHFISH_SMOKE_TIMEOUT_MS must be between 100 and ${DEFAULT_TIMEOUT_MS}`,
    )
  }
  return parsed
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
