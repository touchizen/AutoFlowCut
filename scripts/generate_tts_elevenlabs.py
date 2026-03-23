#!/usr/bin/env python3
"""
ep10 TTS 생성 스크립트 (리라이팅 버전)
대본 .md → 세그먼트 파싱 → ElevenLabs with-timestamps → mp3 + srt
"""
import base64
import json
import os
import re
import subprocess
import sys
import time
import requests

# === 설정 ===
def _load_api_key():
    """Load API key from ~/.elevenlabs/credentials or env var"""
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key
    cred_paths = [
        os.path.expanduser("~/.elevenlabs/credentials"),
        os.path.join(os.path.expanduser("~"), ".elevenlabs", "credentials"),
    ]
    for p in cred_paths:
        if os.path.exists(p):
            with open(p) as f:
                return f.read().strip()
    raise RuntimeError("ElevenLabs API key not found. Set ELEVENLABS_API_KEY env var or create ~/.elevenlabs/credentials")

API_KEY = _load_api_key()
MODEL = "eleven_multilingual_v2"
BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"

VOICE_MAP = {
    "나레이션":       "ETPP7D0aZVdEj12Aa7ho",  # Selly Han
    "소은":           "sf8Bpb1IU97NI9BHSMRf",  # Rosa oh
    "곽주사":         "dMZ8mX0Ph1cjrCK7Jhrg",  # Seunguk
    "준혁":           "fHzGR8qcnsDR2uaj9r16",  # Hojin Lim
    "최씨":           "0oqpliV6dVSr9XomngOW",  # Jini
    "복돌이":         "wMrz30qBeYiSkAtnZGtn",  # Harry
    "장영감":         "UmYoqGlufKxhJ6NCx5Mv",  # Jang Ho
    "아버지":         "goT3UYdM9bhm0n2lmKQx",  # Edward
    "아버지(목소리)": "goT3UYdM9bhm0n2lmKQx",  # Edward (회상)
    "아이":           "Lb7qkOn5hF8p7qfCDH8q",  # Annie (소은 보이스 = 콜백)
    "하인":           "v1jVu1Ky28piIPEJqRrm",  # KKC RADIO
}

VOICE_SETTINGS = {
    "stability": 0.6,
    "similarity_boost": 0.8,
    "style": 0.3,
}

BASEDIR = "/Users/tuxxon/premiere-workspace/무한야담/story/ep10"


def parse_md_to_segments(md_path, dialog_json_path):
    """대본 .md → (type, text, character) 세그먼트 리스트"""
    with open(md_path, "r") as f:
        md_text = f.read()

    with open(dialog_json_path, "r") as f:
        dialogs = json.load(f)  # [{id, character, line, emotion}, ...]

    dialog_idx = 0
    segments = []
    narration_buf = []

    for line in md_text.split("\n"):
        stripped = line.strip()

        # 마크다운 헤더, 구분선 건너뛰기
        if stripped.startswith("#") or stripped == "---" or stripped == "":
            continue

        # 따옴표 대사가 포함된 줄인지 확인
        quotes = re.findall(r'"([^"]*)"', line)

        if quotes:
            # 대사 앞의 나레이션 텍스트
            before_first_quote = line[:line.index('"')].strip()
            if before_first_quote:
                narration_buf.append(before_first_quote)

            # 나레이션 버퍼 플러시
            if narration_buf:
                nar_text = " ".join(narration_buf).strip()
                if nar_text:
                    segments.append(("narration", nar_text, "나레이션"))
                narration_buf = []

            # 각 따옴표 대사 처리
            for quote_text in quotes:
                if dialog_idx < len(dialogs):
                    d = dialogs[dialog_idx]
                    if d["line"] == quote_text:
                        segments.append(("dialog", quote_text, d["character"]))
                        dialog_idx += 1
                    else:
                        # 불일치 시 순차 탐색
                        found = False
                        for j in range(dialog_idx, min(dialog_idx + 5, len(dialogs))):
                            if dialogs[j]["line"] == quote_text:
                                segments.append(("dialog", quote_text, dialogs[j]["character"]))
                                dialog_idx = j + 1
                                found = True
                                break
                        if not found:
                            segments.append(("narration", quote_text, "나레이션"))

            # 대사 뒤의 나레이션 텍스트
            last_quote_end = line.rindex('"') + 1
            after_last_quote = line[last_quote_end:].strip()
            if after_last_quote:
                narration_buf.append(after_last_quote)
        else:
            narration_buf.append(stripped)

    # 남은 나레이션 플러시
    if narration_buf:
        nar_text = " ".join(narration_buf).strip()
        if nar_text:
            segments.append(("narration", nar_text, "나레이션"))

    return segments


