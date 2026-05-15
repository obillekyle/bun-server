# ⚡️ File-Based API Routing

Welcome to the easiest API routing you've ever experienced. Say goodbye to manual router binding like `app.get('/api/users', ...)` and hello to pure, file-system-based magic.

In the Bun Server, the `api/` directory is sacred ground. Any `.ts` file you drop in there automatically maps to an `/api/<filename>` endpoint.

## 🎁 The `respond()` Wrapper

To make your life incredibly easy, we provide a globally available wrapper function called `respond()`. You don't even need to import it! It handles the annoying stuff:

- Catching the request.
- Parsing the body (whether it's JSON, form data, or query parameters).
- Handling errors gracefully so your server never crashes.
- Formatting your return value into a proper HTTP Response.

### Let's Build an Endpoint

Create a file at `api/hello.ts`:

```typescript
// api/hello.ts

// No imports needed! `respond` is just *there*.
export default respond(async (req, body, server) => {
  // `body` is automatically parsed based on the request type.

  // Best Practice: Validate the HTTP method
  if (req.method !== 'GET') {
    return {
      status: 405,
      message: 'Method Not Allowed',
    };
  }

  const name = body.name || 'Mysterious Stranger';

  // Just return a plain object! We handle the JSON serialization and status codes.
  return {
    status: 200,
    message: `Hello there, ${name}!`,
    data: {
      receivedMethod: req.method,
      timestamp: Date.now(),
    },
  };
});
```

Boom. You can now hit `/api/hello?name=Bob` or `POST` JSON to it, and it just works!

## 🛠️ How it Works Under the Hood

Curious how this black magic operates?

1. **The Intercept:** When a request hits the server with a URL starting with `/api/`, our custom server intercepts it.
2. **Dynamic Import:** It extracts the endpoint name (e.g., `hello` from `/api/hello`) and dynamically imports `api/hello.ts`.
3. **Body Processing:** The `processBody(req)` utility securely reads the incoming request, parses JSON if applicable, or extracts URL search params for GET requests, handing you a pristine `body` object.
4. **Execution:** The `export default respond(...)` block is executed.
5. **Auto-Formatting:**
   - If you return a plain object, we automatically wrap it in `Response.json()` and apply the `status` if you provided one.
   - If you return a string or number, we wrap it in a standard text response.
   - If you return a raw `Response` or `Blob`, we send it back as-is!

## 💡 Pro Tips

- **Raw Access:** You have full access to the raw Bun `Request` object (`req`) and the `Server` instance (`server`) inside the callback. Need to check headers? `req.headers.get('Authorization')`. Need to broadcast a WebSocket message? `server.publish(...)`.
- **Custom Responses:** Want to return a file or custom HTML? Just return a `new Response("<h1>Custom!</h1>", { headers: { "Content-Type": "text/html" } })`. The `respond` wrapper is smart enough to let it pass through.
- **Safety First:** The router is protected. Endpoint names must be valid alphanumeric/dash strings, preventing directory traversal attacks.
