#!/usr/bin/env node
/**
 * Postinstall script - runs after npm install
 * Prints helpful next steps but doesn't auto-setup anything
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║             firefox-agent-bridge installed!                  ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  NEXT STEPS:                                                 ║
║                                                              ║
║  1. Install the Firefox extension:                           ║
║     - Open Firefox, go to about:debugging                    ║
║     - Click "Load Temporary Add-on"                          ║
║     - Select extension/manifest.json from this package       ║
║                                                              ║
║  2. Test connection:                                         ║
║     $ browser ping                                           ║
║                                                              ║
║  3. (Optional) Setup for Claude Code:                        ║
║     $ browser setup claude                                   ║
║                                                              ║
║  For help: browser --help                                    ║
║  Full docs: browser docs                                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
