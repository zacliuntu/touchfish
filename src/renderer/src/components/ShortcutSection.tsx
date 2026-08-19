import type { Translate } from './types'

interface ShortcutKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'])

function normalizeKey(key: string): string | null {
  if (MODIFIER_KEYS.has(key)) return null
  if (/^[a-z]$/i.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return key
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase()

  const namedKeys: Readonly<Record<string, string>> = {
    ' ': 'Space',
    Spacebar: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
  }
  return namedKeys[key] ?? null
}

export function normalizeShortcutEvent(event: ShortcutKeyEvent): string | null {
  const key = normalizeKey(event.key)
  if (!key) return null

  const accelerator: string[] = []
  if (event.ctrlKey) accelerator.push('CommandOrControl')
  if (event.metaKey) accelerator.push('Super')
  if (event.altKey) accelerator.push('Alt')
  if (event.shiftKey) accelerator.push('Shift')
  if (accelerator.length === 0) return null
  accelerator.push(key)
  return accelerator.join('+')
}

export function formatShortcut(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part))
    .join(' + ')
}

interface ShortcutSectionProps {
  t: Translate
  value: string
  conflict: boolean
  onChange(value: string): void
}

export function ShortcutSection({
  t,
  value,
  conflict,
  onChange,
}: ShortcutSectionProps) {
  return (
    <section
      className="settings-section"
      id="shortcut"
      aria-labelledby="shortcut-title"
    >
      <h2 id="shortcut-title">{t('shortcut.title')}</h2>
      <div className="shortcut-row">
        <label className="field compact-field">
          <span>{t('shortcut.label')}</span>
          <input
            aria-label={t('shortcut.label')}
            aria-invalid={conflict}
            aria-describedby={conflict ? 'shortcut-conflict' : 'shortcut-hint'}
            type="text"
            value={formatShortcut(value)}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              const accelerator = normalizeShortcutEvent(event)
              if (!accelerator) return
              event.preventDefault()
              onChange(accelerator)
            }}
          />
          <small id="shortcut-hint">{t('shortcut.hint')}</small>
        </label>
        {conflict ? (
          <p className="field-error" id="shortcut-conflict" role="alert">
            {t('shortcut.conflict')}
          </p>
        ) : (
          <p className="available-state">✓ {t('shortcut.available')}</p>
        )}
      </div>
    </section>
  )
}
