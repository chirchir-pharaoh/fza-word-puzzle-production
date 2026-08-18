# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
# Installs dependencies, runs code checks/tests, and creates the static frontend
# output in dist/. Keeping checks in the image build catches errors before the
# container can be promoted to staging.
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --fund=false; fi
COPY . .
RUN npm run check && npm test && npm run security:check && npm run build

# -----------------------------------------------------------------------------
# Runtime stage
# -----------------------------------------------------------------------------
# Copies only the files needed to serve static assets and the API. The app runs
# as a non-root user and listens on PORT, defaulting to 8080 for Docker Compose.
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev --no-audit --fund=false; fi && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/api ./api
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/migrations ./migrations
RUN useradd --create-home --shell /usr/sbin/nologin appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/docker-server.js"]
