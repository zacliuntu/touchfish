import {
  appendFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'

const DEFAULT_MAX_BYTES = 1024 * 1024
const DEFAULT_MAX_FILES = 5
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /cookie|password|authorization|token/i

export interface LogStoreOptions {
  maxBytes?: number
  maxFiles?: number
}

export class LogStore {
  private readonly logPath: string
  private readonly maxBytes: number
  private readonly maxFiles: number

  constructor(
    private readonly directory: string,
    options: LogStoreOptions = {},
  ) {
    this.logPath = join(directory, 'touchfish.log')
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
    if (
      !isPositiveInteger(this.maxBytes) ||
      !isPositiveInteger(this.maxFiles)
    ) {
      throw new RangeError('maxBytes and maxFiles must be positive integers')
    }
  }

  async write(entry: Record<string, unknown>): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })

    const line = `${JSON.stringify(redact(entry))}\n`
    const incomingBytes = Buffer.byteLength(line, 'utf8')
    const currentBytes = await this.currentLogSize()
    if (currentBytes > 0 && currentBytes + incomingBytes > this.maxBytes) {
      await this.rotate()
    }

    await appendFile(this.logPath, line, 'utf8')
  }

  async recent(limit: number): Promise<Record<string, unknown>[]> {
    if (limit <= 0) {
      return []
    }

    const records: Record<string, unknown>[] = []
    for (let suffix = this.maxFiles - 1; suffix >= 0; suffix -= 1) {
      const path = suffix === 0 ? this.logPath : `${this.logPath}.${suffix}`
      let contents: string
      try {
        contents = await readFile(path, 'utf8')
      } catch (error: unknown) {
        if (isErrno(error, 'ENOENT')) {
          continue
        }
        throw error
      }

      for (const line of contents.split(/\r?\n/)) {
        if (line.length === 0) {
          continue
        }
        try {
          const parsed: unknown = JSON.parse(line)
          if (isRecord(parsed)) {
            records.push(parsed)
          }
        } catch {
          // A diagnostics log must remain useful even if one line is corrupt.
        }
      }
    }

    return records.slice(-limit)
  }

  private async currentLogSize(): Promise<number> {
    try {
      return (await stat(this.logPath)).size
    } catch (error: unknown) {
      if (isErrno(error, 'ENOENT')) {
        return 0
      }
      throw error
    }
  }

  private async rotate(): Promise<void> {
    if (this.maxFiles === 1) {
      await removeIfPresent(this.logPath)
      return
    }

    const oldestPath = `${this.logPath}.${this.maxFiles - 1}`
    await removeIfPresent(oldestPath)

    for (let suffix = this.maxFiles - 2; suffix >= 1; suffix -= 1) {
      await renameIfPresent(
        `${this.logPath}.${suffix}`,
        `${this.logPath}.${suffix + 1}`,
      )
    }
    await renameIfPresent(this.logPath, `${this.logPath}.1`)
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item))
  }
  if (!isRecord(value)) {
    return value
  }

  const redacted: Record<string, unknown> = Object.create(null)
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(nestedValue)
  }
  return redacted
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT')) {
      throw error
    }
  }
}

async function renameIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await rename(source, destination)
  } catch (error: unknown) {
    if (!isErrno(error, 'ENOENT')) {
      throw error
    }
  }
}

function isErrno(error: unknown, code: string): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
