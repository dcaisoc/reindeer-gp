"""Build notebooks/*.ipynb from the readable sources in notebooks/src/*.py.

Sources use "# %%" to start a code cell and "# %% [markdown]" for a text cell
(lines in markdown cells start with "# "). Edit the .py files, then run:

    python3 scripts/build_notebooks.py          # CI checks the .ipynb files are up to date
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "notebooks" / "src"
OUT = ROOT / "notebooks"


def cells_from(text: str) -> list[dict]:
    cells = []
    for block in re.split(r"^# %%", text, flags=re.M)[1:]:
        header, _, body = block.partition("\n")
        body = body.strip("\n")
        if header.strip() == "[markdown]":
            lines = [re.sub(r"^# ?", "", l) for l in body.split("\n")]
            cells.append({"cell_type": "markdown", "metadata": {}, "source": _src("\n".join(lines))})
        else:
            cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": _src(body)})
    return cells


def _src(s: str) -> list[str]:
    lines = s.split("\n")
    return [l + "\n" for l in lines[:-1]] + [lines[-1]]


def build(path: Path) -> str:
    nb = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"provenance": []},
        },
        "cells": cells_from(path.read_text("utf-8")),
    }
    for i, c in enumerate(nb["cells"]):
        c["id"] = f"{path.stem}-{i}"
    return json.dumps(nb, indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    stale = []
    check = "--check" in sys.argv
    for src in sorted(SRC.glob("*.py")):
        out = OUT / f"{src.stem}.ipynb"
        text = build(src)
        if check:
            if not out.exists() or out.read_text("utf-8") != text:
                stale.append(out.name)
        else:
            out.write_text(text, "utf-8")
            print(f"built {out.relative_to(ROOT)}")
    if stale:
        print(f"Out of date: {', '.join(stale)}. Run: python3 scripts/build_notebooks.py")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
