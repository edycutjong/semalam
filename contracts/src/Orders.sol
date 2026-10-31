// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {RoundClock} from "./RoundClock.sol";

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}

/// @title Orders — sealed nightly orders. Stores nothing but nonces; the policy lives in the Committed event.
/// @notice `sealedBlob` is the policy JSON drand-timelocked to seedRound(round). Its keccak is checked off chain after
/// decryption (runner and CLI alike); the latest commit per account (max blockNumber, logIndex) is the one that plays.
contract Orders is RoundClock {
    uint256 public constant MAX_SEALED = 1536;

    bytes32 public constant COMMIT_TYPEHASH = keccak256(
        "Commit(address account,uint256 round,bytes32 policyHash,bytes32 sealedHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    mapping(address => uint256) public nonces;

    event Committed(uint256 indexed round, address indexed account, bytes32 policyHash, bytes sealedBlob);

    error WrongRound();
    error RoundClosed();
    error SealedTooLarge();
    error Expired();
    error BadSignature();

    constructor(uint256 genesis) RoundClock(genesis) {}

    function commit(uint256 round, bytes32 policyHash, bytes calldata sealedBlob) external {
        _commit(msg.sender, round, policyHash, sealedBlob);
    }

    /// @notice Self-relay: the player signs, our relayer pays the gas.
    function commitBySig(
        address account,
        uint256 round,
        bytes32 policyHash,
        bytes calldata sealedBlob,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert Expired();
        uint256 nonce = nonces[account]++;
        bytes32 structHash =
            keccak256(abi.encode(COMMIT_TYPEHASH, account, round, policyHash, keccak256(sealedBlob), nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        if (!_validSig(account, digest, signature)) revert BadSignature();
        _commit(account, round, policyHash, sealedBlob);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("SEMALAM Orders"), keccak256("1"), block.chainid, address(this))
        );
    }

    function _commit(address account, uint256 round, bytes32 policyHash, bytes calldata sealedBlob) private {
        if (round == 0 || round != currentRound()) revert WrongRound();
        if (block.timestamp >= closeTime(round)) revert RoundClosed();
        if (sealedBlob.length > MAX_SEALED) revert SealedTooLarge();
        emit Committed(round, account, policyHash, sealedBlob);
    }

    function _validSig(address account, bytes32 digest, bytes calldata sig) private view returns (bool) {
        if (account.code.length > 0) {
            try IERC1271(account).isValidSignature(digest, sig) returns (bytes4 magic) {
                return magic == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }
        if (sig.length != 65) return false;
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // reject malleable high-s signatures
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;
        address signer = ecrecover(digest, v, r, s);
        return signer != address(0) && signer == account;
    }
}
