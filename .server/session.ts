const sessionMap = new Map<string, SessionProxy>();
const ttl = 1000 * 60 * 60 * 24; // 24 hours

type SessionProxy<T = { [x: string]: any }> = T & {
  readonly id: string;
  readonly created: number;
  readonly persist: (key: string, state: boolean) => SessionProxy<T>;
  readonly reset: (full?: boolean) => void;
};

const PERSIST = Symbol('persist');

export function getSession<T = { [x: string]: any }>(
  request: Request,
): SessionProxy<T> {
  const cookieHeader = request.headers.get('cookie') || '';
  const sessionId = cookieHeader.match(/(?:^|;\s*)sId=([^;]+)/)?.[1];

  if (!sessionId) throw new Error('No session cookie found');
  if (sessionMap.has(sessionId))
    return sessionMap.get(sessionId) as SessionProxy<T>;

  const newSession: SessionProxy<T> = new Proxy(
    {
      [PERSIST]: new Set<string>(),
      id: sessionId,
      created: Date.now(),
      persist(key: string, state: boolean) {
        const persistKeys = (this as any)[PERSIST] as Set<string>;

        persistKeys[state ? 'add' : 'delete'](key);
        persistKeys.size > 0 && !sessionMap.has(this.id)
          ? sessionMap.set(this.id, this as SessionProxy<T>)
          : undefined;

        return this;
      },
      reset(full = false) {
        const persistKeys = (this as any)[PERSIST] as Set<string>;

        for (const key of Object.keys(this)) {
          if (persistKeys.has(key) && !full) continue;

          switch (key) {
            case 'id':
            case 'created':
            case 'reset':
            case 'persist':
              continue;
            default:
              delete (this as any)[key];
          }
        }

        persistKeys.clear();
        full && sessionMap.delete(this.id);

        (this as any).created = Date.now();
      },
    } as any,
    {
      get: (target, prop) => (prop in target ? target[prop] : undefined),
      set(target, prop, value) {
        if (prop === 'id') {
          throw new Error('Cannot modify session id');
        }

        if (!sessionMap.has(target.id)) sessionMap.set(target.id, newSession);

        (target as any)[prop] = value;
        return true;
      },
    },
  );

  return newSession;
}

export function setSession(path = '/'): Response {
  const sessionId = Bun.randomUUIDv7();
  return new Response(null, {
    status: 302,
    headers: {
      'Set-Cookie': `sId=${sessionId}; HttpOnly; Path=/; SameSite=Strict`,
      Location: path,
    },
  });
}

setTimeout(() => {
  const now = Date.now();

  for (const session of sessionMap.values()) {
    if (now - session.created > ttl) {
      session.reset();
    }
  }
}, ttl);

export class Session<T = { [x: string]: string }> {
  private static storage = new Map<string, SessionProxy>();
  private proxy;

  constructor(request: Request) {
    this.proxy = getSession(request);
  }

  get(key: string): string | undefined;
  get<K extends string>(key: K): K extends keyof T ? T[K] : undefined;
  get(key: string, defaultValue: string): string;
  get(key: string, defaultValue?: string): any {
    return this.proxy[key] ?? defaultValue;
  }

  set<K extends string>(
    key: K,
    value: string,
    persist = false,
  ): Session<T & Record<K, string>> {
    this.proxy[key] = value;
    persist && this.proxy.persist(key, true);
    return this as any;
  }

  delete<K extends string>(key: string, persist = false): Session<Omit<T, K>> {
    delete this.proxy[key];
    persist && this.proxy.persist(key, false);
    return this as any;
  }

  reset(full = false): void {
    this.proxy.reset(full);
  }
}
