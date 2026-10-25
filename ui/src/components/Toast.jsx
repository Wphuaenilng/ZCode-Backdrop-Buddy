export default function Toast({ toast }) {
  return (
    <div className={`toast${toast ? ' show' : ''}`} role="status" data-testid="toast">
      {toast ? toast.message : ''}
    </div>
  );
}
