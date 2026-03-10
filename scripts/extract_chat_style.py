#!/opt/homebrew/bin/python3
import json
import re
import sys

import pdfplumber


HEADER_RE = re.compile(r"^(信息|短信)$")
DATE_RE = re.compile(r"^(\d{1,2}月\d{1,2}日|\d{4}[-/]\d{1,2}[-/]\d{1,2}|周[一二三四五六日天]|\d{1,2}:\d{2})$")


def should_skip(text: str) -> bool:
    text = (text or "").strip()
    if not text:
        return True
    if HEADER_RE.match(text) or DATE_RE.match(text):
        return True
    if "•" in text and len(text) < 10:
        return True
    return False


def classify_side(page_width: float, line_mid_x: float, side: str) -> bool:
    if side == "right":
        return line_mid_x >= page_width * 0.54
    return line_mid_x <= page_width * 0.46


def extract_messages(pdf_path: str, side: str = "right", limit: int = 4000):
    messages = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
            if not words:
                continue
            words = sorted(words, key=lambda item: (round(item["top"], 1), item["x0"]))

            lines = []
            current = []
            baseline = None
            for word in words:
                top = float(word["top"])
                if current and baseline is not None and abs(top - baseline) > 4.0:
                    lines.append(current)
                    current = []
                    baseline = None
                current.append(word)
                baseline = top if baseline is None else ((baseline * (len(current) - 1)) + top) / len(current)
            if current:
                lines.append(current)

            merged = []
            for line in lines:
                ordered = sorted(line, key=lambda item: item["x0"])
                text = "".join(item["text"] for item in ordered).strip()
                if should_skip(text):
                    continue
                x0 = min(item["x0"] for item in ordered)
                x1 = max(item["x1"] for item in ordered)
                top = min(item["top"] for item in ordered)
                bottom = max(item["bottom"] for item in ordered)
                line_mid_x = (x0 + x1) / 2
                is_target = classify_side(page.width, line_mid_x, side)
                merged.append({
                    "text": text,
                    "target": is_target,
                    "top": top,
                    "bottom": bottom,
                    "x0": x0,
                    "x1": x1,
                })

            combined = []
            for line in merged:
                if not line["target"]:
                    continue
                if combined:
                    prev = combined[-1]
                    near_same_bubble = abs(line["top"] - prev["bottom"]) < 24 and abs(line["x0"] - prev["x0"]) < 40
                    if near_same_bubble:
                        prev["text"] += line["text"]
                        prev["bottom"] = line["bottom"]
                        continue
                combined.append(line.copy())

            for entry in combined:
                text = re.sub(r"\(cid:\d+\)", "", entry["text"]).strip()
                if not text or should_skip(text):
                    continue
                messages.append(text)
                if len(messages) >= limit:
                    return messages
    return messages


def main():
    if len(sys.argv) < 2:
        print("[]")
        return
    pdf_path = sys.argv[1]
    side = sys.argv[2] if len(sys.argv) > 2 else "right"
    try:
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 4000
    except ValueError:
        limit = 4000
    messages = extract_messages(pdf_path, side, limit)
    print(json.dumps(messages, ensure_ascii=False))


if __name__ == "__main__":
    main()
