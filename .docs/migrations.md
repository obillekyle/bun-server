# 🗃️ Database Migrations & Syncing

Managing database schemas over time can be a massive headache. The Bun Server attempts to eliminate this pain with the `db:sync` utility.

## 🔄 The Sync Engine (`bun run db:sync`)

When you define your tables in `.database/schema.ts` and run `bun run db:sync`, the server performs a "smart diff" against your actual SQLite database (`.database/server.db`).

### What it handles automatically:
- **Creating new tables.**
- **Adding new columns** to existing tables.
- **Dropping columns** that you removed from `schema.ts`.
- **Updating TypeScript definitions** so `DB` autocomplete is instantly aware of the changes.

### ⚠️ What you need to be careful with:

Because SQLite has limited support for altering columns (e.g., you can't easily change a column's type or rename it without recreating the whole table), our sync engine takes a safe, non-destructive approach.

- **Renaming a column:** If you rename `userName` to `username` in your schema, the sync engine sees this as: "Drop `userName` and add `username`". **This will result in data loss for that column.** 
- **Changing types:** If you change a column from `text` to `integer`, the sync engine might complain or force a recreation.

**Best Practice:** When you need to rename a column or do complex data migrations, you should write a one-off script to create the new column, copy the data over using SQL, and then delete the old column.

## 🌱 Seeding the Database

Often, you need to populate the database with default data (like an admin user or default settings) when setting up a fresh environment.

You can easily create a script in your root folder:

```typescript
// seed.ts
import './.server/init'; // Loads the DB global

async function seed() {
  console.log("Seeding database...");
  
  // Check if admin exists
  const admin = await DB.table('users').where('username', '=', 'admin').fetch();
  
  if (!admin) {
    await DB.Insert.into('users').values({
      username: 'admin',
      passwordHash: '...', // Use Bun.password.hashSync!
      role: 'admin'
    });
    console.log("Admin created!");
  } else {
    console.log("Admin already exists.");
  }
  
  process.exit(0);
}

seed();
```

Run it via:
```bash
bun run seed.ts
```