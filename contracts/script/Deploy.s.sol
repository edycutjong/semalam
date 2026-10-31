// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Orders} from "../src/Orders.sol";
import {Results, IScrimmageSeason} from "../src/Results.sol";
import {Scrimmage, IWIF} from "../src/Scrimmage.sol";
import {MockWIF} from "../src/MockWIF.sol";

/// Deploy order Orders -> Scrimmage -> Results. WIF=0x0 deploys a labelled MockWIF (testnet only).
contract Deploy is Script {
    function run() external {
        uint256 genesis = vm.envUint("GENESIS");
        address poster = vm.envAddress("POSTER");
        address compute = vm.envAddress("COMPUTE");
        address wif = vm.envOr("WIF", address(0));
        bytes32 houseSetHash = vm.envBytes32("HOUSE_SET_HASH");
        bytes32 simVersion = keccak256(bytes("semalam-sim/1")); // must equal SIM_VERSION in packages/sim
        require(genesis % 1 days == 17 hours, "GENESIS must be a 17:00 UTC instant");

        vm.startBroadcast();
        if (wif == address(0)) {
            require(block.chainid != 4663, "MockWIF never on mainnet");
            wif = address(new MockWIF());
        }
        Orders orders = new Orders(genesis);
        Scrimmage scrim = new Scrimmage(IWIF(wif), compute, genesis);
        Results results = new Results(poster, IScrimmageSeason(address(scrim)), genesis, houseSetHash, simVersion);
        vm.stopBroadcast();

        console.log("WIF", wif);
        console.log("Orders", address(orders));
        console.log("Scrimmage", address(scrim));
        console.log("Results", address(results));
    }
}
