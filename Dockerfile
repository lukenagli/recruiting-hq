# Hosted build: one container that serves the website and the API, with the SQLite database
# continuously backed up to S3-compatible storage by Litestream (the free host's disk is wiped on restart).

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
# fonts-liberation: Times New Roman's and Arial's letter widths, to keep cover letters on one page and draw their PDFs.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata fonts-liberation && rm -rf /var/lib/apt/lists/*
# The site runs on New Haven time, so "today" (home page, deadlines, the daily AI allowance) matches the students' day.
ENV TZ=America/New_York
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -xzf /tmp/litestream.tar.gz -C /usr/local/bin && rm /tmp/litestream.tar.gz
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ backend/
COPY reader-extension/ reader-extension/
COPY --from=web /web/dist frontend/dist
COPY deploy/litestream.yml /etc/litestream.yml
COPY deploy/run.sh run.sh
ENV APP_DB_PATH=/data/app.db PYDANTIC_AI_NO_BANNER=1
CMD ["sh", "run.sh"]
