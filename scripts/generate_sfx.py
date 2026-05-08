#!/usr/bin/env python3
"""
ep10 SFX 생성 스크립트
08_sfx_목록.md 파싱 → ElevenLabs Sound Generation API → mp3
"""
import os
import re
import sys
import time
import requests

def _load_api_key():
    """Load ElevenLabs API key from env var or ~/.elevenlabs/credentials.

    Supports dotenv format (`ELEVENLABS_API_KEY=sk_...`) or a single-line key file.
    Hardcoding the key in source is forbidden — it leaks via git.
    """
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key.strip()
    cred_path = os.path.expanduser("~/.elevenlabs/credentials")
    if os.path.exists(cred_path):
        with open(cred_path) as f:
            raw = f.read()
        m = re.search(r"^\s*ELEVENLABS_API_KEY\s*=\s*([^\s\r\n]+)", raw, re.MULTILINE)
        if m:
            return m.group(1)
        return raw.strip()
    raise RuntimeError(
        "ElevenLabs API key not found. "
        "Set ELEVENLABS_API_KEY env var, or write `ELEVENLABS_API_KEY=sk_...` to "
        "~/.elevenlabs/credentials."
    )


API_KEY = _load_api_key()
BASE_URL = "https://api.elevenlabs.io/v1/sound-generation"

BASEDIR = "/Users/tuxxon/premiere-workspace/무한야담/story/ep10"
SFX_DIR = os.path.join(BASEDIR, "sfx")


def parse_sfx_list(md_path):
    """08_sfx_목록.md → [{id, part, location, name, prompt, duration}, ...]"""
    with open(md_path) as f:
        lines = f.readlines()

    current_part = ""
    sfx_list = []

    for line in lines:
        line = line.strip()
        # 파트 헤더
        if line.startswith("## 【"):
            m = re.search(r"【(.+?)】", line)
            if m:
                current_part = m.group(1)
            continue

        # 테이블 행 (| # | 위치 | ... 헤더와 구분선 건너뛰기)
        if line.startswith("|") and not line.startswith("| #") and not line.startswith("|---"):
            cols = [c.strip() for c in line.split("|")[1:-1]]
            if len(cols) >= 5:
                try:
                    sfx_id = int(cols[0])
                    sfx_list.append({
                        "id": sfx_id,
                        "part": current_part,
                        "location": cols[1],
                        "name": cols[2],
                        "prompt": cols[3],
                        "duration": int(cols[4]),
                    })
                except ValueError:
                    continue

    return sfx_list


def generate_sfx(prompt, duration, output_path):
    """ElevenLabs Sound Generation API 호출"""
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
    }
    data = {
        "text": prompt,
        "duration_seconds": duration,
        "prompt_influence": 0.5,
    }

    resp = requests.post(BASE_URL, headers=headers, json=data, timeout=120)
    if resp.status_code == 200:
        with open(output_path, "wb") as f:
            f.write(resp.content)
        return True
    else:
        print(f"  ERROR: {resp.status_code} - {resp.text[:200]}")
        return False


def main():
    dry_run = "--dry-run" in sys.argv
    md_path = os.path.join(BASEDIR, "08_sfx_목록.md")

    sfx_list = parse_sfx_list(md_path)
    print(f"\n=== SFX 목록: {len(sfx_list)}개 ===\n")

    for sfx in sfx_list:
        print(f"  {sfx['id']:02d} [{sfx['part']}] {sfx['name']:15s} | {sfx['duration']}초 | {sfx['prompt'][:50]}...")

    if dry_run:
        print("\n[DRY RUN] SFX 생성 건너뜀")
        return

    os.makedirs(SFX_DIR, exist_ok=True)

    success = 0
    fail = 0
    for sfx in sfx_list:
        # 파일명: {id:02d}_{name}.mp3
        safe_name = sfx['name'].replace(" ", "_").replace("/", "_")
        output_path = os.path.join(SFX_DIR, f"{sfx['id']:02d}_{safe_name}.mp3")

        if os.path.exists(output_path):
            print(f"  {sfx['id']:02d} SKIP (이미 존재)")
            success += 1
            continue

        print(f"  {sfx['id']:02d} 생성 중... [{sfx['name']}] {sfx['duration']}초")
        ok = generate_sfx(sfx['prompt'], sfx['duration'], output_path)
        if ok:
            size = os.path.getsize(output_path)
            print(f"  {sfx['id']:02d} OK ({size:,} bytes)")
            success += 1
        else:
            print(f"  {sfx['id']:02d} FAILED")
            fail += 1

        time.sleep(1.0)  # rate limit

    print(f"\n완료: {success}개 성공, {fail}개 실패")
    print(f"출력 디렉토리: {SFX_DIR}")


if __name__ == "__main__":
    main()
