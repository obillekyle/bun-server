# 🎨 Frontend & Asset Management

The Bun Server uses standard browser modules combined with background server compilation to eliminate traditional bundlers.

---

## 📂 Asset Placement

*   **`index.html`** — Application entrance.
*   **`script/`** — Frontend TypeScript (`.ts`) and JavaScript (`.js`).
*   **`styles/`** — CSS files.

---

## ⚡ TypeScript Serving

You write TypeScript inside `script/`, but link it as JavaScript in your HTML:
```html
<script type="module" src="/script/main.js"></script>
```
1.  When `/script/main.js` is requested, the compiler checks for `/script/main.ts` on disk.
2.  If found, the compiler compiles the TS file to standard JS on the fly.
3.  The result is cached in memory. File saves automatically clear the cache.

---

## 📦 Import Maps (NPM Packages in Browser)

Use NPM packages directly inside frontend scripts:
```typescript
import confetti from 'canvas-confetti';
```
On server startup, it inspects your `package.json` dependencies and injects an import map into every HTML response header:
```html
<script type="importmap"> ... </script>
```
This maps bare package imports directly to your local node_modules directory, allowing the browser to resolve and load NPM packages natively.

---

## 💅 CSS Hot-Swapping

Link your stylesheets normally:
```html
<link rel="stylesheet" href="/styles/main.css" />
```
In development, saving CSS edits alerts the browser via WebSockets to reload the stylesheet link with a timestamp query parameter. The styles update immediately **without reloading the page**.

---

## 🏗️ Server-Side TSX Templating

We support native server-side `.tsx` templates out of the box using the global `html()` wrapper. 

Create `jsx.tsx`:
```tsx
// jsx.tsx
export default html((req, body, server) => {
  const items = ['Alice', 'Bob'];
  return (
    <html lang="en">
      <head>
        <title>Server Page</title>
        <link rel="stylesheet" href="/styles/global.css" />
      </head>
      <body>
        <h1>Rendered on Server</h1>
        <ul>
          {items.map(name => <li>{name}</li>)}
        </ul>
        <script type="module" src="/script/main.js"></script>
      </body>
    </html>
  );
});
```

---

## 🚀 Frontend Frameworks

This stack is ideal for:
1.  **Vanilla JS/TS** and DOM interactions.
2.  **Lightweight libraries** that run directly in the browser, like **Alpine.js**:

```bash
bun add alpinejs
```
```typescript
// script/main.ts
import Alpine from 'alpinejs';
window.Alpine = Alpine;
Alpine.start();
```
3.  **Web Components**.
4.  **Server-Side TSX** templates.
