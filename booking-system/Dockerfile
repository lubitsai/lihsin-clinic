# 立欣診所預約系統 — production image（Next.js standalone）
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# build 期不需要真實密鑰，提供佔位讓 Next.js 收集頁面
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-placeholder-secret-0123456789" \
    PII_ENCRYPTION_KEY="build-placeholder-encryption-key-0123456789" \
    PII_HASH_KEY="build-placeholder-hash-key-01234"
RUN npx prisma generate && npx next build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Taipei
RUN addgroup -S app && adduser -S app -G app
# standalone 伺服器與靜態資源
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# 完整 node_modules（含 prisma CLI、tsx、產生的 client）供 migrate/seed/提醒腳本使用
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/scripts ./scripts
COPY --from=builder --chown=app:app /app/src ./src
COPY --from=builder --chown=app:app /app/package.json /app/tsconfig.json ./
USER app
EXPOSE 3000
CMD ["node", "server.js"]
