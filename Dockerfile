# syntax=docker/dockerfile:1

FROM node:16.14-alpine
ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm ci

COPY . .

RUN npx prisma generate

CMD [ "npm", "start" ]
