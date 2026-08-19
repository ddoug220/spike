# Issue tracker: GitHub

Issues and PRDs for this repository live as GitHub issues. Use the `gh` CLI for all operations. Infer the repository from the current clone.

## Conventions

- Create: `gh issue create`
- Read: `gh issue view <number> --comments`
- List: `gh issue list`
- Comment: `gh issue comment <number>`
- Apply or remove labels: `gh issue edit <number>`
- Close: `gh issue close <number>`

Use machine-readable JSON output when a skill needs to filter issues, labels, comments, or dependencies.

## Pull requests as a triage surface

External pull requests are not a request surface. Do not include them in the `/triage` queue.

## Skill operations

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means read the GitHub issue and its comments.
- `/wayfinder` uses a labelled map issue with child issues.
- Use native GitHub sub-issues and blocking dependencies when available.
- If those features are unavailable, use task lists and a `Blocked by:` line.
- A ticket is ready only when it is open, unassigned, and all blockers are closed.
- Claim work by assigning the issue to the current GitHub user before implementation.
