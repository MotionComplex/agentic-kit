#!/usr/bin/env python3
"""Validate an SVG against the Lucide icon design specification.

Usage: validate-icon.py <path-to-svg>
Exit code 0 = pass, 1 = fail.
"""
from __future__ import annotations

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SVG_NS = "http://www.w3.org/2000/svg"
ALLOWED_TAGS = {"path", "line", "polyline", "polygon", "circle", "ellipse", "rect"}
DISALLOWED_TAGS = {"g", "use", "filter", "mask", "defs", "linearGradient",
                   "radialGradient", "pattern", "clipPath", "symbol", "image",
                   "text", "foreignObject", "style", "script"}

REQUIRED_ROOT_ATTRS = {
    "viewBox": "0 0 24 24",
    "fill": "none",
    "stroke": "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
}

NUM_RE = re.compile(r"-?\d+\.\d{4,}")


def localname(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def check(svg_path: Path) -> list[str]:
    errors: list[str] = []

    try:
        tree = ET.parse(svg_path)
    except ET.ParseError as e:
        return [f"SVG is not valid XML: {e}"]

    root = tree.getroot()
    if localname(root.tag) != "svg":
        errors.append(f"Root element must be <svg>, got <{localname(root.tag)}>")

    for attr, expected in REQUIRED_ROOT_ATTRS.items():
        actual = root.get(attr)
        if actual is None:
            errors.append(f"Root <svg> missing required attribute: {attr}=\"{expected}\"")
        elif actual.strip() != expected:
            errors.append(
                f"Root <svg> attribute {attr}=\"{actual}\" must be \"{expected}\""
            )

    for dim in ("width", "height"):
        val = root.get(dim)
        if val and val.strip() not in {"24", "24px"}:
            errors.append(f"Root <svg> {dim}=\"{val}\" should be \"24\" (or omitted)")

    for el in root.iter():
        if el is root:
            continue
        tag = localname(el.tag)

        if tag in DISALLOWED_TAGS:
            errors.append(f"Disallowed element <{tag}> (not part of the Lucide primitive set)")
        elif tag not in ALLOWED_TAGS:
            errors.append(f"Unknown/disallowed element <{tag}>")

        for attr in ("id", "class", "style", "transform", "fill", "stroke",
                     "stroke-width", "stroke-linecap", "stroke-linejoin",
                     "opacity", "fill-opacity", "stroke-opacity"):
            if el.get(attr) is not None:
                if attr in {"fill", "stroke", "stroke-width", "stroke-linecap",
                            "stroke-linejoin"}:
                    errors.append(
                        f"<{tag}> should not override root {attr} (got {attr}=\"{el.get(attr)}\")"
                    )
                else:
                    errors.append(f"<{tag}> has disallowed attribute: {attr}")

        for attr_name, attr_val in el.attrib.items():
            for match in NUM_RE.findall(attr_val):
                errors.append(
                    f"<{tag} {attr_name}=\"{attr_val}\"> contains a coordinate "
                    f"with >3 decimal places ({match}); round to ≤3 decimals"
                )

    body_count = sum(1 for el in root.iter() if el is not root)
    if body_count == 0:
        errors.append("SVG has no body elements — icon is empty")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate-icon.py <path-to-svg>", file=sys.stderr)
        return 2

    svg_path = Path(sys.argv[1])
    if not svg_path.exists():
        print(f"File not found: {svg_path}", file=sys.stderr)
        return 2

    errors = check(svg_path)
    if errors:
        print(f"FAIL  {svg_path}  ({len(errors)} issue{'s' if len(errors) != 1 else ''})")
        for err in errors:
            print(f"  - {err}")
        return 1

    print(f"PASS  {svg_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
