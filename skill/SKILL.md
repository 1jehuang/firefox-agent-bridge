---
name: firefox-browser
description: Control the user's Firefox browser with their logins and cookies intact. Use when you need to browse websites as the user, interact with authenticated pages, fill forms, click buttons, take screenshots, or get page content.
allowed-tools: Bash, Read, Write
---

# Firefox Browser Automation Skill

This skill enables browser automation through Firefox using the user's actual browser session with their logins and cookies.

## Prerequisites

The Firefox MCP server should be running. If not available, use Playwright MCP as a fallback.

## Capabilities

1. **Navigate** - Go to URLs in the user's Firefox
2. **Screenshot** - Capture the current page
3. **Click** - Click elements on the page
4. **Type** - Enter text into form fields
5. **Scroll** - Scroll the page
6. **Get Content** - Extract text or HTML from the page

## Usage Pattern

When the user asks to interact with a website:

1. First check if the Firefox MCP tools are available
2. Use `browser_navigate` to go to URLs
3. Use `browser_snapshot` to understand page structure
4. Use `browser_click`, `browser_type` for interactions
5. Use `browser_take_screenshot` to show the user what happened

## Example Workflow

User: "Log into my GitHub and star a repo"

1. Navigate to github.com
2. Take snapshot to see current state
3. If logged in, proceed to the repo
4. Click the star button
5. Confirm with screenshot

## Notes

- The user's existing Firefox session is used, so they're already logged into their accounts
- Be careful with sensitive actions - confirm before submitting forms
- Use snapshots over screenshots when you need to interact with elements
