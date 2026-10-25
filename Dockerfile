FROM node:24.22-slim AS builder

WORKDIR /usr/src/app

ARG DASHBOARD_BASE_URL
ARG API_BASE_URL
ARG S3_BUCKET_URL
ARG GRAPHQL_WS_URL
ARG ZITADEL_AUTHORITY
ARG ZITADEL_CLIENT_ID
# Restaurant name shown in the app (white-label); defaults to Tokyo Sushi Bar.
ARG RESTAURANT_NAME

ENV DASHBOARD_BASE_URL=${DASHBOARD_BASE_URL} \
    API_BASE_URL=${API_BASE_URL} \
    S3_BUCKET_URL=${S3_BUCKET_URL} \
    GRAPHQL_WS_URL=${GRAPHQL_WS_URL} \
    ZITADEL_AUTHORITY=${ZITADEL_AUTHORITY} \
    ZITADEL_CLIENT_ID=${ZITADEL_CLIENT_ID} \
    RESTAURANT_NAME=${RESTAURANT_NAME}

# The image has no git; skip the Vite+ hook setup run by the `prepare` script.
ENV VP_GIT_HOOKS=0

# Pin pnpm to the version package.json declares (packageManager + devEngines).
# Installed with the image's own npm before any package.json is copied: that
# npm would otherwise be judged by the project's devEngines.
RUN npm install -g pnpm@12.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./

RUN pnpm install --frozen-lockfile

COPY . .

# `nuxt generate` (vs `nuxt build`) ensures Nitro emits the SPA shell as a real
# /index.html in .output/public/ rather than serving it from a virtual server
# module at runtime, required for static file serving.
RUN pnpm run generate

# ---------- Runtime (Caddy) ----------
FROM caddy:2-alpine

# ARGs don't cross stages, so re-declare the subset needed for the CSP origins.
ARG API_BASE_URL
ARG S3_BUCKET_URL
ARG GRAPHQL_WS_URL
ARG ZITADEL_AUTHORITY

COPY Caddyfile.template /tmp/Caddyfile.template

# Derive the CSP origins exactly the way nuxt.config.ts does (URL → origin,
# http→ws), then envsubst them into the Caddyfile. gettext is removed after
# substitution so the runtime image stays minimal.
RUN apk add --no-cache gettext libcap && \
    export API_ORIGIN=$(echo "$API_BASE_URL" | awk -F/ '{print $1"//"$3}') && \
    export WS_ORIGIN=$(echo "$API_ORIGIN" | sed 's/^http/ws/') && \
    export S3_BUCKET_URL ZITADEL_AUTHORITY && \
    envsubst '${API_ORIGIN} ${WS_ORIGIN} ${S3_BUCKET_URL} ${ZITADEL_AUTHORITY}' \
        < /tmp/Caddyfile.template > /etc/caddy/Caddyfile && \
    rm /tmp/Caddyfile.template && \
    setcap -r /usr/bin/caddy && \
    apk del gettext libcap

# Strip cap_net_bind_service from /usr/bin/caddy above. The base image grants
# it so Caddy can bind ports <1024; we listen on 3000 so it's unused, and
# leaving it on breaks Kubernetes pods that set allowPrivilegeEscalation:false
# + drop:ALL caps: the kernel refuses to exec a binary whose file caps
# exceed the container's bounding set under no_new_privs.

# Strip the base image's welcome page so any future Nuxt rename doesn't leave
# it lingering alongside the SPA shell.
RUN rm -rf /usr/share/caddy/*

COPY --from=builder /usr/src/app/.output/public /usr/share/caddy

USER 1000:1000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
