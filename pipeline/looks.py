"""Which of the 9 customer looks the game draws for a party member (the game ports this rule).

The game names a party by free text (the game's groupKind: 地盤佬, 阿伯, OL, 的士佬, 學生仔, 情侶,
兩個同事, 一家四口 ...; named regulars like 陳生 or 張太). The art has 9 fixed looks. The rule:

  1. the first LOOK_RULES pattern that matches the label gives the member's candidate looks (member k of a party tries
     its own entry of a per-member list first, so a couple is a man and a woman); no match: all 9 looks;
  2. a stable hash (FNV-1a 32-bit of "<group id>:<member index>") picks the starting candidate;
  3. from there, the first candidate not already seated at a neighbouring table (table centres within NEIGHBOUR_TILES)
     and not already used by an earlier member of the same party wins; if every candidate is taken, the same walk over
     all 9 looks; if even that fails, the hashed candidate.

So the same party always gets the same looks, the same look does not sit at neighbouring tables (as the compositor seats
them), and a label reads right (a 地盤佬 wears the hard hat) unless all its looks are already at a neighbouring table:
then the neighbour rule wins.
"""

from __future__ import annotations

import re

LOOKS = ("worker", "housewife", "office_lady", "student", "uncle", "office_man", "housewife2", "granny", "schoolgirl")
NEIGHBOUR_TILES = 9.5  # table centres closer than this (art tiles) are neighbours

# (pattern, candidates per member; the last list repeats for further members). JS-compatible regex syntax.
LOOK_RULES: tuple[tuple[str, tuple[tuple[str, ...], ...]], ...] = (
    ("地盤", (("worker",),)),
    ("阿婆|婆婆", (("granny",), ("granny", "housewife2"))),
    ("伯|阿叔|保安", (("uncle",),)),
    ("情侶|同女伴", (("office_man",), ("office_lady", "schoolgirl"))),
    ("一家|兩代", (("office_man", "uncle"), ("housewife", "housewife2"), ("student",), ("schoolgirl",))),
    ("學生|打機|後生", (("student", "schoolgirl"),)),
    ("OL|阿姐|Miss|小姐", (("office_lady",), ("office_lady", "housewife2"))),
    ("太|師奶", (("housewife", "housewife2"),)),
    ("同事|返工|上班|的士|夜更", (("office_man", "office_lady"),)),
    ("生|哥", (("office_man", "uncle"),)),
)


def fnv1a(s: str) -> int:
    """FNV-1a 32-bit over the UTF-8 bytes (a TypeScript port must hash the same bytes: TextEncoder)."""
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def candidates(label: str, member: int) -> tuple[str, ...]:
    for pat, per_member in LOOK_RULES:
        if re.search(pat, label):
            return per_member[min(member, len(per_member) - 1)]
    return LOOKS


def pick(cands: tuple[str, ...], start: int, taken: set[str]) -> str | None:
    for k in range(len(cands)):
        c = cands[(start + k) % len(cands)]
        if c not in taken:
            return c
    return None


def party_looks(group_id: int, label: str, size: int, neighbours: set[str]) -> list[str]:
    """The looks of a party's members. neighbours: looks seated at tables within NEIGHBOUR_TILES of this one."""
    out: list[str] = []
    for k in range(size):
        h = fnv1a(f"{group_id}:{k}")
        cands = candidates(label, k)
        taken = neighbours | set(out)
        look = pick(cands, h % len(cands), taken) or pick(LOOKS, h % len(LOOKS), taken) or cands[h % len(cands)]
        out.append(look)
    return out
