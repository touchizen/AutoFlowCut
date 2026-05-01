#!/usr/bin/env python3
"""
README.ko.md 용 YouTube 썸네일 + 플레이 버튼 합성 PNG 생성.

사용법:
    python3 scripts/generate_youtube_thumb.py [VIDEO_ID]

기본 VIDEO_ID: AutoFlowCut 인트로 영상 (mYnfgqvCkME)
출력 경로: docs/youtube-thumb.png

YouTube 썸네일 변경 시 이 스크립트 재실행 후 docs/youtube-thumb.png 커밋.
"""
import sys
import os
import urllib.request
from PIL import Image, ImageDraw

DEFAULT_VIDEO_ID = "mYnfgqvCkME"
OUTPUT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "docs",
    "youtube-thumb.png",
)


def make_thumbnail(video_id: str, output: str) -> None:
    # 1. YouTube 썸네일 다운로드
    thumb_url = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
    tmp_path = "/tmp/yt-thumb.jpg"
    urllib.request.urlretrieve(thumb_url, tmp_path)

    thumb = Image.open(tmp_path).convert("RGBA")
    W, H = thumb.size
    print(f"썸네일 크기: {W}x{H}")

    # 2. 오버레이 레이어
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 3. 빨간 둥근 사각형 (YouTube 스타일 플레이 버튼)
    btn_w = int(W * 0.18)
    btn_h = int(btn_w * 0.7)
    btn_x = (W - btn_w) // 2
    btn_y = (H - btn_h) // 2
    radius = int(btn_h * 0.2)

    draw.rounded_rectangle(
        [btn_x, btn_y, btn_x + btn_w, btn_y + btn_h],
        radius=radius,
        fill=(255, 0, 0, 235),
    )

    # 4. 흰색 삼각형 (재생 화살표)
    tri_w = int(btn_w * 0.28)
    tri_h = int(btn_h * 0.55)
    cx, cy = W // 2, H // 2
    draw.polygon(
        [
            (cx - tri_w // 2, cy - tri_h // 2),
            (cx - tri_w // 2, cy + tri_h // 2),
            (cx + tri_w // 2, cy),
        ],
        fill=(255, 255, 255, 255),
    )

    # 5. 합성 + 저장
    result = Image.alpha_composite(thumb, overlay)
    result.convert("RGB").save(output, optimize=True, quality=92)

    size_kb = os.path.getsize(output) / 1024
    print(f"저장됨: {output}")
    print(f"파일 크기: {size_kb:.1f} KB")


if __name__ == "__main__":
    video_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_ID
    make_thumbnail(video_id, OUTPUT_PATH)
