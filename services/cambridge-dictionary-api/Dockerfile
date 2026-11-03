FROM node:24-alpine
WORKDIR /service
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY LICENSE.txt README.md ./
COPY src ./src
COPY upstream ./upstream
# Schema is supplied in the same relative layout the adapter uses.
COPY schema ./schema
RUN mkdir -p /cache && chown node:node /cache
ENV HOST=0.0.0.0 PORT=3211 CACHE_DIR=/cache
USER node
EXPOSE 3211
CMD ["node", "src/server.js"]
