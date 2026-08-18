import type {
  DisplayInfo,
  TargetKind,
  TouchFishConfig,
} from '../../shared/models'

export interface Placement {
  target: TargetKind
  displayId: string
}

export interface ScenePlan {
  placements: Placement[]
  usedFallback: boolean
}

export class NoActiveDisplayError extends Error {
  constructor() {
    super('NoActiveDisplayError: no active display')
    this.name = 'NoActiveDisplayError'
  }
}

export function planScene(
  displays: DisplayInfo[],
  config: TouchFishConfig,
): ScenePlan {
  const sortedDisplays = [...displays].sort(compareDisplays)
  const primaryDisplay = sortedDisplays[0]

  if (primaryDisplay === undefined) {
    throw new NoActiveDisplayError()
  }

  if (sortedDisplays.length === 1) {
    return singleDisplayPlan(primaryDisplay.id, config.singleDisplayTarget)
  }

  const secondaryDisplay = sortedDisplays[1]

  if (secondaryDisplay === undefined) {
    throw new NoActiveDisplayError()
  }

  if (sortedDisplays.length === 2) {
    return twoDisplayPlan(
      primaryDisplay.id,
      secondaryDisplay.id,
      config.swapOnTwoDisplays,
    )
  }

  const { webDisplayId, externalDisplayId } = config.multiDisplayTargets
  const savedTargetsAreUsable =
    webDisplayId !== null &&
    externalDisplayId !== null &&
    webDisplayId !== externalDisplayId &&
    sortedDisplays.some((display) => display.id === webDisplayId) &&
    sortedDisplays.some((display) => display.id === externalDisplayId)

  if (savedTargetsAreUsable) {
    return {
      placements: [
        { target: 'web', displayId: webDisplayId },
        { target: 'external', displayId: externalDisplayId },
      ],
      usedFallback: false,
    }
  }

  const fallbackExternalDisplay = sortedDisplays.find(
    (display) => display.id !== primaryDisplay.id,
  )

  if (fallbackExternalDisplay === undefined) {
    throw new NoActiveDisplayError()
  }

  return {
    placements: [
      { target: 'web', displayId: primaryDisplay.id },
      { target: 'external', displayId: fallbackExternalDisplay.id },
    ],
    usedFallback: true,
  }
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

function singleDisplayPlan(displayId: string, target: TargetKind): ScenePlan {
  return {
    placements: [{ target, displayId }],
    usedFallback: false,
  }
}

function twoDisplayPlan(
  primaryDisplayId: string,
  secondaryDisplayId: string,
  swapOnTwoDisplays: boolean,
): ScenePlan {
  const [webDisplayId, externalDisplayId] = swapOnTwoDisplays
    ? [secondaryDisplayId, primaryDisplayId]
    : [primaryDisplayId, secondaryDisplayId]

  return {
    placements: [
      { target: 'web', displayId: webDisplayId },
      { target: 'external', displayId: externalDisplayId },
    ],
    usedFallback: false,
  }
}
