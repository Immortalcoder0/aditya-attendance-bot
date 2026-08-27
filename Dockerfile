FROM node:20-bookworm-slim

# Real Chrome (not just Chromium) + Xvfb (virtual display) + fonts.
# See src/portal/render.js for why a real, non-headless Chrome is required —
# it's a mundane rendering-path difference in the site's own JS, not
# automation detection (verified during development). Xvfb just gives Chrome
# somewhere to render into on a server with no physical display.
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget gnupg ca-certificates fonts-liberation xvfb \
    && mkdir -p /etc/apt/keyrings \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/google-chrome-stable
# Not needed: render.js drives a real Chrome via connectOverCDP, never
# Playwright's own bundled browser — skip the ~300MB download entirely.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN chmod +x docker-entrypoint.sh

# Mount a persistent volume here — it holds the WhatsApp link and every
# linked user's encrypted session. Without a volume, a redeploy or restart
# wipes both and everyone has to re-link.
VOLUME ["/app/data"]

CMD ["./docker-entrypoint.sh"]
