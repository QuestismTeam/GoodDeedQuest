

def next_level_xp(level: int) -> int:
    if level <= 1:
        return 1000
    return 1000 + (100 * level) * level


def level_floor_xp(level: int) -> int:
    if level <= 1:
        return 0
    return next_level_xp(level - 1)


def level_from_xp(xp: int) -> int:
    level = 1
    while xp >= next_level_xp(level):
        level += 1
    return level