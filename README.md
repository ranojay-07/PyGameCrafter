# PyGameCrafter 🎮

PyGameCrafter is a web-based AI assistant for building and refining **Python games using Pygame**.

You can:
- Paste your existing Pygame code and ask for improvements.
- Select a portion of code to refactor.
- Or just type a prompt (with no code) and let PyGameCrafter **generate a full Pygame game script** from scratch.

The app shows original vs modified code, highlights changes, explains what was done, and can run both versions locally.

---

## ✨ Features

- **Prompt → Game**: Give only a text prompt (e.g. _“endless runner with falling obstacles”_) and get a runnable Pygame script.
- **Code improvement**: Paste your existing Pygame game and ask for tweaks (movement, FPS cap, collisions, UI, etc.).
- **Partial edits**: Select a region of code in the editor to target only that part.
- **Change highlighting**: Modified lines are visually highlighted in the “modified code” panel.
- **Human-friendly messages**: In-app status bar instead of raw alerts or JSON blobs.
- **Run code**: Run original or modified code via a Flask API (opens a Pygame window on your machine).
- **Dark / light mode** toggle.
- **Save & copy**: Download modified code as a `.py` file or copy it to the clipboard.

---

## 🧱 Tech Stack

- **Frontend**
  - HTML, CSS, vanilla JavaScript
  - [CodeMirror](https://codemirror.net/) for the code editor
- **Backend**
  - Python 3
  - Flask + flask-cors
  - Pygame (for running games)
  - Groq API (OpenAI-compatible chat completion endpoint)
- **Other**
  - `python-dotenv` for environment variables

---

## 📁 Project Structure

```text
.
├── app.py           # Flask backend (API + Pygame runner)
├── index.html       # Main frontend UI
├── script.js        # Frontend logic (editors, API calls, status UI)
└── styles.css       # Styling for the app
