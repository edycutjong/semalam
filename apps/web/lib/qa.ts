// Our own QA accounts (build/evidence/qa-accounts-46630.json) are labelled wherever they appear: they played real
// commits, but they are not users, testers or traction.
import qaFile from "../../../evidence/qa-accounts-46630.json";
import { CHAIN_ID } from "./config";

const QA = new Set(qaFile.chainId === CHAIN_ID ? qaFile.accounts.map((a) => a.toLowerCase()) : []);
export const isQA = (account: string) => QA.has(account.toLowerCase());
