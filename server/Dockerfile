FROM node:22-bookworm-slim

WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/index.js ./
COPY server/reference ./reference

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3001
VOLUME ["/data"]
EXPOSE 3001
CMD ["node", "index.js"]
