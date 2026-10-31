// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Scrimmage, IWIF} from "../src/Scrimmage.sol";

interface IERC20Full is IWIF {
    function totalSupply() external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

/// Fork test against the REAL $WIF on Robinhood Chain 4663 (pinned block). Proves: no fee-on-transfer
/// (balance delta == amount), `burn` really lowers totalSupply by exactly 80%, 20% reaches COMPUTE.
/// Run: RPC_4663=https://rpc.mainnet.chain.robinhood.com forge test --match-contract WifFork
contract WifForkTest is Test {
    IERC20Full constant WIF = IERC20Full(0x5173b8eA6923c2d40267890D45C46a3480954773);
    address constant HOLDER = 0x08b04C9F00EbF99711598F1dc233917DC9eeECfb; // EOA holder seen in Transfer logs
    address constant COMPUTE = address(0xC0FFEE);
    uint256 constant FORK_BLOCK = 102548634;

    function test_fork_payBurnsRealWif() public {
        string memory rpc = vm.envOr("RPC_4663", string("https://rpc.mainnet.chain.robinhood.com"));
        vm.createSelectFork(rpc, FORK_BLOCK);
        assertEq(block.chainid, 4663);
        assertEq(WIF.decimals(), 18);

        uint256 genesis = block.timestamp - 1 hours; // round 1 open
        Scrimmage scrim = new Scrimmage(IWIF(address(WIF)), COMPUTE, genesis);

        uint256 supply0 = WIF.totalSupply();
        uint256 holder0 = WIF.balanceOf(HOLDER);
        assertGe(holder0, 200e18);

        vm.startPrank(HOLDER);
        WIF.approve(address(scrim), 200e18);
        scrim.pay(1, 200e18, keccak256("fork-draft"));
        vm.stopPrank();

        assertEq(holder0 - WIF.balanceOf(HOLDER), 200e18, "payer delta");
        assertEq(supply0 - WIF.totalSupply(), 160e18, "burned 80%");
        assertEq(WIF.balanceOf(COMPUTE), 40e18, "compute 20%");
        assertEq(WIF.balanceOf(address(scrim)), 0, "holds nothing");
        assertTrue(scrim.paidInSeason(HOLDER, 0));
    }
}
