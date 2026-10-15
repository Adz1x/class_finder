# Efficient MCP Server Usage

## Core Principles
- Only enable servers you actively use per session
- Use filesystem MCP for file read/write instead of manual commands
- Use github MCP for PR/issues instead of CLI
- Use memory MCP for cross-session persistence

## Workflow Tips
- Chain servers: search -> fetch -> filesystem write
- Test servers with simple commands first
- Monitor token usage per server call
- Cache results when possible

## Recommended Servers
- filesystem
- github
- memory
- puppeteer
- brave-search
- sequential-thinking
