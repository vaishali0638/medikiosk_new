# Multi-stage build for the core API.
# Build context is the repository root so workspace packages resolve.

FROM node:22-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json* tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
COPY tools ./tools
COPY tests ./tests
COPY apps/patient_pwa/package.json ./apps/patient_pwa/package.json
COPY apps/doctor_web/package.json ./apps/doctor_web/package.json
COPY apps/governance_web/package.json ./apps/governance_web/package.json

RUN npm ci --ignore-scripts
RUN npx tsc --build services/core_api

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Run unprivileged: the container handles patient data and must not run as root.
RUN addgroup -S medikiosk && adduser -S medikiosk -G medikiosk

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/services/core_api/dist ./services/core_api/dist
COPY --from=builder /repo/services/core_api/package.json ./services/core_api/package.json

USER medikiosk
EXPOSE 3000
CMD ["node", "services/core_api/dist/main.js"]
