# syntax=docker/dockerfile:1

FROM node:16.17-alpine

# add docx read support with antiword for textract
RUN apk add antiword

ENV NODE_ENV=production

WORKDIR /app

COPY ["package.json", "package-lock.json*", "prisma", "./"]

RUN npm ci

COPY . .

CMD [ "npm", "run start-prod" ]
