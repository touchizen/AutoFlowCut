# W8: Upload Info

This document is the W8 (YouTube upload info generation) stage guide for the story-engine skill — dark-history genre.

---

## YouTube upload info

### Title writing formula

- `[provocative situation] + [curiosity-inducing closer]`
- 60–100 chars + ` | dark history true crime folklore mystery audiobook`
- Example: "The Orphan Boy Sold for Five Shillings Who Would Later Execute the King's Advisor"

### Title patterns that work

- **Hidden identity**: "The Plague Doctor Who Never Treated the Sick — and the Village That Vanished After He Visited"
- **Number / date anchor**: "In 1692, Every Child in Hartford Parish Had the Same Nightmare. One Week Later, They Were All Gone."
- **Question opener**: "Why Did the Witch of Pendle Ask for Only One Thing Before They Burned Her?"
- **Twist foreshadowed**: "Everyone Swore the Priest Had Been Dead for Three Days Before They Heard the Knocking"
- **Contrast**: "The Beggar a Duchess Pitied — and the Fortune He Buried in Her Cellar"

### Output format

```json
{
  "youtube": {
    "enabled": true,
    "title": "Title | dark history true crime folklore mystery audiobook",
    "description": "SEO-optimized description (keywords in first 200 chars)",
    "tags": ["dark history", "true crime", "folklore", "medieval mystery", "gothic", "witch trial", "plague", "victorian", "cold case", "unsolved mystery", "historical mystery", "audiobook", "sleep story", "legend", "ghost story"],
    "hashTags": true,
    "privacy": "private",
    "categoryId": "24",
    "defaultLanguage": "en",
    "defaultAudioLanguage": "en",
    "schedule": { "enabled": false }
  }
}
```

### Description template

```
[Hook paragraph — 1-2 sentences that expand the title's mystery.]

[Historical setup — 3-5 sentences placing the viewer in the period, the location, and the stakes. Include key searchable keywords (era, place, recognizable event) in the first 200 chars for SEO.]

[What to expect — 1-2 sentences hinting at the twist without spoiling it.]

─────────

🕯 About this channel
[One paragraph about the channel, calling out related playlists.]

▶ More stories like this:
- [Playlist: Witch Trials]
- [Playlist: Victorian Mysteries]
- [Playlist: Cold Cases]

📖 Primary sources / further reading:
- [Book or archive 1]
- [Book or archive 2]

#darkhistory #truecrime #folklore #[episode-specific tag]
```

### What to deliver

- **3 candidate titles** (pick the strongest, keep alternatives)
- **Description** (SEO-optimized, first 200 chars packed with keywords)
- **Up to 20 tags** (mix of broad + specific)
- **Thumbnail text suggestions** (short, provocative — 3–6 words)
- **Up to 15 hashtags**

### Thumbnail text tips (dark-history)

- Short (3–6 words), high-contrast on image
- Curiosity over explanation: "SHE KEPT THE KEY" > "Mary Kept The Cellar Key"
- Numbers and dates resonate: "1692", "THREE DAYS"
- Single strong verb or noun at center; avoid small text

**Output file**: `11_upload_info.json`
