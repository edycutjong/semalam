// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One round per day. Round r accepts commits in [GENESIS + (r-1) days, GENESIS + r days).
/// GENESIS is a 17:00 UTC instant, so every round closes at 00:00 WIB.
abstract contract RoundClock {
    uint256 public immutable GENESIS;

    constructor(uint256 genesis) {
        GENESIS = genesis;
    }

    function currentRound() public view returns (uint256) {
        if (block.timestamp < GENESIS) return 0;
        return (block.timestamp - GENESIS) / 1 days + 1;
    }

    function closeTime(uint256 round) public view returns (uint256) {
        return GENESIS + round * 1 days;
    }

    /// @notice season(1) = 0 (rehearsal, never crowned); season s = rounds 3s-1 .. 3s+1.
    function season(uint256 round) public pure returns (uint256) {
        return round < 2 ? 0 : (round - 2) / 3 + 1;
    }
}
