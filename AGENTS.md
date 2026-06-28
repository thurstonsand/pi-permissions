# AGENTS.md

`pi-permissions` hooks into pi's execution flow before tool calls execute, introducing a decision point for whether that tool execution should proceed. It allows for both programmatic decisions as well as user prompts for human-in-the-loop, and arbitrary complexity since the hooks are written in Typescript. Users may define their own hooks in their home directories, while projects may define their own specific hooks that have special logic/decision making.

## Project context

- See @CONTEXT.md for terminology and architecture vocabulary

## Ethos

pi has an ethos of foregoing permission prompts that Claude Code, Codex, etc have implemented, viewing them as unnecessary security theater. Thus the user is forced to think about what they unleash their agents onto instead of blindly trusting that the harness has made it safe. I largely agree with that principle, however I still find there are certain situations where I want to gate pi simply for my own workflow semantics. For example, I review LLM generated code and then `git add` the files as I go, as a means of keeping track of what I've reviewed, which means I rarely want pi to ever `git add` on its own as that could mess up my workflow. So I want to be able to force it to ask me before it takes actions like that. It's not to improve security, it's more to support my, and anyone else's, workflows.

## Design

This is human developer-focused tooling, meant to assist a developer in their agentic workflows with the pi coding agent. It should be highly flexible, similar in ethos to pi itself, and allow an author to only be limited by their own imagination. We are working within the confines of a pi coding harness extension, meaning we are NOT authors of pi itself and cannot make changes to that code base.

## Core principles

- Be flexible and extensible
- Clear and simple contract between extension and permission author, mirroring pi's extension contract
- Expose composable hooks that enable permission rules at different scopes (user vs project)
- Export helpful, but compact and precise types for permission authors
- Build on pi concepts, types, and extension patterns where they exist

## Code style

- See @DEV.md
