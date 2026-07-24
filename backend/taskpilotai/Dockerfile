# Multi-stage Dockerfile for TaskPilot AI Backend on Google Cloud Run
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm ci --only=production

# Copy application source files
COPY server.mjs ./
COPY clean_datasets.py ./
COPY agent/ ./agent/
COPY api/ ./api/
COPY datasets/ ./datasets/

# Runtime stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

# Copy built dependencies and app files
COPY --from=builder /app /app

EXPOSE 8787

CMD ["node", "server.mjs"]
