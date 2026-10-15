# SideHustle — production image for Render / any Docker host
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY server.js ./
COPY models ./models
COPY routes ./routes
COPY services ./services
COPY public ./public

# Optional: if you keep README/.env.example in image for docs
# COPY README.md .env.example ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Render injects PORT; server.js already uses process.env.PORT
CMD ["node", "server.js"]