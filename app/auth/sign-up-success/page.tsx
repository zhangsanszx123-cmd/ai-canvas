import { redirect } from "next/navigation";
export default function SignUpSuccess() {
  redirect("/protected");
}
