FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY apps ./apps
COPY packages ./packages
EXPOSE 3000
ENV PORT=3000 HUB_DATA_DIR=/data HUB_PUBLIC_ORIGIN=http://localhost:3000
VOLUME ["/data"]
CMD ["node", "apps/api/src/server.mjs"]
