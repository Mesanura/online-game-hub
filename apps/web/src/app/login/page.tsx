import { AuthForm } from "../../components/auth-form";

export default function LoginPage() {
  return (
    <div className="page-shell auth-page">
      <p className="eyebrow">账户</p>
      <h1>登录</h1>
      <p>登录后，新开的对局会归入你的账户历史。</p>
      <AuthForm mode="login" />
    </div>
  );
}
