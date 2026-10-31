import { keccak256, toHex } from "viem";
export const OPTS = {
  round: 1n,
  drandRound: 33548730n,
  policySetHash: keccak256(toHex("fixture-policy-set")),
  houseSetHash: keccak256(toHex("fixture-house-set")),
};
