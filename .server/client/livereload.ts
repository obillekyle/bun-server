let needsReload = false;
let isDead = false;
const logQueue: string[] = [];

function connect() {
  const ws = new WebSocket('ws://' + location.host + '/_livereload');

  const safeStringify = (val: any): string => {
    try {
      if (typeof val !== 'object' || val === null) return String(val);
      const seen = new WeakSet();
      return JSON.stringify(val, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular]';
          seen.add(value);
        }
        return value;
      });
    } catch {
      return Object.prototype.toString.call(val);
    }
  };

  const sendLog = (level: string, args: any[]) => {
    const payload = Array.from(args)
      .map((a) => safeStringify(a))
      .join(' ');

    const msg = JSON.stringify({
      type: 'client_log',
      level,
      payload,
      ip: '',
    });

    ws.readyState === WebSocket.OPEN ? ws.send(msg) : logQueue.push(msg);
  };

  const ogLog = console.log,
    ogWarn = console.warn,
    ogErr = console.error;
  console.log = (...args) => (ogLog(...args), sendLog('info', args));
  console.warn = (...args) => (ogWarn(...args), sendLog('warn', args));
  console.error = (...args) => (ogErr(...args), sendLog('error', args));

  window.onerror = (m, s, l, c) => sendLog('error', [`${m} at ${s}:${l}:${c}`]);
  window.addEventListener('unhandledrejection', (e) =>
    sendLog('error', [`Unhandled Promise: ${e.reason}`]),
  );

  const handleUpdate = (filename: string) => {
    const isCSS = filename.endsWith('.css');

    let isSelfHTML = false;
    if (filename.endsWith('.html')) {
      const normFile = filename.startsWith('.')
        ? filename.substring(1)
        : filename.startsWith('/')
          ? filename
          : '/' + filename;
      const p = location.pathname;

      isSelfHTML =
        p === normFile ||
        p + '.html' === normFile ||
        (p.endsWith('/') ? p + 'index.html' : p + '/index.html') === normFile;
    }

    const isOtherHTML = filename.endsWith('.html') && !isSelfHTML;

    if (isOtherHTML) return;

    switch (true) {
      case isCSS:
        const normCssFile = filename.startsWith('.')
          ? filename.substring(1)
          : filename.startsWith('/')
            ? filename
            : '/' + filename;
        console.log('[LiveReload] CSS change detected: ' + filename);
        const links = document.querySelectorAll(
          'link[rel="stylesheet"]:not([data-removing])',
        ) as NodeListOf<HTMLLinkElement>;
        for (const link of links) {
          const url = new URL(link.href, location.href);
          if (url.origin === location.origin && url.pathname === normCssFile) {
            link.setAttribute('data-removing', 'true');
            url.searchParams.set('v', String(Date.now()));
            const newHref = url.pathname + url.search;
            fetch(newHref, { mode: 'no-cors' }).then(() => {
              const newLink = document.createElement('link');
              newLink.rel = 'stylesheet';
              newLink.href = newHref;
              document.head.appendChild(newLink);
              setTimeout(() => link.remove(), 50);
            });
          }
        }
        break;

      default:
        if (document.visibilityState === 'visible') {
          location.reload();
        } else {
          needsReload = true;
        }
        break;
    }
  };

  ws.onmessage = (e) => handleUpdate(e.data);

  ws.onopen = () => {
    while (logQueue.length > 0) {
      ws.send(logQueue.shift()!);
    }

    switch (true) {
      case isDead:
        console.log('[LiveReload] Server is back! Refreshing...');
        location.reload();
        break;
      default:
        console.log('[LiveReload] Connected');
        break;
    }
  };

  ws.onclose = () => {
    isDead = true;
    setTimeout(connect, 1000);
  };

  ws.onerror = () => ws.close();
}

connect();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && needsReload) {
    location.reload();
  }
});
