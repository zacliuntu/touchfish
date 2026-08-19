import type { DisplayInfo } from '../../../shared/models'

const GEOMETRY_TOKEN = /^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/

export class XrandrParseError extends Error {
  constructor() {
    super('Invalid active xrandr geometry')
    this.name = 'XrandrParseError'
  }
}

export function parseXrandr(text: string): DisplayInfo[] {
  const displays: DisplayInfo[] = []

  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/)
    const connector = tokens[0]

    if (connector === undefined || tokens[1] !== 'connected') {
      continue
    }

    const geometryToken = tokens.find((token) => GEOMETRY_TOKEN.test(token))

    if (geometryToken === undefined) {
      continue
    }

    const geometry = parseGeometry(geometryToken)
    const bounds = {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    }

    displays.push({
      id: connector,
      label: connector,
      primary: tokens.includes('primary'),
      bounds,
      workArea: { ...bounds },
    })
  }

  return displays.sort(compareDisplays)
}

function parseGeometry(token: string): {
  width: number
  height: number
  x: number
  y: number
} {
  const match = GEOMETRY_TOKEN.exec(token)

  if (match === null) {
    throw new XrandrParseError()
  }

  const [, widthToken, heightToken, xToken, yToken] = match
  const width = Number(widthToken)
  const height = Number(heightToken)
  const x = Number(xToken)
  const y = Number(yToken)

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new XrandrParseError()
  }

  return { width, height, x, y }
}

function compareDisplays(left: DisplayInfo, right: DisplayInfo): number {
  if (left.primary !== right.primary) {
    return left.primary ? -1 : 1
  }

  return (
    left.bounds.x - right.bounds.x ||
    left.bounds.y - right.bounds.y ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  )
}
