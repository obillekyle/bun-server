type ResponseFn = (
  req: Request,
  body: Record<string, any>,
  server: Bun.Server<any>,
) =>
  | Promise<Response | Record<string, any> | string>
  | Response
  | Record<string, any>
  | string;

type JsonResponse<T = any> = {
  time: number;
  status: number;
  message: string;
  data: T;
};

type InjectScript = {
  src: string;
  module?: boolean;
  async?: boolean;
  defer?: boolean;
  inBody?: boolean;
};

type AppConfig = {
  /**
   * Sets the server preferred port
   * @default 3000
   */
  port?: number;
  /**
   * Set a custom host for the server.
   * @default '0.0.0.0'
   */
  host?: string;
  /**
   * Define custom import mappings for the frontend. This is useful when you
   * want to use absolute imports in your frontend code without worrying about
   * the actual file structure.
   *
   * For example, you can map `#components/*` to `./src/components/*`, and then
   * import components in your frontend code like this: `import Button from
   * '#components/Button'`.
   *
   * Start the server to register the mappings and make them available in your
   * frontend code.
   *
   * @default {}
   *
   * @example
   * export default defineConfig({
   *   importMap: {
   *     '#components/*': './src/components/*',
   *     '#utils/*': './src/utils/*',
   *   },
   * });
   */
  importMap?: Record<string, string>;
  /**
   * Number of database backups to keep when auto-cleaning old backups.
   * Set to 0 to disable auto-cleanup. This only applies if the backupDatabase
   * function is used in the sync process.
   *
   * @default 10
   */
  backups?: number;
  /**
   * Define proxy rules for the server. This allows you to forward certain
   * requests to another server, which is useful for API calls during
   * development. The key is the path prefix to match, and the value is the
   * target URL to proxy to.
   *
   * For example, you can set `'/api': 'http://localhost:4000'` to forward all
   * requests starting with `/api` to a backend server running on port 4000.
   *
   * @default {}
   *
   * @example
   * export default defineConfig({
   *   proxy: {
   *    '/api': 'http://localhost:4000',
   *    '/api/v0': 'https://api.example.com/v0',
   *   },
   * });
   */
  proxy?: Record<string, string>;
  /**
   * Define global scripts and styles to be injected into every HTML response.
   * Scripts can be defined as simple strings (the src URL) or as objects with
   * additional attributes like `module`, `async`, `defer`, and `inBody`
   * (to inject the script before the closing body tag instead of in the head).
   *
   * @default []
   *
   * @example
   * export default defineConfig({
   *   scripts: [
   *    '/scripts/global.js',
   *    { src: '/scripts/module.js', module: true },
   *   ],
   * });
   */
  scripts?: (string | InjectScript)[];
  /**
   * Define global styles to be injected into every HTML response.
   *
   * @default []
   * @example
   * export default defineConfig({
   *   styles: ['/styles/global.css'],
   * });
   */
  styles?: string[];
  /**
   * Register a callback to be executed when the server starts,
   * receiving the server instance as an argument. This is useful for performing
   * any setup tasks that require access to the server, such as initializing
   * a database connection or setting up WebSocket handlers.
   *
   * @default undefined
   * @example
   * export default defineConfig({
   *   onStart: (server) => {
   *    console.log('Server started on port', server.port);
   *  },
   * });
   */
  onStart?: (server: Bun.Server<any>) => MixedPromise<void>;
  /**
   * Register a callback to handle incoming requests. This allows you to define
   * custom request handling logic, such as routing or middleware, directly in
   * the configuration. The callback receives the request object and the server
   * instance as arguments, and can return a Response object or any data that
   * will be sent as a JSON response.
   *
   * @default undefined
   * @example
   * export default defineConfig({
   *   onRequest: (req, server) => {
   *    const url = new URL(req.url);
   *    if (url.pathname === '/hello') {
   *      return { message: 'Hello, world!' };
   *    }
   *  },
   * });
   */
  onRequest?: (req: Request, server: Bun.Server<any>) => MixedPromise<T>;
  /**
   * Register a callback to handle errors that occur during request processing.
   * This allows you to define custom error handling logic, such as logging or
   * returning custom error responses. The callback receives the error object and
   * the server instance as arguments, and can return a Response object or any
   * data that will be sent as a JSON response.
   *
   * @default undefined
   * @example
   * export default defineConfig({
   *  onError: (error, server) => {
   *   console.error('Error occurred:', error);
   *  },
   * });
   */
  onError?: (error: Error) => MixedPromise<T>;
};

