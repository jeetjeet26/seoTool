FROM python:3.12-slim-bookworm

ARG SCREAMING_FROG_VERSION=24.3
ARG SCREAMING_FROG_DEB_URL=https://download.screamingfrog.co.uk/products/seo-spider/screamingfrogseospider_24.3_amd64.deb

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-dejavu-core \
        xauth \
        xvfb \
    && curl --fail --location "${SCREAMING_FROG_DEB_URL}" --output /tmp/screamingfrog.deb \
    && apt-get install -y --no-install-recommends /tmp/screamingfrog.deb \
    && rm -f /tmp/screamingfrog.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
COPY worker/requirements.txt /app/worker/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r /app/worker/requirements.txt

COPY config.py main.py /app/
COPY modules /app/modules
COPY worker /app/worker

RUN chmod +x /app/worker/entrypoint.sh \
    && mkdir -p /tmp/seo-audits

ENTRYPOINT ["/app/worker/entrypoint.sh"]
