# syntax=docker/dockerfile:1

FROM node:16.17-alpine

# use libreoffice for docx to pdf
RUN apk add libreoffice

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "prisma", "./"]

RUN npm ci

COPY . .

CMD [ "npm", "run start-prod" ]
