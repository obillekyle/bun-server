const logLevels = ['info', 'warn', 'error', 'fatal', 'debug', 'trace'] as const;
export type LogLevels = (typeof logLevels)[number];

export type LoggerEntry = {
  level?: LogLevels;
  by?: string;
  msg: string;
};

const levelColors: Record<LogLevels | 'reset', string> = {
  info: '\x1b[37m', // White (Regular)
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
  fatal: '\x1b[1;31m', // Bold Red
  debug: '\x1b[35m', // Magenta
  trace: '\x1b[90m', // Gray
  reset: '\x1b[0m', // Reset
};

export function log(
  { level = 'info', by = 'global', msg }: LoggerEntry,
  newLine = true,
) {
  const color = levelColors[level] || levelColors['info'];
  const lvTag = `[${level.charAt(0).toUpperCase()}]`;
  const byPad = by.length <= 10 ? by.padEnd(10) : by.substring(0, 7) + '...';

  console.write(
    `${color}${lvTag} ${byPad}${levelColors['reset']} ${msg}${newLine ? '\n' : ''}`,
  );
}

export function confirm(msg: string, by = 'global') {
  log({ level: 'warn', by, msg: `\x1b[33m${msg} (y/n): ` }, false);
  const response = prompt('')?.toLowerCase();
  return response === 'y' || response === 'yes';
}

export function select(msg: string, options: string[], by = 'global'): string {
  const index = selectIndex(msg, options, by);
  return options[index] as string;
}

export function selectIndex(
  msg: string,
  options: string[],
  by = 'global',
): number {
  log({ by, msg: '\n' });
  log({ by, msg });
  options.forEach((opt, i) => log({ by, msg: `  ${i + 1}. ${opt}` }));
  while (true) {
    log({ by, msg: `Select an option (1-${options.length}): ` }, false);
    const response = prompt('')?.trim();
    const num = parseInt(response || '', 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      log({ by, msg: '\n' });
      return num - 1;
    }
    log({ level: 'error', by, msg: 'Invalid option.' });
  }
}

export class Logger {
  constructor(private by: string) {}

  static log = log;
  static confirm = confirm;
  static select = select;
  static selectIndex = selectIndex;

  static messages<T extends Record<string, string>>(by: string, msgs: T) {
    const logger = new Logger(by);
    return messageLogger(logger, msgs);
  }

  log(msg: string, level?: LogLevels) {
    log({ level, by: this.by, msg });
  }

  confirm(msg: string) {
    return confirm(msg, this.by);
  }

  select(msg: string, options: string[]) {
    return select(msg, options, this.by);
  }

  selectIndex(msg: string, options: string[]) {
    return selectIndex(msg, options, this.by);
  }
}

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type ExtractArgs<S extends string> =
  S extends `${infer _}{${infer Param}}${infer Rest}`
    ? Prettify<{ [K in Param]: string | number | boolean } & ExtractArgs<Rest>>
    : {};

export function messageLogger<T extends Record<string, string>>(
  loggerInstance: Logger,
  targetMsgs: T,
) {
  return new Proxy(targetMsgs, {
    get(target, prop: string) {
      return (payload?: Record<string, any>) => {
        const raw =
          target[prop as keyof T] ||
          `E Error message not found: ${String(prop)}`;

        const spaceIdx = raw.indexOf(' ');
        const rawLevel = spaceIdx > -1 ? raw.substring(0, spaceIdx) : 'E';
        const template = spaceIdx > -1 ? raw.substring(spaceIdx + 1) : raw;

        const formattedMessage = template.replace(/\{([^}]+)\}/g, (_, key) => {
          return String(payload?.[key] ?? `{${key}}`);
        });

        let mappedLevel: 'info' | 'warn' | 'error' | 'debug' = 'info';
        switch (true) {
          case rawLevel === 'W':
            mappedLevel = 'warn';
            break;
          case rawLevel === 'E':
            mappedLevel = 'error';
            break;
          case rawLevel === 'D':
            mappedLevel = 'debug';
            break;
          case rawLevel === 'I':
            mappedLevel = 'info';
            break;
        }

        loggerInstance.log(formattedMessage, mappedLevel);
      };
    },
  }) as any as {
    [K in keyof T]: T[K] extends string
      ? keyof ExtractArgs<T[K]> extends never
        ? () => void // No params needed if the string has no {braces}
        : (payload: ExtractArgs<T[K]>) => void
      : never;
  };
}
