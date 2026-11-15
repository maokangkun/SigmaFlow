"""项目技能自动导入 / 实时扫描 / 同名项目优先 / create_skill 工具。

覆盖:
- create_skill 三类 scope 行为(project 缺 workdir 报错 / project 落盘 / global 落盘+刷新)
- 技能名与必填字段校验、已存在需 overwrite
- project_skills_scan 实时读盘(写入后立即可见)
- load_skill_resolved 的同名项目优先与回落全局
"""

import textwrap
from pathlib import Path

import yaml

from sigmaflow.agent import tools as agent_tools


def _make_skill(
    root: Path, name: str, description: str, body: str = "# Skill\n正文"
) -> Path:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    front = yaml.safe_dump(
        {"name": name, "description": description}, allow_unicode=True
    )
    f = d / "SKILL.md"
    f.write_text(f"---\n{front}---\n\n{body}\n", encoding="utf-8")
    return f


def test_create_skill_requires_valid_name(tmp_path):
    out = agent_tools.create_skill("", "d", "c")
    assert out.startswith("Error:")
    out = agent_tools.create_skill("Bad_Name", "d", "c")
    assert out.startswith("Error:")
    out = agent_tools.create_skill("-bad-", "d", "c")
    assert out.startswith("Error:")


def test_create_skill_project_requires_workdir():
    agent_tools.set_session_workdir(None)
    out = agent_tools.create_skill("some-skill", "d", "c", scope="project")
    assert out.startswith("Error:")
    assert "global" in out


def test_create_skill_writes_project_dir(tmp_path):
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        out = agent_tools.create_skill(
            "pdf-fix", "修复 PDF 文本抽取", "# PDF Fix\n步骤…", scope="project"
        )
        assert out.startswith("Skill created:")
        target = tmp_path / "skills" / "pdf-fix" / "SKILL.md"
        assert target.exists()
        text = target.read_text(encoding="utf-8")
        meta, body = agent_tools.parse_skill_frontmatter(text)
        assert meta["name"] == "pdf-fix"
        assert "修复 PDF 文本抽取" in meta["description"]
        assert "PDF Fix" in body
        # 实时扫描立即可见
        scan = agent_tools.project_skills_scan(str(tmp_path))
        assert "pdf-fix" in scan
        # 重复创建需要 overwrite
        again = agent_tools.create_skill("pdf-fix", "x", "y", scope="project")
        assert again.startswith("Error:")
        assert "overwrite" in again
        ok = agent_tools.create_skill(
            "pdf-fix", "x2", "y2", scope="project", overwrite=True
        )
        assert ok.startswith("Skill created:")
    finally:
        agent_tools.set_session_workdir(None)


def test_create_skill_accepts_full_frontmatter_body(tmp_path):
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        raw = textwrap.dedent(
            """\
            ---
            name: full-form
            description: 模型自带 frontmatter 的完整文本
            ---

            # 全文形态
            """
        )
        out = agent_tools.create_skill("full-form", "d", raw, scope="project")
        assert out.startswith("Skill created:")
        meta, _body = agent_tools.parse_skill_frontmatter(
            (tmp_path / "skills" / "full-form" / "SKILL.md").read_text(encoding="utf-8")
        )
        assert meta["name"] == "full-form"
    finally:
        agent_tools.set_session_workdir(None)


def test_create_skill_global_and_live_scan(tmp_path, monkeypatch):
    gdir = tmp_path / "global-skills"
    gdir.mkdir()
    loader = agent_tools.SkillLoader(gdir)
    monkeypatch.setattr(agent_tools, "skill_loader", loader)
    out = agent_tools.create_skill("glob-skill", "全局技能描述", "# G", scope="global")
    assert out.startswith("Skill created:")
    assert (gdir / "glob-skill" / "SKILL.md").exists()
    # create_skill 已刷新 loader 视图 → get_content 直接命中
    content = agent_tools.skill_loader.get_content("glob-skill")
    assert "glob-skill" in content
    assert "全局技能描述" not in content  # description 在 frontmatter, body 才是内容


def test_load_skill_resolved_project_precedence(tmp_path, monkeypatch):
    # 全局技能 pdf-fix
    gdir = tmp_path / "global-skills"
    gdir.mkdir()
    _make_skill(gdir, "pdf-fix", "全局版本的 pdf-fix", "# GLOBAL VERSION")
    loader = agent_tools.SkillLoader(gdir)
    monkeypatch.setattr(agent_tools, "skill_loader", loader)
    # 项目技能同名覆盖
    project = tmp_path / "proj"
    _make_skill(
        project / "skills", "pdf-fix", "项目版本的 pdf-fix", "# PROJECT VERSION"
    )
    agent_tools.set_session_workdir(str(project))
    try:
        out = agent_tools.load_skill_resolved("pdf-fix")
        assert 'scope="project"' in out
        assert "# PROJECT VERSION" in out
        assert "# GLOBAL VERSION" not in out
        # 项目没有的技能回落全局
        out2 = agent_tools.load_skill_resolved("only-global")
        assert "Error" in out2  # 全局里没有 only-global → 错误列出可用清单
        _make_skill(gdir, "only-global", "只存在于全局", "# ONLY GLOBAL")
        loader._load_all()
        out3 = agent_tools.load_skill_resolved("only-global")
        assert "# ONLY GLOBAL" in out3
        assert 'scope="project"' not in out3
    finally:
        agent_tools.set_session_workdir(None)


