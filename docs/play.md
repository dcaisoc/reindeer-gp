# How to play

## 1. Drive

Pick a track and drive a few laps.

| Key | Action |
| --- | --- |
| ← → or A D | Steer |
| ↑ or W | Go |
| ↓ or S | Brake / reverse |
| P | Pause |
| R | Restart |

Pass every checkpoint in order and cross the finish line. **Your score is your lap time plus 1 second for each wall hit** (a hit counts at most once every half second). Lower is better. A lap that doesn't finish within 2 minutes doesn't count.

Every lap is saved in your browser under **Driving data**, as a tiny replay file (1–3 KB) that stores only your key presses. Delete the clumsy ones: your bot learns from whatever you keep.

## 2. Train

Open **Train**. The trainer re-drives your laps and records, 20 times a second, what the sleigh's sensors saw and what you did. A small neural network then learns to map one to the other. Training takes under a minute, and at the end you watch your bot drive.

Your bot sees only what a bot is allowed to see:

- **7 distance rays** fanned out from −60° to +60° ahead (`ray0` … `ray6`; 0 = touching a wall, 1 = 40 m or more of room);
- **speed** (forwards) and **lateral** (sideways slide), as fractions of top speed;
- **surface** underneath: snow, ice or rough.

It answers with **steer** and **throttle**, each between −1 and 1.

!!! tip "Better laps make better bots"
    Bots copy you, mistakes included. Smooth, consistent laps usually beat one heroic fast lap. If your bot crashes at the same corner every time, drive that corner more carefully a few more times.

## 3. Submit

Sign in with **Raven**, create or join a team (1–4 people, join with the team's code), then submit from the trainer. The server re-runs your bot on every track with the official engine, and within a minute your best score per track appears on the leaderboard with a replay anyone can watch.

You can submit **20 times per team per day**. The leaderboard keeps your best entry, so a bad submission never costs you anything.

**Beginner bracket.** Elf teams whose bot came from the web trainer, trained on at least 3 of the team's own verified laps of that track, are marked as beginners and can be filtered on the leaderboard.

**Human board.** Your own driving can go on the Human leaderboard too: on **Driving data**, choose *Submit to Human board*. The server re-simulates the replay, so it's just as trustworthy as a bot's score.

## Weekly twists

Every week or so a **twist** opens: a familiar track changed in some way. It might be night (only 3 short headlamp sensors), ice on the hairpins, or the track driven backwards. Each twist has its own boards and shows on the home page while it's open.

- Drive it, then train a bot on it: the trainer shows exactly the sensors the twist gives you. Your laps on other tracks still count as training data, because the sensors are re-read the twist's way.
- When you submit, your bot is entered on every live twist its sensors fit (a 7-ray bot can't race at night; a 3-ray bot can).
- When a twist ends, its boards stay up.

## Baseline, ghosts and badges

Every board shows the **baseline bot**, a few hand-written rules, as a grey reference row. It finishes but isn't fast. **Race the leader** on any board lets you drive against the current leader's lap as a ghost; while driving, press **G** to switch between your best lap, the baseline and no ghost.

Badges are awarded automatically and shown on your team page:

| Badge | How |
| --- | --- |
| 🛷 First Lap | Drive a complete lap yourself (saved to your account and verified). |
| ✨ Clean Lap | Finish a lap, driving or bot, without touching a wall. |
| 🎯 Beat the Baseline | A bot of yours beats the baseline bot's time on the same track. |
| 🔭 Less Is More | Beat the baseline with a bot using 4 sensors or fewer. |
| 🌀 Twist Tamer | A bot of yours finishes a weekly twist. |
| 👑 Grinch Slayer | Take first place on a Bots board from another team. |

## Standings

On the Bots board of every public track and every twist, the top six teams score **10, 7, 5, 3, 2 and 1 points**. **Team standings** add these up (ties go to more first places). **College standings** add up each college's **best 3 teams**, so a college can't win just by entering more teams; "Mixed / none" teams score only for themselves. Human boards are for glory and don't score points.

## Settings and assists

The ⚙ button (top right) opens **Settings**:

- **Reduce motion**: no animations; replays wait for you to press Play. It follows your device's setting unless you change it.
- **Driving assists**, for anyone who finds fast key presses hard: play at **75% or half speed**, and/or **auto-throttle** (the game handles go and brake; you only steer; ↑ or ↓ takes over). Assists never change the physics and lap times are game time, so the laps are fair and just as good for training. Laps driven with an assist are marked *assisted* on the Human board. You can also change assists from the pause menu (P).

Everything except driving itself works with the keyboard: Tab moves between controls, Enter or Space presses them; in the replay viewer, Space plays and pauses.

## Sharing a moment

In the replay viewer, pause on your best moment (or your best crash) and use **Export a clip**: a few seconds as a GIF, which works everywhere, or as a video where your browser supports it. **Share link** copies a link anyone can open.

## Rules

1. Bots must be files in the [bot format](formats/bot.md): a small network (up to 5,000 parameters) that decides from the sensors alone. No other code runs on the server.
2. One team per person. Teams of up to four.
3. Be kind: team names are checked by a filter and by referees. Referees can hide entries and edit names; every action is logged.
4. Don't attack the site. Found a bug that lets you cheat? Tell the organisers ([security policy](https://github.com/dcaisoc/reindeer-gp/blob/main/SECURITY.md)) and you'll be credited.
5. The engine is open source and deterministic: what you see on your laptop is exactly what the server will score.
