# Spike Match Tracking

Spike records a volleyball match quickly enough for courtside use while keeping every score, player statistic, and review statement traceable to what the operator recorded.

## Team and setup

**Team Roster**:
The saved players who belong to a team and can be considered for future matches.
_Avoid_: Player pool, match roster

**Match Squad**:
The Team Roster players marked available for one match. The Starting Lineup and bench both come from this group.
_Avoid_: Active roster, available roster

**Match Setup**:
The opponent, Match Squad, first serve, and first set Starting Lineup chosen before a match starts.
_Avoid_: Team setup, lineup selection

**Starting Lineup**:
The six Match Squad players and their P1-P6 Court Positions submitted before a set starts.
_Avoid_: Rotation, starters

**On-court Lineup**:
The six players and Court Positions at the current moment of a live set. Rotations and substitutions can make it differ from the Starting Lineup.
_Avoid_: Starting Lineup, rotation

## Live match

**Court Position**:
One physical P1-P6 location occupied by a player on the court.
_Avoid_: Team Rotation, rotation position

**Team Rotation**:
The team's R1-R6 orientation relative to the Starting Lineup submitted for the current set.
_Avoid_: Court Position, lineup

**Rally Outcome**:
The recorded event that awards one point and completes the current rally.
_Avoid_: Player action, point tap

**Stat Observation**:
A recorded player action during a rally that does not award a point or complete the rally.
_Avoid_: Rally Outcome, stat tap

**Player Attribution**:
The link between a Rally Outcome or Stat Observation and the player who performed it.
_Avoid_: Active player, selected position

**Side-out Opportunity**:
A completed rally that began with the opponent serving.

**Side-out Conversion**:
A Side-out Opportunity that the tracked team won.

**Rotation Rally Win Rate**:
The tracked team's rally wins divided by all completed Rally Outcomes that began in the same Team Rotation.
_Avoid_: Rotation efficiency, position performance

## Match result

**Completed Match**:
A match that reached the configured winning condition through recorded Rally Outcomes.
_Avoid_: Ended match

**Ended-early Match**:
A match stopped before the winning condition. It preserves recorded facts but has no final win or loss.
_Avoid_: Completed Match, abandoned match

**Match Review**:
The read-only factual account of a live, Completed, or Ended-early Match.
_Avoid_: Analytics dashboard, recap
