// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @notice Second implementation of every hash encoding the simulator and the CLI use, checked against the byte-level
/// vectors in fixtures/golden/vectors.json (written by the TypeScript generator). If these agree, a judge can rebuild
/// the posted resultHash from the ranking with nothing but abi.encode.
contract VectorsTest is Test {
    struct Row {
        address account;
        uint256 coins;
    }

    struct PolicyRow {
        address account;
        bytes32 policyHash;
    }

    string json;

    function setUp() public {
        json = vm.readFile("../fixtures/golden/vectors.json");
    }

    function test_tieKey_isEncodePacked_randomness_id() public view {
        bytes32 randomness = vm.parseJsonBytes32(json, ".randomness");
        for (uint256 i = 0; i < 2; i++) {
            string memory k = string.concat(".tieKeys[", vm.toString(i), "]");
            address id = vm.parseJsonAddress(json, string.concat(k, ".id"));
            assertEq(keccak256(abi.encodePacked(randomness, id)), vm.parseJsonBytes32(json, string.concat(k, ".hash")));
        }
    }

    function test_policySetHash_sortedAbiEncode() public view {
        PolicyRow[] memory rows = new PolicyRow[](2);
        // vector rows are given unsorted; sorted by address ascending: rows[1] (0x…01) then rows[0]
        rows[0] = PolicyRow(
            vm.parseJsonAddress(json, ".policySet.rows[1].account"),
            vm.parseJsonBytes32(json, ".policySet.rows[1].policyHash")
        );
        rows[1] = PolicyRow(
            vm.parseJsonAddress(json, ".policySet.rows[0].account"),
            vm.parseJsonBytes32(json, ".policySet.rows[0].policyHash")
        );
        assertLt(uint160(rows[0].account), uint160(rows[1].account));
        assertEq(keccak256(abi.encode(rows)), vm.parseJsonBytes32(json, ".policySet.hash"));
    }

    function test_resultHash_abiEncode() public view {
        Row[] memory ranking = new Row[](2);
        for (uint256 i = 0; i < 2; i++) {
            string memory k = string.concat(".resultHash.ranking[", vm.toString(i), "]");
            ranking[i] = Row(
                vm.parseJsonAddress(json, string.concat(k, ".id")), vm.parseJsonUint(json, string.concat(k, ".coins"))
            );
        }
        bytes32 h = keccak256(
            abi.encode(
                vm.parseJsonString(json, ".simVersion"),
                vm.parseJsonUint(json, ".resultHash.round"),
                uint64(vm.parseJsonUint(json, ".resultHash.drandRound")),
                vm.parseJsonBytes32(json, ".resultHash.randomness"),
                vm.parseJsonBytes32(json, ".resultHash.policySetHash"),
                vm.parseJsonBytes32(json, ".resultHash.houseSetHash"),
                ranking
            )
        );
        assertEq(h, vm.parseJsonBytes32(json, ".resultHash.hash"));
        assertEq(keccak256(bytes(vm.parseJsonString(json, ".simVersion"))), keccak256("semalam-sim/1"));
    }
}
