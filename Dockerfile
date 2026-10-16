FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run seed:1910 && npm run build
RUN tar -czf /pax-corresponding-source.tar.gz \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./dist' \
  --exclude='./dist-web' \
  --exclude='./dist-android' \
  --exclude='./dist-site' \
  --exclude='./release' \
  --exclude='./coverage' \
  --exclude='./data' \
  --exclude='./server/data' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  --exclude='./_legacy-pax' \
  --exclude='./_open-historia-upstream' \
  --exclude='./_recon' \
  -C /app .

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV OH_UI_LANGUAGE=ru
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/public/lang ./public/lang
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/scripts/fetch-map-assets.mjs ./scripts/fetch-map-assets.mjs
COPY --from=build /app/scripts/map-assets.json ./scripts/map-assets.json
COPY --from=build /pax-corresponding-source.tar.gz ./pax-corresponding-source.tar.gz
RUN mkdir -p /data /assets && chown -R node:node /data /assets /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["sh", "-c", "node scripts/fetch-map-assets.mjs --ensure && node server/server.js"]
