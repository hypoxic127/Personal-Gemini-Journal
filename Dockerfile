# Stage 1: Build Frontend and Packages
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifest files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/
COPY web/package.json ./web/

# Install all dependencies including devDependencies for build
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY shared/ ./shared/
COPY api/ ./api/
COPY web/ ./web/
COPY tsconfig.json ./

# Build shared, web and api
RUN pnpm -F @journal/shared build
RUN pnpm -F @journal/web build
RUN pnpm -F @journal/api build

# Stage 2: Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY shared/package.json ./shared/
COPY api/package.json ./api/

# Copy built shared artifacts
COPY --from=builder /app/shared/dist ./shared/dist
# Copy built api artifacts
COPY --from=builder /app/api/dist ./api/dist
# Copy built web static assets
COPY --from=builder /app/web/dist ./web/dist

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Least-privilege non-root user
USER node

CMD ["node", "api/dist/index.js"]