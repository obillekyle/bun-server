# 🚀 Deployment & Production

So you've built your awesome app with the Bun Server, and now it's time to show it to the world. Deploying this stack is incredibly simple because Bun is practically a self-contained runtime.

## 🏃 Running in Production

In development, you use `bun run dev` to get the magic live-reloader and file watchers. In production, you want raw speed and stability.

```bash
# Start the server without any watchers
bun run serve
```

This runs the `.server/serve.ts` entrypoint. It skips the TypeScript live-compilation watchers and live-reload WebSocket injection, dedicating all resources to serving your app fast.

## 🛡️ Using a Process Manager (PM2)

If your server crashes in production, you want it to restart automatically. PM2 is the industry standard for this.

1. **Install PM2 globally:**
   ```bash
   npm install pm2 -g
   # or
   bun install -g pm2
   ```

2. **Start your app with PM2:**
   ```bash
   pm2 start bun --name "my-bun-app" -- run serve
   ```

3. **Save the PM2 list** so it restarts on server reboot:
   ```bash
   pm2 save
   pm2 startup
   ```

## 🐳 Docker Deployment

Want to containerize? Bun has an official, super-lean Docker image.

Create a `Dockerfile` in your root:

```dockerfile
# Use the official Bun image
FROM oven/bun:1 as base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Expose your port (match your server.config.ts)
EXPOSE 3000

# Start the production server
CMD ["bun", "run", "serve"]
```

Build and run:
```bash
docker build -t my-bun-app .
docker run -p 3000:3000 my-bun-app
```

## 🌍 Setting Up a Reverse Proxy (Nginx)

Usually, you shouldn't expose Bun directly to port 80 or 443. You'll want to use Nginx or Caddy to handle SSL (HTTPS) and proxy traffic to your Bun app.

Here is a basic **Nginx** configuration block:

```nginx
server {
    listen 80;
    server_name myawesomeapp.com;

    location / {
        # Proxy traffic to the Bun server
        proxy_pass http://127.0.0.1:3000;
        
        # Pass essential headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (Required if you use WebSockets in your app)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

## 🔐 Environment Variables

Bun automatically loads `.env` files. Ensure you have a `.env` file in your production environment containing your secrets.

**Never commit your `.env` file to git!**

```env
# .env
API_SECRET_KEY=super_secret_production_key_123
DATABASE_URL=./.database/production.db
```

Access them anywhere in your backend code:
```typescript
const secret = process.env.API_SECRET_KEY;
```