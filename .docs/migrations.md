# 🗃️ Database Migrations & Syncing

Manage your SQLite database state cleanly without manually writing migration files.

---

## 🔄 The Sync Engine (`bun run db:sync`)

Your database schema layout is stored inside **[schema.ts](.database/schema.ts)**. Running:

```bash
bun run db:sync
```

tells the server to inspect the database file (`.database/server.db`), compute a smart diff, and sync the changes.

- **Supported automatically:** Creating tables, adding columns, dropping columns, and compiling TypeScript autocomplete types.
- **Unsupported / Risky:** Renaming columns and altering field types. SQLite has limited support for these.
  - _Warning:_ Renaming `userName` to `username` inside `schema.ts` is treated as a drop-and-add action. The sync engine will delete the `userName` column (erasing its data!) and build a clean `username` column.

_Best Practice:_ If you need to rename a column or perform complex modifications, write a temporary SQL script to migrate data values safely.

---

## 🌱 Seeding the Database

Create a `seed.ts` script at your project root to provision default data:

```typescript
// seed.ts
import './.server/init'; // Spins up environment and loads global `DB`

async function seed() {
  console.log('Seeding database...');

  const admin = await DB.table('users').where('username', '=', 'admin').fetch();
  if (!admin) {
    await DB.Insert.into('users').values({
      username: 'admin',
      email: 'admin@myawesomeapp.com',
      isActive: 1,
    });
    console.log('Admin account seeded!');
  }

  process.exit(0);
}

seed();
```

Run it via:

```bash
bun run seed.ts
```
