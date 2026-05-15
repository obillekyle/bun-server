# 🧪 Testing Guide

Bun ships with a ridiculously fast, built-in test runner (`bun test`). It's Jest-compatible, meaning you already know how to use it!

## 🏃 Running Tests

```bash
# Run all tests in the project
bun test

# Run tests in watch mode
bun test --watch
```

## 🛠️ Testing API Routes

Because our API routes use the `respond()` wrapper, they expect a `Request` object and return a `Response` object. Testing them is incredibly straightforward.

Create a test file next to your API route, e.g., `api/hello.test.ts`:

```typescript
// api/hello.test.ts
import { expect, test, describe } from "bun:test";

// 1. Initialize globals so `respond` and `DB` are available
import "../.server/init";

// 2. Import your endpoint
import helloEndpoint from "./hello";

describe("GET /api/hello", () => {
  test("returns a friendly greeting", async () => {
    // Mock a standard web Request
    const req = new Request("http://localhost:3000/api/hello?name=Alice");
    
    // Call the endpoint directly
    const response = await helloEndpoint(req, null as any, {} as any);
    
    // Parse the JSON response
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect(data.message).toBe("Hello there, Alice!");
  });
});
```

## 🗄️ Testing with the Database

If your endpoints hit the database, you probably don't want your tests altering your local development database (`.database/server.db`).

### Using an In-Memory Database for Tests

You can override the global database connection specifically for your tests. In a global test setup file (or at the top of your test file):

```typescript
import { Database } from "bun:sqlite";
import { connection } from "../.database/conn";

// Swap out the physical file DB for an in-memory one
connection.db = new Database(":memory:");

// You will need to run the sync logic or manually create tables
// to ensure your in-memory DB has the right schema before tests run!
```

*Note: Fully automating in-memory DB syncing for tests requires importing the `syncSQLSchema` function from `.database/sync.ts` and awaiting it before your test suites run.*