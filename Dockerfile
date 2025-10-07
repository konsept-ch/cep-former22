# syntax=docker/dockerfile:1

FROM node:18-bullseye-slim

# use libreoffice for docx to pdf
RUN apt update && apt install -y \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "prisma", "./"]

RUN npm ci

COPY . .

CMD [ "npm", "run start-prod" ]
