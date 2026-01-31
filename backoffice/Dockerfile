# Stage 0, "build-stage", based on Bun, to build and compile the backoffice
FROM oven/bun:1 AS build-stage

WORKDIR /app

COPY package.json bun.lock /app/

COPY backoffice/package.json /app/backoffice/

WORKDIR /app/backoffice

RUN bun install

COPY ./backoffice /app/backoffice
ARG VITE_API_URL

RUN bun run build


# Stage 1, based on Nginx, to have only the compiled app, ready for production with Nginx
FROM nginx:1

COPY --from=build-stage /app/backoffice/dist/ /usr/share/nginx/html

COPY ./backoffice/nginx.conf /etc/nginx/conf.d/default.conf
COPY ./backoffice/nginx-backend-not-found.conf /etc/nginx/extra-conf.d/backend-not-found.conf
