import type { Metadata } from "next";
import Tonight from "@/components/Tonight";

export const metadata: Metadata = { title: "Tonight — write your orders · SEMALAM" };

export default function Play() {
  return <Tonight />;
}
