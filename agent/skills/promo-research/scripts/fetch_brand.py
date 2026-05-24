#!/usr/bin/env python3
"""fetch_brand.py — fetch a URL and extract brand tokens.

Usage: fetch_brand.py <url>
Prints structured sections (TITLE, DESCRIPTION, PALETTE, FONTS,
INTERNAL_LINKS, BODY_TEXT). Exits non-zero on fetch failure.
"""
from __future__ import annotations

import ipaddress
import re
import socket
import sys
import urllib.parse
import urllib.request


PRIVATE_HOST_PATTERNS = (
    "localhost",
    "127.", "10.", "192.168.", "169.254.",
    "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
)


def is_private_host(host: str) -> bool:
    if any(host == p.rstrip(".") or host.startswith(p) for p in PRIVATE_HOST_PATTERNS):
        return True
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
        return ip.is_private or ip.is_loopback or ip.is_link_local
    except (socket.gaierror, ValueError):
        return False


def fetch(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SystemExit(f"ERROR: only http(s) URLs supported (got: {url})")
    if not parsed.hostname:
        raise SystemExit(f"ERROR: no hostname in URL: {url}")
    if is_private_host(parsed.hostname):
        raise SystemExit(f"ERROR: private host blocked: {parsed.hostname}")

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "PromoAgent/0.1 (+https://github.com/dennis/promo-agent)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def strip_tags(html: str) -> str:
    # Remove script/style blocks first
    html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"\s+", " ", html)
    return html.strip()


def extract_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.S | re.I)
    return m.group(1).strip() if m else ""


def extract_description(html: str) -> str:
    m = re.search(
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)',
        html,
        flags=re.I,
    )
    return m.group(1).strip() if m else ""


def extract_palette(html: str) -> list[str]:
    hexes = re.findall(r"#[0-9A-Fa-f]{6}\b", html)
    seen: dict[str, None] = {}
    for h in hexes:
        seen.setdefault(h.lower(), None)
    return list(seen.keys())[:8]


_GENERIC_FONTS = {
    "var", "inherit", "initial", "unset", "sans-serif", "serif",
    "monospace", "system-ui", "-apple-system", "blinkmacsystemfont",
    "ui-sans-serif", "ui-monospace", "ui-serif", "ui-rounded",
}


def extract_fonts(html: str) -> list[str]:
    matches = re.findall(r"font-family:\s*([^;}\"]+)", html, flags=re.I)
    fonts: list[str] = []
    seen: set[str] = set()
    for m in matches:
        for part in m.split(","):
            f = part.strip().strip('"').strip("'")
            low = f.lower()
            if (
                f
                and low not in _GENERIC_FONTS
                and not low.startswith("var(")
                and f not in seen
            ):
                seen.add(f)
                fonts.append(f)
                if len(fonts) >= 5:
                    return fonts
    return fonts


def extract_internal_links(html: str, base: str) -> list[str]:
    base_parsed = urllib.parse.urlparse(base)
    base_host = base_parsed.hostname
    out: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r'href=["\']([^"\']+)["\']', html, flags=re.I):
        href = m.group(1).strip()
        try:
            target = urllib.parse.urljoin(base, href)
        except ValueError:
            continue
        tp = urllib.parse.urlparse(target)
        if tp.hostname == base_host and tp.scheme in ("http", "https"):
            if target not in seen:
                seen.add(target)
                out.append(target)
                if len(out) >= 5:
                    break
    return out


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <url>", file=sys.stderr)
        sys.exit(2)
    url = sys.argv[1]

    try:
        html = fetch(url)
    except Exception as e:
        print(f"ERROR: fetch failed: {e}", file=sys.stderr)
        sys.exit(1)

    sections = [
        ("TITLE", extract_title(html)),
        ("DESCRIPTION", extract_description(html)),
        ("PALETTE", " ".join(extract_palette(html))),
        ("FONTS", ", ".join(extract_fonts(html))),
        ("INTERNAL_LINKS", "\n".join(extract_internal_links(html, url))),
        ("BODY_TEXT (first 4000 chars)", strip_tags(html)[:4000]),
    ]
    for label, content in sections:
        print(f"=== {label} ===")
        print(content)
        print()


if __name__ == "__main__":
    main()
