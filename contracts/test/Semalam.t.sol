// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Orders} from "../src/Orders.sol";
import {Results, IScrimmageSeason} from "../src/Results.sol";
import {Scrimmage, IWIF} from "../src/Scrimmage.sol";
import {MockWIF} from "../src/MockWIF.sol";

contract SemalamTest is Test {
    // 2026-11-07 17:00:00 UTC — planned mainnet GENESIS
    uint256 constant GENESIS = 1793984400;
    address constant POSTER = address(0x9057E4);
    address constant COMPUTE = address(0xC0FFEE);
    bytes32 constant HOUSE = keccak256("house-set");
    bytes32 constant SIMV = keccak256("semalam-sim/1");

    Orders orders;
    Scrimmage scrim;
    Results results;
    MockWIF wif;

    function setUp() public {
        vm.warp(GENESIS + 1 hours); // round 1 open
        wif = new MockWIF();
        orders = new Orders(GENESIS);
        scrim = new Scrimmage(IWIF(address(wif)), COMPUTE, GENESIS);
        results = new Results(POSTER, IScrimmageSeason(address(scrim)), GENESIS, HOUSE, SIMV);
    }

    // ---------- round clock ----------
    function test_clock() public view {
        assertEq(orders.currentRound(), 1);
        assertEq(orders.closeTime(1), GENESIS + 1 days);
        assertEq(orders.season(1), 0);
        assertEq(orders.season(2), 1);
        assertEq(orders.season(4), 1);
        assertEq(orders.season(5), 2);
    }

    /// A7: seedRound = first quicknet round at or after close + 300 s
    function testFuzz_seedRound(uint32 r) public view {
        vm.assume(r >= 1 && r < 100_000);
        uint256 t = results.closeTime(r) + 300;
        uint64 s = results.seedRound(r);
        uint256 emitted = 1692803367 + (uint256(s) - 1) * 3;
        assertGe(emitted, t);
        assertLt(emitted - 3, t);
    }

    // ---------- Orders ----------
    function test_commit_emits() public {
        bytes memory sealedBlob = new bytes(1536);
        vm.recordLogs();
        vm.prank(address(0xA11CE));
        orders.commit(1, keccak256("p"), sealedBlob);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[1], bytes32(uint256(1)));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(address(0xA11CE)))));
    }

    function test_commit_rejects() public {
        vm.expectRevert(Orders.SealedTooLarge.selector);
        orders.commit(1, bytes32(0), new bytes(1537));
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(2, bytes32(0), "");
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(0, bytes32(0), "");
        vm.warp(GENESIS + 1 days); // round 1 closed, round 2 open
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(1, bytes32(0), "");
        orders.commit(2, bytes32(0), "");
    }

    function _sign(uint256 pk, address account, uint256 round, bytes32 ph, bytes memory sealedBlob, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 sh = keccak256(
            abi.encode(orders.COMMIT_TYPEHASH(), account, round, ph, keccak256(sealedBlob), orders.nonces(account), deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", orders.domainSeparator(), sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_commitBySig_relay() public {
        (address player, uint256 pk) = makeAddrAndKey("player");
        bytes memory sealedBlob = hex"deadbeef";
        bytes memory sig = _sign(pk, player, 1, keccak256("p"), sealedBlob, block.timestamp + 600);
        vm.recordLogs();
        vm.prank(address(0xBEEF)); // relayer
        orders.commitBySig(player, 1, keccak256("p"), sealedBlob, block.timestamp + 600, sig);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(player))));
        assertEq(orders.nonces(player), 1);
        // replay of the same signature fails (nonce consumed)
        vm.expectRevert(Orders.BadSignature.selector);
        orders.commitBySig(player, 1, keccak256("p"), sealedBlob, block.timestamp + 600, sig);
    }

    function test_commitBySig_bindsSealed() public {
        (address player, uint256 pk) = makeAddrAndKey("player");
        bytes memory sig = _sign(pk, player, 1, keccak256("p"), hex"01", block.timestamp + 600);
        vm.expectRevert(Orders.BadSignature.selector);
        orders.commitBySig(player, 1, keccak256("p"), hex"02", block.timestamp + 600, sig);
        vm.expectRevert(Orders.Expired.selector);
        orders.commitBySig(player, 1, keccak256("p"), hex"01", block.timestamp - 1, sig);
    }

    // ---------- Results ----------
    function test_post() public {
        uint64 sr = results.seedRound(1);
        vm.prank(POSTER);
        vm.expectRevert(Results.TooEarly.selector);
        results.post(1, keccak256("r"), sr);

        vm.warp(GENESIS + 1 days + 300);
        vm.expectRevert(Results.NotPoster.selector);
        results.post(1, keccak256("r"), sr);
        vm.startPrank(POSTER);
        vm.expectRevert(Results.WrongDrandRound.selector);
        results.post(1, keccak256("r"), sr + 1);
        vm.expectRevert(Results.EmptyResult.selector);
        results.post(1, bytes32(0), sr);
        results.post(1, keccak256("r"), sr);
        vm.expectRevert(Results.AlreadyPosted.selector);
        results.post(1, keccak256("r2"), sr);
        vm.stopPrank();
        assertEq(results.resultOf(1), keccak256("r"));
        assertEq(results.drandRoundOf(1), sr);
    }

    function test_results_genesisMustMatchScrimmage() public {
        vm.expectRevert(Results.GenesisMismatch.selector);
        new Results(POSTER, IScrimmageSeason(address(scrim)), GENESIS + 1 days, HOUSE, SIMV);
    }

    // ---------- Scrimmage ----------
    function test_pay_burns80() public {
        address p = address(0xA11CE);
        wif.mint(p, 1000e18);
        vm.startPrank(p);
        wif.approve(address(scrim), 200e18);
        uint256 supply = wif.totalSupply();
        scrim.pay(1, 200e18, keccak256("draft"));
        vm.stopPrank();
        assertEq(wif.totalSupply(), supply - 160e18);
        assertEq(wif.balanceOf(COMPUTE), 40e18);
        assertEq(wif.balanceOf(address(scrim)), 0);
        assertEq(wif.balanceOf(p), 800e18);
        assertTrue(scrim.paidInSeason(p, 0));
    }

    function test_pay_rejects() public {
        address p = address(0xA11CE);
        wif.mint(p, 1000e18);
        vm.startPrank(p);
        wif.approve(address(scrim), 1000e18);
        vm.expectRevert(Scrimmage.WrongAmount.selector);
        scrim.pay(1, 201e18, bytes32(0));
        vm.expectRevert(Scrimmage.WrongRound.selector);
        scrim.pay(2, 200e18, bytes32(0));
        vm.stopPrank();
    }

    // ---------- crown ----------
    function test_crown_needsPaidSeason() public {
        address p = address(0xA11CE);
        wif.mint(p, 1000e18);
        vm.prank(p);
        wif.approve(address(scrim), 1000e18);

        vm.warp(GENESIS + 1 days + 1); // round 2 = season 1
        vm.prank(p);
        scrim.pay(2, 200e18, bytes32(0));

        vm.startPrank(POSTER);
        vm.expectRevert(Results.BadSeason.selector);
        results.crown(0, p, bytes32(0));
        vm.expectRevert(Results.SeasonOpen.selector);
        results.crown(1, p, bytes32(0));
        vm.warp(GENESIS + 4 days + 300); // round 4 closed + 300 s
        results.post(4, keccak256("r4"), results.seedRound(4));
        vm.expectRevert(Results.NotEligible.selector);
        results.crown(1, address(0xB0B), bytes32(0));
        results.crown(1, p, keccak256("policy"));
        vm.expectRevert(Results.AlreadyCrowned.selector);
        results.crown(1, p, keccak256("policy"));
        vm.stopPrank();
        assertEq(results.championOf(1), p);
    }
}
