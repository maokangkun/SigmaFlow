# 运行器: 有 uv 用 uv(锁文件语义); 没有 uv 的机器回落仓库 .venv。
# .venv 由 `uv sync --all-extras --all-packages --group dev` 建立(`make sync`);
# 无 uv 机器可先在有 uv 的机器上同步一次, 或直接 python -m venv + pip install -e ".[dev]"。
ifeq ($(shell command -v uv 2>/dev/null),)
PY := .venv/bin/python
PYMOD := .venv/bin/python -m
else
PY := uv run python
PYMOD := uv run
endif

.PHONY: sync
sync:
	uv sync --all-extras --all-packages --group dev

.PHONY: format
format:
	$(PYMOD) ruff format
	$(PYMOD) ruff check --fix

.PHONY: format-check
format-check:
	$(PYMOD) ruff format --check

.PHONY: lint
lint:
	$(PYMOD) ruff check

.PHONY: mypy
mypy:
	$(PYMOD) mypy .

.PHONY: tests
tests:
	$(PYMOD) pytest

# Science 工作区回归: 后端 API(HTTP+SSE+WS) + 前端语法/UI 检查;
# build 后 dist 必须与源码一致, 防止"改了源码忘记重建就提交"。
# dist 校验覆盖整个 dist 目录(含未跟踪残留): 只查 index.html 会漏掉
# "懒加载 chunk 陈旧而 index 恰好未变"的形态。
.PHONY: science-regression
science-regression:
	$(PY) src/sigmaflow/server/science/tests/test_backend.py
	cd src/sigmaflow/server/science && node scripts/check.mjs
	cd src/sigmaflow/server/science && node scripts/unittest.mjs
	cd src/sigmaflow/server/science && node scripts/build.mjs
	git diff --exit-code -- src/sigmaflow/server/science/dist/
	@test -z "$$(git status --porcelain -- src/sigmaflow/server/science/dist/)" \
		|| (echo "dist 有未提交的重建差异(源码改了没提交 dist, 或 dist 改了源码没跟上):" && \
			git status --porcelain -- src/sigmaflow/server/science/dist/ && exit 1)
	$(MAKE) web-dist-check

# website dist 一致性(与 science dist 同策略): 重建后必须与提交一致。
# (admin 前端已随 c1d2f1c 下线, 不再有可校验的构建。)
# - website 依赖已钉在 package-lock.json(peer 冲突时代用 --legacy-peer-deps,
#   与锁文件生成时一致)。
# - vite 在全新安装依赖后的第一次构建不稳定(构建间产物哈希会漂移一次,
#   之后逐字节稳定), 因此连建两次、以第二次为准。
# - 无 npm 的环境整体 SKIP(打印提示), 不挂红 —— 与 E2E 的环境哲学一致。
.PHONY: web-dist-check
web-dist-check:
	@if ! command -v npm >/dev/null 2>&1; then \
		echo "SKIP web-dist-check: 本机无 npm(website dist 一致性未验证)"; exit 0; \
	fi; \
	cd src/sigmaflow/server/website && { \
		[ -d node_modules ] || npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 \
			|| npm install --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1; } && \
		npm run build >/dev/null 2>&1 && npm run build >/dev/null 2>&1 \
		|| { echo "FAIL: website 构建失败"; exit 1; }; \
	if [ -n "$$(git -C $(CURDIR) status --porcelain -- src/sigmaflow/server/website/dist)" ]; then \
		echo "website dist 有未提交的重建差异(源码改了没提交 dist, 或 dist 改了源码没跟上):"; \
		git -C $(CURDIR) status --porcelain -- src/sigmaflow/server/website/dist; exit 1; \
	fi; echo "PASS: website dist 与源码一致"

# 浏览器端到端(需本机起服务与 chromium; 无服务自动 SKIP 不阻塞):
#   make e2e          全套(patho3d / 会话切换 / steering), 对常驻服务
#   make e2e-smoke    冒烟: 自起一次性本地服务(127.0.0.1 随机端口, 空模型库),
#                     需模型的套件自跳过, 纯前端套件照跑 —— 不依赖常驻服务
# E2E 依赖 tests/e2e/node_modules, 首次运行自动 npm install(离线时 SKIP)。
# 常驻服务的地址经 SIGMAFLOW_E2E_BASE 覆盖(默认 LAN 部署地址见 helpers.mjs)。
.PHONY: e2e
e2e:
	cd tests/e2e && node run.mjs

.PHONY: e2e-smoke
e2e-smoke:
	$(PY) tests/e2e/smoke.py

# 提交前准入: 双套全绿(包级测试 + science 回归) + E2E 冒烟
.PHONY: test-all
test-all: tests science-regression e2e-smoke

# push 前全量门禁: 格式/静态检查 + 双套测试; 由 git pre-push 钩子自动调用。
# dist 重建需要 esbuild(压缩产物); 没有它也能过, 只是产物体积回到未压缩档。
.PHONY: pre-push
pre-push: format-check lint test-all

# 启用 git 钩子(仓库本地配置 core.hooksPath 指向跟踪的 scripts/git-hooks/;
# 比逐钩子往 .git/hooks/ 放符号链接稳 —— 沙箱/容器对 .git 内部的写入可能不持久)。
# 新克隆后跑一次; 钩子内容随仓库走, 改钩子无需重跑。
.PHONY: hooks
hooks:
	git config core.hooksPath scripts/git-hooks
	@echo "pre-push 钩子已启用: push 前自动跑 make pre-push(format/lint/test-all/science-regression)"

.PHONY: coverage
coverage:
	$(PYMOD) coverage run -m pytest
	$(PYMOD) coverage xml -o coverage.xml
	$(PYMOD) coverage html -d htmlcov
	$(PYMOD) coverage report -m --fail-under=95
