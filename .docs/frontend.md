# 🎨 Frontend & Asset Management

The Bun Server takes a radically simple approach to frontend development. There is no Vite, no Webpack, and no complex bundler configs. It relies entirely on native browser features and server-side magic.

## 📂 Where Things Go

- **`index.html`**: The root of your app.
- **`script/`**: Put your frontend TypeScript or JavaScript here.
- **`styles/`**: Put your CSS files here.

## ⚡ The TypeScript Magic

You write `.ts` files in your `script/` folder. In your `index.html`, you reference them as `.js`:

```html
<!-- index.html -->
<script type="module" src="/script/main.js"></script>
```

**Wait, what?**
When the browser requests `/script/main.js`, the Bun server intercepts it, finds `/script/main.ts`, compiles it to raw JavaScript instantly, and serves it. It caches the result, making reloads lightning fast.

## 📦 Using `node_modules` (No Bundler Needed!)

Normally, you can't use NPM packages in the browser without a bundler. We fixed that with **Auto Import Maps**.

### 1. Install a Package

```bash
bun add canvas-confetti
```

### 2. Import it directly in your frontend `.ts` file

```typescript
// script/main.ts
import confetti from 'canvas-confetti';

document.querySelector('button')?.addEventListener('click', () => {
  confetti();
});
```

### How it works:

When the server starts, it scans your `package.json` dependencies and injects an `<script type="importmap">` into your `index.html`. It maps bare imports like `canvas-confetti` to the exact file paths inside `/node_modules/`. The browser natively handles the rest!

## 💅 Styling and Live Reload

Just link your CSS normally:

```html
<link rel="stylesheet" href="/styles/main.css" />
```

If you're running `bun run dev`, changing `styles/main.css` triggers a **Hot Swap**. The WebSocket server tells the browser to append a timestamp to the CSS URL, forcing the browser to fetch the new CSS without reloading the page. It's incredibly fast styling iteration.

## 🏗️ Using Frameworks (React, Vue, Alpine)

Because we aren't using a traditional bundler, you can't easily compile JSX (`.tsx` or `.jsx`) or Vue Single File Components (`.vue`) out of the box for the _client-side_.

**However, Server-Side TSX is natively supported!**
You can create `.tsx` files anywhere in your server (e.g. `jsx.tsx` or `api/page.tsx`) and return server-rendered HTML effortlessly using the global `html()` wrapper. You get React-like templating with zero dependencies.

```tsx
// jsx.tsx
export default html((req, body, server) => {
  return (
    <div class="hello">
      <h1>Hello from Server-Side TSX!</h1>
      <p>This was rendered purely on the server.</p>
    </div>
  );
});
```

This stack is heavily optimized for:

- Vanilla TypeScript/DOM manipulation.
- Lightweight frameworks that work directly in the browser (like **Alpine.js** or **Petite Vue**).
- Web Components.
- Native server-rendered TSX.

If you want to use Alpine.js, it's as simple as:

```bash
bun add alpinejs
```

```typescript
// script/main.ts
import Alpine from 'alpinejs';
window.Alpine = Alpine;
Alpine.start();
```

_(Note: If you need a full React SPA, you should probably use Vite! This starter is about keeping the stack as light as possible.)_
