# pili-dashboard

Admin dashboard of Pili for restaurant operations.

Repository `nuagemagique-dev/pili-dashboard`, local folder and internal name `tsb-dashboard`. Images: `ghcr.io/nuagemagique-dev/pili-dashboard-tsb` and `ghcr.io/nuagemagique-dev/pili-dashboard-ygf`.

`tsb-dashboard` is used by staff to manage products and monitor orders in real time.

## Stack

- Nuxt 4 (Vue 3, SSR)
- Nuxt UI 4 + Tailwind CSS 4
- Pinia with persisted state
- GraphQL + subscriptions (`graphql-ws`)
- `@nuxtjs/i18n` (fr default, en, zh)

## Main features

- Product CRUD with multilingual translations
- Live order board with status updates
- Auth-protected admin routes

## Local setup

### 1) Environment

```bash
cp .env.example .env
```

Minimum variables:

- `DASHBOARD_BASE_URL`
- `API_BASE_URL`
- `GRAPHQL_WS_URL`
- `S3_BUCKET_URL`
- `ZITADEL_AUTHORITY`
- `ZITADEL_CLIENT_ID`

### 2) Install and run

```bash
pnpm install
pnpm dev
```

## Commands

```bash
pnpm dev
pnpm build
pnpm preview
pnpm generate
pnpm lint
```

## Docker

```bash
docker build -t tsb-dashboard .
docker run --name tsb-dashboard --env-file .env -p 3000:3000 tsb-dashboard
```

The Dockerfile is multi-stage with a healthcheck and supports multi-arch builds.

## Deployment

### tokyosushi (`ghcr.io/nuagemagique-dev/pili-dashboard-tsb`)

- Push to `main`: builds and publishes `:latest` (multi-arch) and deploys to the home server.
- Tag `v*`: builds `:production` + version tags (AMD64) from the `TSB_*`
  variables, then deploys the Helm release `tokyosushi-apps` to OVH.
- Manual rollback: run the workflow with the target version.

### ygfliege (`ghcr.io/nuagemagique-dev/pili-dashboard-ygf`)

- Tag `ygf-v*`: builds `:production` + version tags (AMD64) from the `YGF_*`
  variables, then deploys the Helm release `ygf-apps` (namespace `ygf`).

Build and deploy settings are named per brand: `TSB_*` and `YGF_*` variables,
the `TSB_DEPLOY_TOKEN` secret, `IMAGE_NAME_TSB` and `IMAGE_NAME_YGF` in the
workflow. Shared ones (`PAT`, `OVH_*`) carry no prefix.

## Pili repositories

Every Pili repository lives in the GitHub org `nuagemagique-dev`. Local folders kept their earlier names.

| Repository                           | Local folder     | What it is                                             |
| ------------------------------------ | ---------------- | ------------------------------------------------------ |
| pili-api                             | `tsb-service`    | GraphQL API (Go) and the `pili-mcp` tool server        |
| pili-shop                            | `tsb-core`       | Customer web shop, one Nuxt app per brand              |
| **pili-dashboard** (this repository) | `tsb-dashboard`  | Admin dashboard (Nuxt)                                 |
| pili-mobile                          | `tsb-mobile`     | Customer iOS and Android app (Expo)                    |
| pili-handheld                        | `moyun-handheld` | Staff handheld app for the Sunmi V3H (Kotlin)          |
| pili-pos                             | `moyun-pos`      | SCE 2.0 cash register (Rust engine, Android and Linux) |
| pili-agent                           | `tsb-agent`      | Owner and staff Telegram agent                         |
| pili-infra                           | `tsb-infra`      | Helm charts, Terraform, SOPS secrets, runbooks         |