def test_project_skills_scan_live_updates(tmp_path):
    skills = tmp_path / "skills"
    agent_tools.set_session_workdir(str(tmp_path))
    try:
        assert agent_tools.project_skills_scan(str(tmp_path)) == {}
        _make_skill(skills, "late-skill", "会话中途新增的技能")
        # TTL 缓存内可能返回旧结果; 清缓存后(或 TTL 过后)下一次扫描即可见
        agent_tools.project_skills_cache_clear(tmp_path)
        scan = agent_tools.project_skills_scan(str(tmp_path))
        assert "late-skill" in scan
        assert scan["late-skill"]["meta"]["description"] == "会话中途新增的技能"
    finally:
        agent_tools.set_session_workdir(None)


def test_create_skill_invalidates_scan_cache(tmp_path):
    """create_skill 落盘后主动失效缓存: 项目内即时可见(不等 TTL)。"""
    calls = {"n": 0}
    orig = agent_tools.parse_skill_frontmatter

    def counting(text):
        calls["n"] += 1
        return orig(text)

    agent_tools.set_session_workdir(str(tmp_path))
    try:
        agent_tools.project_skills_scan(str(tmp_path))  # 预热: 空结果进缓存
        assert agent_tools.project_skills_scan(str(tmp_path)) == {}  # 命中, 不读盘
        assert calls["n"] == 0
        out = agent_tools.create_skill(
            "cached-in", "缓存失效验证", "# C", scope="project"
        )
        assert out.startswith("Skill created:")
        scan = agent_tools.project_skills_scan(str(tmp_path))
        assert "cached-in" in scan  # 未等 TTL 即可见
    finally:
        agent_tools.set_session_workdir(None)
        agent_tools.project_skills_cache_clear(tmp_path)


def test_create_skill_global_per_user_in_multi(tmp_path, monkeypatch):
    """多用户下全局技能按用户隔离: 写入各自 users/<name>/skills, 互不干扰。"""
    monkeypatch.setenv("SIGMAFLOW_SCIENCE_DIR", str(tmp_path))
    # 单用户/单机会话: 沿用 loader 的共享目录, 行为不变
    gdir = tmp_path / "global-skills"
    gdir.mkdir()
    loader = agent_tools.SkillLoader(gdir)
    monkeypatch.setattr(agent_tools, "skill_loader", loader)
    agent_tools.set_session_user("conv-s1", "service", multi=False)
    agent_tools.set_session_scope("conv-s1")
    try:
        out = agent_tools.create_skill(
            "shared-skill", "单用户全局技能", "# S", scope="global"
        )
        assert out.startswith("Skill created:")
        assert (gdir / "shared-skill" / "SKILL.md").exists()
    finally:
        agent_tools.set_session_scope(None)
        agent_tools.set_session_user("conv-s1")

    # 多用户 alice: 落盘到 her users/alice/skills, 且 rebuild 按显式用户刷新
    rebuilds = []

    class FakeView:
        skills_dir = str(gdir)

        def rebuild(self, user=None):
            rebuilds.append(user)

    monkeypatch.setattr(agent_tools, "skill_loader", FakeView())
    agent_tools.set_session_user("conv-a", "alice", multi=True)
    agent_tools.set_session_scope("conv-a")
    try:
        out = agent_tools.create_skill(
            "alice-skill", "alice 的全局技能", "# A", scope="global"
        )
        assert out.startswith("Skill created:"), out
        assert (
            tmp_path / "users" / "alice" / "skills" / "alice-skill" / "SKILL.md"
        ).exists()
        assert rebuilds == ["alice"]  # 显式用户刷新, 不靠池线程的 ContextVar
    finally:
        agent_tools.set_session_scope(None)
        agent_tools.set_session_user("conv-a")

    # 多用户 bob: 同名技能写入 bob 自己的目录, 不见 alice 的文件
    agent_tools.set_session_user("conv-b", "bob", multi=True)
    agent_tools.set_session_scope("conv-b")
    try:
        out = agent_tools.create_skill(
            "alice-skill", "bob 的同名技能", "# B", scope="global"
        )
        assert out.startswith("Skill created:")  # 不冲突: 目录不同, 无需 overwrite
        alice_meta = (
            tmp_path / "users" / "alice" / "skills" / "alice-skill" / "SKILL.md"
        ).read_text(encoding="utf-8")
        assert "alice 的全局技能" in alice_meta  # alice 的内容未被 bob 覆盖
    finally:
        agent_tools.set_session_scope(None)
        agent_tools.set_session_user("conv-b")


def test_session_user_registry_scoped_and_cleaned():
    """登记表按会话 scope 隔离, 清除后回到未登记状态(未登记会话按单用户语义处理)。"""
    agent_tools.set_session_user("s-a", "u1", multi=True)
    agent_tools.set_session_user("s-b", "u2", multi=False)
    try:
        agent_tools.set_session_scope("s-a")
        assert agent_tools._session_user_info() == {"name": "u1", "multi": True}
        agent_tools.set_session_scope("s-b")
        assert agent_tools._session_user_info() == {"name": "u2", "multi": False}
        agent_tools.set_session_scope("s-missing")
        # 未登记的会话查不到 multi 标记 → 全局写入按非多用户处理(单机行为不变)
        assert agent_tools._session_user_info().get("multi") is not True
    finally:
        agent_tools.set_session_scope(None)
        agent_tools.set_session_user("s-a")
        agent_tools.set_session_user("s-b")
