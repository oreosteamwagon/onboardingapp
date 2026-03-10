FROM node:20-alpine AS base

# ---- deps ----
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++ openssl
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ---- builder ----
FROM base AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# Compile seed.ts to CommonJS so it can run without tsx at runtime
RUN cd prisma && \
    node ../node_modules/typescript/bin/tsc \
      --module commonjs \
      --moduleResolution node \
      --target es2020 \
      --outDir ../dist-seed \
      --esModuleInterop true \
      --skipLibCheck true \
      seed.ts

# ---- runner ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads && \
    mkdir -p /app/.next && chown nextjs:nodejs /app/.next

# Next.js standalone app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: migrations, schema, and generated client
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Prisma CLI (for migrate deploy)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# argon2 native module (for seed)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/argon2 ./node_modules/argon2

# Compiled seed
COPY --from=builder --chown=nextjs:nodejs /app/dist-seed/seed.js ./dist-seed/seed.js

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
