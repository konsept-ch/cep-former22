# syntax=docker/dockerfile:1

FROM node:18-bullseye-slim

# use libreoffice for docx to pdf
RUN set -eux; \
    apt-get update -o Acquire::Retries=5; \
    for attempt in 1 2 3; do \
        apt-get install -y -o Acquire::Retries=5 --fix-missing libreoffice && break; \
        if [ "$attempt" = "3" ]; then exit 1; fi; \
        apt-get update -o Acquire::Retries=5; \
        sleep 5; \
    done; \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "prisma", "./"]

RUN npm ci

COPY . .

CMD [ "npm", "run start-prod" ]