type Wrapped<T> = T | (() => T);
type MixedPromise<T> = Promise<T> | T;
var respond: (callback: ResponseFn) => void;

var DB: typeof import('../.database/connection').DB;
type DBSchema = import('../.database/schema').DBSchema;
type DBOptionals = import('../.database/schema').DBOptionals;

type LoggerEntry = import('./logger').LoggerEntry;
type LogLevels = import('./logger').LogLevels;

var any: <T = any>(x: any) => T;
var log: typeof import('./logger').log;
var Logger: typeof import('./logger').Logger;
var match: typeof import('./utils').match;
var assert: (condition: any, message?: string) => asserts condition;

var defineConfig: (config: AppConfig) => AppConfig;
var html: typeof import('./jsx').html;
var createElement: typeof import('./jsx').createElement;
var Fragment: typeof import('./jsx').Fragment;

declare namespace JSX {
  type Element = string | Promise<string>;

  interface ElementChildrenAttribute {
    children: {};
  }

  interface HTMLAttributes {
    class?: string;
    className?: string; // Included just in case React muscle memory kicks in!
    id?: string;
    style?: string | Record<string, string | number>;
    children?: any;
    tabindex?: number | string;
    title?: string;

    // Auto-complete support for data and aria attributes
    [key: `data-${string}`]: string | undefined;
    [key: `aria-${string}`]: string | undefined;

    // Catch-all for everything else (HTMX, Alpine.js, custom elements, etc.)
    [key: string]: any;
  }

  // --- Specific Element Attributes ---
  interface AnchorAttributes extends HTMLAttributes {
    href?: string;
    target?: string;
    rel?: string;
  }
  interface ImgAttributes extends HTMLAttributes {
    src?: string;
    alt?: string;
    width?: string | number;
    height?: string | number;
    loading?: 'lazy' | 'eager';
  }
  interface InputAttributes extends HTMLAttributes {
    type?: string;
    value?: any;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    checked?: boolean;
    autocomplete?: string;
  }
  interface FormAttributes extends HTMLAttributes {
    action?: string;
    method?: 'GET' | 'POST' | 'get' | 'post';
    enctype?: string;
  }
  interface ScriptAttributes extends HTMLAttributes {
    src?: string;
    type?: string;
    defer?: boolean;
    async?: boolean;
  }
  interface LinkAttributes extends HTMLAttributes {
    rel?: string;
    href?: string;
    as?: string;
    type?: string;
  }
  interface MetaAttributes extends HTMLAttributes {
    name?: string;
    content?: string;
    charset?: string;
    property?: string;
  }

  // --- The Global Tag Map ---
  interface IntrinsicElements {
    // Document basics
    html: HTMLAttributes & { lang?: string };
    head: HTMLAttributes;
    body: HTMLAttributes;
    title: HTMLAttributes;
    meta: MetaAttributes;
    link: LinkAttributes;
    script: ScriptAttributes;

    // Core structure
    div: HTMLAttributes;
    span: HTMLAttributes;
    p: HTMLAttributes;
    h1: HTMLAttributes;
    h2: HTMLAttributes;
    h3: HTMLAttributes;
    h4: HTMLAttributes;
    h5: HTMLAttributes;
    h6: HTMLAttributes;
    ul: HTMLAttributes;
    ol: HTMLAttributes;
    li: HTMLAttributes;

    // Interactive & Media
    a: AnchorAttributes;
    img: ImgAttributes;
    button: HTMLAttributes & {
      type?: 'button' | 'submit' | 'reset';
      disabled?: boolean;
    };
    input: InputAttributes;
    textarea: InputAttributes & {
      rows?: number | string;
      cols?: number | string;
    };
    form: FormAttributes;
    select: HTMLAttributes & {
      name?: string;
      disabled?: boolean;
      required?: boolean;
      multiple?: boolean;
    };
    option: HTMLAttributes & {
      value?: any;
      selected?: boolean;
      disabled?: boolean;
    };

    br: HTMLAttributes;
    hr: HTMLAttributes;

    // 🛡️ The Ultimate Fallback: Automatically supports nav, main, footer, svg, etc!
    [elemName: string]: HTMLAttributes;
  }
}
