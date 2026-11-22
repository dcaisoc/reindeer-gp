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

## Rules

1. Bots must be files in the [bot format](formats/bot.md): a small network (up to 5,000 parameters) that decides from the sensors alone. No other code runs on the server.
2. One team per person. Teams of up to four.
3. Be kind: team names are checked by a filter and by referees. Referees can hide entries and edit names; every action is logged.
4. Don't attack the site. Found a bug that lets you cheat? Tell the organisers ([security policy](https://github.com/dcaisoc/reindeer-gp/blob/main/SECURITY.md)) and you'll be credited.
5. The engine is open source and deterministic: what you see on your laptop is exactly what the server will score.
