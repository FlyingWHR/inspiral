# Inspiral, in a box.
#
# Node 22 rather than 24: the repo's floor is 22 and better-sqlite3 v13 ships
# prebuilt binaries for it, so nothing has to compile at image build time.
# build-essential/python3 are here only as the fallback path for an architecture
# with no prebuild -- on arm64 and x64 they go unused.
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first so a source edit does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Where the writable copy of any seeded world lives. Never the host's file:
# a live clock is writing to that one, and two writers on a SQLite world is
# how you lose the only artefact in this project that cannot be regenerated.
RUN mkdir -p /app/data
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8787 8788 8790
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "serve"]
