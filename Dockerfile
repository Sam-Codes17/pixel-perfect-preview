# =======================================================
# Stage 1: Build application
# =======================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Build arguments for Vite client bundle
ARG VITE_SUPABASE_URL=https://gazjbspyjngfqdorlduh.supabase.co
ARG VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdhempic3B5am5nZnFkb3JsZHVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjY5NDEsImV4cCI6MjEwNzE0Mjk0MX0.m_v_oyW1qdOO0x6ZKeQHyb4XkDt9v1yWyfv0bL2yrEU

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Install dependencies using package-lock
COPY package*.json ./
RUN npm ci

# Copy source files
COPY . .

# Compile application and Nitro SSR server
RUN npm run build

# =======================================================
# Stage 2: Production runner
# =======================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy compiled Nitro server bundle and static public assets
COPY --from=builder /app/.output ./.output

# Expose default port
EXPOSE 3000

# Start Nitro Node server (automatically listens on 0.0.0.0:$PORT)
CMD ["node", ".output/server/index.mjs"]
