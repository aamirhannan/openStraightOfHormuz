# Strait of Hormuz - Frontend

This is the interactive client application for the asymmetric "Mine Layer vs Flipper" strategy game, built using Next.js.

## 🚀 Game Overview
Two roles clash across a real geographic map of the Strait of Hormuz:
* **The Mine Layer (Creator):** Plots hidden explosive mines inside the narrow waterways, constrained by an 8-way spacing rule to prevent unplayable "walls."
* **The Flipper:** Plays a high-states "Minesweeper-like" puzzle routing a ship from the Western entry (Persian Gulf) safely out to the Eastern or Southern exits (Gulf of Oman). 

### Features
* **Interactive Canvas Engine:** The grid dynamically scales over a high-resolution satellite image. Water tiles are calculated instantly using color-sampling algorithms mapping 20x20 transparent tiles to exact geographic waterways.
* **Persistent Sessions (No Auth Required):** User identity is maintained invisibly via randomized `localStorage` UUIDs matching the backend REST state, meaning you can reload the page or close your browser without losing your game.
* **Single Player Mode:** An "AI Commander" algorithm that actively parses random un-adjacent coordinate matrices automatically if you prefer to play a puzzle solo.
* **Instant URL Deep Linking:** Sharing `?room=HZ-XXXX` links automatically completes the join sequence.

## 🛠 Tech Stack
* **Framework:** Next.js (React / App Router)
* **Styling:** Tailwind CSS (Custom UI panels, fluid gradients)
* **Real-time Engine:** `socket.io-client` 
* **State Networking:** Synchronous REST API fetching for atomic movements.

## ⚙️ Local Setup Instructions

1. **Install Dependencies:**
   Ensure you are in the `frontend` directory.
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file in the `frontend` directory:
   ```env
   NEXT_PUBLIC_SERVER_URL=http://localhost:4000
   ```

3. **Run the Development Server:**
   ```bash
   npm run dev
   ```

4. **Access the Application:**
   Open your browser and navigate to `http://localhost:3000`. If you port-forward (e.g. using ngrok), the multiplayer will instantly work for remote players.
