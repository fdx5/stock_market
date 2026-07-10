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

COPY backend/app ./app
COPY --from=frontend-build /frontend/dist ./app/static

ENV PORT=8000
# In-process caches (see app/services/cache.py) aren't shared across workers, so
# raising this multiplies upstream-scraper traffic by the same factor. Only raise
# it once the host has more than one usable CPU to actually take advantage of it.
ENV WEB_CONCURRENCY=1
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}"]
