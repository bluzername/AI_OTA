#!/usr/bin/env python3
"""Validate mvp-web/data/pois.json against the shape that mvp-web/app.js expects.

Usage:
    python3 scripts/validate_pois.py [path/to/pois.json]

Exit codes:
    0  data is valid
    1  one or more schema errors (all are printed)
    2  the file could not be read or parsed as JSON

Standard library only, so it runs anywhere python3 exists.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "mvp-web" / "data" / "pois.json"

# Categories app.js knows about. "kids" is a category in the data as well as an
# interest filter that requires kidFriendly to be true.
ALLOWED_CATEGORIES = frozenset({"culture", "food", "nature", "shopping", "kids"})
LAT_RANGE = (-90.0, 90.0)
LNG_RANGE = (-180.0, 180.0)
RATING_RANGE = (0.0, 5.0)
REQUIRED_POI_FIELDS = ("id", "name", "lat", "lng", "category", "rating", "kidFriendly")


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_nonempty_str(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def check_range(value, field: str, bounds: tuple, where: str) -> list[str]:
    if not is_number(value):
        return [f"{where}: {field} must be a number, got {value!r}"]
    low, high = bounds
    if not low <= value <= high:
        return [f"{where}: {field} {value} is outside [{low}, {high}]"]
    return []


def validate_center(center, where: str) -> list[str]:
    if not isinstance(center, dict):
        return [f"{where}: center must be an object with lat and lng"]
    return (
        check_range(center.get("lat"), "center.lat", LAT_RANGE, where)
        + check_range(center.get("lng"), "center.lng", LNG_RANGE, where)
    )


def validate_poi(poi, where: str) -> list[str]:
    if not isinstance(poi, dict):
        return [f"{where}: POI must be an object"]
    missing = [f for f in REQUIRED_POI_FIELDS if f not in poi]
    if missing:
        return [f"{where}: missing fields {missing}"]
    errors = []
    if not is_nonempty_str(poi["id"]):
        errors.append(f"{where}: id must be a non-empty string")
    if not is_nonempty_str(poi["name"]):
        errors.append(f"{where}: name must be a non-empty string")
    errors += check_range(poi["lat"], "lat", LAT_RANGE, where)
    errors += check_range(poi["lng"], "lng", LNG_RANGE, where)
    errors += check_range(poi["rating"], "rating", RATING_RANGE, where)
    if poi["category"] not in ALLOWED_CATEGORIES:
        errors.append(
            f"{where}: category {poi['category']!r} not in {sorted(ALLOWED_CATEGORIES)}"
        )
    if not isinstance(poi["kidFriendly"], bool):
        errors.append(f"{where}: kidFriendly must be true or false")
    return errors


def validate_city(key: str, city) -> list[str]:
    where = f"cities.{key}"
    if not isinstance(city, dict):
        return [f"{where}: must be an object"]
    errors = []
    if not is_nonempty_str(city.get("displayName")):
        errors.append(f"{where}: displayName must be a non-empty string")
    errors += validate_center(city.get("center"), where)
    pois = city.get("pois")
    if not isinstance(pois, list) or not pois:
        return errors + [f"{where}: pois must be a non-empty list"]
    for index, poi in enumerate(pois):
        errors += validate_poi(poi, f"{where}.pois[{index}]")
    return errors


def duplicate_ids(data: dict) -> list[str]:
    ids = [
        poi.get("id")
        for city in data.get("cities", {}).values()
        if isinstance(city, dict)
        for poi in city.get("pois", []) or []
        if isinstance(poi, dict)
    ]
    return [f"duplicate POI id {pid!r}" for pid, n in Counter(ids).items() if n > 1]


def validate(data) -> list[str]:
    if not isinstance(data, dict) or not isinstance(data.get("cities"), dict):
        return ["top level must be an object with a 'cities' object"]
    if not data["cities"]:
        return ["cities must contain at least one city"]
    errors = []
    for key, city in data["cities"].items():
        if not is_nonempty_str(key):
            errors.append(f"city key {key!r} must be a non-empty string")
        errors += validate_city(key, city)
    return errors + duplicate_ids(data)


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else DEFAULT_PATH
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"error: cannot load {path}: {exc}", file=sys.stderr)
        return 2
    errors = validate(data)
    if errors:
        print(f"{path}: {len(errors)} error(s)", file=sys.stderr)
        for line in errors:
            print(f"  - {line}", file=sys.stderr)
        return 1
    cities = data["cities"]
    total = sum(len(c["pois"]) for c in cities.values())
    print(f"{path}: OK ({len(cities)} cities, {total} POIs)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
