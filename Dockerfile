FROM node:22-bookworm-slim

WORKDIR /app
# The process starts as root, takes ownership of /data (e.g. a bind-mounted host dir)
# and then drops to PUID/PGID (see src/config.js). 1000 = the image's "node" user.
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    PUID=1000 \
    PGID=1000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY migrations ./migrations
COPY locales ./locales
COPY assets ./assets

RUN mkdir -p /data && chown node:node /data

VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/server.js"]
