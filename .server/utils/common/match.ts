import type { Match } from '../../types'

const matchDefault = Symbol('matchDefault')

function handleStringCases(value: any, cases: any): any {
  if (value in cases) {
    const handler = cases[value]
    return typeof handler === 'function' ? handler(value) : handler
  }
  if (matchDefault in cases) {
    const handler = cases[matchDefault]
    return typeof handler === 'function' ? handler(value) : handler
  }
}

function handleArrayCases(value: any, cases: any[]): any {
  for (const [predicate, result] of cases) {
    const isMatch =
      predicate === match ||
      predicate === matchDefault ||
      predicate === value ||
      (typeof predicate === 'function' && Boolean(predicate(value)))

    if (isMatch) {
      return typeof result === 'function' ? result(value) : result
    }
  }
}

export const match: Match<typeof matchDefault> = ((value: any, cases: any) => {
  const isString = typeof value === 'string'
  const isArray = Array.isArray(cases)

  if (isString && !isArray) {
    return handleStringCases(value, cases)
  }
  if (isArray) {
    return handleArrayCases(value, cases)
  }
  return undefined
}) as any

match.default = matchDefault
match[Symbol.toPrimitive] = () => matchDefault
