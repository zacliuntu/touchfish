import { describe, expect, test, vi } from 'vitest'

import { ShortcutService } from './shortcut-service'

describe('ShortcutService', () => {
  test('reports a conflict without changing the current shortcut', () => {
    const register = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const unregister = vi.fn()
    const first = vi.fn()
    const replacement = vi.fn()
    const service = new ShortcutService({ register, unregister })

    expect(service.set('CommandOrControl+Alt+Z', first)).toEqual({ ok: true })
    expect(service.set('CommandOrControl+Alt+X', replacement)).toEqual({
      ok: false,
      reason: 'conflict',
    })

    expect(unregister).not.toHaveBeenCalled()
    expect(register).toHaveBeenNthCalledWith(
      1,
      'CommandOrControl+Alt+Z',
      expect.any(Function),
    )
    expect(register).toHaveBeenNthCalledWith(
      2,
      'CommandOrControl+Alt+X',
      expect.any(Function),
    )
    const registeredCallback = register.mock.calls[0]?.[1]
    expect(registeredCallback).toBeTypeOf('function')
    registeredCallback?.()
    expect(first).toHaveBeenCalledOnce()
    expect(replacement).not.toHaveBeenCalled()
  })

  test('unregisters only its prior accelerator after a successful reconfiguration', () => {
    const register = vi.fn().mockReturnValue(true)
    const unregister = vi.fn()
    const service = new ShortcutService({ register, unregister })

    service.set('CommandOrControl+Alt+Z', vi.fn())
    service.set('CommandOrControl+Alt+X', vi.fn())

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Alt+Z')
  })

  test('ignores a stale registered callback after successful reconfiguration', () => {
    const register = vi.fn().mockReturnValue(true)
    const first = vi.fn()
    const replacement = vi.fn()
    const service = new ShortcutService({ register, unregister: vi.fn() })

    service.set('CommandOrControl+Alt+Z', first)
    service.set('CommandOrControl+Alt+X', replacement)
    const staleRegisteredCallback = register.mock.calls[0]?.[1]
    const currentRegisteredCallback = register.mock.calls[1]?.[1]

    staleRegisteredCallback?.()
    expect(first).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()

    currentRegisteredCallback?.()
    expect(replacement).toHaveBeenCalledOnce()
  })

  test('updates the callback without changing a repeated accelerator registration', () => {
    const register = vi.fn().mockReturnValue(true)
    const unregister = vi.fn()
    const first = vi.fn()
    const replacement = vi.fn()
    const service = new ShortcutService({ register, unregister })

    service.set('CommandOrControl+Alt+Z', first)
    service.set('CommandOrControl+Alt+Z', replacement)

    expect(register).toHaveBeenCalledTimes(1)
    expect(unregister).not.toHaveBeenCalled()
    register.mock.calls[0]?.[1]?.()
    expect(first).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledOnce()
  })

  test('disposes its current shortcut once', () => {
    const unregister = vi.fn()
    const service = new ShortcutService({
      register: vi.fn().mockReturnValue(true),
      unregister,
    })
    service.set('CommandOrControl+Alt+Z', vi.fn())

    service.dispose()
    service.dispose()

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Alt+Z')
  })
})
