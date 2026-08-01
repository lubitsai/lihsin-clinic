"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { staffLogout } from "@/app/actions/admin";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await staffLogout();
          router.replace("/admin/login");
        })
      }
      disabled={pending}
      className="rounded-full border border-sage-300 text-sage-700 hover:bg-sage-100 px-3 py-1.5 font-medium transition"
    >
      登出
    </button>
  );
}
