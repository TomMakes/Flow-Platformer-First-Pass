# Flow Platformer

Endless side-scrolling browser platformer. The level is generated during play as three stacked routes
(harder on top, matched in the middle, easier below). A search bot solves and scores every chunk, and a live
skill estimate `s` picks the difficulty of upcoming routes. Built from the "Build Plan for First Playable".

    npm install
    npm run dev      # play at the printed URL; add ?seed=123 to fix the seed, ?fixed=1 for the unscored debug level
    npm test         # physics, world, bot, scorer, tracker, director, headless session
    npm run build

Keys: A/D or arrows move, Space/W/Up jump, H debug HUD, G bot ghost, R restart with a new seed.

Every tunable number is in `src/tuning.ts`. `src/sim` and `src/gen` are deterministic and never import from `src/game`.
