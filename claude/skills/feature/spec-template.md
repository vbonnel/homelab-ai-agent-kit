# <Title in plain words>

Status: planning
Size: small | normal
Database change: no | yes - <what changes, and how it is applied>
New settings (.env keys): none | KEY_NAME - <what it is for>
Restart needed after merge: no | yes - <which service>

## Goal
<What the owner wants, in 1-3 sentences. What will be different afterwards.>

## Not doing
<What is explicitly out of scope, so Luna doesn't over-build.>

## Current situation
<Normal size only. The relevant files and how they work today.>

## Changes
<File by file. Be exact: file path, function/class, new behaviour, edge cases.>
- `path/to/file.py`: ...

## Tests to add or update
<Which tests, what they check. How they avoid the real database and outside
services (per AGENTS.md: throwaway test database, fakes, mocks).>

## Acceptance checks
- [ ] <Something checkable: "running X with Y gives Z">
- [ ] `scripts/test.sh` passes

## Notes for Luna
<Anything else: style to follow, traps to avoid, files not to touch.>
