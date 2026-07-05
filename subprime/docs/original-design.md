# Subprime — The Boardgame (original design doc, as received)

## Elevator Pitch

Players (3-5) take on increasingly large amounts of loans to build their
real estate empire. As interest rates rise, some players might go bankrupt
while others get bailed out by the government. The player with the largest

## Game

### Components

- Turn order track - Lists the player order
- Bid track - Used to bid for how many loans to take + turn order
- Loan track - Used to track how many loans the players have taken
  combined, and the current interest rate
- Deck of real estate cards (100)
- Loan markers (50)
- Money (indeterminate amount)
- Player markers (14 per player; 1 bid marker, 1 turn order marker;
  12 ownership markers)
- 4 city boards
- 1 round marker
- 3 state subsidy markers
- 12 city subsidy markers

### Setup

- Place one fewer city boards than there are players in the centre of the
  table
- Deal three rows of real estate cards to the centre of the table face up,
  each row having the number of players plus one cards.
- Place all the loan markers on the loan track
- Place the round marker on spot 1 on the round track (next to the loan
  track)
- Give each player one loan marker and $10 money
- Place the turn order marker of each player on the turn order track in
  random order.
- Place the bid marker of each player near the bid track.
- Give each player their ownership markers

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
their bid marker on an empty space on the bid track to mark their initial
bid. Once all players have placed their initial bid, the player with the
lowest current bid is given the opportunity to increase their bid to a
higher empty space or to pass.

If a player passes, their turn order marker goes to the last free spot on
the turn order track. They take the number of loans indicated by their
bid; one loan marker and $10 per bid loan. The player's bid marker is then
removed from the bid track.

The process of the lowest bid either being raised or the player passing
continues until all players have passed.

Running out of loan markers.

### Phase 2 - Buy

In turn order, players take one action at a time until all players have
passed. The possible actions are:

**Pass** — The player is out of the round. Mark this by moving the
player's turn order marker to the side of the turn order track.

**Buy** — The player takes one card from the card display and any money on
it, and pays for it. The cost is the number printed on the lower right
corner of the card, multiplied by the card row they took the card from.
Players are not allowed to buy a card if they cannot pay the cost. The
money on a building may be used to pay for the building.

The player then places the card into the appropriate section (residential,
commercial or industrial) on a city board of their choice, and marks it
with their ownership marker. Buildings of the same type owned by the same
player may be stacked.

### Phase 3 - Collect income

Players collect income and then pay interest for their loans.

**Determining income**

For each of the three building types, determine which city has the fewest
building of that type. Place a state subsidy marker on the appropriate
section in the city. If there's a tie for the fewest buildings, don't
place a subsidy marker on any city.

For each section of each city, determine which player has the most
buildings in that section. Place a city subsidy marker next to that
player's cards in that city section. If there is a tie for most buildings,
don't place a subsidy marker for that section.

Each player then receives the income stated on the building cards they
own, possibly modified by the subsidy tokens in that section:

- No subsidy: Receive the printed income for each card.
- Just a state subsidy: Receive the printed income for each card.
  Additionally receive $1 per owned card in that section.
- Just a city subsidy: Receive the printed income for each card.
  Additionally receive $1 per owned card in that section.
- Both city and state subsidies: Receive the printed income for each card.
  Additionally receive $3 per owned card in that section.

**Pay interest**

Find the highest interest rate number visible on the loan track (not
covered by a loan marker). Each player must pay this amount in interest.
If a player is unable to pay the full interest, they should pay as much as
they can.

### Phase 4 - Bankruptcy and end of game

The game ends in this phase if any of the following conditions holds:

- A player was unable to pay their loans. See bankruptcy.
- The loan track is empty.
- The round marker is on space 6.

**Bankruptcy**

The player earliest in turn order who was unable to pay their loans has
gone bankrupt. They are out of the game and cannot win. Any other players
who were unable to pay their loans are bailed out by the government, but
cannot at this point have any money left for the bankruptcy auction.

For each city in the game, remove all the buildings owned by the bankrupt
player. Randomly choose one of the cards to place next to the city. This
building is available for sale. The other buildings are returned to the
appropriate section on the city board without ownership markers.

In player order, all players who are not bankrupt have the chance of
buying one of these buildings for its normal purchase price. There is only
one round of buying. Any buildings that were not bought are returned to
the appropriate city section of the city board without ownership markers.

**End of game scoring**

After any possible bankruptcy has been resolved, the players who are still
in the game count points. Scoring is as follows:

- 1vp per building
- For each city, the player with the most buildings scores 3vp. If tied,
  all tied players get 3vp.
- For each city section with a state subsidy marker: the player with the
  most buildings scores 1vp per building. If tied, all tied players score
  the points.

### Phase 5 - Cleanup

- Remove all subsidy markers from the board.
- Put $1 on any unpicked cards in row 1.
- Slide all cards down to the lowest available row in their column
- Fill the card display
- Advance the round marker to the next spot
- If there are any loans on the loan track below the current position of
  the round marker, remove those loan markers from the game. E.g. after
  round 3 there should never be any loan markers on row 1 or 2.
