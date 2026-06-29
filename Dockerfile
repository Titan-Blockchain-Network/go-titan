FROM golang:1.24.13-trixie@sha256:5835f052b784aa39f2fe9070def3568605c8bc3fcd810f10402066348b61e716 AS build

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends rsync && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/

COPY ./avalanchego /app/avalanchego
COPY ./config /app/config
COPY ./coreth /app/coreth
COPY ./titan-network /app/titan-network

WORKDIR /app/avalanchego/

ARG AVALANCHEGO_COMMIT=unknown
ARG TITAN_ORIGIN=
ENV AVALANCHEGO_COMMIT=${AVALANCHEGO_COMMIT}
ENV TITAN_ORIGIN=${TITAN_ORIGIN}

RUN /app/avalanchego/scripts/build-titan.sh

FROM ubuntu:24.04@sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54

WORKDIR /app

ENV NODE_MODE="" \
    HTTP_HOST=0.0.0.0 \
    HTTP_PORT=9650 \
    STAKING_PORT=9651 \
    PUBLIC_IP= \
    DATA_DIR=/app/data \
    DB_DIR=/app/db \
    DB_TYPE=leveldb \
    BOOTSTRAP_IPS= \
    BOOTSTRAP_IDS= \
    CHAIN_CONFIG_DIR=/app/conf \
    LOG_DIR=/app/logs \
    LOG_LEVEL=info \
    NETWORK_ID=titan \
    STAKING_TLS_CERT_FILE=/app/keys/staker.crt \
    STAKING_TLS_KEY_FILE=/app/keys/staker.key \
    STAKING_SIGNER_KEY_FILE=/app/keys/signer.key \
    AUTOCONFIGURE_PUBLIC_IP=1 \
    AUTOCONFIGURE_BOOTSTRAP=0 \
    AUTOCONFIGURE_BOOTSTRAP_ENDPOINT= \
    EXTRA_ARGUMENTS="" \
    BOOTSTRAP_BEACON_CONNECTION_TIMEOUT="1m" \
    HTTP_ALLOWED_HOSTS="*"

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends curl jq ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/conf/C /app/keys /app/logs /app/db /app/data

COPY --from=build /app/avalanchego/build /app/build
COPY --from=build /app/avalanchego/build/titan /app/build/titan
COPY config/ /app/conf/
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE ${STAKING_PORT}
EXPOSE ${HTTP_PORT}

VOLUME [ "${DB_DIR}" ]
VOLUME [ "${LOG_DIR}" ]
VOLUME [ "${CHAIN_CONFIG_DIR}" ]
VOLUME [ "/app/keys" ]

HEALTHCHECK CMD curl --fail http://localhost:${HTTP_PORT}/ext/health || exit 1

ENTRYPOINT [ "/usr/bin/bash" ]
CMD [ "/app/entrypoint.sh" ]