from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
from dotenv import load_dotenv
import os
import re
import subprocess
import tempfile
import ast

app = Flask(__name__)
CORS(app)  # Allow frontend access

# Load environment variables
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


# ---------- Utilities ----------

def validate_syntax(code: str):
    """Validate Python syntax using ast."""
    try:
        ast.parse(code)
        return None
    except SyntaxError as e:
        return f"Syntax error: {str(e)} at line {e.lineno}"


def extract_between_tags(text: str, tag: str):
    """
    Extract content between <TAG> and </TAG>, non-greedy, including newlines.
    Returns the inner text or None if not found.
    """
    pattern = rf"<{tag}>([\s\S]*?)</{tag}>"
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()


# ---------- Routes ----------

@app.route("/improve-code", methods=["POST"])
def improve_code():
    """
    Uses Groq LLM to transform or generate code based on a prompt.

    Modes:
    - If code is provided (non-empty): improve/modify Python Pygame game code.
    - If code is empty and only a prompt is given: generate a new Python Pygame
      game or demo based purely on the prompt.

    We DO NOT ask the model to output JSON.
    Instead, we ask it to wrap the code in <CODE>...</CODE> and
    the explanation in <EXPLANATION>...</EXPLANATION>, and we parse that.
    Then we return clean JSON to the frontend.
    """
    global GROQ_API_KEY

    # Reload env in case you changed .env while server is running
    if GROQ_API_KEY is None:
        load_dotenv()
        GROQ_API_KEY = os.getenv("GROQ_API_KEY")

    if not GROQ_API_KEY:
        return jsonify({
            "error": (
                "GROQ_API_KEY is not set.\n"
                "PyGameCrafter needs a valid Groq API key in your .env file:\n"
                "GROQ_API_KEY=your_real_groq_key_here"
            )
        }), 500

    # Common mistake: putting an OpenAI key here
    if GROQ_API_KEY.startswith("sk-"):
        return jsonify({
            "error": (
                "Your GROQ_API_KEY looks like an OpenAI key (starts with 'sk-').\n"
                "PyGameCrafter uses Groq. Please create a Groq key and set it as GROQ_API_KEY."
            )
        }), 500

    data = request.json or {}
    code = data.get("code", "")  # May be empty
    prompt = data.get("prompt")
    selected_code = data.get("selected_code", "")  # The portion to modify

    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    # Normalize whitespace-only code to empty string
    code = code or ""
    if code.strip() == "":
        has_code = False
        code = ""
    else:
        has_code = True  # noqa: F841 (for clarity; not used directly)

    # Use full code as the base, with selected_code as the target for modification
    target_code = selected_code if selected_code.strip() else code

    # Instructions for both "improve code" and "generate from prompt" modes.
    ai_prompt = f"""
You are PyGameCrafter, an assistant that focuses on Python games built using Pygame.

You will receive:
- The full code of a file (which may be empty if the user hasn't provided any code yet).
- Optionally, a selected portion that the user wants to modify.
- A natural language prompt.

Behaviors:

1) WHEN THERE IS EXISTING CODE (non-empty):
   - Treat the given code as a Python/Pygame game (or close to it).
   - If a selected portion is non-empty:
       * Modify ONLY that selected portion, but you may use the full code for context.
   - If the selected portion is empty:
       * You may modify anywhere in the full code.
   - Apply the user's prompt to improve the game:
       * Examples: smoother movement, better collision, FPS cap, menus, UI, etc.
   - Then return the ENTIRE updated code (not just a diff).
   - In the explanation, concisely describe what you changed and why.

   If the prompt is clearly unrelated to Python/Pygame games (e.g., essays, websites, random chat),
   but code is provided, you should:
   - Leave the code mostly unchanged or make only game-relevant improvements.
   - Explain in the explanation that PyGameCrafter is focused on Python/Pygame games and how you
     interpreted the prompt in that context.

2) WHEN THERE IS NO EXISTING CODE (code is empty or only whitespace):
   - Treat the prompt as a request to CREATE a new Python + Pygame game or demo from scratch.
   - Generate a single-file Python script using Pygame that:
       * Opens a window.
       * Implements a simple game or demo inspired by the prompt
         (e.g., moving player, bouncing ball, obstacle dodging, etc.).
       * Is runnable as-is (assuming Pygame is installed).
   - If the prompt is vague or off-topic, you MUST STILL create a simple, reasonable Pygame demo.
       * For example: "a little square you can move with arrow keys, with a basic FPS cap".
   - In the explanation, clearly say that:
       * PyGameCrafter is focused on Python games using Pygame.
       * You generated a simple Pygame game that best matches the prompt.

IMPORTANT: You NEVER refuse to generate code just because the user did not paste any code.
If there is no code, you generate a new Pygame game file guided by the prompt.

OUTPUT FORMAT (VERY IMPORTANT):
Return your answer in EXACTLY this structure:

<CODE>
[PUT THE FULL UPDATED OR NEW PYTHON CODE HERE]
</CODE>
<EXPLANATION>
[PUT A SHORT, CLEAR EXPLANATION OF WHAT YOU DID HERE]
</EXPLANATION>

Rules:
- Do NOT wrap the output in JSON.
- Do NOT use Markdown code blocks or backticks.
- Do NOT add any other sections or tags.
- Everything between <CODE> and </CODE> must be valid Python code that can be saved as a .py file.
- Everything between <EXPLANATION> and </EXPLANATION> must be plain text.

Full Code (may be empty):
{code}

Selected Portion (may be empty):
{target_code}

User Prompt:
{prompt}
    """.strip()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {GROQ_API_KEY}",
    }
    payload = {
        "model": "llama-3.1-8b-instant",  # Groq model
        "messages": [{"role": "user", "content": ai_prompt}],
        "max_tokens": 2000,
    }

    try:
        response = requests.post(
            GROQ_API_URL,
            headers=headers,
            json=payload,
            timeout=40,
        )

        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError:
            status = response.status_code
            if status == 401:
                return jsonify({
                    "error": (
                        "Groq API returned 401 Unauthorized.\n"
                        "Check that your GROQ_API_KEY is correct, active, "
                        "and really a Groq key (not an OpenAI key)."
                    )
                }), 401
            else:
                return jsonify({
                    "error": f"Groq API error {status}: {response.text}"
                }), status

        # Groq's OpenAI-compatible response
        result_json = response.json()
        content = result_json["choices"][0]["message"]["content"]
        if content is None:
            return jsonify({"error": "Model returned empty content."}), 500

        content = content.strip()
        print("Raw Groq Response (first 500 chars):", content[:500] + ("..." if len(content) > 500 else ""))

        modified_code = extract_between_tags(content, "CODE")
        explanation = extract_between_tags(content, "EXPLANATION")

        if not modified_code:
            return jsonify({
                "error": (
                    "PyGameCrafter could not find a <CODE>...</CODE> block in the model response.\n"
                    "Try a simpler, more focused prompt about your Python/Pygame game."
                )
            }), 500

        if not explanation:
            explanation = (
                "No explanation provided by the model. "
                "PyGameCrafter updated or generated the code based on your prompt."
            )

        # Optional: validate syntax of the modified code server-side
        syntax_error = validate_syntax(modified_code)
        if syntax_error:
            # We still return the code so the user can see it, but include the error in explanation.
            explanation = (
                explanation
                + "\n\n[Server syntax check warning]\n"
                + syntax_error
            )

        return jsonify({
            "modified_code": modified_code,
            "explanation": explanation
        })

    except requests.exceptions.RequestException as e:
        return jsonify({
            "error": (
                "PyGameCrafter had trouble talking to the Groq API.\n"
                f"Details: {str(e)}"
            )
        }), 502
    except Exception as e:
        return jsonify({
            "error": (
                "PyGameCrafter hit an unexpected error while processing this request.\n"
                f"Details: {str(e)}"
            )
        }), 500


