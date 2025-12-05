// Ensure codeEditor is globally accessible
let codeEditor;
let modifiedCodeEditor;
let originalCode = "";
let statusTimeoutId = null;

// Initialize CodeMirror for the code editors
document.addEventListener("DOMContentLoaded", () => {
    // Input code editor
    codeEditor = CodeMirror.fromTextArea(document.getElementById("code-editor"), {
        mode: "python",
        theme: "default",
        lineNumbers: true,
        indentUnit: 4,
        matchBrackets: true,
        lineWrapping: true,
    });
    codeEditor.setValue(""); // Start with empty editor

    // Add selection change listener
    codeEditor.on("cursorActivity", updateSelectionInfo);

    // Modified code editor (read-only)
    modifiedCodeEditor = CodeMirror(document.getElementById("modified-code-editor"), {
        mode: "python",
        theme: "default",
        lineNumbers: true,
        indentUnit: 4,
        matchBrackets: true,
        readOnly: true,
        lineWrapping: true,
    });

    // Add Ctrl+Enter shortcut for submitCode
    document.addEventListener("keydown", (event) => {
        if (event.ctrlKey && event.key === "Enter") {
            event.preventDefault(); // Prevent default behavior (e.g., new line)
            submitCode();
        }
    });

    // Add event listener for the Toggle Dark Mode button
    const toggleThemeButton = document.getElementById("toggle-theme");
    toggleThemeButton.addEventListener("click", () => {
        document.body.classList.toggle("dark-mode");
        // Update button icon based on mode
        if (document.body.classList.contains("dark-mode")) {
            toggleThemeButton.textContent = "🌞"; // Light mode icon
        } else {
            toggleThemeButton.textContent = "🌙"; // Night mode icon
        }
    });

    // Set initial icon based on default mode
    if (document.body.classList.contains("dark-mode")) {
        toggleThemeButton.textContent = "🌞";
    } else {
        toggleThemeButton.textContent = "🌙";
    }
});

// Status bar helper
function showStatus(message, type = "info", durationMs = 4000) {
    const bar = document.getElementById("status-bar");
    if (!bar) return;

    bar.textContent = message;

    bar.classList.remove(
        "status-bar--hidden",
        "status-bar--info",
        "status-bar--success",
        "status-bar--error"
    );
    bar.classList.add("status-bar", `status-bar--${type}`);

    if (statusTimeoutId) {
        clearTimeout(statusTimeoutId);
    }

    statusTimeoutId = setTimeout(() => {
        bar.classList.add("status-bar--hidden");
    }, durationMs);
}

// Function to update selection info (always hidden as per user request)
function updateSelectionInfo() {
    const selectionInfo = document.getElementById("selection-info");
    if (selectionInfo) {
        selectionInfo.style.display = "none"; // Always hide the selection info
    }
}

/**
 * Improved diff: line-based LCS (Longest Common Subsequence).
 * This gives much more accurate "what changed" than a naive scan.
 */
