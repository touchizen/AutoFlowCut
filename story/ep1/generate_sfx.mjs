import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const credPath = path.join(process.env.USERPROFILE || process.env.HOME, '.elevenlabs', 'credentials');
const credRaw = fs.readFileSync(credPath, 'utf8').trim();
let API_KEY;
try {
  const creds = JSON.parse(credRaw);
  API_KEY = creds.api_key;
} catch {
  API_KEY = credRaw; // plain text key
}

const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const OUTPUT_DIR = path.join(__dirname, 'sfx_output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Load timeline to get timecodes for SFX placement
const timeline = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline.json'), 'utf8'));

// Map SFX cues to timeline positions (segment index → start time)
// From script_10min.md SFX lines mapped to nearest segment
const SFX_LIST = [
  // folder, filename, prompt, duration, timecode(from timeline)
  ["01_watch", "watch_clasp_open_01_0000.mp3", "Antique brass pocket watch clasp clicking open, metallic click, close-up foley", 2, "00:00"],
  ["01_watch", "watch_ticking_01_0025.mp3", "Old pocket watch ticking steadily, mechanical clock tick tock, quiet room", 5, "00:25"],
  ["01_watch", "watch_ticking_soft_01_0055.mp3", "Old pocket watch ticking softly, gentle mechanical rhythm, intimate", 4, "00:55"],
  ["01_watch", "watch_ticking_slow_01_0920.mp3", "Old pocket watch ticking, gradually slowing down to a stop, final tick then silence", 5, "09:20"],
  ["02_wind", "wind_bare_trees_01_0032.mp3", "Gentle autumn wind blowing through bare trees, rustling dry leaves, outdoor cemetery atmosphere", 5, "00:32"],
  ["02_wind", "wind_grass_coastal_01_0520.mp3", "Coastal wind blowing through tall grass, seagulls in distance, peaceful cliffside", 5, "05:20"],
  ["02_birds", "birds_singing_garden_01_0720.mp3", "Birds singing in an English cottage garden, morning songbirds, peaceful countryside", 5, "07:20"],
  ["02_birds", "seagulls_coastal_01_0518.mp3", "Seagulls calling over coastal cliffs, ocean waves in background, windy", 4, "05:18"],
  ["03_church", "church_bell_distant_01_0034.mp3", "Distant church bell tolling slowly, funeral atmosphere, somber single bell", 4, "00:34"],
  ["04_indoor", "floorboards_creaking_01_0102.mp3", "Old wooden floorboards creaking under footsteps, dusty attic, quiet house", 3, "01:02"],
  ["04_indoor", "dust_settling_01_0105.mp3", "Quiet room ambience, subtle dust particles, faint air movement in old attic", 3, "01:05"],
  ["04_indoor", "fire_crackling_01_0755.mp3", "Fireplace crackling warmly, wood burning, cozy cottage interior, gentle flames", 5, "07:55"],
  ["04_indoor", "clock_ticking_room_01_0758.mp3", "Quiet room with a wall clock ticking, cozy interior ambience", 4, "07:58"],
  ["05_paper", "paper_unfolding_01_0115.mp3", "Old yellowed paper being carefully unfolded, delicate paper handling, close-up foley", 3, "01:15"],
  ["06_phone", "phone_click_hangup_01_0210.mp3", "Telephone receiver being hung up with a click, 1990s landline phone", 1, "02:10"],
  ["06_phone", "phone_ringing_01_0640.mp3", "1990s landline telephone ringing, traditional ring tone, indoor", 4, "06:40"],
  ["07_vehicle", "car_engine_off_01_0245.mp3", "Car engine turning off and car door closing, gravel driveway, countryside", 3, "02:45"],
  ["07_vehicle", "airplane_landing_01_0855.mp3", "Airplane touching down on runway, engines, indoor cabin perspective", 4, "08:55"],
  ["08_human", "sharp_breath_01_0550.mp3", "Person taking a sharp surprised breath, quiet gasp, emotional moment, close-up", 2, "05:50"],
  ["08_human", "quiet_sob_01_0830.mp3", "Elderly woman's quiet sob, gentle crying, emotional moment, intimate", 3, "08:30"],
  ["08_human", "silence_breath_01_0220.mp3", "Complete silence with very faint breathing, tense emotional pause", 3, "02:20"],
  ["09_outdoor", "footsteps_gravel_01_0722.mp3", "Footsteps walking on gravel path, garden walkway, approaching a door", 4, "07:22"],
  ["09_outdoor", "gate_creaking_01_0721.mp3", "Old wooden garden gate creaking open, rusty hinges, countryside cottage", 2, "07:21"],
  ["09_outdoor", "three_knocks_door_01_0725.mp3", "Three knocks on a wooden cottage door, then silence, then muffled footsteps inside", 4, "07:25"],
  ["09_outdoor", "autumn_leaves_01_0857.mp3", "Autumn leaves rustling on the ground, gentle breeze, peaceful atmosphere", 4, "08:57"],
  ["10_props", "teacup_rattling_01_0745.mp3", "Teacup rattling against a saucer, shaking elderly hands, china, quiet room", 2, "07:45"],
  ["10_props", "wheelchair_creaking_01_0418.mp3", "Wheelchair creaking as someone shifts weight, indoor nursing home, quiet", 2, "04:18"],
  ["10_props", "tv_murmuring_01_0420.mp3", "Television murmuring quietly in background, indistinct voices, nursing home common room", 4, "04:20"],
  ["11_music", "soft_music_ending_01_0900.mp3", "Soft gentle piano music, emotional, bittersweet, ending of a story, fading out", 5, "09:00"],
  ["12_ambience", "evening_settling_01_0845.mp3", "Evening settling in, crickets beginning, distant birds, peaceful countryside dusk", 5, "08:45"],
];

async function generateSFX(folder, filename, prompt, duration) {
  const folderPath = path.join(OUTPUT_DIR, folder);
  fs.mkdirSync(folderPath, { recursive: true });
  const filepath = path.join(folderPath, filename);

  if (fs.existsSync(filepath)) {
    return 'SKIP';
  }

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: prompt,
      duration_seconds: duration,
    }),
  });

  if (resp.ok) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return `OK (${buffer.length} bytes)`;
  } else {
    const text = await resp.text();
    return `ERROR ${resp.status}: ${text.slice(0, 200)}`;
  }
}

async function main() {
  console.log(`Generating ${SFX_LIST.length} SFX files with timecodes...`);

  for (let i = 0; i < SFX_LIST.length; i++) {
    const [folder, filename, prompt, duration, timecode] = SFX_LIST[i];
    console.log(`[${String(i + 1).padStart(2)}/${SFX_LIST.length}] ${folder}/${filename} (${duration}s @ ${timecode})`);

    const result = await generateSFX(folder, filename, prompt, duration);
    console.log(`  -> ${result}`);

    if (!result.startsWith('SKIP')) {
      await new Promise(r => setTimeout(r, 1000)); // rate limit
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
