FROM node:24-alpine
ENV NODE_ENV=production PORT=80
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node domain/ ./domain/
COPY --chown=node:node fixtures/ ./fixtures/
COPY --chown=node:node prompts/ ./prompts/
COPY --chown=node:node test/engine.test.mjs ./test/engine.test.mjs
COPY --chown=node:node server/ ./server/
COPY --chown=node:node dist/ ./dist/
USER node
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:80/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/http.js"]
