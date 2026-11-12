"""The customer look rule (looks.py): stable, label-true, no repeat at neighbouring tables."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import looks  # noqa: E402

LABELS = ["地盤佬", "晨運伯伯", "OL", "返工族", "學生哥", "的士佬", "放工OL", "夜更的士佬", "補習學生", "獨居阿伯", "阿伯", "學生仔",
          "阿姐", "情侶", "兩個同事", "兩個阿婆", "兩個學生", "三個學生", "三個同事", "一家四口", "四個同事", "兩代人", "陳生", "張太",
          "Miss 黃", "戴黑超嘅客", "保安阿叔", "通宵打機仔"]


def test_fnv1a_matches_reference() -> None:
    assert looks.fnv1a("") == 0x811C9DC5
    assert looks.fnv1a("a") == 0xE40C292C


def test_stable() -> None:
    for i, lab in enumerate(LABELS):
        assert looks.party_looks(i, lab, 4, set()) == looks.party_looks(i, lab, 4, set())


def test_label_reads_right_without_neighbours() -> None:
    for gid in range(50):
        assert looks.party_looks(gid, "地盤佬", 1, set()) == ["worker"]
        assert looks.party_looks(gid, "阿伯", 1, set()) == ["uncle"]
        assert looks.party_looks(gid, "兩個阿婆", 2, set())[0] == "granny"
        couple = looks.party_looks(gid, "情侶", 2, set())
        assert couple[0] == "office_man" and couple[1] in ("office_lady", "schoolgirl")


def test_no_repeat_in_party_or_at_neighbours() -> None:
    for gid in range(200):
        for lab in LABELS:
            near = {looks.LOOKS[(gid + k) % 9] for k in range(gid % 4)}
            got = looks.party_looks(gid, lab, 4, near)
            assert len(set(got)) == 4, (gid, lab, got)
            assert not near & set(got), (gid, lab, near, got)


def test_every_look_is_known() -> None:
    for _, per in looks.LOOK_RULES:
        for cands in per:
            assert set(cands) <= set(looks.LOOKS)
