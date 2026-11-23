# Plain HTTP reading only (Scrapling's Fetcher) — no browser, so no `scrapling install` step and
# no Chromium/Playwright in this image. Keeps the image small and the service fast to deploy.
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py extract.py listing.py safety.py ./

ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
