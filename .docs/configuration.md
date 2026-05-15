# 🛠️ Configuration Reference

While the server strives for zero-configuration, sometimes you need to tweak the engine. Everything is controlled via the `server.config.ts` file in the root of your project.

## 📝 The `server.config.ts` File

Here is an exhaustive list of everything you can configure:

```typescript
// server.config.ts
import { defineConfig } from './.server/types'; // Assuming you exported the type

export default defineConfig({
  // -------------------------
  // Networking
  // -------------------------
  
  // The port the server runs on. Defaults to 3000.
  port: 3000,
  
  // The host binding. Defaults to '0.0.0.0' (accessible on network).
  // Use '127.0.0.1' or 'localhost' to restrict to local machine only.
  host: '0.0.0.0',

  // -------------------------
  // Proxy Configuration
  // -------------------------
  
  // Proxy requests to other servers to bypass CORS or aggregate APIs.
  proxy: {
    // When a request hits '/external/*', it will be forwarded to the target.
    '/weather-api': 'https://api.weather.gov',
    '/internal-auth': 'http://localhost:8080/auth'
  },

  // -------------------------
  // Import Mapping (Frontend)
  // -------------------------
  
  // Override or add to the auto-generated import maps for the browser.
  importMap: {
    // Allows you to do `import { MyUtil } from 'utils/string'` in the frontend
    'utils/': '/script/utils/',
    
    // You can also override a node_module if you want a specific build
    'lodash': '/node_modules/lodash/lodash.min.js'
  },

  // -------------------------
  // Server Hooks (Advanced)
  // -------------------------

  /**
   * onRequest
   * Intercept requests BEFORE the router or static file server touches them.
   * Return a `Response` to short-circuit the request and answer immediately.
   * Return `null` or `undefined` to let the server handle it normally.
   */
  async onRequest(req, server) {
    const url = new URL(req.url);
    
    // Example: Block all traffic trying to read a specific hidden folder
    if (url.pathname.startsWith('/top-secret')) {
      return new Response('Access Denied', { status: 403 });
    }
    
    return null; 
  },

  /**
   * onError
   * Catch global server errors. 
   * Useful for logging to external services (like Sentry) or returning custom 500 pages.
   */
  async onError(error) {
    console.error("Custom Error Logger:", error.message);
    
    // Return a custom JSON response instead of the default
    return new Response(JSON.stringify({ 
      error: "Something went terribly wrong!",
      details: error.message 
    }), { status: 500 });
  },

  /**
   * onStart
   * Runs exactly once when the server has successfully started and bound to the port.
   */
  async onStart(server) {
    console.log(`Server is healthy and ready to accept connections!`);
  }
});
```

## 🔄 Automatic `tsconfig.app.json` Syncing

If you define path aliases in your `importMap` (e.g., `'utils/': '/script/utils/'`), the server will automatically detect this and synchronize your `tsconfig.app.json` paths!

This means your IDE will immediately understand your custom aliases without you having to configure TypeScript manually. It's just another way the Bun Server keeps things frictionless.