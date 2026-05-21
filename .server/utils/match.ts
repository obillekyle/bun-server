import type { Match } from '../types';

const matchDefault = Symbol('matchDefault');

export const match: Match<typeof matchDefault> = ((value: any, cases: any) => {
  const isString = typeof value === 'string';
  const isArray = Array.isArray(cases);

  switch (true) {
    case isString && !isArray: {
      switch (true) {
        case value in cases:
          return typeof cases[value] === 'function'
            ? cases[value](value)
            : cases[value];
        case matchDefault in cases:
          return typeof cases[matchDefault] === 'function'
            ? cases[matchDefault](value)
            : cases[matchDefault];
      }
      break;
    }

    case isArray: {
      for (const [predicate, result] of cases) {
        switch (true) {
          case predicate === match:
          case predicate === matchDefault:
          case predicate === value:
          case typeof predicate === 'function' && Boolean(predicate(value)):
            return typeof result === 'function' ? result(value) : result;
        }
      }
    }
  }
  return undefined;
}) as any;

match.default = matchDefault;
match[Symbol.toPrimitive] = () => matchDefault;
