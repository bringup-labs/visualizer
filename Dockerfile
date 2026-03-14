# Build stage
FROM node:22 AS build
WORKDIR /src
ARG API_URL
ARG DEV_WORKSPACE
ARG BAGMASTER_KEYCLOAK_URL
ARG BAGMASTER_KEYCLOAK_REALM
ARG BAGMASTER_KEYCLOAK_CLIENT_ID
ENV API_URL=$API_URL
ENV DEV_WORKSPACE=$DEV_WORKSPACE
ENV BAGMASTER_KEYCLOAK_URL=$BAGMASTER_KEYCLOAK_URL
ENV BAGMASTER_KEYCLOAK_REALM=$BAGMASTER_KEYCLOAK_REALM
ENV BAGMASTER_KEYCLOAK_CLIENT_ID=$BAGMASTER_KEYCLOAK_CLIENT_ID
COPY . ./

RUN corepack enable
RUN yarn install --immutable

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080

COPY <<EOF /entrypoint.sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /lichtblick
touch /lichtblick/default-layout.json
index_html=\$(cat index.html)
replace_pattern='/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=\$(cat /lichtblick/default-layout.json)
echo "\${index_html/"\$replace_pattern"/\$replace_value}" > index.html

# Continue executing the CMD
exec "\$@"
EOF

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8080"]
