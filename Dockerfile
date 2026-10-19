# 固定 Python 版本: python:slim 当前解析到 3.15(cp315),
# aiohttp/fastuuid/pydantic-core/tiktoken 等原生扩展包尚无 cp315 预编译 wheel,
# pip 退回源码编译又无 Rust 工具链, 导致镜像构建失败; 3.13 与本项目运行环境一致且 wheel 全覆盖
FROM python:3.13-slim
WORKDIR /app
# Install Node.js & mermaid
RUN apt-get update && \
    apt-get install -y curl unzip libglib2.0-dev libnss3 libdbus-1-dev libatk1.0-dev libatk-bridge2.0-dev libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxkbcommon0 libasound2 && \
    curl -fsSL https://deb.nodesource.com/setup_25.x | bash - && apt-get install -y nodejs && \
    npm install -g @mermaid-js/mermaid-cli && \
    echo '{"args": ["--no-sandbox"]}' > /app/puppeteer-config.json && \
    echo "alias mmdc='mmdc -p /app/puppeteer-config.json'" >> ~/.bashrc && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
# Install sigmaflow
RUN pip install --no-cache-dir sigmaflow
ENTRYPOINT ["sigmaflow", "--serve"]
