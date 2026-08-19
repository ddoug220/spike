# Separate team and match state

The Team Roster owns reusable player data, match defaults own the prior Match Squad and first-set Starting Lineup, and each match session owns its squad snapshot, submitted set lineups, and changing On-court Lineup. We chose these boundaries because the previous shared lineup let live rotations and substitutions silently become the next match's setup and let later team edits rewrite historical meaning.
