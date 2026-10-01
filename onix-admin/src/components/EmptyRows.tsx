/**
 * One shared "nothing here yet" row for admin tables.
 *
 * A bare table with only headers reads as broken or still loading, which in a
 * money console invites an operator to re-click and double-apply an action.
 */
export function EmptyRows({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-cell muted">{label}</td>
    </tr>
  );
}