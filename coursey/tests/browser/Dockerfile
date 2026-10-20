FROM node:22-bookworm
WORKDIR /opt/browser
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
ENV NODE_PATH=/opt/browser/node_modules
RUN npm ci --ignore-scripts --no-audit --no-fund && npx playwright install --with-deps chromium
WORKDIR /workspace
CMD ["node", "coursey/tests/browser/smoke.cjs"]
