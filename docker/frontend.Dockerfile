FROM nginx:1.27-alpine

ENV TZ=Asia/Shanghai

COPY docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/public /usr/share/nginx/html

EXPOSE 80
