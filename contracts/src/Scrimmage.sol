// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RoundClock} from "./RoundClock.sol";

interface IWIF {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
}

/// @title Scrimmage — the fee for practising a draft. 80% of every payment is burned, 20% goes to compute.
/// @notice Immutable, no owner, no withdrawal. Holds no balance between calls.
contract Scrimmage is RoundClock {
    uint256 public constant MIN_PRICE = 200e18;
    uint256 public constant COMPUTE_BPS = 2000;

    IWIF public immutable WIF;
    address public immutable COMPUTE;

    mapping(address => mapping(uint256 => bool)) public paidInSeason;

    event Paid(
        address indexed payer, uint256 indexed round, bytes32 draftHash, uint256 amount, uint256 burned, uint256 toCompute
    );

    error WrongRound();
    error WrongAmount();
    error TransferShort();
    error TransferFailed();
    error BurnFailed();
    error ZeroAddress();

    constructor(IWIF wif, address compute, uint256 genesis) RoundClock(genesis) {
        if (address(wif) == address(0) || compute == address(0) || compute == address(this)) revert ZeroAddress();
        WIF = wif;
        COMPUTE = compute;
    }

    function pay(uint256 round, uint256 amount, bytes32 draftHash) external {
        if (round == 0 || round != currentRound()) revert WrongRound();
        if (amount != MIN_PRICE) revert WrongAmount();

        paidInSeason[msg.sender][season(round)] = true;

        uint256 before = WIF.balanceOf(address(this));
        if (!WIF.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (WIF.balanceOf(address(this)) - before != amount) revert TransferShort();

        uint256 toCompute = amount * COMPUTE_BPS / 10_000;
        uint256 burned = amount - toCompute;
        if (!WIF.transfer(COMPUTE, toCompute)) revert TransferFailed();
        WIF.burn(burned);
        // I1: nothing stays behind — a burn that silently did nothing would leave 160 WIF here
        if (WIF.balanceOf(address(this)) != before) revert BurnFailed();

        emit Paid(msg.sender, round, draftHash, amount, burned, toCompute);
    }
}
