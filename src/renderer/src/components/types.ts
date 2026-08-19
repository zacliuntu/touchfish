export type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string

export interface FieldErrors {
  url?: boolean
  timeout?: boolean
}
