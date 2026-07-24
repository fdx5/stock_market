# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Python backend serving API + built frontend ---
FROM python:3.11-slim AS runtime
WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Claude Code CLI, so the prediction batch's 60% analysis can run on a Claude
# subscription (PREDICTION_AI_BACKEND=subscription + CLAUDE_CODE_OAUTH_TOKEN) instead
# of metered API credits. python:3.11-slim ships no Node, so pull Node 20 from
# NodeSource and install the CLI globally — it lands on PATH as `claude`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && npm cache clean --force \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# The image pins the CLI version it was built with. Letting it self-update mid-batch
# would swap the binary under a running analysis for no benefit — redeploys are how
# this gets upgraded.
ENV DISABLE_AUTOUPDATER=1

COPY backend/app ./app
COPY --from=frontend-build /frontend/dist ./app/static

ENV PORT=8000
# In-process caches (see app/services/cache.py) aren't shared across workers, so
# raising this multiplies upstream-scraper traffic by the same factor. Only raise
# it once the host has more than one usable CPU to actually take advantage of it.
ENV WEB_CONCURRENCY=1
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}"]
