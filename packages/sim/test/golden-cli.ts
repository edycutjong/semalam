// Prints the 230-agent golden hash from a fresh process (used by sim.test.ts).
import { run } from "../src/index.ts";
import { field, RANDOMNESS } from "./fixture.ts";
import { OPTS } from "./opts.ts";
console.log(run(field(200), RANDOMNESS, OPTS).resultHash);