function highlightChanges(original, modified) {
    if (!modifiedCodeEditor) return;

    const originalLines = original.split("\n");
    const modifiedLines = modified.split("\n");

    // Clear existing highlights
    modifiedCodeEditor.getAllMarks().forEach((mark) => mark.clear());

    const m = originalLines.length;
    const n = modifiedLines.length;

    // Build LCS DP table
    const dp = Array(m + 1)
        .fill(null)
        .map(() => Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (originalLines[i] === modifiedLines[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    // Walk the DP to find which modified lines are unchanged
    const unchangedInModified = new Set();
    let i = 0;
    let j = 0;
    while (i < m && j < n) {
        if (originalLines[i] === modifiedLines[j]) {
            unchangedInModified.add(j);
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }

    // Any modified line not in unchangedInModified is changed → highlight
    for (let lineIdx = 0; lineIdx < n; lineIdx++) {
        if (unchangedInModified.has(lineIdx)) continue;
        const lineText = modifiedLines[lineIdx] || "";
        modifiedCodeEditor.markText(
            { line: lineIdx, ch: 0 },
            { line: lineIdx, ch: lineText.length },
            { css: "background-color: rgba(34, 197, 94, 0.2)" }
        );
    }
}

// Function to submit code and prompt to the backend with retry and exponential backoff
async function submitCode() {
    const loadingElement = document.getElementById("loading");
    const explanationArea = document.getElementById("explanation");
    const promptInput = document.getElementById("prompt-input");
    const maxRetries = 3;
    let attempt = 0;

    if (!loadingElement || !explanationArea || !promptInput) {
        console.error("DOM elements missing:", { loadingElement, explanationArea, promptInput });
        return;
    }

    async function attemptSubmission() {
        loadingElement.style.display = "flex";
        const code = codeEditor.getValue() || ""; // May be empty (for 'generate from prompt' mode)
        const prompt = promptInput.value.trim();
        const selectedCode = codeEditor.getSelection();

        // If original code is empty but modified code exists and prompt is provided, use modified code
        let baseCode = code;
        if (!code && modifiedCodeEditor.getValue() && prompt) {
            baseCode = modifiedCodeEditor.getValue();
        }

        modifiedCodeEditor.setValue("");
        explanationArea.innerText = ""; // Sanitized output

        if (!prompt) {
            explanationArea.innerText =
                "Tell PyGameCrafter what to do.\n\nExamples:\n" +
                "- 'Generate a simple Pygame game with a player that moves with arrow keys.'\n" +
                "- 'Improve collision detection in my platformer.'";
            showStatus(
                "Give us a clear game-related instruction so we can craft or refine your Python/Pygame code.",
                "info"
            );
            loadingElement.style.display = "none";
            return;
        }

        // IMPORTANT: we NO LONGER require baseCode to be non-empty.
        // If it's empty, backend will generate a brand-new Pygame game.
        const syntaxError = baseCode
            ? validatePythonSyntax(baseCode)
            : null;
        if (syntaxError) {
            explanationArea.innerText =
                "Your code looks a bit off:\n\n" +
                syntaxError +
                "\n\nFix the indentation/syntax, then let PyGameCrafter enhance your game.";
            showStatus("Your Python code has a syntax issue. Fix it, then we’ll help polish it.", "error");
            loadingElement.style.display = "none";
            return;
        }

        let backoff = 2000; // Start with 2 seconds

        while (attempt < maxRetries) {
            try {
                const response = await fetch("http://localhost:5000/improve-code", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        code: baseCode,        // may be "" → backend will generate from prompt
                        selected_code: selectedCode || "",
                        prompt: prompt,
                    }),
                });

                console.log("Response Status:", response.status);

                let result;
                try {
                    result = await response.json();
                } catch (parseError) {
                    console.error("Failed to parse JSON:", parseError);
                    explanationArea.innerText =
                        "PyGameCrafter couldn't understand the server response.\nCheck the backend logs and try again.";
                    showStatus("We hit a strange response from the server. Try again in a moment.", "error");
                    return;
                }

                console.log("Response Data:", result);

                if (response.ok) {
                    let modifiedCode = result.modified_code || "";
                    let explanation = result.explanation || "";
                    if (!modifiedCode) {
                        explanationArea.innerText =
                            "The model did not return any updated code. Try a more specific prompt about your Pygame game.";
                        showStatus("No updated code came back. Try a more specific game tweak.", "info");
                        return;
                    }

                    const previousOriginal = baseCode || ""; // may be empty if this was 'from prompt' generation
                    originalCode = baseCode || "";

                    modifiedCodeEditor.setValue(modifiedCode); // Show the full modified/generated code
                    highlightChanges(previousOriginal, modifiedCode); // Highlight changed lines (all lines if original was empty)
                    explanationArea.innerText = explanation; // Plain text output
                    promptInput.value = ""; // Clear the prompt input after successful response

                    if (previousOriginal) {
                        showStatus(
                            "Your Pygame code has been re-crafted. Check the changes on the right.",
                            "success"
                        );
                    } else {
                        showStatus(
                            "Generated a fresh Python/Pygame game from your prompt. Explore the code on the right.",
                            "success"
                        );
                    }
                    return; // Success, exit the loop
                } else if (response.status === 429) {
                    // Handle rate limit error
                    const retryAfter = response.headers.get("Retry-After");
                    const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : backoff;
                    console.warn(
                        `Rate limit exceeded. Retrying after ${waitTime / 1000} seconds...`
                    );
                    await new Promise((resolve) => setTimeout(resolve, waitTime));
                    backoff *= 2; // Double the backoff time for the next retry
                    attempt++;
                } else {
                    const serverError = result && result.error ? result.error : "Unknown error";
                    throw new Error(serverError);
                }
            } catch (error) {
                console.error("Fetch or processing error:", error);
                if (attempt < maxRetries - 1) {
                    const waitTime = backoff;
                    console.log(
                        `Retrying... Attempt ${attempt + 1} of ${maxRetries} in ${
                            waitTime / 1000
                        }s`
                    );
                    await new Promise((resolve) => setTimeout(resolve, waitTime));
                    backoff *= 2; // Double the backoff time for the next retry
                    attempt++;
                } else {
                    throw error; // Max retries reached, throw the error
                }
            }
        }
    }

    try {
        await attemptSubmission();
    } catch (error) {
        console.error("Final failure after retries:", error);
        explanationArea.innerText =
            "PyGameCrafter couldn't safely reshape or generate your code after several tries.\n\n" +
            "Tips:\n" +
            "- Use a more focused prompt (e.g. 'Generate a basic dodging game with a player and falling blocks')\n" +
            "- If improving an existing game, try with a smaller part of your code.\n\n" +
            `Technical note: ${error.message || String(error)}`;
        showStatus(
            "We struggled with this request. Try a simpler, more game-focused prompt.",
            "error"
        );
    } finally {
        loadingElement.style.display = "none";
    }
}

// Function to run the original code
async function runOriginalCode() {
    const code = codeEditor.getValue() || "";
    if (!code) {
        showStatus("There’s no code in the editor yet. Paste or generate a Pygame game first.", "info");
        return;
    }

    try {
        const response = await fetch("http://localhost:5000/run-code", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: code }),
        });
        console.log("Run Original Code Response Status:", response.status);
        let result;
        try {
            result = await response.json();
        } catch (err) {
            console.error("Failed to parse run-code JSON:", err);
            showStatus("We couldn’t read the run result from the server. Check the console/logs.", "error");
            return;
        }
        console.log("Run Original Code Response Data:", result);
        if (response.ok) {
            showStatus("Running your original Pygame code. Check the game window.", "success");
        } else {
            showStatus(
                `Error running original code: ${result.error || "Unknown error from backend."}`,
                "error"
            );
        }
    } catch (error) {
        console.error("Run Original Code Fetch Error:", error);
        showStatus(`Failed to run original code: ${error.message}`, "error");
    }
}

