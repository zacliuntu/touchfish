import { execFile } from 'node:child_process'
import { basename } from 'node:path'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BUFFER = 1024 * 1024
const MAX_SANITIZED_STDERR_LENGTH = 1024

export interface CommandOptions {
  timeoutMs?: number
  maxBuffer?: number
}

export interface CommandOutput {
  stdout: string
  stderr: string
}

export class CommandExecutionError extends Error {
  readonly command: string
  readonly status: number | null
  readonly stderr: string

  constructor(command: string, status: number | null, stderr: string) {
    super(
      status === null
        ? `Command ${command} failed`
        : `Command ${command} failed with status ${status}`,
    )
    this.name = 'CommandExecutionError'
    this.command = command
    this.status = status
    this.stderr = stderr
  }
}

export function runCommand(
  file: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandOutput> {
  const command = basename(file)

  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr })
          return
        }

        reject(
          new CommandExecutionError(
            command,
            typeof error.code === 'number' ? error.code : null,
            sanitizeStderr(stderr),
          ),
        )
      },
    )
  })
}

function sanitizeStderr(stderr: string): string {
  let sanitized = ''

  for (const character of stderr) {
    const code = character.charCodeAt(0)

    if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
      continue
    }

    sanitized += character
  }

  return sanitized.slice(0, MAX_SANITIZED_STDERR_LENGTH)
}
