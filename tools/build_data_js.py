# 把 chaoxing_phys 导出的题库 JSON 转成站点用的 js/data.js
#
# 输入: E:\DSH\chaoxing_phys\data\大学物理II题库.json
# 输出: <站点>/js/data.js      const QUIZ_BANKS = [...]
#
# 字段约定（与电工学站一致，另加两个）：
#   k  题号 key      t 题型 single/multiple/judge/fill   s 题干（含 $LaTeX$ 与 ![](img/x.png)）
#   o  选项 dict     a 答案（填空为数组）                src 答案来源
#   wrong / my      学习通里是否答错、当时的选择
#   an 解析（新增）  note 备注（新增，一般不用）
#
# 用法: py tools\build_data_js.py
import json
import re
from datetime import datetime
from pathlib import Path

SITE = Path(__file__).parent.parent
SRC = Path(r"E:\DSH\chaoxing_phys\data\大学物理II题库.json")
OUT = SITE / "js" / "data.js"

# 章节归类：section -> (chapter id, 章节显示名)
CHAPTER_MAP = {
    "2.10": ("vib", "第9章 振动"),
    "3.10": ("wave", "第10章 波动"),
    "5.7": ("gas", "气体动理论"),
    "5.8": ("gas", "气体动理论"),
    "6.11": ("quantum", "量子物理"),
    "7.8": ("rel", "狭义相对论"),
    "8.8": ("thermo", "热力学"),
    "8.9": ("thermo", "热力学"),
    "9.3": ("exp", "物理实验"),
    "10.3": ("exp", "物理实验"),
    "11.3": ("exp", "物理实验"),
    "12.5": ("exp", "物理实验"),
    "13.5": ("exp", "物理实验"),
}


def clean_title(title: str) -> str:
    """去掉测验标题里的冗余后缀。"""
    t = (title or "").strip()
    t = re.sub(r"\s*测试\s*[12]?\s*$", "", t)
    return t or title


def main():
    bank = json.loads(SRC.read_text(encoding="utf-8"))
    banks = []
    for quiz in bank["quizzes"]:
        sec = quiz["section"]
        ch_id, ch_name = CHAPTER_MAP.get(sec, ("other", "其他"))
        qs = []
        for q in quiz["questions"]:
            qs.append({
                "k": f"{sec}#{q['num']}",
                "t": q["type"],
                "s": q["stem"],
                "o": q["options"],
                "a": q["answer"],
                "src": "official" if q.get("answer_source") == "page" else "unknown",
                "wrong": q.get("was_correct") is False,
                "my": q.get("my_answer"),
                **({"an": q["analysis"]} if q.get("analysis") else {}),
                **({"note": q["note"]} if q.get("note") else {}),
            })
        banks.append({
            "id": sec.replace(".", "_"),
            "section": sec,
            "name": clean_title(quiz["title"]),
            "chapter": ch_id,
            "chapterName": ch_name,
            "questions": qs,
        })

    payload = json.dumps(banks, ensure_ascii=False, separators=(",", ":"))
    header = (
        "// 由 tools/build_data_js.py 从 chaoxing_phys 导出的题库自动生成，不要手改\n"
        f"// 生成时间：{datetime.now().isoformat(timespec='seconds')}\n"
        f"// {len(banks)} 个测验 / {sum(len(b['questions']) for b in banks)} 题\n"
    )
    OUT.write_text(header + "const QUIZ_BANKS = " + payload + ";\n", encoding="utf-8")

    n_q = sum(len(b["questions"]) for b in banks)
    n_wrong = sum(1 for b in banks for q in b["questions"] if q["wrong"])
    n_an = sum(1 for b in banks for q in b["questions"] if q.get("an"))
    print(f"写出 {OUT}  {OUT.stat().st_size} 字节")
    print(f"  {len(banks)} 个测验 / {n_q} 题；学习通答错 {n_wrong} 题；带解析 {n_an} 题")
    for b in banks:
        print(f"  {b['section']:<6}{b['chapterName']:<10}{b['name']:<16}{len(b['questions'])} 题")


if __name__ == "__main__":
    main()
