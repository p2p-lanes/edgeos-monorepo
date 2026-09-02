FROM public.ecr.aws/docker/library/node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ai-service/package.json ./ai-service/
RUN pnpm install --frozen-lockfile --filter ai-service...

COPY ai-service ./ai-service
RUN pnpm --filter ai-service build

FROM public.ecr.aws/docker/library/node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/ai-service/node_modules ./ai-service/node_modules
COPY --from=build /app/ai-service/package.json ./ai-service/package.json
COPY --from=build /app/ai-service/dist ./ai-service/dist
COPY --from=build /app/ai-service/skills ./ai-service/skills

USER node
EXPOSE 3002
CMD ["node", "ai-service/dist/index.js"]
