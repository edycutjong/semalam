import { redirect } from "next/navigation";

// The game lives at /play; the landing page replaces this redirect.
export default function Home() {
  redirect("/play");
}
