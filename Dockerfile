# Multi-stage build for the Gorilla MCP server.
# Stage 1: install + compile.
FROM node:25-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --omit=dev=false --no-audit --no-fund \
 && npm run build

# Stage 2: minimal runtime. Only ship dist + production deps.
FROM node:25-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
