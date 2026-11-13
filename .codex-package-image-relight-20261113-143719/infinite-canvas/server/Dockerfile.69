FROM ghcr.io/douxiyang-prog/infinite-canvas-api:latest

COPY src ./src
COPY sql ./sql

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
