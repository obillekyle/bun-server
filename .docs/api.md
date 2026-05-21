# ⚡️ File-Based API Routing

Say goodbye to manual router bindings like `app.get('/api/users', ...)`. In the Bun Server, files inside the `api/` directory automatically map to `/api/<filename>` endpoints. Zero-config routing!

---

## 🎁 The Global `respond()` Wrapper

The globally injected `respond()` wrapper removes backend boilerplate. It automatically handles:

- Catching the HTTP request.
- Parsing the request body (JSON, URL-encoded forms, query parameters).
- Error handling to prevent server crashes.
- Serializing return values into standard HTTP Responses.

### Basic Endpoint Example

Create `api/hello.ts`:

```typescript
// api/hello.ts
// `respond` is globally available—no imports needed!
export default respond(async (req, body, server) => {
  if (req.method !== 'GET') {
    return { status: 405, message: 'GET only please!' };
  }

  const name = body.name || 'Stranger';
  return {
    status: 200,
    message: `Hello, ${name}!`,
  };
});
```

Hit `GET /api/hello?name=Bob` and watch the JSON print!

---

## 🌀 Dynamic File-Based Routing (`req.params`)

For dynamic endpoints, use square brackets `[parameter]` in your directory or file names (e.g. `api/users/[id].ts`). The matched values are injected into **`req.params`**.

Create `api/users/[id].ts`:

```typescript
// api/users/[id].ts
export default respond(async (req, body, server) => {
  const userId = req.params.id; // Extracted dynamically!

  if (req.method !== 'GET') {
    return { status: 405, message: 'GET requests only' };
  }

  const user = await DB.table('users').where('id', '=', userId).fetch();
  if (!user) {
    return { status: 404, message: 'User not found' };
  }

  return { status: 200, data: user };
});
```

### Nesting Placeholders

You can nest dynamic routes too, e.g. `api/blogs/[blogId]/comments/[commentId].ts` will populate:

- `req.params.blogId`
- `req.params.commentId`

---

## 🔍 Under the Hood Lifecycle

1.  **Intercept:** Incoming requests starting with `/api/` are routed to the API engine.
2.  **Match:** Direct file matches are checked first. If none exist, the routing tree searches for dynamic placeholders (e.g., `[id]`).
3.  **Parse Body:** The server parses queries for `GET`/`DELETE` requests and JSON/form bodies for `POST`/`PUT`/`PATCH` requests into the `body` argument.
4.  **Dynamic Import:** The server dynamically imports the API file. In development, caching is bypassed on file saves so changes are live instantly.
5.  **Execution & Wrapping:** The handler executes:
    - **Plain Object:** Serialized into `Response.json()` with status.
    - **String/Number:** Wrapped in a plain text response.
    - **Raw Response/Blob:** Returned as-is (useful for custom headers, files, redirects).

---

## 💡 Pro Tips

- **Headers:** Access raw request headers via `req.headers.get('Authorization')`.
- **WebSockets:** Broadcast socket messages using the server instance: `server.publish('channel', 'message')`.
- **HTML Endpoints:** Return server-side compiled TSX templates by writing `.tsx` files and wrapping them with `html()`. Details in the [Frontend Guide](.docs/frontend.md).
