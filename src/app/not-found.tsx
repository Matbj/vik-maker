import Link from "next/link";
import { Notice } from "@/components/notice";

export default function NotFound() {
  return (
    <Notice title="Sidan hittades inte">
      <Link href="/" className="font-medium text-accent">
        Till träningarna
      </Link>
    </Notice>
  );
}
