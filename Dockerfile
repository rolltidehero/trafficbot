FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json .puppeteerrc.cjs ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json .puppeteerrc.cjs ./
RUN apt-get update \
    && npm ci --omit=dev \
    && ./node_modules/.bin/puppeteer browsers install chrome --install-deps \
    && chown -R node:node /home/node/.cache /app \
    && mkdir -p /app/sessions /app/logs \
    && chown node:node /app/sessions /app/logs
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node useragent ./useragent
USER node
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
 CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.HEALTH_PORT||3000),r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["node", "dist/main.js"]
