# ============================================================
# Stage 1: Builder
# 安装所有依赖（包括编译 better-sqlite3 native 模块）
# 并构建前端产物
# ============================================================
FROM node:20-alpine AS builder

# 安装编译 native 模块所需的工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 先只复制 package 文件，充分利用 Docker 缓存
COPY package.json package-lock.json ./

RUN npm ci

# 复制全部源码并构建前端
COPY . .

RUN npm run build

# ============================================================
# Stage 2: Production
# 只保留运行时必要文件，缩小镜像体积
# ============================================================
FROM node:20-alpine AS production

WORKDIR /app

# 从 builder 阶段复制已编译的依赖和产物
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public       ./public

# 复制服务端源码
COPY server.js      ./
COPY server/        ./server/

# 数据目录（SQLite 数据库会写在这里，挂载 Volume 持久化）
RUN mkdir -p /app/data

EXPOSE 8866

# 环境变量（可通过 docker run -e 或 compose 覆盖）
ENV NODE_ENV=production
ENV PORT=8866

CMD ["node", "server.js"]
