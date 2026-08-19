import { basename } from 'node:path'

import { describe, expect, test } from 'vitest'

import { CommandExecutionError, runCommand } from './command'

describe('runCommand', () => {
  test('returns UTF-8 stdout and stderr without invoking a shell', async () => {
    await expect(
      runCommand(process.execPath, [
        '-e',
        "require('node:fs').writeSync(1, 'ok'); require('node:fs').writeSync(2, 'warn')",
      ]),
    ).resolves.toEqual({ stdout: 'ok', stderr: 'warn' })
  })

  test('passes argument values unchanged without invoking a shell', async () => {
    const literalArgument = 'a; literal $argument with spaces'

    await expect(
      runCommand(process.execPath, [
        '-e',
        "require('node:fs').writeSync(1, process.argv[1])",
        literalArgument,
      ]),
    ).resolves.toEqual({ stdout: literalArgument, stderr: '' })
  })

  test('wraps a non-zero status and sanitizes stderr', async () => {
    const secretArgument = 'untrusted command argument'

    await expect(
      runCommand(process.execPath, [
        '-e',
        "require('node:fs').writeSync(2, 'bad\\u001b[31m message'); process.exit(7)",
        secretArgument,
      ]),
    ).rejects.toMatchObject({
      name: 'CommandExecutionError',
      command: basename(process.execPath),
      status: 7,
      stderr: 'bad[31m message',
    })
  })

  test('limits sanitized stderr exposed by a command failure', async () => {
    try {
      await runCommand(process.execPath, [
        '-e',
        "require('node:fs').writeSync(2, 'x'.repeat(2048)); process.exit(1)",
      ])
      throw new Error('Expected runCommand to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExecutionError)
      expect((error as CommandExecutionError).stderr).toHaveLength(1024)
    }
  })

  test('does not expose executable paths or arguments in command failures', async () => {
    const secretArgument = 'untrusted command argument'

    try {
      await runCommand(process.execPath, [
        '-e',
        'process.exit(1)',
        secretArgument,
      ])
      throw new Error('Expected runCommand to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(CommandExecutionError)
      expect((error as Error).message).not.toContain(process.execPath)
      expect((error as Error).message).not.toContain(secretArgument)
    }
  })

  test('wraps timeouts in a typed error', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      name: 'CommandExecutionError',
      command: basename(process.execPath),
      status: null,
    })
  })

  test('wraps output buffer limits in a typed error', async () => {
    await expect(
      runCommand(
        process.execPath,
        ['-e', "require('node:fs').writeSync(1, 'x'.repeat(128))"],
        {
          maxBuffer: 32,
        },
      ),
    ).rejects.toMatchObject({
      name: 'CommandExecutionError',
      command: basename(process.execPath),
      status: null,
    })
  })

  test('wraps missing executables in the same typed error', async () => {
    await expect(
      runCommand('touchfish-command-does-not-exist', []),
    ).rejects.toMatchObject({
      name: 'CommandExecutionError',
      command: 'touchfish-command-does-not-exist',
      status: null,
    })
  })
})
