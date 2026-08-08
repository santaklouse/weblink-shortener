FROM alpine:3.22

ARG PB_VERSION=0.39.9
ARG TARGETARCH

RUN apk add --no-cache ca-certificates unzip wget \
    && case "${TARGETARCH}" in \
      amd64) PB_ARCH="amd64" ;; \
      arm64) PB_ARCH="arm64" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" -O /tmp/pocketbase.zip \
    && mkdir -p /pb \
    && unzip /tmp/pocketbase.zip -d /pb \
    && rm /tmp/pocketbase.zip

WORKDIR /pb
EXPOSE 8090

CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