def generate_tts(text, voice_id, output_path):
    """ElevenLabs with-timestamps → mp3 + json"""
    url = f"{BASE_URL}/{voice_id}/with-timestamps"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
    }
    data = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": VOICE_SETTINGS,
    }

    resp = requests.post(url, headers=headers, json=data, timeout=120)
    if resp.status_code == 200:
        result = resp.json()
        audio_b64 = result.get("audio_base64", "")
        with open(output_path, "wb") as f:
            f.write(base64.b64decode(audio_b64))
        ts_path = output_path.replace(".mp3", ".json")
        alignment = result.get("alignment", {})
        with open(ts_path, "w") as f:
            json.dump(alignment, f, ensure_ascii=False, indent=2)
        return True
    else:
        print(f"  ERROR: {resp.status_code} - {resp.text[:200]}")
        return False


def get_mp3_duration(mp3_path):
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", mp3_path],
        capture_output=True, text=True
    )
    return float(result.stdout.strip())


def format_srt_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


MAX_SUBTITLE_LEN = 20
MIN_SUBTITLE_LEN = 6

CLAUSE_ENDINGS = ("고", "며", "면", "지요", "니다", "는데", "어서", "아서",
                  "지만", "으나", "이나", "니까", "더니", "다가")


def _is_clause_boundary(text_so_far):
    stripped = text_so_far.rstrip()
    for ending in CLAUSE_ENDINGS:
        if stripped.endswith(ending):
            return True
    return False


