# 🗄️ The Typed ORM: Database Bliss

The Bun Server features a built-in, type-safe SQLite ORM under the global variable **`DB`**. No imports required—it is injected globally at startup.

---

## 🏗️ Schema Definition

Define tables inside **[schema.ts](.database/schema.ts)** using the builders from `schema-util.ts`:

```typescript
// .database/schema.ts
import { value, primary, dateNow } from './schema-util';

export namespace DBInfo {
  export const constraints = {
    users: {
      id: primary(),
      username: value('text'),
      isActive: value('integer'),
      createdAt: value('integer', dateNow),
    },
  } as const;
}
```

Whenever you modify your schema, run:

```bash
bun run db:sync
```

The sync engine alters the SQLite tables and updates the TypeScript compilation types instantly.

---

## ✍️ Inserting Records

Inserts are fully type-safe:

```typescript
const newRecord = await DB.Insert.into('users').values({
  username: 'CodeWizard',
  isActive: 1,
});
```

---

## 🔍 Read Queries (Chaining Order)

To ensure valid SQL compilation, the query builder enforces a strict **Golden Ordering Chain**:

1.  `with()` _(Common Table Expressions)_
2.  `table()` / `from()` _(Base table and alias)_
3.  `join()`
4.  `groupBy()`
5.  `where()` / `and()` / `or()`
6.  `select()` / `selectAll()` / `selectMath()`
7.  `having()`
8.  `orderBy()`
9.  `limit()`

### Chaining Example:

```typescript
const activeUsers = await DB.table('users', 'u')
  .join('posts', { u: 'id', p: 'authorId' }, 'p')
  .where('u.isActive', '=', 1)
  .select({
    userId: { u: 'id' },
    userName: { u: 'username' },
    postTitle: { p: 'title' },
  })
  .orderBy('u.id DESC')
  .limit(10)
  .array();
```

---

## 🏁 Execution Methods

Run your read query with:

- `.array()` ➜ Returns `Promise<T[]>` of matching row objects.
- `.fetch()` ➜ Returns the first row (`Promise<T | undefined>`).
- `.column()` ➜ Returns a flat array of the first column (`Promise<any[]>`).
- `.iterable()` ➜ Streams rows using an asynchronous generator (RAM-friendly for massive tables).

---

## 🔄 Mutations (Update / Delete)

Use `DB.Update` and `DB.Delete` (or UPPERCASE `DB.UPDATE` / `DB.DELETE`):

```typescript
// Update
await DB.Update.table('users').set({ isActive: 0 }).where('id', '=', 42).run();

// Delete
await DB.Delete.from('users').where('id', '=', 99).run();
```

Both return a result reporting `changes` and `lastInsertRowid`.

---

## 🎩 The Magic of Thenables

Every query builder object is a **Thenable**. You can directly `await` them without calling `.array()` or `.run()`:

- **Read Queries** default to `.array()`
- **Mutations** default to `.run()`

```typescript
// Evaluates directly to an array of rows!
const usersList = await DB.table('users').selectAll('users');

// Commits the insert immediately!
const result = await DB.Insert.into('users').values({ username: 'FastCoder' });
```
