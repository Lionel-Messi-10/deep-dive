# Verbal Krillion

Host a spoken Krillion from one screen. Open [index.html](index.html) in a browser.

1. Add teams and names on the home screen, in the order they will sit.
2. Edit the seven prompts. Listed answers are optional. The time limit is saved with the pack (5–100000 seconds) and the host paces each question.
3. Begin. Teams call answers out loud and go around the circle.
4. Award a score category, or mark a team as unable to answer. That team sits out the rest of the question. Everyone else keeps going, and a team can score again when the circle returns. Rarer categories are worth more points, and more points sink deeper (1 point = 10 metres).
5. After the last prompt, read the final leaderboard.

Packs are JSON (`format: "deep-dive"`, version 2). Import and export on the home screen.

[Deep-Dive.html](Deep-Dive.html) is the original solo game: one player types answers against the clock. A pack from that file imports here. This host also allows questions with no listed answers, and a time limit above 180 seconds.
