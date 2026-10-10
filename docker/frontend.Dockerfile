# 多阶段构建：Node 构建产物 → Nginx 运行（镜像体积与运行依赖最小化）
FROM node:22-alpine AS build

ENV TZ=Asia/Shanghai
WORKDIR /app

COPY frontend/package.json frontend/.npmrc ./
RUN npm install --registry=https://registry.npmmirror.com

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

ENV TZ=Asia/Shanghai
COPY docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80