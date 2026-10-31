"use client";
import { useState } from "react";
import { copyText } from "@/lib/ls";

export default function HashLine({ value, short, href }: { value: string; short?: boolean; href?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = short ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  return (
    <span className="hash data">
      {href ? <a href={href}>{shown}</a> : <span>{shown}</span>}
      <button type="button" className="quiet" aria-label={`Copy ${value}`} onClick={() => { copyText(value).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1200); }); }}>
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
