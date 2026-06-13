FROM node:24-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV KIDS_TUNES_DB_PATH=/app/data/kids_tunes.db

WORKDIR /app

COPY package.json .
COPY server.js .

EXPOSE 8787

CMD ["npm", "start"]