// Function to run the modified code
async function runModifiedCode() {
    const code = modifiedCodeEditor.getValue() || "";
    if (!code) {
        showStatus("There’s no modified code yet. Run a prompt to generate or improve code first.", "info");
        return;
    }

    try {
        const response = await fetch("http://localhost:5000/run-code", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ code: code }),
        });
        console.log("Run Modified Code Response Status:", response.status);
        let result;
        try {
            result = await response.json();
        } catch (err) {
            console.error("Failed to parse run-code JSON:", err);
            showStatus("We couldn’t read the run result from the server. Check the console/logs.", "error");
            return;
        }
        console.log("Run Modified Code Response Data:", result);
        if (response.ok) {
            showStatus("Running your PyGameCrafter-crafted Pygame code. Check the game window.", "success");
        } else {
            showStatus(
                `Error running modified code: ${result.error || "Unknown error from backend."}`,
                "error"
            );
        }
    } catch (error) {
        console.error("Run Modified Code Fetch Error:", error);
        showStatus(`Failed to run modified code: ${error.message}`, "error");
    }
}

// Function to clear the form
function clearForm() {
    codeEditor.setValue("");
    document.getElementById("prompt-input").value = "";
    modifiedCodeEditor.setValue("");
    document.getElementById("explanation").innerText = ""; // Sanitized output
    document.getElementById("selection-info").style.display = "none";
    originalCode = "";
    modifiedCodeEditor.getAllMarks().forEach((mark) => mark.clear()); // Clear highlights
    showStatus(
        "Cleared both editors. You can now paste an existing game or ask PyGameCrafter to generate one from a prompt.",
        "info"
    );
}

