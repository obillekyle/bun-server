# 🚀 Deployment & Production

Deploying the Bun Server is direct because Bun is a self-contained runtime.

---

## 🏃 1. Running in Production

While `bun run dev` runs local development watchers and compile cache-busters, production requires raw speed.

To launch the high-performance production server, run:
```bash
bun run serve
```
This disables dev watchers, livereload sockets, and developer dashboards.

---

## 🛡️ 2. Process Management (PM2)

Use PM2 to automatically restart your application if it crashes or if the host machine reboots.

```bash
# Install PM2
npm install pm2 -g

# Start your production server
pm2 start bun --name "my-bun-app" -- run serve

# Save PM2 process list to load on reboot
pm2 save
pm2 startup
```

---

## 🐳 3. Containerization (Docker)

Use the official, lightweight Bun image. Create a `Dockerfile`:

```dockerfile
FROM oven/bun:1 as base
WORKDIR /usr/src/app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
EXPOSE 3000

CMD ["bun", "run", "serve"]
```

Build and run:
```bash
docker build -t my-bun-app .
docker run -d -p 3000:3000 my-bun-app
```

---

## 🌍 4. Reverse Proxy (Nginx)

Place Nginx in front of your server to handle SSL and proxy traffic safely.

Add this site configuration block to Nginx:

```nginx
server {
    listen 80;
    server_name myawesomeapp.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name myawesomeapp.com;

    ssl_certificate /etc/letsencrypt/live/myawesomeapp.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/myawesomeapp.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
    }
}
```

---

## 🔐 5. Environment Variables

Bun automatically loads `.env` variables into `process.env`. 

**Never commit `.env` to Git.** Add it to `.gitignore` and create a production-only version on your host:

```env
PORT=3000
DATABASE_URL=./.database/production.db
DASHPASS=my_secret_console_password_123
```
Access keys in your backend via `process.env.DASHPASS`.