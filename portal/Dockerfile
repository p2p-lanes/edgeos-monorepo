# Stage 0: Build the portal
FROM public.ecr.aws/docker/library/node:20-alpine AS build-stage
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /app/

COPY portal/package.json /app/portal/
COPY packages/shared-form-ui/package.json /app/packages/shared-form-ui/

ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile

COPY ./packages/shared-form-ui /app/packages/shared-form-ui
COPY ./portal /app/portal
ARG NEXT_PUBLIC_API_URL
ENV NODE_ENV=production

RUN pnpm --filter portal run build


# Stage 1: Production runtime
FROM public.ecr.aws/docker/library/node:20-alpine

WORKDIR /app

COPY --from=build-stage /app/portal/.next/standalone ./
COPY --from=build-stage /app/portal/.next/static ./portal/.next/static
COPY --from=build-stage /app/portal/public ./portal/public

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

CMD ["node", "portal/server.js"]
