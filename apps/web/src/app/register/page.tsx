import { AuthForm } from "../../components/auth-form";

export default function RegisterPage() {
  return (
    <div className="page-shell auth-page">
      <p className="eyebrow">账户</p>
      <h1>创建账户</h1>
      <p>用户名只支持 3–24 位小写字母、数字和下划线。</p>
      <AuthForm mode="register" />
    </div>
  );
}
