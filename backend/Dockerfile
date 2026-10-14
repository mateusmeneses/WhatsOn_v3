FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/public/media && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
