# 🧪 Testing Guide

Bun has a built-in Jest-compatible test runner: **`bun test`**.

---

## 🏃 Running Tests

```bash
# Run all tests in the project
bun test

# Run tests in hot watch mode
bun test --watch
```

---

## 🛠️ Testing API Routes

Because route handlers use the `respond()` wrapper, you can test them by directly passing a mocked `Request` object.

Create `api/hello.test.ts`:

```typescript
// api/hello.test.ts
import { expect, test, describe } from 'bun:test';
import '../.server/init'; // Loads global respond and DB
import helloRouteHandler from './hello';

describe('GET /api/hello', () => {
  test('returns greeting message', async () => {
    const req = new Request('http://localhost:3000/api/hello?name=Alice');
    const response = await helloRouteHandler(req, null as any, {} as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.message).toBe('Hello there, Alice!');
  });
});
```

---

## 🗄️ Database Test Isolation (In-Memory)

Avoid altering your local dev database during test runs by swapping it out for a temporary, isolated in-memory DB:

```typescript
// api/users.test.ts
import { expect, test, describe, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import '../.server/init';
import { connection } from '../.database/conn';
import { syncSQLSchema } from '../.database/sync';

describe('Users Endpoints', () => {
  beforeAll(async () => {
    // 1. Swap connection to an in-memory SQLite DB
    connection.db = new Database(':memory:');
    // 2. Sync schema to build tables in the new in-memory instance
    await syncSQLSchema();
  });

  test('queries empty user table', async () => {
    const users = await DB.table('users').selectAll('users');
    expect(users.length).toBe(0);
  });
});
```
This isolates your test runs, making them completely independent and blazing fast!
