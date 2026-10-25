ARG API_IMAGE=territory-load-api:read-collation
FROM ${API_IMAGE} AS reference

FROM node:20-alpine AS dependencies
WORKDIR /lab-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM reference AS nest
WORKDIR /app
COPY . /app/labs
CMD ["node", "/app/labs/nest/main.cjs"]

FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS bun
WORKDIR /app
# Reuse the EXACT compiled domain rules and generated schema metadata, not AppModule.
# The Prisma engine is never instantiated by this entrypoint.
COPY --from=reference /app /app
COPY --from=dependencies /lab-dependencies/node_modules /app/labs/node_modules
COPY . /app/labs
CMD ["bun", "/app/labs/bun/main.cjs"]
