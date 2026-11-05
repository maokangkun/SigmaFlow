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
	cd src/sigmaflow/server/science && node scripts/build.mjs
	git diff --exit-code -- src/sigmaflow/server/science/dist/
	@test -z "$$(git status --porcelain -- src/sigmaflow/server/science/dist/)" \
		|| (echo "dist 有未提交的重建差异(源码改了没提交 dist, 或 dist 改了源码没跟上):" && \
			git status --porcelain -- src/sigmaflow/server/science/dist/ && exit 1)

# 提交前准入: 双套全绿(包级测试 + science 回归)
.PHONY: test-all
test-all: tests science-regression

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
