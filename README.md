# Chuck-Lash

A small browser-based bachelor-party prompt game built for a fast launch. Players join on phones, the host runs the main screen, videos play on the host screen, players submit answers, vote, and see a leaderboard.

## Run locally

```bash
npm start
```

Open:

- Player phone view: `http://localhost:3000`
- Main game screen: `http://localhost:3000/screen.html`
- Host controls: `http://localhost:3000/host.html`

The default host PIN is `chucklash`.

## Render deployment

1. Push this repo to GitHub.
2. Create a Render Web Service from the repo.
3. Use:
   - Build command: leave blank or `npm install`
   - Start command: `npm start`
4. Add environment variables if desired:
   - `HOST_PIN`: host control password
   - `ROOM_CODE`: displayed room code

## Adding prompts and videos

Edit `data/prompts.json`.

```json
{
  "id": "round-1",
  "text": "The prompt everyone answers.",
  "videoUrl": "https://example.com/video.mp4",
  "mode": "all"
}
```

Modes:

- `all`: everyone answers, each voter can spend up to 3 votes.
- `duel`: two rotating players answer, everyone else gets one vote.

Video URLs:

- Direct `.mp4` links work best.
- YouTube links are embedded.
- Google Drive file share links are embedded as previews.

After editing prompts on the deployed server, use the host control **Reload Prompts**. On Render, the normal workflow is to edit locally, commit, push, and let Render redeploy.

## Party flow

1. Open `/screen.html` on the laptop/TV.
2. Open `/host.html` on your host device.
3. Have players open the main URL and enter a display name.
4. Host assigns Chuck with the **Bachelor** button.
5. Host clicks **Start Game**.
6. Players see the written prompt on their phones and submit answers.
7. Once submissions are in, host clicks **Reveal Video + Prompt**.
8. Main screen shows the video and written prompt.
9. Host clicks **Show Answers**.
10. Host can either click **Open Voting** or skip voting with **Next Phone Prompt**.
11. If voting is used, host clicks **Show Results**, then **Next Phone Prompt**.

Results are written to `data/results.json` and are also available from the host link **Open saved results JSON**.

## Demo walkthrough

Open `/screen.html` and `/host.html` side by side. In the host controls, use **Demo Walkthrough**:

- **Load Demo Lobby** creates fake players.
- **Fill Demo Answers** submits sample answers for the current prompt.
- **Cast Demo Votes** submits sample votes.
- **Auto-Run Round** automatically steps the main screen through lobby, answering, prompt reveal, answers, voting, and results.
