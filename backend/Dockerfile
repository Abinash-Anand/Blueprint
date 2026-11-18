# ---- build: compile TypeScript ----
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production deps + compiled output ----
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl && mkdir /app && chown node:node /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
# Run as the unprivileged "node" user; --chown avoids a duplicated chown layer.
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node prisma ./prisma
RUN npx prisma generate
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node docker-entrypoint.sh ./
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["sh", "./docker-entrypoint.sh"]
