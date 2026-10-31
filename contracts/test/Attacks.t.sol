// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Orders} from "../src/Orders.sol";
import {Results, IScrimmageSeason} from "../src/Results.sol";
import {Scrimmage, IWIF} from "../src/Scrimmage.sol";
import {MockWIF} from "../src/MockWIF.sol";

/// @dev Takes a 1% fee on transferFrom — the balance-delta check must refuse it (A12).
contract FeeWIF {
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
        totalSupply += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        allowance[from][msg.sender] -= a;
        balanceOf[from] -= a;
        balanceOf[to] += a - a / 100;
        totalSupply -= a / 100;
        return true;
    }

    function burn(uint256 a) external {
        balanceOf[msg.sender] -= a;
        totalSupply -= a;
    }
}

/// @dev ERC-1271 smart account: accepts exactly one digest.
contract Wallet1271 {
    bytes32 public okDigest;

    function allow(bytes32 d) external {
        okDigest = d;
    }

    function isValidSignature(bytes32 d, bytes calldata) external view returns (bytes4) {
        return d == okDigest ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// @notice Attack corpus (A5, A8, A12, A16): field-stuffing, a second commit, posting before the seed delay, a double
/// post, replayed / stale / malleable signatures, short-paying tokens, crowning the ineligible.
contract AttacksTest is Test {
    uint256 constant GENESIS = 1793984400; // 2026-11-07 17:00 UTC
    address constant POSTER = address(0x9057E4);
    address constant COMPUTE = address(0xC0FFEE);
    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141; // secp256k1 order

    Orders orders;
    Scrimmage scrim;
    Results results;
    MockWIF wif;

    function setUp() public {
        vm.warp(GENESIS + 1 hours);
        wif = new MockWIF();
        orders = new Orders(GENESIS);
        scrim = new Scrimmage(IWIF(address(wif)), COMPUTE, GENESIS);
        results = new Results(
            POSTER, IScrimmageSeason(address(scrim)), GENESIS, keccak256("house"), keccak256("semalam-sim/1")
        );
    }

    function _digest(address account, uint256 round, bytes32 ph, bytes memory blob, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 sh =
            keccak256(abi.encode(orders.COMMIT_TYPEHASH(), account, round, ph, keccak256(blob), nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", orders.domainSeparator(), sh));
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------- Orders (A5) ----------
    function test_commit_beforeGenesis_wrongRound() public {
        vm.warp(GENESIS - 1);
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(1, bytes32(0), "");
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(0, bytes32(0), "");
    }

    function test_secondCommit_emitsNewEvent_latestWinsOffChain() public {
        vm.recordLogs();
        vm.startPrank(address(0xA11CE));
        orders.commit(1, keccak256("draft-1"), hex"01");
        orders.commit(1, keccak256("draft-2"), hex"02");
        vm.stopPrank();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 2);
        (bytes32 ph,) = abi.decode(logs[1].data, (bytes32, bytes));
        assertEq(ph, keccak256("draft-2"));
    }

    function test_closeBoundary() public {
        vm.warp(GENESIS + 1 days - 1); // last second of round 1
        orders.commit(1, bytes32(0), "");
        vm.warp(GENESIS + 1 days); // round 1 closed at exactly closeTime
        vm.expectRevert(Orders.WrongRound.selector);
        orders.commit(1, bytes32(0), "");
    }

    function testFuzz_fieldStuffing_sealedSize(uint16 len) public {
        bytes memory blob = new bytes(len);
        if (len > 1536) vm.expectRevert(Orders.SealedTooLarge.selector);
        orders.commit(1, bytes32(0), blob);
    }

    function test_commitBySig_tooLarge() public {
        (address p, uint256 pk) = makeAddrAndKey("p");
        bytes memory blob = new bytes(1537);
        bytes memory sig = _sig(pk, _digest(p, 1, bytes32(0), blob, 0, block.timestamp + 60));
        vm.expectRevert(Orders.SealedTooLarge.selector);
        orders.commitBySig(p, 1, bytes32(0), blob, block.timestamp + 60, sig);
    }

    function test_commitBySig_oldDraftSignatureIsDead() public {
        (address p, uint256 pk) = makeAddrAndKey("p");
        uint256 dl = block.timestamp + 600;
        bytes memory sig1 = _sig(pk, _digest(p, 1, keccak256("d1"), hex"d1", 0, dl)); // draft 1, nonce 0
        bytes memory sig2 = _sig(pk, _digest(p, 1, keccak256("d2"), hex"d2", 0, dl)); // draft 2, same nonce
        orders.commitBySig(p, 1, keccak256("d2"), hex"d2", dl, sig2);
        vm.expectRevert(Orders.BadSignature.selector); // the relayer cannot resurrect draft 1
        orders.commitBySig(p, 1, keccak256("d1"), hex"d1", dl, sig1);
    }

    function test_commitBySig_rejectsHighS() public {
        (address p, uint256 pk) = makeAddrAndKey("p");
        uint256 dl = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(p, 1, bytes32(0), "", 0, dl));
        bytes memory malleated = abi.encodePacked(r, bytes32(N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(Orders.BadSignature.selector);
        orders.commitBySig(p, 1, bytes32(0), "", dl, malleated);
    }

    function test_commitBySig_wrongRoundSigned() public {
        (address p, uint256 pk) = makeAddrAndKey("p");
        uint256 dl = block.timestamp + 600;
        bytes memory sig = _sig(pk, _digest(p, 2, bytes32(0), "", 0, dl));
        vm.expectRevert(Orders.BadSignature.selector); // signed for round 2, submitted as round 1
        orders.commitBySig(p, 1, bytes32(0), "", dl, sig);
    }

    function testFuzz_commitBySig_onlyTheAccountCanSign(uint256 signerPk, address account) public {
        signerPk = bound(signerPk, 1, N - 1);
        vm.assume(account != vm.addr(signerPk) && account.code.length == 0);
        uint256 dl = block.timestamp + 600;
        bytes memory sig = _sig(signerPk, _digest(account, 1, bytes32(0), "", 0, dl));
        vm.expectRevert(Orders.BadSignature.selector);
        orders.commitBySig(account, 1, bytes32(0), "", dl, sig);
    }

    function testFuzz_commitBySig_deadline(uint32 ahead, uint32 late) public {
        (address p, uint256 pk) = makeAddrAndKey("p");
        uint256 dl = block.timestamp + ahead;
        bytes memory sig = _sig(pk, _digest(p, 1, bytes32(0), "", 0, dl));
        vm.warp(block.timestamp + uint256(late) % 1 hours);
        if (block.timestamp > dl) vm.expectRevert(Orders.Expired.selector);
        orders.commitBySig(p, 1, bytes32(0), "", dl, sig);
    }

    function test_commitBySig_erc1271() public {
        Wallet1271 w = new Wallet1271();
        uint256 dl = block.timestamp + 600;
        bytes32 d = _digest(address(w), 1, keccak256("p"), hex"aa", 0, dl);
        vm.expectRevert(Orders.BadSignature.selector);
        orders.commitBySig(address(w), 1, keccak256("p"), hex"aa", dl, "");
        w.allow(d);
        orders.commitBySig(address(w), 1, keccak256("p"), hex"aa", dl, "");
        assertEq(orders.nonces(address(w)), 1);
    }

    // ---------- Results (A8) ----------
    function test_post_seedDelayBoundary() public {
        uint64 sr = results.seedRound(1);
        vm.warp(GENESIS + 1 days + 299);
        vm.prank(POSTER);
        vm.expectRevert(Results.TooEarly.selector);
        results.post(1, keccak256("r"), sr);
        vm.warp(GENESIS + 1 days + 300);
        vm.prank(POSTER);
        results.post(1, keccak256("r"), sr);
    }

    function test_post_roundZeroAndFuture() public {
        vm.warp(GENESIS + 10 days);
        vm.startPrank(POSTER);
        vm.expectRevert(Results.TooEarly.selector);
        results.post(0, keccak256("r"), 0);
        uint64 sr = results.seedRound(10);
        vm.expectRevert(Results.TooEarly.selector); // round 10 closes at GENESIS + 10 days; seed delay not over
        results.post(10, keccak256("r"), sr);
        vm.stopPrank();
    }

    function testFuzz_post_onlyPosterOnlySeedRound(address who, uint64 drand) public {
        vm.warp(GENESIS + 1 days + 300);
        uint64 sr = results.seedRound(1);
        vm.prank(who);
        if (who != POSTER) vm.expectRevert(Results.NotPoster.selector);
        else if (drand != sr) vm.expectRevert(Results.WrongDrandRound.selector);
        results.post(1, keccak256("r"), drand);
    }

    function test_post_unpostedRoundsSettleOldestFirstOrAnyOrder() public {
        vm.warp(GENESIS + 3 days + 300); // rounds 1–3 closed, none posted (missed nights)
        vm.startPrank(POSTER);
        results.post(1, keccak256("r1"), results.seedRound(1));
        results.post(2, keccak256("r2"), results.seedRound(2));
        results.post(3, keccak256("r3"), results.seedRound(3));
        vm.stopPrank();
        assertEq(results.resultOf(2), keccak256("r2"));
    }

    // ---------- Scrimmage (A12) ----------
    function testFuzz_pay_exactPriceOnly(uint256 amount) public {
        address p = address(0xA11CE);
        wif.mint(p, 1e30);
        vm.startPrank(p);
        wif.approve(address(scrim), type(uint256).max);
        uint256 supply = wif.totalSupply();
        if (amount != 200e18) {
            vm.expectRevert(Scrimmage.WrongAmount.selector);
            scrim.pay(1, amount, bytes32(0));
        } else {
            vm.recordLogs();
            scrim.pay(1, amount, keccak256("draft"));
            Vm.Log[] memory logs = vm.getRecordedLogs();
            (, uint256 amt, uint256 burned, uint256 toCompute) =
                abi.decode(logs[logs.length - 1].data, (bytes32, uint256, uint256, uint256));
            assertEq(burned + toCompute, amt);
            assertEq(toCompute, amt * 20 / 100);
            assertEq(supply - wif.totalSupply(), burned);
        }
        vm.stopPrank();
    }

    function test_pay_feeOnTransferToken_refused() public {
        FeeWIF fw = new FeeWIF();
        Scrimmage s2 = new Scrimmage(IWIF(address(fw)), COMPUTE, GENESIS);
        address p = address(0xA11CE);
        fw.mint(p, 1000e18);
        vm.startPrank(p);
        fw.approve(address(s2), 1000e18);
        vm.expectRevert(Scrimmage.TransferShort.selector);
        s2.pay(1, 200e18, bytes32(0));
        vm.stopPrank();
        assertFalse(s2.paidInSeason(p, 0)); // the revert rolls the flag back
    }

    function test_pay_withoutAllowance_reverts() public {
        address p = address(0xA11CE);
        wif.mint(p, 1000e18);
        vm.prank(p);
        vm.expectRevert();
        scrim.pay(1, 200e18, bytes32(0));
        assertFalse(scrim.paidInSeason(p, 0));
    }

    // ---------- crown (A16) ----------
    function test_crown_notPoster_houseIdNeverEligible() public {
        vm.warp(GENESIS + 4 days + 300);
        uint64 sr4 = results.seedRound(4); // read before prank: an external call would consume it
        vm.prank(POSTER);
        results.post(4, keccak256("r4"), sr4);
        vm.expectRevert(Results.NotPoster.selector);
        results.crown(1, address(0xA11CE), bytes32(0));
        vm.startPrank(POSTER);
        for (uint160 i = 1; i <= 30; i++) {
            vm.expectRevert(Results.NotEligible.selector);
            results.crown(1, address(i), bytes32(0));
        }
        vm.stopPrank();
    }

    function test_crown_seasonTwoNeedsRound7() public {
        vm.warp(GENESIS + 6 days + 300);
        vm.startPrank(POSTER);
        results.post(6, keccak256("r6"), results.seedRound(6));
        vm.expectRevert(Results.SeasonOpen.selector);
        results.crown(2, address(0xA11CE), bytes32(0));
        vm.stopPrank();
    }

    function test_crown_inFirstDeployBytecode() public view {
        bytes memory code = address(results).code;
        bytes4 sel = Results.crown.selector;
        bool found;
        for (uint256 i = 0; i + 4 <= code.length; i++) {
            if (code[i] == sel[0] && code[i + 1] == sel[1] && code[i + 2] == sel[2] && code[i + 3] == sel[3]) {
                found = true;
                break;
            }
        }
        assertTrue(found, "crown selector in runtime bytecode");
    }
}
