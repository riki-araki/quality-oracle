// app/api/auth/[...nextauth]/route.ts — Auth.js のルートハンドラ（decisions/0018）。
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
