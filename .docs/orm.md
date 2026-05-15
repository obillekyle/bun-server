# 🗄️ The Typed ORM: Database Bliss

Let's face it: writing raw SQL strings is scary, and setting up massive ORMs like Prisma or TypeORM can be overkill.

Welcome to our built-in, intuition-first, insanely typed ORM. It's built specifically for this Bun server, and it utilizes a global entry point: `DB`.

Because `DB` is injected globally during server startup, you never have to `import { DB } from '@database/connection'`. It's just always there, ready to serve you.

## 🏗️ Defining Your Schema

Everything starts in `.database/schema.ts`. This is your single source of truth. We provide neat little helpers in `schema-util.ts` to make defining SQLite tables a breeze.

```typescript
// .database/schema.ts
import { value, primary, dateNow } from './schema-util';

export namespace DBInfo {
  // Define your tables and columns here
  export const constraints = {
    users: {
      id: primary(), // Auto-incrementing primary key
      username: value('text'), // A text column
      email: value('text'),
      isActive: value('integer'), // SQLite uses integers for booleans (0 or 1)
      createdAt: value('integer', dateNow), // Automatically defaults to current timestamp
    },
    posts: {
      id: primary(),
      title: value('text'),
      authorId: value('integer'),
    },
  } as const;

  // You also add versions and indexes down here to help the compiler!
}
```

**Workflow:** Make a change to `schema.ts`, then open your terminal and run `bun run db:sync`. Our sync engine will automatically migrate your SQLite tables and update all TypeScript types instantly. Zero downtime, zero tears.

## ✍️ Inserting Data

Creating records is strongly typed. If you try to insert a column that doesn't exist, TypeScript will yell at you.

```typescript
// inside any api route...
export default respond(async (req, body) => {
  // Notice how DB is just globally available!
  const newRecord = await DB.Insert.into('users').values({
    username: 'CodeWizard',
    email: 'wizard@bun.sh',
    isActive: 1,
    // id and createdAt are handled automatically!
  });

  return { message: 'User created successfully', data: newRecord };
});
```

## 🔍 The Query Builder

Our read queries use a strictly typed chain. To ensure your SQL is correct and your TypeScript types perfectly align with what the database returns, **you must follow a specific call order**.

### The Golden Order:

1. `with()` (Common Table Expressions - optional)
2. `table()` / `from()` (Your main table)
3. `join()` (Inner joins)
4. `groupBy()`
5. `where()` / `and()` / `or()`
6. `select()` / `selectAll()` / `selectMath()`
7. `having()` / `and()` / `or()`
8. `orderBy()`
9. `limit()`

### A Juicy Example

Let's fetch some active users and their latest posts. Watch how beautiful this chaining is:

```typescript
const awesomeUsers = await DB
  // Start with the base table, and give it an alias 'u'
  .table('users', 'u')

  // Join the posts table, aliased as 'p'
  .join('posts', { u: 'id', p: 'authorId' }, 'p')

  // Group them up!
  .groupBy('u.id')

  // Filter for active users
  .where('u.isActive', '=', 1)

  // Strongly typed select!
  // The keys on the left are the resulting object keys.
  // The values on the right reference the table aliases and column names.
  .select({
    userId: { u: 'id' },
    userName: { u: 'username' },
    postTitle: { p: 'title' },
  })

  // Sort them descending
  .orderBy('u.createdAt DESC')

  // Just give me the top 5
  .limit(5)

  // Execute and return an array!
  .array();
```

### Execution Methods

Once your query is built, how do you get the data? Pick your poison:

- **`.array()`**: The standard. Returns a `Promise<T[]>` of your requested objects.
- **`.fetch()`**: Grabs a single row. Returns `Promise<T | undefined>`. Great for fetching by ID!
- **`.column()`**: Plucks out just the first column into a raw array. `Promise<any[]>`.
- **`.iterable()`**: An Async Generator. Perfect for iterating over massive datasets without blowing up your RAM.

## 🔄 Updating and Deleting

Mutations are just as easy. Use `DB.Update` and `DB.Delete` (or their uppercase aliases `DB.UPDATE` / `DB.DELETE`).

```typescript
// Updating a user
await DB.Update.table('users').set({ isActive: 0 }).where('id', '=', 42).run(); // .run() executes the mutation

// Deleting a user
await DB.Delete.from('users').where('id', '=', 99).run();
```

## 🎩 The Magic of Thenables

Here is the coolest part of the ORM: **Every query builder object is a Thenable.**

This means they natively implement `.then()` behavior. You don't _actually_ have to call `.array()` or `.run()` at the end of your chains if you don't want to! You can just `await` the query builder directly, and JavaScript evaluates it for you.

- **Read Queries** default to `.array()`.
- **Mutations** default to `.run()`.

```typescript
// 🤯 Look ma, no .array()!
// This automatically evaluates and returns the array of users.
const allUsers = await DB.table('users').selectAll('users');

// Mutations automatically commit and return a RunResult!
const insertResult = await DB.Insert.into('users').values({
  username: 'LazyCoder',
});

console.log(`Inserted ID: ${insertResult.lastInsertRowid}`);
```

Database interactions have never felt so smooth and casual!
