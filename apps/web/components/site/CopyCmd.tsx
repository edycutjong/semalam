"use client";
import { useState } from "react";
import { copyText } from "@/lib/ls";

/** A command a judge can paste: the text is always visible; the button only copies it. */
export default function CopyCmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copycmd">
      <code className="cmd">{cmd}</code>
      <button type="button" onClick={async () => { setDone(await copyText(cmd)); window.setTimeout(() => setDone(false), 1600); }} aria-label="Copy the replay command">{done ? "copied" : "copy"}</button>
    </div>
  );
}
