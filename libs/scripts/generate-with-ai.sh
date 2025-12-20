#!/bin/bash

# --- CONFIG ---
export PATH=$PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
# Your API key
API_KEY="$GEMINI_API_KEY"
MODEL="gemini-flash-lite-latest"

# 1. Check staged files
added_files=$(git diff --cached --name-only)
if [ -z "$added_files" ]; then
  # If no files are staged, display a notification (because the script runs silently)
  osascript -e 'display notification "Please stage files before running the script!" with title "AI Commit Error"'
  exit 1
fi

# 2. Get content
diff_content=$(git diff --cached)

# 3. Create JSON
json_payload=$(jq -n \
  --arg diff "$diff_content" \
  --arg prompt "Generate a concise, conventional commit message (e.g., feat:, fix:) for the following changes. Just the message, no quotes." \
  '{
    contents: [{
      parts: [{
        text: ($prompt + "\n\n" + $diff)
      }]
    }]
  }')

# 4. Call API
response=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: $API_KEY" \
  -d "$json_payload")

# 5. Parse result
commit_msg=$(echo "$response" | jq -r '.candidates[0].content.parts[0].text // empty')
commit_msg=$(echo "$commit_msg" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

if [ -z "$commit_msg" ] || [ "$commit_msg" == "null" ]; then
  osascript -e 'display notification "API or JSON error" with title "AI Commit Error"'
  exit 1
fi

# 6. Copy to Clipboard (MacOS)
echo "$commit_msg" | pbcopy

# 7. Automatically paste (Simulate Cmd + V)
# This command requires Accessibility permission
osascript -e 'tell application "System Events" to keystroke "v" using command down'