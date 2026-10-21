"""Verify plugin ZIP contents, versions, source parity and website download links."""
import ast
import json
import re
import tomllib
from pathlib import Path
import zipfile

# Git checkouts may use LF or CRLF. Only normalize this representation for
# known UTF-8 source files; binary assets and every other source byte stay exact.
TEXT_SUFFIXES = {".py", ".toml", ".json", ".md", ".txt", ".cs", ".meta", ".asmdef"}


def comparable_content(relative, content):
    path = Path(relative)
    if path.suffix.lower() in TEXT_SUFFIXES or path.name == "LICENSE":
        return content.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    return content


ROOT = Path(__file__).resolve().parents[1]
config = (ROOT / "src/config/plugins.js").read_text(encoding="utf-8")
for engine in ("blender", "unity"):
    source = ROOT / ("plugins/blender/procedural_terrains" if engine == "blender" else "plugins/unity/Packages/com.zyfou.procedural-terrains")
    if engine == "blender":
        manifest = tomllib.loads((source / "blender_manifest.toml").read_text(encoding="utf-8"))
        version = manifest["version"]
        module = ast.parse((source / "__init__.py").read_text(encoding="utf-8"))
        info = next(ast.literal_eval(node.value) for node in module.body
                    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "bl_info" for target in node.targets))
        assert ".".join(map(str, info["version"])) == version, "Blender manifest and bl_info versions differ"
        expected = {"blender_manifest.toml", *manifest["build"]["paths"]}
        prefix = ""
    else:
        version = json.loads((source / "package.json").read_text())["version"]
        expected = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
        prefix = "com.zyfou.procedural-terrains/"
        guids = [re.search(r"^guid: (\w+)", p.read_text(), re.M).group(1) for p in source.rglob("*.meta")]
        assert len(guids) == len(set(guids)), "Duplicate Unity GUIDs"
        assert all((source / (p + ".meta")).is_file() for p in expected if p.endswith(".cs"))
    filename = f"procedural-terrains-{engine}-{version}.zip"
    assert f"/downloads/plugins/{filename}" in config
    archive_path = ROOT / "public/downloads/plugins" / filename
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {prefix + p for p in expected}
        for p in expected:
            assert comparable_content(p, archive.read(prefix + p)) == comparable_content(p, (source / p).read_bytes()), f"Stale archive entry: {p}"
    print(f"{engine} {version}: {len(expected)} entries, source content and download URL verified")
