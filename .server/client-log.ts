import './init';

const parentPid = parseInt(process.argv[2], 10);
parentPid &&
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 1000);

let port = 3000;
let host = 'localhost';

try {
  const configExists = await Bun.file(
    process.cwd() + '/server.config.ts',
  ).exists();
  const module = configExists
    ? await import(process.cwd() + '/server.config.ts').catch(() => null)
    : null;

  port = module?.default?.port || port;
  host =
    module?.default?.host === '0.0.0.0' || module?.default?.host === '::'
      ? 'localhost'
      : module?.default?.host || host;
} catch (e) {}

let wsInstance: WebSocket | null = null;

console.clear();
log({ level: 'debug', by: 'connect', msg: 'Waiting for backend...' });

function connect() {
  const ws = new WebSocket(`ws://${host}:${port}/_livereload`);
  wsInstance = ws;

  ws.onopen = function (ev) {
    console.clear();
    log({ by: 'websocket', msg: 'Connected! Listening for client logs...' });
    log({ by: 'logger', msg: 'Press "r" to reload all connected clients' });
    ws.send(JSON.stringify({ type: 'subscribe_logger' }));
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      const msg = data.payload || (data.args ? data.args.join(' ') : '');
      data.type === 'client_log' &&
        log({
          msg,
          level: data.level,
          by: 'console',
        });
    } catch (err) {}
  };

  ws.onclose = () => {
    wsInstance = null;
    log({
      level: 'warn',
      by: 'connect',
      msg: 'Hot-reload active. Backend rebooting...',
    });
    setTimeout(connect, 1000);
  };

  ws.onerror = () => ws.close();
}

connect();

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key: string) => {
    match(key.toLowerCase(), {
      '\u0003': () => process.exit(0),
      r: () => {
        log({ by: 'websocket', msg: 'Triggering global browser reload...' });
        wsInstance?.readyState === WebSocket.OPEN &&
          wsInstance.send(JSON.stringify({ type: 'force_reload' }));
      },
      [match.default]: () => {},
    });
  });
}
