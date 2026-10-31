// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RoundClock} from "./RoundClock.sol";

interface IScrimmageSeason {
    function paidInSeason(address account, uint256 season) external view returns (bool);
    function GENESIS() external view returns (uint256);
}

/// @title Results — one result hash per night, bound to the drand beacon that seeded it. Holds no funds.
contract Results is RoundClock {
    uint256 public constant DRAND_GENESIS = 1692803367; // drand quicknet genesis_time
    uint256 public constant DRAND_PERIOD = 3; // seconds
    uint256 public constant SEED_DELAY = 300; // seed = first quicknet round at or after close + 300 s

    address public immutable POSTER;
    IScrimmageSeason public immutable SCRIMMAGE;
    bytes32 public immutable HOUSE_SET_HASH;
    bytes32 public immutable SIM_VERSION; // keccak256("semalam-sim/1"); the result hash encodes the string itself

    mapping(uint256 => bytes32) public resultOf;
    mapping(uint256 => uint64) public drandRoundOf;
    mapping(uint256 => address) public championOf;

    event Posted(uint256 indexed round, bytes32 resultHash, uint64 drandRound);
    event Crowned(uint256 indexed season, address account, bytes32 policyHash);

    error NotPoster();
    error TooEarly();
    error AlreadyPosted();
    error WrongDrandRound();
    error EmptyResult();
    error BadSeason();
    error SeasonOpen();
    error AlreadyCrowned();
    error NotEligible();
    error GenesisMismatch();

    constructor(
        address poster,
        IScrimmageSeason scrimmage,
        uint256 genesis,
        bytes32 houseSetHash,
        bytes32 simVersion
    ) RoundClock(genesis) {
        if (scrimmage.GENESIS() != genesis) revert GenesisMismatch();
        POSTER = poster;
        SCRIMMAGE = scrimmage;
        HOUSE_SET_HASH = houseSetHash;
        SIM_VERSION = simVersion;
    }

    function seedRound(uint256 round) public view returns (uint64) {
        uint256 t = closeTime(round) + SEED_DELAY;
        return uint64((t - DRAND_GENESIS + DRAND_PERIOD - 1) / DRAND_PERIOD + 1);
    }

    function post(uint256 round, bytes32 resultHash, uint64 drandRound) external {
        if (msg.sender != POSTER) revert NotPoster();
        if (round == 0 || block.timestamp < closeTime(round) + SEED_DELAY) revert TooEarly();
        if (resultOf[round] != bytes32(0)) revert AlreadyPosted();
        if (resultHash == bytes32(0)) revert EmptyResult();
        if (drandRound != seedRound(round)) revert WrongDrandRound();
        resultOf[round] = resultHash;
        drandRoundOf[round] = drandRound;
        emit Posted(round, resultHash, drandRound);
    }

    /// @notice POSTER attestation of the season pick; `semalam season <s>` re-derives it. Eligibility is on chain.
    function crown(uint256 s, address account, bytes32 policyHash) external {
        if (msg.sender != POSTER) revert NotPoster();
        if (s == 0) revert BadSeason();
        if (resultOf[3 * s + 1] == bytes32(0)) revert SeasonOpen();
        if (championOf[s] != address(0)) revert AlreadyCrowned();
        if (!SCRIMMAGE.paidInSeason(account, s)) revert NotEligible();
        championOf[s] = account;
        emit Crowned(s, account, policyHash);
    }
}
