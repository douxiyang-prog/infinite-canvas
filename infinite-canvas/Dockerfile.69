FROM ghcr.io/douxiyang-prog/infinite-canvas:latest

RUN rm -rf /usr/share/nginx/html/assets /usr/share/nginx/html/index.html
COPY web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh \
    && chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
