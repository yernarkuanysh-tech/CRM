ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4173

ENV NODE_ENV=production

CMD ["npm", "start"]
