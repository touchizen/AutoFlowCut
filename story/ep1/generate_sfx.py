#!/usr/bin/env python3
"""Generate SFX using ElevenLabs Sound Generation API."""

import os
import json
import time
import requests
from pathlib import Path

# Load credentials
cred_path = Path.home() / ".elevenlabs" / "credentials"
with open(cred_path) as f:
    creds = json.load(f)
API_KEY = creds["api_key"]

API_URL = "https://api.elevenlabs.io/v1/sound-generation"
OUTPUT_DIR = Path(__file__).parent / "sfx_output"
OUTPUT_DIR.mkdir(exist_ok=True)

# SFX definitions: (folder, filename, prompt, duration_seconds)
SFX_LIST = [
    ("01_watch", "watch_clasp_open_01.mp3",
     "Antique brass pocket watch clasp clicking open, metallic click, close-up foley", 2),
    ("01_watch", "watch_ticking_01.mp3",
     "Old pocket watch ticking steadily, mechanical clock tick tock, quiet room", 5),
    ("01_watch", "watch_ticking_slow_01.mp3",
     "Old pocket watch ticking, gradually slowing down to a stop, final tick then silence", 5),
    ("02_environment_wind", "wind_bare_trees_01.mp3",
     "Gentle autumn wind blowing through bare trees, rustling dry leaves, outdoor cemetery atmosphere", 5),
    ("02_environment_wind", "wind_grass_coastal_01.mp3",
     "Coastal wind blowing through tall grass, seagulls in distance, peaceful cliffside", 5),
    ("02_environment_birds", "birds_singing_garden_01.mp3",
     "Birds singing in an English cottage garden, morning songbirds, peaceful countryside", 5),
    ("02_environment_birds", "seagulls_coastal_01.mp3",
     "Seagulls calling over coastal cliffs, ocean waves in background, windy", 4),
    ("03_church", "church_bell_distant_01.mp3",
     "Distant church bell tolling slowly, funeral atmosphere, somber single bell", 4),
    ("04_indoor", "floorboards_creaking_01.mp3",
     "Old wooden floorboards creaking under footsteps, dusty attic, quiet house", 3),
    ("04_indoor", "dust_settling_01.mp3",
     "Quiet room ambience, subtle dust particles, faint air movement in old attic", 3),
    ("04_indoor", "fire_crackling_01.mp3",
     "Fireplace crackling warmly, wood burning, cozy cottage interior, gentle flames", 5),
    ("04_indoor", "clock_ticking_room_01.mp3",
     "Quiet room with a wall clock ticking, cozy interior ambience", 4),
    ("05_paper", "paper_unfolding_01.mp3",
     "Old yellowed paper being carefully unfolded, delicate paper handling, close-up foley", 3),
    ("06_phone", "phone_click_hangup_01.mp3",
     "Telephone receiver being hung up with a click, 1990s landline phone", 1),
    ("06_phone", "phone_ringing_01.mp3",
     "1990s landline telephone ringing, traditional ring tone, indoor", 4),
    ("07_vehicle", "car_engine_off_01.mp3",
     "Car engine turning off and car door closing, gravel driveway, countryside", 3),
    ("07_vehicle", "airplane_landing_01.mp3",
     "Airplane touching down on runway, engines, indoor cabin perspective", 4),
    ("08_human", "sharp_breath_01.mp3",
     "Person taking a sharp surprised breath, quiet gasp, emotional moment, close-up", 2),
    ("08_human", "quiet_sob_01.mp3",
     "Elderly woman's quiet sob, gentle crying, emotional moment, intimate", 3),
    ("08_human", "silence_breath_01.mp3",
     "Complete silence with very faint breathing, tense emotional pause", 3),
    ("09_outdoor", "footsteps_gravel_01.mp3",
     "Footsteps walking on gravel path, garden walkway, approaching a door", 4),
    ("09_outdoor", "gate_creaking_01.mp3",
     "Old wooden garden gate creaking open, rusty hinges, countryside cottage", 2),
    ("09_outdoor", "three_knocks_door_01.mp3",
     "Three knocks on a wooden cottage door, then silence, then muffled footsteps inside", 4),
    ("09_outdoor", "autumn_leaves_01.mp3",
     "Autumn leaves rustling on the ground, gentle breeze, peaceful atmosphere", 4),
    ("10_props", "teacup_rattling_01.mp3",
     "Teacup rattling against a saucer, shaking elderly hands, china, quiet room", 2),
    ("10_props", "wheelchair_creaking_01.mp3",
     "Wheelchair creaking as someone shifts weight, indoor nursing home, quiet", 2),
    ("10_props", "tv_murmuring_01.mp3",
     "Television murmuring quietly in background, indistinct voices, nursing home common room", 4),
    ("11_music", "soft_music_ending_01.mp3",
     "Soft gentle piano music, emotional, bittersweet, ending of a story, fading out", 5),
    ("12_ambience", "evening_settling_01.mp3",
     "Evening settling in, crickets beginning, distant birds, peaceful countryside dusk", 5),
]

headers = {
    "xi-api-key": API_KEY,
    "Content-Type": "application/json",
}

print(f"Generating {len(SFX_LIST)} SFX files...")

for i, (folder, filename, prompt, duration) in enumerate(SFX_LIST):
    folder_path = OUTPUT_DIR / folder
    folder_path.mkdir(parents=True, exist_ok=True)
    filepath = folder_path / filename

    if filepath.exists():
        print(f"[{i+1:02d}/{len(SFX_LIST)}] SKIP (exists): {folder}/{filename}")
        continue

    print(f"[{i+1:02d}/{len(SFX_LIST)}] Generating: {folder}/{filename} ({duration}s)")

    payload = {
        "text": prompt,
        "duration_seconds": duration,
    }

    try:
        resp = requests.post(API_URL, headers=headers, json=payload, timeout=60)
        if resp.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(resp.content)
            print(f"  -> OK ({len(resp.content)} bytes)")
        else:
            print(f"  -> ERROR {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        print(f"  -> EXCEPTION: {e}")

    time.sleep(1)  # rate limit

print("\nDone!")
