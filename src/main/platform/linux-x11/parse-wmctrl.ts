import type { NativeWindow } from '../../../shared/models'

const WINDOW_ID = /^0x[0-9a-f]+$/i
const INTEGER = /^-?\d+$/

export class WmctrlParseError extends Error {
  readonly lineNumber: number

  constructor(lineNumber: number) {
    super(`Invalid wmctrl line ${lineNumber}`)
    this.name = 'WmctrlParseError'
    this.lineNumber = lineNumber
  }
}

export function parseWmctrl(text: string): NativeWindow[] {
  const windows: NativeWindow[] = []

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') {
      continue
    }

    const lineNumber = index + 1
    const parsedLine = consumeWmctrlLine(line)

    if (parsedLine === null) {
      throw new WmctrlParseError(lineNumber)
    }

    const [
      rawId,
      desktopToken,
      pidToken,
      xToken,
      yToken,
      widthToken,
      heightToken,
      nativeClass,
      _host,
    ] = parsedLine.fields

    if (
      rawId === undefined ||
      !WINDOW_ID.test(rawId) ||
      nativeClass === undefined
    ) {
      throw new WmctrlParseError(lineNumber)
    }

    const desktop = parseInteger(desktopToken, lineNumber)
    const pid = parseInteger(pidToken, lineNumber)
    const x = parseInteger(xToken, lineNumber)
    const y = parseInteger(yToken, lineNumber)
    const width = parseInteger(widthToken, lineNumber)
    const height = parseInteger(heightToken, lineNumber)

    if (desktop === undefined || width < 0 || height < 0) {
      throw new WmctrlParseError(lineNumber)
    }

    windows.push({
      id: `0x${rawId.slice(2).toLowerCase()}`,
      pid,
      title: parsedLine.title,
      nativeClass,
      bounds: { x, y, width, height },
      visible: width > 0 && height > 0,
    })
  }

  return windows
}

function consumeWmctrlLine(
  line: string,
): { fields: string[]; title: string } | null {
  const fields: string[] = []
  let remainder = line

  while (fields.length < 9) {
    const match = /^\s*(\S+)([\s\S]*)$/.exec(remainder)
    const field = match?.[1]
    const nextRemainder = match?.[2]

    if (field === undefined || nextRemainder === undefined) {
      return null
    }

    fields.push(field)
    remainder = nextRemainder
  }

  return { fields, title: remainder.trimStart() }
}

function parseInteger(value: string | undefined, lineNumber: number): number {
  if (value === undefined || !INTEGER.test(value)) {
    throw new WmctrlParseError(lineNumber)
  }

  const number = Number(value)

  if (!Number.isSafeInteger(number)) {
    throw new WmctrlParseError(lineNumber)
  }

  return number
}
