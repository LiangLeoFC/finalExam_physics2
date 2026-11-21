# 下载 KaTeX 并裁剪到站点所需的最小集合（js + css + fonts + auto-render）
#
# 为什么要本地化：GitHub Pages 是静态站，jsdelivr 在国内经常抽风/被墙，
# 一旦 CDN 挂了公式就整片空白。KaTeX 全部产物约 1 MB，直接进仓库最稳。
#
# 用 npmmirror（阿里源）拉 tgz，不写全局 npm 配置。
#
# 输出: <站点>/js/vendor/katex.min.js
#       <站点>/js/vendor/auto-render.min.js
#       <站点>/css/vendor/katex.min.css
#       <站点>/css/vendor/fonts/*.woff2
#
# 用法: py tools\fetch_katex.py
import io
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

SITE = Path(__file__).parent.parent
VERSION = "0.16.11"
URL = f"https://registry.npmmirror.com/katex/-/katex-{VERSION}.tgz"

JS_DIR = SITE / "js" / "vendor"
CSS_DIR = SITE / "css" / "vendor"
FONT_DIR = CSS_DIR / "fonts"


def main():
    print(f"下载 {URL}")
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        blob = r.read()
    print(f"  {len(blob) / 1024:.0f} KB")

    JS_DIR.mkdir(parents=True, exist_ok=True)
    FONT_DIR.mkdir(parents=True, exist_ok=True)

    want = {
        f"package/dist/katex.min.js": JS_DIR / "katex.min.js",
        f"package/dist/contrib/auto-render.min.js": JS_DIR / "auto-render.min.js",
        f"package/dist/katex.min.css": CSS_DIR / "katex.min.css",
    }
    n_fonts = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = member.name
            if name in want:
                with tar.extractfile(member) as fh:
                    want[name].write_bytes(fh.read())
                print(f"  解出 {name} -> {want[name].relative_to(SITE)}")
            elif name.startswith("package/dist/fonts/") and name.endswith(".woff2"):
                out = FONT_DIR / Path(name).name
                with tar.extractfile(member) as fh:
                    out.write_bytes(fh.read())
                n_fonts += 1

    # katex.min.css 里引用的是 fonts/KaTeX_*.woff2，与 css/vendor/fonts/ 对齐
    for name in ("katex.min.js", "auto-render.min.js"):
        p = JS_DIR / name
        if not p.exists():
            print(f"!! 缺少 {name}")
            sys.exit(1)

    print(f"\n完成：KaTeX {VERSION}  字体 {n_fonts} 个")
    print(f"  {JS_DIR.relative_to(SITE)}/katex.min.js")
    print(f"  {JS_DIR.relative_to(SITE)}/auto-render.min.js")
    print(f"  {CSS_DIR.relative_to(SITE)}/katex.min.css")
    print(f"  {FONT_DIR.relative_to(SITE)}/")


if __name__ == "__main__":
    main()