// Function to validate Python syntax (basic indentation check - just a heuristic)
function validatePythonSyntax(code) {
    const lines = code.split("\n");
    let indentLevel = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines
        const indent = lines[i].match(/^\s*/)[0].length / 4; // Count indent in terms of 4 spaces
        if (line.endsWith(":")) {
            indentLevel++; // Increase indent level after a colon
        } else if (indent < indentLevel && indentLevel > 0) {
            indentLevel = indent; // Allow dedentation to previous level
        } else if (indent > indentLevel + 1) {
            return `Indentation error at line ${i + 1}: unexpected indent`;
        }
    }
    return null;
}

// Function to integrate (replace input with modified code) and keep highlights
function integrateCode() {
    if (!codeEditor) {
        console.error("codeEditor is undefined");
        showStatus("Code editor is not ready yet. Try refreshing the page.", "error");
        return;
    }
    const modifiedCode = modifiedCodeEditor.getValue();
    console.log("Attempting to integrate Modified Code:", modifiedCode);
    if (!modifiedCode) {
        showStatus("No modified code to send to the editor yet. Run a prompt first.", "info");
        console.warn("Modified code is empty");
        return;
    }
    try {
        const originalBeforeIntegration = codeEditor.getValue();
        codeEditor.getDoc().setValue(modifiedCode);
        codeEditor.refresh();
        console.log("Editor updated with:", modifiedCode);
        document.getElementById("selection-info").style.display = "none";
        originalCode = modifiedCode; // Update original for future diffs
        // Keep the modified code and highlights in the modified editor
        modifiedCodeEditor.setValue(modifiedCode);
        highlightChanges(originalBeforeIntegration, modifiedCode);
        showStatus("Replaced the left editor with PyGameCrafter’s crafted game code.", "success");
    } catch (error) {
        console.error("Integration error:", error);
        showStatus("Integration failed: " + error.message, "error");
    }
}

// Function to save the modified code to a file
function saveCode() {
    const modifiedCode = modifiedCodeEditor.getValue();
    if (!modifiedCode) {
        console.warn("Modified code is empty");
        showStatus("No modified code to save yet. Run a prompt first.", "info");
        return;
    }
    try {
        const blob = new Blob([modifiedCode], { type: "text/x-python" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "pygamecrafter_game.py";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log("Code saved as pygamecrafter_game.py");
        showStatus("Saved your game as pygamecrafter_game.py.", "success");
    } catch (error) {
        console.error("Save error:", error);
        showStatus("Failed to save code: " + error.message, "error");
    }
}

// Function to copy modified code to clipboard
function copyToClipboard() {
    const modifiedCode = modifiedCodeEditor.getValue();
    if (!modifiedCode) {
        console.warn("Modified code is empty");
        showStatus("No modified code to copy yet. Run a prompt first.", "info");
        return;
    }
    try {
        navigator.clipboard
            .writeText(modifiedCode)
            .then(() => {
                console.log("Code copied to clipboard:", modifiedCode);
                showStatus("Copied PyGameCrafter’s game code to your clipboard.", "success");
            })
            .catch((error) => {
                console.error("Clipboard error:", error);
                showStatus("Failed to copy code: " + error.message, "error");
            });
    } catch (error) {
        console.error("Copy error:", error);
        showStatus("Failed to copy code: " + error.message, "error");
    }
}
