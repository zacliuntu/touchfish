import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  assertReadiness,
  assertRunnableFile,
  remainingMilliseconds,
  terminateChild,
  waitForReadiness,
  writeQuitCommand,
} from './smoke-electron-core.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

describe('smoke electron core', () => {
  test('requires a regular executable file', async () => {
    const directory = await temporaryDirectory()

    await expect(
      assertRunnableFile(directory, fs, process.platform),
    ).rejects.toThrow('regular file')

    if (process.platform !== 'win32') {
      const file = join(directory, 'not-executable')
      await fs.writeFile(file, 'content', { mode: 0o600 })
      await expect(
        assertRunnableFile(file, fs, process.platform),
      ).rejects.toThrow('executable')
    }
  })

  test.each([
    ['linux', 'linux-x11'],
    ['win32', 'windows'],
  ] as const)('requires the real %s adapter identity', (platform, adapter) => {
    expect(() =>
      assertReadiness(
        {
          ready: true,
          platform,
          adapter,
          displayCount: 1,
          contextIsolation: true,
          nodeIntegration: false,
        },
        platform,
      ),
    ).not.toThrow()
    expect(() =>
      assertReadiness(
        {
          ready: true,
          platform,
          adapter: platform === 'linux' ? 'windows' : 'linux-x11',
          displayCount: 1,
          contextIsolation: true,
          nodeIntegration: false,
        },
        platform,
      ),
    ).toThrow('adapter')
  })

  test('uses one absolute deadline instead of restarting the timeout', () => {
    expect(remainingMilliseconds(30_000, 12_500)).toBe(17_500)
    expect(() => remainingMilliseconds(30_000, 30_000)).toThrow(
      '30s smoke deadline',
    )
  })

  test('rejects a spawn error while waiting for readiness', async () => {
    const child = new FakeChild()
    const reading = waitForReadiness(
      '/missing/ready.json',
      child,
      Date.now() + 1_000,
      {
        readFile: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('missing'), { code: 'ENOENT' }),
          ),
        sleep: vi.fn(async () => undefined),
        now: Date.now,
      },
    )

    child.emit('error', new Error('spawn failed'))

    await expect(reading).rejects.toThrow('spawn failed')
  })

  test('atomically publishes a private quit command', async () => {
    const directory = await temporaryDirectory()
    const commandFile = join(directory, 'command.json')

    await writeQuitCommand(commandFile, fs)

    await expect(fs.readFile(commandFile, 'utf8')).resolves.toBe(
      '{"command":"quit"}\n',
    )
    if (process.platform !== 'win32') {
      expect((await fs.stat(commandFile)).mode & 0o777).toBe(0o600)
    }
    expect(await fs.readdir(directory)).toEqual(['command.json'])
  })

  test('waits after graceful termination and forces then waits when needed', async () => {
    const graceful = new FakeChild()
    graceful.onKill = (signal) => {
      if (signal === 'SIGTERM') graceful.complete(null, 'SIGTERM')
    }
    await terminateChild(graceful, 10)
    expect(graceful.kills).toEqual(['SIGTERM'])

    const forced = new FakeChild()
    forced.onKill = (signal) => {
      if (signal === 'SIGKILL') forced.complete(null, 'SIGKILL')
    }
    await terminateChild(forced, 1)
    expect(forced.kills).toEqual(['SIGTERM', 'SIGKILL'])
    expect(forced.signalCode).toBe('SIGKILL')
  })

  test('CI annotates packaged Linux smoke failures without losing their exit status', async () => {
    const workflow = await fs.readFile('.github/workflows/ci.yml', 'utf8')
    const start = workflow.indexOf('- name: Smoke packaged Linux app')
    const end = workflow.indexOf('- name: Check packaged Windows helper')
    const step = workflow.slice(start, end)

    expect(step).toContain('pipeline_statuses=("${PIPESTATUS[@]}")')
    expect(step).toContain('smoke_status=${pipeline_statuses[0]}')
    expect(step).toContain('tee_status=${pipeline_statuses[1]}')
    expect(step).toContain('tail -n 200 "$smoke_log"')
    expect(step).toContain("diagnostic=${diagnostic//'%'/'%25'}")
    expect(step).toContain("diagnostic=${diagnostic//$'\\r'/'%0D'}")
    expect(step).toContain("diagnostic=${diagnostic//$'\\n'/'%0A'}")
    expect(step.match(/::error::/g)).toHaveLength(1)
    expect(step).toContain('exit "$failure_status"')
  })
})

class FakeChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: Signal | null = null
  readonly kills: Signal[] = []
  onKill: (signal: Signal) => void = () => undefined

  kill(signal: Signal): boolean {
    this.kills.push(signal)
    this.onKill(signal)
    return true
  }

  complete(code: number | null, signal: Signal | null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

type Signal = 'SIGTERM' | 'SIGKILL'

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(join(tmpdir(), 'touchfish-smoke-core-'))
  temporaryDirectories.push(directory)
  return directory
}
