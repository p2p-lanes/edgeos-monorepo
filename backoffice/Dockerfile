# Stage 0, "build-stage", based on Node + pnpm, to build and compile the backoffice
FROM public.ecr.aws/docker/library/node:20-alpine AS build-stage
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /app/

COPY backoffice/package.json /app/backoffice/

ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile

COPY ./backoffice /app/backoffice
ARG VITE_API_URL
ENV NODE_ENV=production

RUN pnpm --filter backoffice run build


# Stage 1, based on Nginx, to have only the compiled app, ready for production with Nginx
FROM public.ecr.aws/docker/library/nginx:1.28-alpine

COPY --from=build-stage /app/backoffice/dist/ /usr/share/nginx/html

COPY ./backoffice/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./backoffice/nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
