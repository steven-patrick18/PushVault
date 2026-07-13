export default function Placeholder({
  title,
  milestone,
}: {
  title: string;
  milestone: string;
}) {
  return (
    <>
      <div className="page-title">{title}</div>
      <div className="page-sub">Coming soon</div>
      <div className="panel">
        <div className="empty">
          <div style={{ fontSize: 36, marginBottom: 10 }}>🚧</div>
          This screen ships with <b>{milestone}</b>.<br />
          Watch the <a href="/updates">Updates</a> page to see progress land in real time.
        </div>
      </div>
    </>
  );
}
