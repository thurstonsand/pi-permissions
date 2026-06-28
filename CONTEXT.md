# Context

- Agent/Pi: The coding harness that loads and runs this extension
- Author: A person who writes user-level or project-level permission modules
- Approver: The person running the Pi session who sees permission prompts and approves or rejects tool use
- Permission module: A TypeScript module loaded by `pi-permissions` that registers permission hooks
- User-level: In the context of an individual user's machine; typically within `~/.pi/agent` folder
- Project-level: In the context of an individual project/repo/folder; may have project-specific settings/permissions
- Trusted directory: Pi concept that determines if Pi, and by extension this extension, loads settings that are present in a project/directory
- Permission hook: A registered check that can inspect one tool call and return a permission decision
- Matcher: The part of a permission hook that selects which tool calls the hook should inspect
- Permission decision: The result of a permission hook: pass, block, or request
- Request: A permission decision that asks the Approver whether a tool call should proceed
- Guidance: Optional request-specific text an Author adds to a prompt in addition to the hook description
- Prompt: The text and labels shown to the Approver for a request, in totality
- Permission root: The directory that contains the permission module or permission package currently handling a hook
- Custom tool: A non-built-in Pi tool registered by an extension
