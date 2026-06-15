# CLAUDE.md

## What this repo is

This is a scratchpad for **early-stage project prototypes** — ideas in the
"doodling" phase, before they've proven themselves worth a dedicated repo.
It's intentionally low-ceremony: a place to sketch, experiment, and throw
things away.

## Structure

- **One top-level directory per project.** Each new idea gets its own
  directory at the root of the repo (e.g. `./my-new-thing/`). Everything for
  that prototype lives inside it.
- Keep projects self-contained within their directory. Avoid cross-project
  imports or shared code at the repo root — prototypes should be easy to lift
  out wholesale.

## Lifecycle

- Prototypes start here while they're still being figured out.
- If a prototype turns into something real, it **graduates**: its directory is
  moved out into its own standalone repo, and removed from here.
- This repo is therefore expected to churn — directories come and go, and
  abandoned experiments are fine to leave or delete.

## Guidance for working here

- When starting a new prototype, create a fresh top-level directory for it
  rather than adding to an existing one.
- Don't over-engineer. Favor the quickest path to seeing whether an idea
  works. Tooling, tests, and structure can stay minimal until a project is
  ready to graduate.
- Treat each project directory as its own little world; conventions can differ
  from one prototype to the next.
