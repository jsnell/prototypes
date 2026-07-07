# Subprime — The Boardgame (original design doc, as received)

## Elevator Pitch

Players (3-5) take on increasingly large amounts of loans to build their
real estate empire. As interest rates rise, some players might go bankrupt
while others get bailed out by the government.

## Game

### Components

- Turn order track - Lists the player order
- Bid track - Used to bid for how many loans to take + turn order
- Loan track - Used to track how many loans the players have taken
  combined, and the current interest rate
- Deck of real estate cards (100)
- Loan markers (50)
- Loan*10 chits (5)
- Money (indeterminate amount)
- Player markers (2 per player; 1 bid marker, 1 turn order marker)
- Insolvent! cards (5)
- 4 city boards, each split into three *zones* (commercial, industrial
  and residential), and each *zone* having a *block* for each player.
- Round marker (1)
- State subsidy markers (3)
- City subsidy markers (12)

### Setup

- Place one fewer city boards than there are players in the centre of the
  table
- Deal three rows of real estate cards to the centre of the table face up,
  each row having the number of players plus one cards.
- Place all the loan markers on the loan track
- Place the loan*10 chits to the side
- Place the round marker on spot 1 on the round track (next to the loan
  track)
- Give each player one loan markers from the first row of the loan track
  and $10 money
- Place the turn order marker of each player on the turn order track in
  random order.
- Place the bid markers near the bid track.

### Phases

1. Take loans and determine turn order
2. Buy real-estate
3. Collect income and pay interest
4. Bailout and end of the game
5. Cleanup

### Phase 1 - Take loans

In this phase, players decide how many loans they want to take, and
determine the new turn order.

In the inverse of the existing turn order (last to first), players place
their bid marker on an empty space on the bid track or pass. Once all players
have done this, the lowest current bid is given the opportunity to increase
their bid to a higher empty space or to pass.

When a player passes, their turn order marker goes to the last free spot on
the turn order track. They take the number of loans indicated by their
bid; one loan marker and $10 per bid loan. The player's bid marker is then
removed from the bid track.

The process of the lowest bid either being raised or the player passing
continues until all players have passed. In this way, the highest bidder will
go first, the second higher bidder will go second, etc.

**Running out of loan markers.**

If the supply of loan markers is exhausted, players can still take loans
in excess of the provided markers (use the provided loan chits). This will
trigger the game end.

### Phase 2 - Buy

In turn order, players take one action at a time until all players have
passed. The possible actions are:

**Pass** — The player is out of the round. Mark this by moving the
player's turn order marker to the side of the turn order track.

**Buy** — The player takes one card from the card display and pays for it.
The cost is the number printed on the lower right
corner of the card, multiplied by the card row they took the card from.
Players are not allowed to buy a card if they cannot pay the cost.

The player then places the card into the appropriate zone (residential,
commercial or industrial) on a city board of their choice. The card will
always go to that player's block in that zone.

### Phase 3 - Collect income

Players collect income and then pay interest for their loans.

**Update subsidies**

For each of the three building types, determine which city has the fewest
building of that type. Place a state subsidy marker in the appropriate
*zone* in the city. If there's a tie for the fewest buildings, don't
place a subsidy marker in any city.

For each zone of each city, determine which player has the most
buildings in that zone. Place a city subsidy marker in that player's *block*
in that zone. If there is a tie for most buildings, don't place a subsidy
marker in that zone.

**Collect income**

Each player then receives the income stated on the building cards they
own, possibly modified by the subsidy tokens in the zone/block:

- No subsidy: Receive the printed income for each card.
- Just a state subsidy: Receive the printed income for each card.
  Additionally receive $1 per owned card in that zone.
- Just a city subsidy: Receive the printed income for each card.
  Additionally receive $1 per owned card in that zone.
- Both city and state subsidies: Receive the printed income for each card.
  Additionally receive $3 per owned card in that zone.

**Pay interest**

Find the highest interest rate number visible on the loan track (not
covered by a loan marker). Each player must pay this amount in interest
for each loan they have.

If a player is unable to pay the full interest, they must pay as much as they
can, and are then declared insolvent. Mark this by giving the player an Insolvent!
card. The game will end in phase 4.

### Phase 4 - Bankruptcy and end of game

The game ends in this phase if any of the following conditions holds:

- One or more players is insolvent.
- The loan track is empty.
- The round marker is on space 6.

**Bankruptcy**

The player earliest in turn order who is insolvent has gone *bankrupt*.
They are out of the game and cannot win. Any other insolvent players
are *bailed out* by the government. As they have no cash, they will not
be able to take part in the bankruptcy auction.

**Bankruptcy auction**

For each city in the game, randomly choose one of the buildings of the
bankrupt player. This building is available for sale.

In turn order, all players who are not insolvent have the chance of
buying one of these buildings for its base price. There is only
one round of buying. Any bought buildings are moved to buyers' blocks in
the same zone. All other buildings stay in the same block.

The subsidy markers are not moved.

**End of game scoring**

After any possible bankruptcy has been resolved, the players who did not
go bankrupt count points. Scoring is as follows:

- 1vp per building
- For each city, the player with the most buildings scores 3vp. If tied,
  all tied players get 3vp.
- For each zone with a state subsidy marker: the player with the
  most buildings scores 1vp per building. If tied, all tied players score
  the points.

A bankrupt player's buildings still count for the majorities: if the
bankrupt player is the sole winner of a city/zone, nobody will score points.

Tiebreaker: if multiple players have the same number of vps, the tied player
with the most money wins. If this did not break the tie, the players rejoice
in a shared victory.

### Phase 5 - Cleanup

- Remove all subsidy markers from the board.
- Slide all cards down to the lowest available row in their column
- Fill the card display
- Advance the round marker to the next spot
- If there are any loans on the loan track below the current position of
  the round marker, remove those loan markers from the game. E.g. after
  round 3 there should never be any loan markers on row 1 or 2.
