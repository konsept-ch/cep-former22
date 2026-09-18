# syntax=docker/dockerfile:1

# Debian 12 (Bookworm). Debian 11 (Bullseye) a atteint sa fin de vie le 2026-08-31 :
# bullseye-security ne sert plus les paquets LibreOffice et le build echouait en 404.
# Meme base que le middleware DGCS, deja valide en production sur Jelastic.
FROM node:22-bookworm-slim

# use libreoffice for docx to pdf
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "prisma", "./"]

RUN npm ci

COPY . .

CMD [ "npm", "run start-prod" ]