def split_timestamps_to_subtitles(chars_ts, starts_ts, ends_ts, seg_start, prefix=""):
    """글자별 타임스탬프 → 의미 단위 자막 분리 (최대 20자)"""
    raw_sentences = []
    buf_chars = []
    buf_indices = []
    for j, (c, s, e) in enumerate(zip(chars_ts, starts_ts, ends_ts)):
        buf_chars.append(c)
        buf_indices.append(j)
        if c in (".", "?", "!"):
            raw_sentences.append((list(buf_chars), list(buf_indices)))
            buf_chars = []
            buf_indices = []
    if buf_chars:
        raw_sentences.append((list(buf_chars), list(buf_indices)))

    subtitles = []
    for sent_chars, sent_indices in raw_sentences:
        text = "".join(sent_chars).strip()
        if not text:
            continue
        if len(text) <= MAX_SUBTITLE_LEN:
            first_idx = sent_indices[0]
            last_idx = sent_indices[-1]
            subtitles.append((
                seg_start + starts_ts[first_idx],
                seg_start + ends_ts[last_idx],
                f"{prefix}{text}"
            ))
        else:
            break_points = []
            running_text = ""
            for k, ci in enumerate(sent_indices):
                c = chars_ts[ci]
                running_text += c
                if c == ",":
                    break_points.append((k, 1))
                elif c == " " and _is_clause_boundary(running_text.rstrip()):
                    break_points.append((k, 2))
                elif c == " ":
                    break_points.append((k, 3))

            chunk_start = 0
            chunks = []
            while chunk_start < len(sent_indices):
                remaining_text = "".join(chars_ts[sent_indices[i]] for i in range(chunk_start, len(sent_indices))).strip()
                if len(remaining_text) <= MAX_SUBTITLE_LEN:
                    chunks.append((chunk_start, len(sent_indices) - 1))
                    break

                best_bp = None
                for bp_idx, bp_prio in break_points:
                    if bp_idx <= chunk_start:
                        continue
                    chunk_text = "".join(chars_ts[sent_indices[i]] for i in range(chunk_start, bp_idx + 1)).strip()
                    if len(chunk_text) > MAX_SUBTITLE_LEN:
                        break
                    after_text = "".join(chars_ts[sent_indices[i]] for i in range(bp_idx + 1, len(sent_indices))).strip()
                    if 0 < len(after_text) < MIN_SUBTITLE_LEN:
                        continue
                    best_bp = bp_idx

                if best_bp is not None:
                    chunks.append((chunk_start, best_bp))
                    chunk_start = best_bp + 1
                else:
                    fallback = None
                    for k in range(chunk_start + 1, min(chunk_start + MAX_SUBTITLE_LEN + 5, len(sent_indices))):
                        if chars_ts[sent_indices[k]] == " ":
                            fallback = k
                    if fallback:
                        chunks.append((chunk_start, fallback))
                        chunk_start = fallback + 1
                    else:
                        chunks.append((chunk_start, len(sent_indices) - 1))
                        break

            for cs, ce in chunks:
                indices_slice = sent_indices[cs:ce + 1]
                chunk_text = "".join(chars_ts[i] for i in indices_slice).strip()
                if chunk_text:
                    first_idx = indices_slice[0]
                    last_idx = indices_slice[-1]
                    subtitles.append((
                        seg_start + starts_ts[first_idx],
                        seg_start + ends_ts[last_idx],
                        f"{prefix}{chunk_text}"
                    ))

    return subtitles


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_tts.py <파트> [--dry-run]")
        print("  파트: 기, 승, 전, 결")
        sys.exit(1)

    part = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    title = "빚값으로_팔려온_천재_소녀"
    md_path = os.path.join(BASEDIR, f"{title}_{part}.md")
    dialog_path = os.path.join(BASEDIR, f"dialogs_{part}.json")
    output_dir = os.path.join(BASEDIR, f"segments_{part}")

    if not os.path.exists(md_path):
        print(f"파일 없음: {md_path}")
        sys.exit(1)

    # 세그먼트 파싱
    segments = parse_md_to_segments(md_path, dialog_path)

    print(f"\n=== {part} 파트: {len(segments)}개 세그먼트 ===\n")
    for i, (stype, text, char) in enumerate(segments):
        label = f"[{stype.upper():9s}] {char:10s}"
        preview = text[:60] + ("..." if len(text) > 60 else "")
        print(f"  {i:03d} {label} | {preview}")

    # 세그먼트 목록 저장
    seg_json_path = os.path.join(BASEDIR, f"segments_{part}.json")
    seg_data = [
        {"idx": i, "type": stype, "character": char, "text": text}
        for i, (stype, text, char) in enumerate(segments)
    ]
    with open(seg_json_path, "w") as f:
        json.dump(seg_data, f, ensure_ascii=False, indent=2)
    print(f"\n세그먼트 목록 저장: {seg_json_path}")

    if dry_run:
        print("\n[DRY RUN] TTS 생성 건너뜀")
        return

    # TTS 생성
    os.makedirs(output_dir, exist_ok=True)

    for i, (stype, text, char) in enumerate(segments):
        voice_id = VOICE_MAP.get(char, VOICE_MAP["나레이션"])
        output_path = os.path.join(output_dir, f"{i:03d}_{char}.mp3")

        if os.path.exists(output_path):
            print(f"  {i:03d} SKIP (이미 존재)")
            continue

        print(f"  {i:03d} 생성 중... [{char}] {text[:40]}...")
        success = generate_tts(text, voice_id, output_path)
        if success:
            size = os.path.getsize(output_path)
            print(f"  {i:03d} OK ({size:,} bytes)")
        else:
            print(f"  {i:03d} FAILED")

        time.sleep(0.5)

    # ffmpeg filelist
    filelist_path = os.path.join(output_dir, "filelist.txt")
    with open(filelist_path, "w") as f:
        for i, (stype, text, char) in enumerate(segments):
            mp3 = f"{i:03d}_{char}.mp3"
            f.write(f"file '{mp3}'\n")
    print(f"\nffmpeg filelist 저장: {filelist_path}")

    # SRT 생성
    print(f"\nSRT 생성 중...")
    cumulative = 0.0
    srt_lines = []
    srt_seq = 1
    timeline_data = []

    for i, (stype, text, char) in enumerate(segments):
        mp3_path = os.path.join(output_dir, f"{i:03d}_{char}.mp3")
        ts_path = os.path.join(output_dir, f"{i:03d}_{char}.json")
        dur = get_mp3_duration(mp3_path)
        seg_start = cumulative

        timeline_data.append({
            "idx": i, "type": stype, "character": char,
            "text": text, "duration": round(dur, 3),
            "start": round(seg_start, 3), "end": round(seg_start + dur, 3)
        })

        if os.path.exists(ts_path):
            with open(ts_path) as f:
                ts = json.load(f)
            chars_ts = ts.get("characters", [])
            starts_ts = ts.get("character_start_times_seconds", [])
            ends_ts = ts.get("character_end_times_seconds", [])

            if chars_ts:
                prefix = f"({char}) " if stype == "dialog" else ""
                subs = split_timestamps_to_subtitles(chars_ts, starts_ts, ends_ts, seg_start, prefix)
                for sub_start, sub_end, sub_text in subs:
                    srt_lines.append(f"{srt_seq}")
                    srt_lines.append(f"{format_srt_time(sub_start)} --> {format_srt_time(sub_end)}")
                    srt_lines.append(sub_text)
                    srt_lines.append("")
                    srt_seq += 1
            else:
                subtitle = f"({char}) {text}" if stype == "dialog" else text
                srt_lines.append(f"{srt_seq}")
                srt_lines.append(f"{format_srt_time(seg_start)} --> {format_srt_time(seg_start + dur)}")
                srt_lines.append(subtitle)
                srt_lines.append("")
                srt_seq += 1
        else:
            subtitle = f"({char}) {text}" if stype == "dialog" else text
            srt_lines.append(f"{srt_seq}")
            srt_lines.append(f"{format_srt_time(seg_start)} --> {format_srt_time(seg_start + dur)}")
            srt_lines.append(subtitle)
            srt_lines.append("")
            srt_seq += 1

        cumulative += dur

    # SRT 저장
    srt_path = os.path.join(BASEDIR, f"final_{part}.srt")
    with open(srt_path, "w") as f:
        f.write("\n".join(srt_lines))
    print(f"SRT 저장: {srt_path} ({srt_seq - 1}개 자막)")

    # 타임라인 JSON
    timeline_path = os.path.join(BASEDIR, f"timeline_{part}.json")
    with open(timeline_path, "w") as f:
        json.dump(timeline_data, f, ensure_ascii=False, indent=2)
    print(f"타임라인 저장: {timeline_path}")

    total_dur = cumulative
    print(f"\n파트 총 길이: {int(total_dur // 60)}분 {total_dur % 60:.1f}초")

    # ffmpeg 병합 명령어
    final_mp3 = os.path.join(BASEDIR, f"final_{part}.mp3")
    cmd = f"ffmpeg -y -f concat -safe 0 -i {filelist_path} -c copy {final_mp3}"
    print(f"\n병합 실행: {cmd}")
    subprocess.run(cmd, shell=True, check=True)
    print(f"병합 완료: {final_mp3}")


if __name__ == "__main__":
    main()
