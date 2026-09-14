# Frontend image: build the React app to static files, then serve them with Caddy.
# Caddy ALSO terminates HTTPS and reverse-proxies the API — see the Caddyfile.
#
# Build context is the repo root (see docker-compose.yml): backend/, frontend/
# and these deployment files all live there together.

# --- build stage: produce the static site ---
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Empty base = the app calls the API on the SAME domain (/api/...), so there is
# no cross-origin request and no hardcoded server address. See frontend/src/api.js.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- serve stage: Caddy with the built site + our config ---
FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
