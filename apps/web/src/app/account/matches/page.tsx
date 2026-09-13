import Link from "next/link";
import { Suspense } from "react";
import { MatchHistory } from "../../../components/match-history";

export default function AccountMatchesPage() {
  return (
    <div className="page-shell history-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">账户历史</p>
          <h1>我的对局</h1>
        </div>
        <Link className="text-link" href="/account">
          账户设置
        </Link>
      </div>
      <Suspense
        fallback={
          <p data-testid="history-loading" role="status">
            加载中…
          </p>
        }
      >
        <MatchHistory />
      </Suspense>
    </div>
  );
}