@app.route("/run-code", methods=["POST"])
def run_code():
    data = request.json or {}
    code = data.get("code", "")
    if not code:
        return jsonify({"error": "No code provided"}), 400

    # Validate syntax before running
    syntax_error = validate_syntax(code)
    if syntax_error:
        return jsonify({
            "error": (
                "Your Python code has a syntax issue. "
                "Fix this before running the Pygame window:\n"
                f"{syntax_error}"
            )
        }), 400

    try:
        # Set environment variable for SDL to ensure Pygame can find a video driver
        env = os.environ.copy()
        if "SDL_VIDEODRIVER" not in env:
            env["SDL_VIDEODRIVER"] = "windows" if os.name == "nt" else "x11"
            if not os.environ.get("DISPLAY") and os.name != "nt":
                env["SDL_VIDEODRIVER"] = "dummy"

        # Write code to a temporary file
        with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as temp_file:
            # Wrap the code in a Pygame loop with initialization check
            wrapped_code = (
                "import pygame\n"
                "import sys\n"
                "\n"
                "# Initialize Pygame and check if video system initialized successfully\n"
                "if pygame.init() == (0, 0):  # Returns (num_successful, num_failed)\n"
                "    print('Pygame initialization failed')\n"
                "    sys.exit(1)\n"
                "\n"
                "# Original code wrapped in a persistent loop\n"
                f"{code}\n"
                "\n"
                "running = True\n"
                "while running:\n"
                "    for event in pygame.event.get():\n"
                "        if event.type == pygame.QUIT:\n"
                "            running = False\n"
                "    pygame.display.flip()  # Ensure the display updates\n"
                "\n"
                "pygame.quit()\n"
            )
            temp_file.write(wrapped_code.encode("utf-8"))
            temp_file_path = temp_file.name

        # Run the code without a timeout, allowing it to run until the window is closed
        result = subprocess.run(
            ["python", temp_file_path],
            capture_output=True,
            text=True,
            env=env,
        )
        os.unlink(temp_file_path)  # Clean up

        stderr_lower = (result.stderr or "").lower()

        # Check for common Pygame errors in stderr, even if returncode is 0
        if "pygame.error" in stderr_lower or "no available video device" in stderr_lower:
            return jsonify({
                "error": (
                    "Pygame failed to initialize.\n"
                    "If you are running this in a headless environment, "
                    "make sure to use the 'dummy' video driver or run with a display.\n\n"
                    f"Details:\n{result.stderr}"
                )
            }), 500
        elif "pygame initialization failed" in stderr_lower:
            return jsonify({
                "error": (
                    "Pygame failed to initialize in this environment.\n"
                    "PyGameCrafter can still help you improve the code, "
                    "but you may need a proper display to actually run the game."
                )
            }), 500

        if result.returncode == 0:
            return jsonify({
                "output": result.stdout or
                "Code executed successfully (Pygame window should open until manually closed)."
            })
        else:
            return jsonify({"error": result.stderr}), 500

    except Exception as e:
        if "temp_file_path" in locals() and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)
        return jsonify({
            "error": (
                "Execution failed while running your Pygame code.\n"
                f"Details: {str(e)}"
            )
        }), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
