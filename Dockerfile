FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install --global pnpm@11.7.0 \
    && pnpm install --frozen-lockfile --prod
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY samples ./samples
COPY templates ./templates

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
